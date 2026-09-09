import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class InventorySnapshot(Base):
    """품목별 시점 재고 스냅샷. 재고 회전율/과잉·부족 판정과 예측 피처로 사용."""

    __tablename__ = "inventory_snapshots"
    __table_args__ = (
        UniqueConstraint("tenant_id", "sku_id", "snapshot_at", name="uq_inventory_snapshot"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    sku_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("skus.id"), index=True)

    on_hand_qty: Mapped[int] = mapped_column(Integer)
    safety_stock_qty: Mapped[int] = mapped_column(Integer, default=0)
    snapshot_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
