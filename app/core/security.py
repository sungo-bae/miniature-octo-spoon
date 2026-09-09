"""테넌트 사방넷 API 자격증명을 암호화/복호화하는 유틸리티.

고객사의 사방넷 로그인 비밀번호는 이 시스템에서 절대 다루지 않는다.
여기서 암/복호화하는 것은 고객사가 사방넷에서 직접 발급받은
API Access Key / Secret Key (또는 레거시 연동키) 뿐이다.
"""

from cryptography.fernet import Fernet

from app.core.config import get_settings


class CredentialCipher:
    def __init__(self, key: str | None = None) -> None:
        settings = get_settings()
        raw_key = key or settings.credential_encryption_key
        if not raw_key:
            raise RuntimeError(
                "CREDENTIAL_ENCRYPTION_KEY가 설정되지 않았습니다. "
                "Fernet.generate_key()로 생성한 값을 .env에 등록하세요."
            )
        self._fernet = Fernet(raw_key.encode() if isinstance(raw_key, str) else raw_key)

    def encrypt(self, plaintext: str) -> str:
        return self._fernet.encrypt(plaintext.encode()).decode()

    def decrypt(self, ciphertext: str) -> str:
        return self._fernet.decrypt(ciphertext.encode()).decode()


def generate_encryption_key() -> str:
    return Fernet.generate_key().decode()
