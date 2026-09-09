import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class IngestionRunStatus(str, enum.Enum):
    SUCCESS = "success"
    FAILED = "failed"
    RUNNING = "running"


class IngestionKind(str, enum.Enum):
    ORDERS = "orders"
    INVENTORY = "inventory"


class IngestionRun(Base):
    """테넌트별 폴링 실행 이력. 모니터링/재시도 판단에 사용."""

    __tablename__ = "ingestion_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)

    kind: Mapped[IngestionKind] = mapped_column(Enum(IngestionKind))
    status: Mapped[IngestionRunStatus] = mapped_column(Enum(IngestionRunStatus))

    # 증분 수집 커서 (예: 마지막으로 성공 수집한 시각). 사방넷이 증분 조회를
    # 지원하는지 미확인이므로 우선 "마지막 성공 시각"만 기록해두고,
    # 지원 여부가 확인되면 실제 커서 값으로 교체한다.
    last_cursor: Mapped[str | None] = mapped_column(String(200))

    fetched_count: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text)

    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RawIngestionPayload(Base):
    """사방넷 API 원본 응답 보관. mapper 버그/스펙 변경 시 재처리용."""

    __tablename__ = "raw_ingestion_payloads"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    ingestion_run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ingestion_runs.id", ondelete="CASCADE"))

    payload: Mapped[dict] = mapped_column(JSONB)
    processed: Mapped[bool] = mapped_column(default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
