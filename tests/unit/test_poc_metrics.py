from __future__ import annotations

import pandas as pd
import pytest

from src.evaluation.poc_metrics import bias, wape


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
