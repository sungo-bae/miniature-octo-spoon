import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.security import CredentialCipher
from app.models.credential import ApiCredential
from app.models.tenant import Tenant
from app.schemas.tenant import CredentialCreate, CredentialOut, TenantCreate, TenantOut

router = APIRouter(prefix="/tenants", tags=["tenants"])


@router.post("", response_model=TenantOut)
def create_tenant(payload: TenantCreate, db: Session = Depends(get_db)) -> Tenant:
    tenant = Tenant(name=payload.name, business_registration_no=payload.business_registration_no)
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    return tenant


@router.post("/{tenant_id}/credentials", response_model=CredentialOut)
def register_credential(
    tenant_id: uuid.UUID, payload: CredentialCreate, db: Session = Depends(get_db)
) -> ApiCredential:
    """고객사가 사방넷에서 직접 발급받은 API 키를 등록한다.

    이 엔드포인트는 사방넷 로그인 ID/비밀번호를 받지 않는다 — 고객사가
    사방넷 마이페이지에서 발급한 API Access/Secret Key(또는 레거시 연동키)만 받는다.
    """
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status_code=404, detail="테넌트를 찾을 수 없습니다.")

    cipher = CredentialCipher()
    credential = ApiCredential(
        tenant_id=tenant_id,
        service_type=payload.service_type,
        encrypted_key_id=cipher.encrypt(payload.key_id),
        encrypted_key_secret=cipher.encrypt(payload.key_secret),
        is_sandbox=payload.is_sandbox,
    )
    db.add(credential)
    db.commit()
    db.refresh(credential)
    return credential


@router.post("/{tenant_id}/credentials/{credential_id}/verify", response_model=CredentialOut)
def verify_credential(
    tenant_id: uuid.UUID, credential_id: uuid.UUID, db: Session = Depends(get_db)
) -> ApiCredential:
    """등록된 키로 실제 사방넷 API에 커넥션 테스트를 수행한다.

    TODO: SabangnetFulfillmentClient.fetch_orders(page_size=1) 등 가벼운 호출로
    실제 검증. 현재는 client.py의 엔드포인트/서명이 미확정이라 스텁으로 둔다.
    """
    credential = db.get(ApiCredential, credential_id)
    if credential is None or credential.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="자격증명을 찾을 수 없습니다.")

    credential.last_verified_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(credential)
    return credential
