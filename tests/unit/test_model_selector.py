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


def _high_volume_lumpy_series(n_days: int = 200) -> pd.Series:
    # 3일에 한 번 발생(adi>=1.32)하되 수요크기가 2~20으로 크게 변동(cv2>=0.49)
    # 해서 lumpy로 분류되고, 평균 일 판매량은 _HIGH_VOLUME_AVG_RATE 이상이 되도록 함.
    idx = pd.date_range("2025-01-01", periods=n_days, freq="D")
    values = [0.0] * n_days
    for n, i in enumerate(range(0, n_days, 3)):
        values[i] = 2.0 if n % 2 == 0 else 20.0
    return pd.Series(values, index=idx)


def test_run_pattern_aware_backtest_routes_high_volume_lumpy_to_tsb():
    y = _high_volume_lumpy_series()
    features = make_calendar_lag_features(y, lags=[1, 7, 14])
    test_start = y.index[-30]

    result = run_pattern_aware_backtest(y, features, test_start=test_start)

    assert result.method == "tsb"
    assert result.demand_pattern == "lumpy"
    assert not result.candidate.empty
    assert (result.candidate == result.candidate.iloc[0]).all()  # 평평한 예측


def test_run_pattern_aware_backtest_routes_low_volume_lumpy_to_blend():
    # 수요크기 변동은 lumpy 기준을 만족하지만 평균 판매량이 낮은 경우
    # TSB가 아닌 기존 블렌드를 써야 한다 (저매출 lumpy는 TSB가 악화시킴).
    idx = pd.date_range("2025-01-01", periods=200, freq="D")
    values = [0.0] * 200
    for n, i in enumerate(range(0, 200, 6)):
        values[i] = 0.5 if n % 2 == 0 else 3.0
    y = pd.Series(values, index=idx)
    features = make_calendar_lag_features(y, lags=[1, 7, 14])
    test_start = y.index[-30]

    result = run_pattern_aware_backtest(y, features, test_start=test_start)

    assert result.demand_pattern == "lumpy"
    assert result.method == "blend"
