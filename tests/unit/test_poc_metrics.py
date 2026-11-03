from __future__ import annotations

import pandas as pd
import pytest

from src.evaluation.poc_metrics import bias, mase, service_level, wape


def test_wape_perfect_prediction_is_zero():
    idx = pd.date_range("2026-01-01", periods=5, freq="D")
    actual = pd.Series([10, 20, 30, 40, 50], index=idx)
    assert wape(actual, actual) == 0.0


def test_wape_known_value():
    idx = pd.date_range("2026-01-01", periods=2, freq="D")
    actual = pd.Series([100, 100], index=idx)
    predicted = pd.Series([90, 110], index=idx)
    # |100-90| + |100-110| = 20; sum(|actual|) = 200 -> wape = 0.1
    assert wape(actual, predicted) == pytest.approx(0.1)


def test_bias_overprediction_is_positive():
    idx = pd.date_range("2026-01-01", periods=2, freq="D")
    actual = pd.Series([100, 100], index=idx)
    predicted = pd.Series([110, 110], index=idx)
    assert bias(actual, predicted) == pytest.approx(0.1)


def test_bias_underprediction_is_negative():
    idx = pd.date_range("2026-01-01", periods=2, freq="D")
    actual = pd.Series([100, 100], index=idx)
    predicted = pd.Series([90, 90], index=idx)
    assert bias(actual, predicted) == pytest.approx(-0.1)


def test_wape_raises_when_actual_sum_zero():
    idx = pd.date_range("2026-01-01", periods=2, freq="D")
    actual = pd.Series([0, 0], index=idx)
    predicted = pd.Series([1, 1], index=idx)
    with pytest.raises(ValueError):
        wape(actual, predicted)


def test_mase_known_value():
    train_idx = pd.date_range("2025-12-01", periods=14, freq="D")
    # 7일 전과 동일한 패턴 -> 계절나이브 오차 평균 = 0이 아니게 약간의 변동을 둠
    train_actual = pd.Series([10, 0, 0, 0, 0, 0, 0, 12, 0, 0, 0, 0, 0, 0], index=train_idx, dtype=float)

    test_idx = pd.date_range("2025-12-15", periods=2, freq="D")
    actual = pd.Series([11, 0], index=test_idx, dtype=float)
    predicted = pd.Series([10, 0], index=test_idx, dtype=float)

    result = mase(actual, predicted, train_actual)
    assert result > 0


def test_mase_raises_when_train_scale_zero():
    idx = pd.date_range("2026-01-01", periods=10, freq="D")
    train_actual = pd.Series([5] * 10, index=idx, dtype=float)  # 7일전과 항상 동일 -> diff=0
    test_idx = pd.date_range("2026-01-11", periods=2, freq="D")
    actual = pd.Series([5, 5], index=test_idx, dtype=float)
    predicted = pd.Series([5, 5], index=test_idx, dtype=float)
    with pytest.raises(ValueError):
        mase(actual, predicted, train_actual)


def test_service_level_perfect_prediction_is_one():
    idx = pd.date_range("2026-01-01", periods=3, freq="D")
    actual = pd.Series([10, 20, 30], index=idx, dtype=float)
    assert service_level(actual, actual) == pytest.approx(1.0)


def test_service_level_underprediction_reduces_below_one():
    idx = pd.date_range("2026-01-01", periods=2, freq="D")
    actual = pd.Series([100, 100], index=idx, dtype=float)
    predicted = pd.Series([80, 100], index=idx, dtype=float)
    # shortfall = 20, total = 200 -> service_level = 0.9
    assert service_level(actual, predicted) == pytest.approx(0.9)


def test_service_level_raises_when_actual_sum_zero():
    idx = pd.date_range("2026-01-01", periods=2, freq="D")
    actual = pd.Series([0, 0], index=idx, dtype=float)
    predicted = pd.Series([1, 1], index=idx, dtype=float)
    with pytest.raises(ValueError):
        service_level(actual, predicted)
