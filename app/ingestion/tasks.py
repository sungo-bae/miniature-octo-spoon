"""테넌트별 사방넷 데이터 폴링 Celery 태스크.

흐름: dispatch_* (활성 테넌트 순회) -> pull_orders_for_tenant / pull_inventory_for_tenant
     (테넌트 1곳 처리: API 호출 -> raw 저장 -> mapper -> upsert -> 실행 로그 기록)
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.celery_app import celery_app
from app.core.security import CredentialCipher
from app.db.session import SessionLocal
from app.etl.normalize import upsert_inventory_snapshot, upsert_order
from app.integrations.sabangnet.client import SabangnetCredential, SabangnetFulfillmentClient
from app.integrations.sabangnet.exceptions import SabangnetError
from app.integrations.sabangnet.mapper import map_inventory_record, map_order
from app.models.credential import ApiCredential
from app.models.ingestion import IngestionKind, IngestionRun, IngestionRunStatus, RawIngestionPayload
from app.models.tenant import Tenant

logger = logging.getLogger(__name__)


def _load_client(db: Session, tenant_id: uuid.UUID) -> SabangnetFulfillmentClient | None:
    credential = (
        db.query(ApiCredential)
        .filter(ApiCredential.tenant_id == tenant_id, ApiCredential.is_active.is_(True))
        .first()
    )
    if credential is None:
        logger.warning("tenant %s: 활성 자격증명 없음, 수집 건너뜀", tenant_id)
        return None

    cipher = CredentialCipher()
    from app.core.config import get_settings

    settings = get_settings()
    return SabangnetFulfillmentClient(
        base_url=settings.sabangnet_api_base_url,
        credential=SabangnetCredential(
            key_id=cipher.decrypt(credential.encrypted_key_id),
            key_secret=cipher.decrypt(credential.encrypted_key_secret),
            is_sandbox=credential.is_sandbox,
        ),
    )


def _start_run(db: Session, tenant_id: uuid.UUID, kind: IngestionKind) -> IngestionRun:
    run = IngestionRun(tenant_id=tenant_id, kind=kind, status=IngestionRunStatus.RUNNING)
    db.add(run)
    db.flush()
    return run


def _finish_run(db: Session, run: IngestionRun, *, status: IngestionRunStatus, count: int = 0, error: str | None = None) -> None:
    run.status = status
    run.fetched_count = count
    run.error_message = error
    run.finished_at = datetime.now(timezone.utc)
    db.add(run)


@celery_app.task(name="app.ingestion.tasks.dispatch_due_order_ingestion")
def dispatch_due_order_ingestion() -> None:
    """활성 테넌트를 순회하며 주문 수집 태스크를 큐에 넣는다.

    TODO: 테넌트별로 다른 주기를 두려면 ingestion_schedule 테이블을 두고
    "지금 수집할 차례인 테넌트"만 골라내도록 확장한다. 현재는 활성 테넌트
    전체를 15분마다 수집하는 단순 버전.
    """
    with SessionLocal() as db:
        tenant_ids = [t.id for t in db.query(Tenant.id).filter(Tenant.is_active.is_(True))]
    for tenant_id in tenant_ids:
        pull_orders_for_tenant.delay(str(tenant_id))


@celery_app.task(name="app.ingestion.tasks.dispatch_due_inventory_ingestion")
def dispatch_due_inventory_ingestion() -> None:
    with SessionLocal() as db:
        tenant_ids = [t.id for t in db.query(Tenant.id).filter(Tenant.is_active.is_(True))]
    for tenant_id in tenant_ids:
        pull_inventory_for_tenant.delay(str(tenant_id))


@celery_app.task(
    name="app.ingestion.tasks.pull_orders_for_tenant",
    autoretry_for=(SabangnetError,),
    retry_backoff=True,
    max_retries=5,
)
def pull_orders_for_tenant(tenant_id_str: str) -> None:
    tenant_id = uuid.UUID(tenant_id_str)
    with SessionLocal() as db:
        client = _load_client(db, tenant_id)
        if client is None:
            return

        run = _start_run(db, tenant_id, IngestionKind.ORDERS)
        db.commit()

        # 마지막 성공 시각 이후만 조회 (증분 지원 여부 미확인 — TODO 참고)
        last_run = (
            db.query(IngestionRun)
            .filter(
                IngestionRun.tenant_id == tenant_id,
                IngestionRun.kind == IngestionKind.ORDERS,
                IngestionRun.status == IngestionRunStatus.SUCCESS,
            )
            .order_by(IngestionRun.finished_at.desc())
            .first()
        )
        since = last_run.finished_at if last_run else None

        try:
            fetched = 0
            page = 1
            with client:
                while True:
                    response = client.fetch_orders(since=since, page=page)
                    raw_orders = response.get("orders", [])
                    if not raw_orders:
                        break

                    db.add(RawIngestionPayload(tenant_id=tenant_id, ingestion_run_id=run.id, payload=response))

                    for raw in raw_orders:
                        normalized = map_order(raw)
                        upsert_order(db, tenant_id, normalized)
                        fetched += 1

                    if not response.get("has_next", False):
                        break
                    page += 1

            _finish_run(db, run, status=IngestionRunStatus.SUCCESS, count=fetched)
            db.commit()
        except Exception as exc:  # noqa: BLE001 - 실행 로그에 남기고 재raise해 Celery 재시도
            db.rollback()
            with SessionLocal() as error_db:
                run_in_error_session = error_db.get(IngestionRun, run.id)
                _finish_run(error_db, run_in_error_session, status=IngestionRunStatus.FAILED, error=str(exc))
                error_db.commit()
            raise


@celery_app.task(
    name="app.ingestion.tasks.pull_inventory_for_tenant",
    autoretry_for=(SabangnetError,),
    retry_backoff=True,
    max_retries=5,
)
def pull_inventory_for_tenant(tenant_id_str: str) -> None:
    tenant_id = uuid.UUID(tenant_id_str)
    with SessionLocal() as db:
        client = _load_client(db, tenant_id)
        if client is None:
            return

        run = _start_run(db, tenant_id, IngestionKind.INVENTORY)
        db.commit()

        try:
            fetched = 0
            page = 1
            with client:
                while True:
                    response = client.fetch_inventory(page=page)
                    raw_records = response.get("inventory", [])
                    if not raw_records:
                        break

                    db.add(RawIngestionPayload(tenant_id=tenant_id, ingestion_run_id=run.id, payload=response))

                    for raw in raw_records:
                        normalized = map_inventory_record(raw)
                        upsert_inventory_snapshot(db, tenant_id, normalized)
                        fetched += 1

                    if not response.get("has_next", False):
                        break
                    page += 1

            _finish_run(db, run, status=IngestionRunStatus.SUCCESS, count=fetched)
            db.commit()
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            with SessionLocal() as error_db:
                run_in_error_session = error_db.get(IngestionRun, run.id)
                _finish_run(error_db, run_in_error_session, status=IngestionRunStatus.FAILED, error=str(exc))
                error_db.commit()
            raise
