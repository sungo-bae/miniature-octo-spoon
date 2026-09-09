import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SabangnetServiceType(str, enum.Enum):
    """고객사가 어떤 사방넷 서비스를 쓰는지. 인증 방식이 서로 다르다."""

    SHOP_INTEGRATION = "shop_integration"  # 레거시 부가서비스 API (연동키)
    FULFILLMENT = "fulfillment"  # 풀필먼트 REST/JSON API (access/secret key)


class ApiCredential(Base):
    """테넌트별 사방넷 API 자격증명. 값은 항상 암호문으로만 저장한다.

    고객사가 사방넷 마이페이지에서 직접 발급한 키만 저장하며,
    고객사의 사방넷 로그인 ID/비밀번호는 절대 저장하지 않는다.
    """

    __tablename__ = "api_credentials"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)

    service_type: Mapped[SabangnetServiceType] = mapped_column(Enum(SabangnetServiceType))

    # 레거시 연동키 방식: company_id + auth_key
    # 풀필먼트 방식: access_key + secret_key
    # 필드명을 서비스별로 나누지 않고 범용적으로 두되, 값은 전부 암호화한다.
    encrypted_key_id: Mapped[str] = mapped_column(String(500))
    encrypted_key_secret: Mapped[str] = mapped_column(String(500))

    is_sandbox: Mapped[bool] = mapped_column(default=True)
    is_active: Mapped[bool] = mapped_column(default=True)

    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
