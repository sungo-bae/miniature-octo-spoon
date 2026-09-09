"""사방넷 API 원시(raw) 클라이언트.

이 모듈은 사방넷 공식 API 문서를 아직 완전히 확보하지 못한 상태에서 작성되었다.
(docs/sabangnet_api_notes.md 참고 — 도메인 접속이 막혀 원문을 확인하지 못함)

설계 의도:
  - 인증/서명 로직과 엔드포인트 경로는 TODO로 명확히 표시해 두었다.
  - 실제 API 문서를 확보하면 이 파일만 교체하면 되고, 나머지 파이프라인
    (ingestion/etl/forecasting)은 mapper가 만들어내는 내부 스키마만 알면 되므로
    영향을 받지 않는다.
  - httpx는 동기 클라이언트를 사용한다(Celery worker에서 호출하므로 굳이 async 불필요).
"""

from __future__ import annotations

import hashlib
import hmac
import time
from dataclasses import dataclass
from datetime import datetime

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.integrations.sabangnet.exceptions import (
    SabangnetAuthError,
    SabangnetError,
    SabangnetRateLimitError,
    SabangnetTemporaryError,
)


@dataclass(frozen=True)
class SabangnetCredential:
    key_id: str
    key_secret: str
    is_sandbox: bool = True


class SabangnetFulfillmentClient:
    """사방넷 풀필먼트(WMS) REST/JSON API 클라이언트.

    TODO(확인 필요, docs/sabangnet_api_notes.md 참고):
      - 정확한 base URL (sandbox / production)
      - signature 생성 알고리즘 — 아래 _build_signature는 업계에서 흔한
        "HMAC-SHA256(secret, method+path+timestamp)" 패턴으로 임시 구현한
        추정치이며, 실제 문서 확보 전까지는 검증되지 않았다.
      - 인증 헤더 이름 (예: X-API-KEY / X-SIGNATURE / X-TIMESTAMP 등 실제 값 확인 필요)
      - 정확한 엔드포인트 경로와 쿼리 파라미터, 페이지네이션 방식
    """

    def __init__(self, base_url: str, credential: SabangnetCredential, timeout: float = 10.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._credential = credential
        self._client = httpx.Client(base_url=self._base_url, timeout=timeout)

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "SabangnetFulfillmentClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # ------------------------------------------------------------------
    # 인증
    # ------------------------------------------------------------------
    def _build_signature(self, method: str, path: str, timestamp: str) -> str:
        # TODO: 실제 서명 규칙으로 교체. 현재는 검증되지 않은 추정 구현.
        message = f"{method.upper()}{path}{timestamp}".encode()
        return hmac.new(self._credential.key_secret.encode(), message, hashlib.sha256).hexdigest()

    def _auth_headers(self, method: str, path: str) -> dict[str, str]:
        timestamp = str(int(time.time()))
        return {
            "X-API-KEY": self._credential.key_id,
            "X-TIMESTAMP": timestamp,
            "X-SIGNATURE": self._build_signature(method, path, timestamp),
        }

    # ------------------------------------------------------------------
    # HTTP
    # ------------------------------------------------------------------
    @retry(
        retry=retry_if_exception_type((SabangnetRateLimitError, SabangnetTemporaryError)),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        stop=stop_after_attempt(5),
    )
    def _request(self, method: str, path: str, *, params: dict | None = None) -> dict:
        headers = self._auth_headers(method, path)
        response = self._client.request(method, path, params=params, headers=headers)

        if response.status_code == 401:
            raise SabangnetAuthError(f"인증 실패: {response.text}")
        if response.status_code == 429:
            raise SabangnetRateLimitError("호출 빈도 제한 초과")
        if response.status_code >= 500:
            raise SabangnetTemporaryError(f"서버 오류: {response.status_code}")
        if response.status_code >= 400:
            raise SabangnetError(f"요청 실패 ({response.status_code}): {response.text}")

        return response.json()

    # ------------------------------------------------------------------
    # 공개 API — TODO: 실제 엔드포인트 경로/파라미터명으로 교체
    # ------------------------------------------------------------------
    def fetch_orders(self, since: datetime | None = None, page: int = 1, page_size: int = 100) -> dict:
        """결제완료/배송준비 상태 주문 목록 조회.

        TODO: 실제 경로(`/orders` 는 추정), since 파라미터명, 페이지네이션 방식 확인.
        """
        params: dict[str, str | int] = {"page": page, "page_size": page_size}
        if since is not None:
            params["updated_since"] = since.isoformat()
        return self._request("GET", "/v1/orders", params=params)

    def fetch_inventory(self, page: int = 1, page_size: int = 200) -> dict:
        """품목별 재고 현황 조회. TODO: 실제 경로/파라미터 확인."""
        params = {"page": page, "page_size": page_size}
        return self._request("GET", "/v1/inventory", params=params)
