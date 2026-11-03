from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.forecast.intermittent import croston_sba_forecast


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
