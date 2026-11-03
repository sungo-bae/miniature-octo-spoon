"""KAMIS 농산물 가격 API를 A2 모델(3.2절)의 원재료 가격 피처로 통합한다.

calendar_features.py와 동일한 패턴(빌더 함수 + 병합 함수)을 따른다.
원재료성 품목(예: 배추·양파 등)의 가격 급등락이 식품 제조·유통 고객사의
발주량에 선행지표가 될 수 있다는 가설에서 출발한 피처다. 이 가설 자체는
실증데이터로 검증된 바 없다 — "알려진 한계" 참고.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

import pandas as pd

from src.external.kamis_api import KamisClient


def build_market_price_series(
    item_code: str,
    item_category_code: str,
    start: date,
    end: date,
    client: Optional[KamisClient] = None,
    country_code: str = "1101",
    product_cls_code: str = "01",
) -> pd.DataFrame:
    """start~end(포함) 구간의 품목 일별 가격 테이블을 만든다.

    KAMIS는 공휴일·주말 등 비거래일 데이터를 비워서 줄 수 있으므로,
    반환값은 실제 거래일만 포함한다 — 달력 전체를 채우는 전진채움(ffill)은
    make_market_price_features()에서 수행한다.

    반환 컬럼: date, price
    """
    client = client or KamisClient()
    records = client.fetch_period_prices(
        item_code=item_code,
        item_category_code=item_category_code,
        start=start,
        end=end,
        country_code=country_code,
        product_cls_code=product_cls_code,
    )
    if not records:
        return pd.DataFrame(columns=["date", "price"])
    return pd.DataFrame(
        {
            "date": [pd.Timestamp(r.regday) for r in records],
            "price": [r.price for r in records],
        }
    ).sort_values("date").reset_index(drop=True)


def make_market_price_features(
    features: pd.DataFrame,
    market_price: pd.DataFrame,
    lags: tuple[int, ...] = (1, 7, 14),
    max_ffill_days: int = 7,
) -> pd.DataFrame:
    """기존 피처 DataFrame(make_calendar_lag_features 출력)에 가격 피처를 덧붙인다.

    Args:
        features: 병합 대상 피처 DataFrame (DatetimeIndex).
        market_price: build_market_price_series()의 반환값.
        lags: 가격 지연값으로 사용할 일수.
        max_ffill_days: 비거래일 전진채움 최대 허용 일수. 이보다 오래된
            가격은 NaN으로 남겨 모델이 과거 가격을 그대로 쓰지 않게 한다.

    Returns:
        features에 price, price_lag_{N}, price_change_pct_7d 컬럼이 추가된
        복사본.
    """
    out = features.copy()
    if market_price.empty:
        out["price"] = pd.NA
        for lag in lags:
            out[f"price_lag_{lag}"] = pd.NA
        out["price_change_pct_7d"] = pd.NA
        return out

    price_series = (
        market_price.set_index("date")["price"]
        .reindex(out.index)
        .ffill(limit=max_ffill_days)
    )
    out["price"] = price_series
    for lag in lags:
        out[f"price_lag_{lag}"] = price_series.shift(lag)
    out["price_change_pct_7d"] = price_series.pct_change(periods=7)
    return out
