import uuid
from datetime import date, datetime

from pydantic import BaseModel

from app.models.credential import SabangnetServiceType


class TenantCreate(BaseModel):
    name: str
    business_registration_no: str | None = None


class TenantOut(BaseModel):
    id: uuid.UUID
    name: str
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class CredentialCreate(BaseModel):
    """온보딩 폼에서 받는 값. 여기서 받는 것은 고객사가 사방넷에서 직접 발급한
    API 키/시크릿이며, 고객사의 사방넷 로그인 비밀번호가 아니다."""

    service_type: SabangnetServiceType
    key_id: str
    key_secret: str
    is_sandbox: bool = True


class CredentialOut(BaseModel):
    id: uuid.UUID
    service_type: SabangnetServiceType
    is_sandbox: bool
    is_active: bool
    last_verified_at: datetime | None

    class Config:
        from_attributes = True


class ForecastOut(BaseModel):
    model_config = {"from_attributes": True, "protected_namespaces": ()}

    sku_id: uuid.UUID
    target_date: date
    predicted_qty: float
    model_version: str
