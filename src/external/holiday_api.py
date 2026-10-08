"""한국천문연구원 특일 정보(공공데이터포털) API 클라이언트.

공공데이터포털(data.go.kr)에서 "특일 정보" 서비스를 활용신청하고
발급받은 서비스키를 DATA_GO_KR_SERVICE_KEY 환경변수에 설정해야 한다.

연구개발계획서 3.2절 A2(모델선택·확률예측) 모듈이 입력으로 쓰는
"요일·연중주기·주말·이벤트" 피처 중 명절/공휴일 이벤트를 자동 생성하기
위한 외부 데이터 소스다. 4.4절 예비분석에서 추석(2025-10, 2,260팩)·설
(2026-02, 1,951팩)이 수요 급증의 핵심 요인으로 확인된 바 있다.
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass
from datetime import date
from typing import Optional

import requests

BASE_URL = "http://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getHoliDeInfo"


@dataclass(frozen=True)
class HolidayRecord:
    locdate: date
    date_name: str
    date_kind: str  # API 정의 기준 (예: "01"=국경일, "02"=기념일, "03"=24절기 등)
    is_holiday: bool


class HolidayAPIError(RuntimeError):
    """특일 정보 API 호출/설정 오류."""


class HolidayClient:
    """월 단위로 특일 정보를 조회한다 (API 자체가 월 단위 조회만 지원)."""

    def __init__(
        self,
        service_key: Optional[str] = None,
        timeout: float = 5.0,
        max_retries: int = 3,
    ) -> None:
        self.service_key = service_key or os.environ.get("DATA_GO_KR_SERVICE_KEY")
        if not self.service_key:
            raise HolidayAPIError(
                "DATA_GO_KR_SERVICE_KEY 환경변수가 설정되어 있지 않습니다. "
                "공공데이터포털에서 '특일 정보' 서비스를 활용신청한 뒤 "
                "발급받은 인증키(서비스키)를 설정하세요."
            )
        self.timeout = timeout
        self.max_retries = max_retries

    def fetch_month(self, year: int, month: int) -> list[HolidayRecord]:
        """해당 연·월의 특일 정보를 조회한다."""
        params = {
            "serviceKey": self.service_key,
            "solYear": f"{year:04d}",
            "solMonth": f"{month:02d}",
            "numOfRows": "50",
            "pageNo": "1",
            "_type": "json",
        }
        data = self._get_with_retry(params)
        items = data.get("response", {}).get("body", {}).get("items")
        if not items:
            return []
        item = items.get("item", [])
        if isinstance(item, dict):
            item = [item]
        return [
            HolidayRecord(
                locdate=_parse_locdate(str(raw["locdate"])),
                date_name=raw.get("dateName", ""),
                date_kind=str(raw.get("dateKind", "")),
                is_holiday=str(raw.get("isHoliday", "N")).upper() == "Y",
            )
            for raw in item
        ]

    def fetch_range(self, start: date, end: date) -> list[HolidayRecord]:
        """start~end(포함) 구간에 걸치는 모든 달을 조회해 날짜순으로 합친다."""
        records: list[HolidayRecord] = []
        for year, month in _month_range(start, end):
            records.extend(self.fetch_month(year, month))
        return sorted(
            (r for r in records if start <= r.locdate <= end),
            key=lambda r: r.locdate,
        )

    def _get_with_retry(self, params: dict) -> dict:
        last_error: Optional[Exception] = None
        for attempt in range(1, self.max_retries + 1):
            try:
                resp = requests.get(BASE_URL, params=params, timeout=self.timeout)
                resp.raise_for_status()
                data = resp.json()
                header = data.get("response", {}).get("header", {})
                result_code = header.get("resultCode")
                if result_code not in (None, "00", "0"):
                    raise HolidayAPIError(
                        f"특일정보 API 오류 응답: {header.get('resultMsg', result_code)}"
                    )
                return data
            except (requests.RequestException, ValueError) as exc:
                last_error = exc
                if attempt < self.max_retries:
                    time.sleep(2 ** (attempt - 1))
        raise HolidayAPIError(f"특일정보 API 호출 실패: {last_error}") from last_error


def _parse_locdate(value: str) -> date:
    return date(int(value[0:4]), int(value[4:6]), int(value[6:8]))


def _month_range(start: date, end: date) -> list[tuple[int, int]]:
    months = []
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        months.append((y, m))
        m += 1
        if m > 12:
            m = 1
            y += 1
    return months
