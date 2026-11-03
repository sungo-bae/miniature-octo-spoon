from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.forecast.intermittent import croston_sba_forecast, tsb_forecast


def _series(values: list[float]) -> pd.Series:
    idx = pd.date_range("2025-01-01", periods=len(values), freq="D")
    return pd.Series(values, index=idx, dtype=float)


def test_croston_sba_all_zero_returns_zero_forecast():
    y = _series([0.0] * 30)
    forecast = croston_sba_forecast(y, horizon=7)
    assert np.all(forecast == 0.0)


def test_croston_sba_returns_flat_positive_forecast():
    values = [0.0] * 30
    for i in range(0, 30, 5):
        values[i] = 10.0
    y = _series(values)
    forecast = croston_sba_forecast(y, horizon=5)
    assert len(forecast) == 5
    assert np.all(forecast == forecast[0])
    assert forecast[0] > 0


def test_croston_sba_rejects_non_positive_horizon():
    y = _series([1.0, 0.0, 0.0])
    with pytest.raises(ValueError):
        croston_sba_forecast(y, horizon=0)


def test_tsb_all_zero_returns_zero_forecast():
    y = _series([0.0] * 30)
    forecast = tsb_forecast(y, horizon=7)
    assert np.all(forecast == 0.0)


def test_tsb_returns_flat_positive_forecast():
    values = [0.0] * 30
    for i in range(0, 30, 5):
        values[i] = 10.0
    y = _series(values)
    forecast = tsb_forecast(y, horizon=5)
    assert len(forecast) == 5
    assert np.all(forecast == forecast[0])
    assert forecast[0] > 0


def test_tsb_rejects_non_positive_horizon():
    y = _series([1.0, 0.0, 0.0])
    with pytest.raises(ValueError):
        tsb_forecast(y, horizon=0)


def test_tsb_reacts_faster_than_croston_to_recent_frequency_increase():
    # 앞 60일은 아주 드문드문(30일에 1번), 뒤 20일은 자주(3일에 1번) 발생 -
    # 최근 추세에 더 민감한 TSB가 Croston보다 높은 예측치를 내야 한다.
    values = [0.0] * 80
    for i in range(0, 60, 30):
        values[i] = 5.0
    for i in range(60, 80, 3):
        values[i] = 5.0
    y = _series(values)

    croston_pred = croston_sba_forecast(y, horizon=1)[0]
    tsb_pred = tsb_forecast(y, horizon=1)[0]

    assert tsb_pred > croston_pred
