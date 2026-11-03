"""aT 한국농수산식품유통공사 KAMIS 농산물유통정보 Open API 클라이언트.

KAMIS Open API는 공공데이터포털(data.go.kr)이 아니라 KAMIS 자체 포털
(https://www.kamis.or.kr/customer/reference/openapi_list.do)에서 별도로
인증키(cert_key)와 아이디(cert_id)를 발급받아야 한다 — 기존
holiday_api.py/weather_api.py가 쓰는 DATA_GO_KR_SERVICE_KEY와는 완전히
다른 키다.

연구개발계획서 3.2절 A2(모델선택·확률예측) 모듈 입력 피처로, 원재료성
농수산물의 일별 소매/도매 가격을 "가격 급등락" 신호로 활용하기 위한
외부 데이터 소스다 (식품 제조·유통 고객사의 원가/발주 타이밍 피처).

주의: 이 모듈은 KAMIS 공개 문서 기준 요청/응답 스키마를 따라 작성했으며,
샌드박스 환경의 외부 네트워크 접근 제한으로 실제 API 호출로 검증하지
못했다. 실사용 전 반드시 발급받은 인증키로 한 번 호출해 응답 스키마가
_parse_period_item()과 맞는지 확인해야 한다
(docs/algorithm_specification/market_price_features.md "알려진 한계" 참고).
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass
from datetime import date
from typing import Optional

import requests

BASE_URL = "https://www.kamis.or.kr/service/price/xml.do"


@dataclass(frozen=True)
class MarketPriceRecord:
    regday: date
    item_name: str
    item_code: str
    unit: str
    price: float  # 원


class KamisAPIError(RuntimeError):
    """KAMIS API 호출/설정 오류."""


class KamisClient:
    """기간별 품목 가격(periodProductList)을 조회한다."""

    def __init__(
        self,
        cert_key: Optional[str] = None,
        cert_id: Optional[str] = None,
        timeout: float = 5.0,
        max_retries: int = 3,
    ) -> None:
        self.cert_key = cert_key or os.environ.get("KAMIS_CERT_KEY")
        self.cert_id = cert_id or os.environ.get("KAMIS_CERT_ID")
        if not self.cert_key or not self.cert_id:
            raise KamisAPIError(
                "KAMIS_CERT_KEY / KAMIS_CERT_ID 환경변수가 설정되어 있지 않습니다. "
                "KAMIS Open API 포털(kamis.or.kr/customer/reference/openapi_list.do)에서 "
                "인증키와 아이디를 발급받아 설정하세요."
            )
        self.timeout = timeout
        self.max_retries = max_retries

    def fetch_period_prices(
        self,
        item_code: str,
        item_category_code: str,
        start: date,
        end: date,
        country_code: str = "1101",  # 기본값: 서울
        product_cls_code: str = "01",  # 01=소매, 02=도매
    ) -> list[MarketPriceRecord]:
        """start~end(포함) 구간의 품목 일별 가격을 조회한다.

        Args:
            item_code: KAMIS 품목코드 (예: "245"=배추).
            item_category_code: KAMIS 부류코드 (예: "200"=채소류).
            country_code: KAMIS 지역코드 (기본 서울 "1101").
            product_cls_code: "01"(소매) 또는 "02"(도매).
        """
        params = {
            "action": "periodProductList",
            "p_productclscode": product_cls_code,
            "p_startday": start.isoformat(),
            "p_endday": end.isoformat(),
            "p_itemcategorycode": item_category_code,
            "p_itemcode": item_code,
            "p_countrycode": country_code,
            "p_convert_kg_yn": "N",
            "p_cert_key": self.cert_key,
            "p_cert_id": self.cert_id,
            "p_returntype": "json",
        }
        data = self._get_with_retry(params)
        items = data.get("data", {}).get("item", [])
        if isinstance(items, dict):
            items = [items]
        return [_parse_period_item(raw) for raw in items]

    def _get_with_retry(self, params: dict) -> dict:
        last_error: Optional[Exception] = None
        for attempt in range(1, self.max_retries + 1):
            try:
                resp = requests.get(BASE_URL, params=params, timeout=self.timeout)
                resp.raise_for_status()
                data = resp.json()
                error_code = str(data.get("data", {}).get("error_code", "000"))
                if error_code not in ("000", "0"):
                    raise KamisAPIError(f"KAMIS API 오류 응답: error_code={error_code}")
                return data
            except (requests.RequestException, ValueError) as exc:
                last_error = exc
                if attempt < self.max_retries:
                    time.sleep(2 ** (attempt - 1))
        raise KamisAPIError(f"KAMIS API 호출 실패: {last_error}") from last_error


def _parse_period_item(raw: dict) -> MarketPriceRecord:
    price_str = str(raw.get("price", "0")).replace(",", "").strip()
    try:
        price = float(price_str) if price_str not in ("", "-") else 0.0
    except ValueError:
        price = 0.0
    return MarketPriceRecord(
        regday=_parse_regday(str(raw.get("regday", raw.get("yyyy", "")))),
        item_name=raw.get("item_name", raw.get("itemname", "")),
        item_code=str(raw.get("item_code", raw.get("itemcode", ""))),
        unit=raw.get("unit", ""),
        price=price,
    )


def _parse_regday(value: str) -> date:
    """KAMIS는 날짜를 'YYYY-MM-DD'로 주는 경우가 일반적이나, 'YYYYMMDD'도 대비한다."""
    value = value.strip()
    if "-" in value:
        y, m, d = value.split("-")
        return date(int(y), int(m), int(d))
    return date(int(value[0:4]), int(value[4:6]), int(value[6:8]))
