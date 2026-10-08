from __future__ import annotations

import numpy as np
import pandas as pd

from src.external.calendar_features import make_calendar_lag_features
from src.forecast.model_selector import run_baseline_candidate_backtest


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
