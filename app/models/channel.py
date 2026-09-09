import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Channel(Base):
    """사방넷이 통합하는 판매 채널(오픈마켓/자사몰 등)."""

    __tablename__ = "channels"
    __table_args__ = (UniqueConstraint("tenant_id", "external_channel_code", name="uq_channel_per_tenant"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)

    external_channel_code: Mapped[str] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(200))
