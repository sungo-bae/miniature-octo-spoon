"""기상청 단기예보 조회서비스(VilageFcstInfoService_2.0) API 클라이언트.

공공데이터포털(data.go.kr)에서 "기상청_단기예보 조회서비스"를 활용신청하고
발급받은 서비스키를 DATA_GO_KR_SERVICE_KEY 환경변수에 설정해야 한다.

단기예보는 발표시각 기준 약 2~3일 뒤까지만 제공되므로, 과거 시계열 전체에
날씨 피처를 채우는 용도가 아니라 "가까운 미래 발주 의사결정" 시점의
보조 피처로 사용하는 것을 전제로 한다(5.1절 2.특징 계층 확장 후보).
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Optional

import requests

BASE_URL = "http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst"

# 단기예보 발표시각: 1일 8회(02,05,08,11,14,17,20,23시), API 반영까지 약 10분 소요
_BASE_TIMES = ["0200", "0500", "0800", "1100", "1400", "1700", "2000", "2300"]

CATEGORY_TMP = "TMP"  # 1시간 기온
CATEGORY_TMX = "TMX"  # 일 최고기온
CATEGORY_TMN = "TMN"  # 일 최저기온
CATEGORY_POP = "POP"  # 강수확률(%)
CATEGORY_PCP = "PCP"  # 1시간 강수량


@dataclass(frozen=True)
class DailyWeatherFeature:
    fcst_date: date
    tmp_min: Optional[float]
    tmp_max: Optional[float]
    pop_max: Optional[float]  # 해당일 최대 강수확률(%)
    precip_expected: bool  # 강수 예보 슬롯 존재 여부


class WeatherAPIError(RuntimeError):
    """단기예보 API 호출/설정 오류."""


class WeatherClient:
    """단기예보를 일 단위로 요약한 피처로 변환한다.

    nx/ny는 기상청 격자좌표계 기준 지점 코드다. 기본값(60, 127)은 서울.
    실증고객의 생산/유통 거점에 맞는 좌표로 교체해야 한다.
    """

    def __init__(
        self,
        service_key: Optional[str] = None,
        nx: int = 60,
        ny: int = 127,
        timeout: float = 5.0,
        max_retries: int = 3,
    ) -> None:
        self.service_key = service_key or os.environ.get("DATA_GO_KR_SERVICE_KEY")
        if not self.service_key:
            raise WeatherAPIError(
                "DATA_GO_KR_SERVICE_KEY 환경변수가 설정되어 있지 않습니다. "
                "공공데이터포털에서 '기상청_단기예보 조회서비스'를 활용신청한 뒤 "
                "발급받은 인증키(서비스키)를 설정하세요."
            )
        self.nx = nx
        self.ny = ny
        self.timeout = timeout
        self.max_retries = max_retries

    def fetch_daily_features(
        self, reference: Optional[datetime] = None
    ) -> list[DailyWeatherFeature]:
        """가장 최근 발표시각 기준 예보를 날짜별로 요약해 반환한다."""
        base_date, base_time = _latest_base_datetime(reference or datetime.now())
        params = {
            "serviceKey": self.service_key,
            "pageNo": "1",
            "numOfRows": "1000",
            "dataType": "JSON",
            "base_date": base_date,
            "base_time": base_time,
            "nx": str(self.nx),
            "ny": str(self.ny),
        }
        data = self._get_with_retry(params)
        items = data.get("response", {}).get("body", {}).get("items", {}).get("item", [])
        return _summarize_by_date(items)

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
                    raise WeatherAPIError(
                        f"단기예보 API 오류 응답: {header.get('resultMsg', result_code)}"
                    )
                return data
            except (requests.RequestException, ValueError) as exc:
                last_error = exc
                if attempt < self.max_retries:
                    time.sleep(2 ** (attempt - 1))
        raise WeatherAPIError(f"단기예보 API 호출 실패: {last_error}") from last_error


def _latest_base_datetime(now: datetime) -> tuple[str, str]:
    """현재 시각 기준 가장 최근 발표분의 base_date/base_time을 계산한다."""
    candidate = now - timedelta(minutes=10)  # API 반영 지연 고려
    hhmm = candidate.strftime("%H%M")
    chosen_time = None
    for t in reversed(_BASE_TIMES):
        if hhmm >= t:
            chosen_time = t
            break
    if chosen_time is None:
        candidate = candidate - timedelta(days=1)
        chosen_time = _BASE_TIMES[-1]
    return candidate.strftime("%Y%m%d"), chosen_time


def _summarize_by_date(items: list[dict]) -> list[DailyWeatherFeature]:
    by_date: dict[date, dict[str, list]] = {}
    for raw in items:
        fcst_date = _parse_yyyymmdd(str(raw["fcstDate"]))
        category = raw.get("category")
        value = raw.get("fcstValue")
        by_date.setdefault(fcst_date, {}).setdefault(category, []).append(value)

    features = []
    for d, cats in sorted(by_date.items()):
        tmx = _first_float(cats.get(CATEGORY_TMX))
        tmn = _first_float(cats.get(CATEGORY_TMN))
        tmp_values = _to_floats(cats.get(CATEGORY_TMP))
        pop_values = _to_floats(cats.get(CATEGORY_POP))
        pcp_values = cats.get(CATEGORY_PCP, [])

        tmp_max = tmx if tmx is not None else (max(tmp_values) if tmp_values else None)
        tmp_min = tmn if tmn is not None else (min(tmp_values) if tmp_values else None)
        pop_max = max(pop_values) if pop_values else None
        precip_expected = any(v not in (None, "강수없음", "0", "0.0") for v in pcp_values)

        features.append(
            DailyWeatherFeature(
                fcst_date=d,
                tmp_min=tmp_min,
                tmp_max=tmp_max,
                pop_max=pop_max,
                precip_expected=precip_expected,
            )
        )
    return features


def _parse_yyyymmdd(value: str) -> date:
    return date(int(value[0:4]), int(value[4:6]), int(value[6:8]))


def _first_float(values: Optional[list]) -> Optional[float]:
    if not values:
        return None
    try:
        return float(values[0])
    except (TypeError, ValueError):
        return None


def _to_floats(values: Optional[list]) -> list[float]:
    out: list[float] = []
    for v in values or []:
        try:
            out.append(float(v))
        except (TypeError, ValueError):
            continue
    return out
