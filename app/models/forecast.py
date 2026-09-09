import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Forecast(Base):
    """품목·일자별 판매량 예측 결과."""

    __tablename__ = "forecasts"
    __table_args__ = (
        UniqueConstraint("tenant_id", "sku_id", "target_date", "model_version", name="uq_forecast"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    sku_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("skus.id"), index=True)

    target_date: Mapped[date] = mapped_column(Date, index=True)
    predicted_qty: Mapped[float] = mapped_column(Numeric(12, 2))
    model_version: Mapped[str] = mapped_column(String(50))

    # 실제 판매량이 확정되면 채워서 정확도(MAPE 등) 계산에 사용
    actual_qty: Mapped[float | None] = mapped_column(Numeric(12, 2))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
