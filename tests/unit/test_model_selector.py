from __future__ import annotations

import numpy as np
import pandas as pd

from src.external.calendar_features import make_calendar_lag_features
from src.forecast.model_selector import run_baseline_candidate_backtest, run_pattern_aware_backtest


def _synthetic_series(n_days: int = 200) -> pd.Series:
    idx = pd.date_range("2025-01-01", periods=n_days, freq="D")
    rng = np.random.default_rng(42)
    weekday_effect = idx.dayofweek.map({0: 0, 1: 0, 2: 0, 3: 0, 4: 5, 5: 10, 6: 8})
    values = 50 + weekday_effect.to_numpy() + rng.normal(0, 2, size=n_days)
    return pd.Series(values.round(), index=idx)


def test_run_baseline_candidate_backtest_produces_aligned_output():
    y = _synthetic_series()
    features = make_calendar_lag_features(y, lags=[1, 7, 14])
    test_start = y.index[-30]

    result = run_baseline_candidate_backtest(y, features, test_start=test_start)

    assert not result.candidate.empty
    assert result.candidate.index.isin(y.index[y.index >= test_start]).all()
    assert isinstance(result.bias_factor, float)
    assert result.bias_factor > 0


def _intermittent_series(n_days: int = 200) -> pd.Series:
    idx = pd.date_range("2025-01-01", periods=n_days, freq="D")
    values = [0.0] * n_days
    for i in range(0, n_days, 6):
        values[i] = 4.0
    return pd.Series(values, index=idx)


def test_run_pattern_aware_backtest_routes_smooth_to_blend():
    y = _synthetic_series()
    features = make_calendar_lag_features(y, lags=[1, 7, 14])
    test_start = y.index[-30]

    result = run_pattern_aware_backtest(y, features, test_start=test_start)

    assert result.method == "blend"
    assert result.demand_pattern == "smooth"


def test_run_pattern_aware_backtest_routes_intermittent_to_croston():
    y = _intermittent_series()
    features = make_calendar_lag_features(y, lags=[1, 7, 14])
    test_start = y.index[-30]

    result = run_pattern_aware_backtest(y, features, test_start=test_start)

    assert result.method == "croston_sba"
    assert result.demand_pattern in ("intermittent", "lumpy")
    assert not result.candidate.empty
    assert (result.candidate == result.candidate.iloc[0]).all()  # 평평한 예측
