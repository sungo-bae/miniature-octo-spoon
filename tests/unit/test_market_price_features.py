from __future__ import annotations

import pandas as pd
import pytest

from src.external.market_price_features import make_market_price_features


def _base_features(n_days: int = 20) -> pd.DataFrame:
    idx = pd.date_range("2026-01-01", periods=n_days, freq="D")
    return pd.DataFrame({"dow": idx.dayofweek}, index=idx)


def test_make_market_price_features_without_price_data_fills_na():
    features = _base_features()
    out = make_market_price_features(features, pd.DataFrame(columns=["date", "price"]))

    assert "price" in out.columns
    assert out["price"].isna().all()
    assert "price_lag_1" in out.columns
    assert "price_change_pct_7d" in out.columns


def test_make_market_price_features_adds_lag_and_pct_change():
    features = _base_features(n_days=10)
    market_price = pd.DataFrame(
        {
            "date": pd.date_range("2026-01-01", periods=10, freq="D"),
            "price": [100.0 + i * 10 for i in range(10)],
        }
    )

    out = make_market_price_features(features, market_price, lags=(1, 7))

    assert out["price"].iloc[0] == 100.0
    assert out["price_lag_1"].iloc[1] == 100.0
    # 7일 후 가격(170) 대비 변화율: (170-100)/100 = 0.7
    assert out["price_change_pct_7d"].iloc[7] == pytest.approx(0.7)


def test_make_market_price_features_forward_fills_missing_trading_days():
    idx = pd.date_range("2026-01-01", periods=5, freq="D")
    features = pd.DataFrame({"dow": idx.dayofweek}, index=idx)
    # 1/1, 1/4만 거래일 (주말 등으로 중간 비어있음)
    market_price = pd.DataFrame(
        {"date": [pd.Timestamp("2026-01-01"), pd.Timestamp("2026-01-04")], "price": [100.0, 110.0]}
    )

    out = make_market_price_features(features, market_price)

    assert out["price"].iloc[0] == 100.0
    assert out["price"].iloc[1] == 100.0  # 1/2: 전진채움
    assert out["price"].iloc[2] == 100.0  # 1/3: 전진채움
    assert out["price"].iloc[3] == 110.0  # 1/4: 실제 거래일
