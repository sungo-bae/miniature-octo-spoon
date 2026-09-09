class SabangnetError(Exception):
    """사방넷 API 연동 관련 공통 예외."""


class SabangnetAuthError(SabangnetError):
    """자격증명이 잘못되었거나 만료된 경우."""


class SabangnetRateLimitError(SabangnetError):
    """호출 빈도 제한에 걸린 경우. 재시도 대상."""


class SabangnetTemporaryError(SabangnetError):
    """일시적 오류(5xx, 타임아웃 등). 재시도 대상."""
