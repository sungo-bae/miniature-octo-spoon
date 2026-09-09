from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "local"
    log_level: str = "INFO"

    database_url: str = "postgresql+psycopg2://app:app@localhost:5432/sabangnet_forecast"
    redis_url: str = "redis://localhost:6379/0"

    # Fernet 키. 테넌트 API 자격증명을 암호화하는 데 사용한다.
    # 운영 환경에서는 반드시 KMS/Secrets Manager 등 외부 비밀 저장소에서 주입한다.
    credential_encryption_key: str = ""

    sabangnet_api_base_url: str = "https://sandbox-api.sbfulfillment.co.kr"
    sabangnet_use_sandbox: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
