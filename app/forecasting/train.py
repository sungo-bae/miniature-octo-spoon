"""매일 배치로 전체 테넌트/SKU에 대해 재학습 + 익일 예측을 수행하는 Celery 태스크."""

from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy.dialects.postgresql import insert

from app.core.celery_app import celery_app
from app.db.session import SessionLocal
from app.forecasting.features import build_daily_sales_series
from app.forecasting.predict import forecast_next_day
from app.models.forecast import Forecast
from app.models.sku import Sku
from app.models.tenant import Tenant


@celery_app.task(name="app.forecasting.train.retrain_all_tenants")
def retrain_all_tenants() -> None:
    with SessionLocal() as db:
        tenant_ids = [t.id for t in db.query(Tenant.id).filter(Tenant.is_active.is_(True))]

    for tenant_id in tenant_ids:
        forecast_tenant_skus.delay(str(tenant_id))


@celery_app.task(name="app.forecasting.train.forecast_tenant_skus")
def forecast_tenant_skus(tenant_id_str: str) -> None:
    import uuid

    tenant_id = uuid.UUID(tenant_id_str)
    target_date = date.today() + timedelta(days=1)

    with SessionLocal() as db:
        sku_ids = [s.id for s in db.query(Sku.id).filter(Sku.tenant_id == tenant_id)]

        for sku_id in sku_ids:
            series = build_daily_sales_series(db, tenant_id, sku_id)
            result = forecast_next_day(series)

            stmt = (
                insert(Forecast)
                .values(
                    tenant_id=tenant_id,
                    sku_id=sku_id,
                    target_date=target_date,
                    predicted_qty=result.predicted_qty,
                    model_version=result.model_version,
                )
                .on_conflict_do_update(
                    index_elements=[
                        Forecast.tenant_id,
                        Forecast.sku_id,
                        Forecast.target_date,
                        Forecast.model_version,
                    ],
                    set_={"predicted_qty": result.predicted_qty},
                )
            )
            db.execute(stmt)
        db.commit()
