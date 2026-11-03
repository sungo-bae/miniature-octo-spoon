"""aT 한국농수산식품유통공사_일별 도,소매 가격정보 Open API 클라이언트 (공공데이터포털).

공공데이터포털(data.go.kr)에서 "한국농수산식품유통공사_일별 도,소매
가격정보 조회"를 활용신청하면(자동승인) 기존 DATA_GO_KR_SERVICE_KEY
(특일정보·기상청과 공용)로 바로 쓸 수 있다 — KAMIS 자체 포털
(kamis.or.kr)의 별도 인증키 체계가 아니다.

End Point: https://apis.data.go.kr/B552845/perDay/price
(공식 API 명세 "일별 도,소매 가격정보 API명세 및 관련 코드 정보.zip"
문서를 그대로 따랐다 — 2026-11-03 사용자가 실제 신청·확인한 명세서
기준이며, holiday_api.py/weather_api.py와 동일한 data.go.kr 표준
response.header/response.body 응답 포맷을 전제로 작성했다. 단, 실제
API 호출 자체는 샌드박스 네트워크 제한으로 아직 검증하지 못했다 —
docs/algorithm_specification/market_price_features.md "알려진 한계" 참고.

연구개발계획서 3.2절 A2 모듈 입력 피처로, 원재료성 농수산물의 일별
소매/도매 가격을 "가격 급등락" 신호로 활용하기 위한 외부 데이터
소스다 (식품 제조·유통 고객사의 원가/발주 타이밍 피처).
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass
from datetime import date
from typing import Optional

import requests

BASE_URL = "https://apis.data.go.kr/B552845/perDay/price"

# 한 페이지 최대 조회 건수 (API 명세 numOfRows max:1000)
MAX_ROWS_PER_PAGE = 1000
# 비정상 응답으로 totalCount가 과도하게 커도 무한 루프에 빠지지 않도록 하는 안전장치
MAX_PAGES = 50


@dataclass(frozen=True)
class MarketPriceRecord:
    exmn_ymd: date  # 조사일자
    item_code: str
    item_name: str
    category_code: str
    se_code: str  # 구분코드 (01=소매, 02=중도매, 03=친환경농산물 등)
    se_name: str
    market_name: str
    unit: str
    unit_size: str
    price: float  # exmn_dd_prc: 조사일가격 (unit/unit_size 기준 원단위)
    price_per_kg: float  # exmn_dd_cnvs_prc: 조사일 kg환산가격 (품목 간 비교용)


class KamisAPIError(RuntimeError):
    """KAMIS 일별 도소매 가격정보 API 호출/설정 오류."""


class KamisClient:
    """기간별 품목 가격(perDay/price)을 모든 페이지에 걸쳐 조회한다."""

    def __init__(
        self,
        service_key: Optional[str] = None,
        timeout: float = 5.0,
        max_retries: int = 3,
    ) -> None:
        self.service_key = service_key or os.environ.get("DATA_GO_KR_SERVICE_KEY")
        if not self.service_key:
            raise KamisAPIError(
                "DATA_GO_KR_SERVICE_KEY 환경변수가 설정되어 있지 않습니다. "
                "공공데이터포털에서 '한국농수산식품유통공사_일별 도,소매 가격정보 "
                "조회'를 활용신청한 뒤(자동승인) 발급받은 서비스키를 설정하세요."
            )
        self.timeout = timeout
        self.max_retries = max_retries

    def fetch_period_prices(
        self,
        item_code: str,
        category_code: str,
        start: date,
        end: date,
        se_code: Optional[str] = "01",  # 기본값: 01=소매
        sgg_code: Optional[str] = None,  # 시군구코드(지역). None이면 전체 지역.
    ) -> list[MarketPriceRecord]:
        """start~end(포함) 구간의 품목 일별 가격을 전 페이지에 걸쳐 조회한다.

        Args:
            item_code: 품목코드 (예: "211"=배추). 코드정보.xlsx '품목코드' 시트 참고.
            category_code: 부류코드 (예: "200"=채소류).
            se_code: 구분코드. "01"=소매, "02"=중도매, "03"=친환경농산물 등.
            sgg_code: 시군구코드 (예: "1101"=서울). 미지정 시 전국 전체 응답.
        """
        page_no = 1
        records: list[MarketPriceRecord] = []
        total_count: Optional[int] = None

        while (total_count is None or len(records) < total_count) and page_no <= MAX_PAGES:
            params = self._build_params(
                item_code, category_code, start, end, se_code, sgg_code, page_no
            )
            data = self._get_with_retry(params)
            body = data.get("response", {}).get("body", {})
            total_count = body.get("totalCount", 0)
            items = body.get("items", {}).get("item", [])
            if isinstance(items, dict):
                items = [items]
            if not items:
                break
            records.extend(_parse_item(raw) for raw in items)
            page_no += 1

        return records

    def _build_params(
        self,
        item_code: str,
        category_code: str,
        start: date,
        end: date,
        se_code: Optional[str],
        sgg_code: Optional[str],
        page_no: int,
    ) -> dict:
        params = {
            "serviceKey": self.service_key,
            "returnType": "JSON",
            "pageNo": str(page_no),
            "numOfRows": str(MAX_ROWS_PER_PAGE),
            "cond[exmn_ymd::GTE]": start.strftime("%Y%m%d"),
            "cond[exmn_ymd::LTE]": end.strftime("%Y%m%d"),
            "cond[ctgry_cd::EQ]": category_code,
            "cond[item_cd::EQ]": item_code,
        }
        if se_code:
            params["cond[se_cd::EQ]"] = se_code
        if sgg_code:
            params["cond[sgg_cd::EQ]"] = sgg_code
        return params

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
                    raise KamisAPIError(
                        f"KAMIS 가격정보 API 오류 응답: {header.get('resultMsg', result_code)}"
                    )
                return data
            except (requests.RequestException, ValueError) as exc:
                last_error = exc
                if attempt < self.max_retries:
                    time.sleep(2 ** (attempt - 1))
        raise KamisAPIError(f"KAMIS 가격정보 API 호출 실패: {last_error}") from last_error


def _parse_item(raw: dict) -> MarketPriceRecord:
    return MarketPriceRecord(
        exmn_ymd=_parse_ymd(str(raw.get("exmn_ymd", ""))),
        item_code=str(raw.get("item_cd", "")),
        item_name=raw.get("item_nm", ""),
        category_code=str(raw.get("ctgry_cd", "")),
        se_code=str(raw.get("se_cd", "")),
        se_name=raw.get("se_nm", ""),
        market_name=raw.get("mrkt_nm", ""),
        unit=raw.get("unit", ""),
        unit_size=raw.get("unit_sz", ""),
        price=_to_float(raw.get("exmn_dd_prc")),
        price_per_kg=_to_float(raw.get("exmn_dd_cnvs_prc")),
    )


def _to_float(value) -> float:
    if value in (None, "", "-"):
        return 0.0
    text = str(value).replace(",", "").strip()
    try:
        return float(text)
    except ValueError:
        return 0.0


def _parse_ymd(value: str) -> date:
    """exmn_ymd는 요청 포맷(YYYYMMDD)과 동일하게 오는 것을 기본 가정하되,
    'YYYY-MM-DD'로 오는 경우도 대비한다."""
    value = value.strip()
    if "-" in value:
        y, m, d = value.split("-")
        return date(int(y), int(m), int(d))
    return date(int(value[0:4]), int(value[4:6]), int(value[6:8]))
