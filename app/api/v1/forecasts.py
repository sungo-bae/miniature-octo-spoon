import uuid
from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.forecast import Forecast
from app.schemas.tenant import ForecastOut

router = APIRouter(prefix="/tenants/{tenant_id}/forecasts", tags=["forecasts"])


@router.get("", response_model=list[ForecastOut])
def list_forecasts(
    tenant_id: uuid.UUID,
    target_date: date | None = None,
    db: Session = Depends(get_db),
) -> list[Forecast]:
    query = db.query(Forecast).filter(Forecast.tenant_id == tenant_id)
    if target_date is not None:
        query = query.filter(Forecast.target_date == target_date)
    return query.order_by(Forecast.target_date.desc()).limit(500).all()
