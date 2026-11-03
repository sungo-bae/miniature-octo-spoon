from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.inventory.safety_stock import quantile_lead_time_target, realized_coverage


def _series(values: list[float]) -> pd.Series:
    idx = pd.date_range("2025-01-01", periods=len(values), freq="D")
    return pd.Series(values, index=idx, dtype=float)


def test_quantile_lead_time_target_rejects_invalid_lead_time():
    y = _series([1.0] * 20)
    with pytest.raises(ValueError):
        quantile_lead_time_target(y, lead_time_days=0)


def test_quantile_lead_time_target_rejects_invalid_service_level():
    y = _series([1.0] * 20)
    with pytest.raises(ValueError):
        quantile_lead_time_target(y, lead_time_days=7, service_level_target=1.5)


def test_quantile_lead_time_target_rejects_too_short_train():
    y = _series([1.0] * 5)
    with pytest.raises(ValueError):
        quantile_lead_time_target(y, lead_time_days=7)


def test_quantile_lead_time_target_constant_demand():
    # 매일 10씩 팔리면 7일 합산수요는 항상 70 -> 어떤 분위수를 요구해도 70
    y = _series([10.0] * 100)
    target = quantile_lead_time_target(y, lead_time_days=7, service_level_target=0.95)
    assert target.quantile_target == pytest.approx(70.0)
    assert target.lead_time_days == 7
    assert target.service_level_target == 0.95


def test_quantile_lead_time_target_higher_service_level_gives_higher_target():
    rng = np.random.default_rng(0)
    values = rng.poisson(lam=3.0, size=200).astype(float)
    y = _series(list(values))

    low = quantile_lead_time_target(y, lead_time_days=7, service_level_target=0.80)
    high = quantile_lead_time_target(y, lead_time_days=7, service_level_target=0.99)

    assert high.quantile_target >= low.quantile_target


def test_realized_coverage_perfect_when_target_is_max():
    y = _series([0.0, 5.0, 0.0, 20.0, 0.0, 0.0, 0.0] * 4)  # 7일 블록 4개
    # 충분히 큰 target이면 모든 블록을 커버해야 한다
    coverage = realized_coverage(y, lead_time_days=7, target=1e9)
    assert coverage == pytest.approx(1.0)


def test_realized_coverage_zero_when_target_too_low():
    y = _series([5.0] * 14)  # 7일 블록 2개, 블록합 35씩
    coverage = realized_coverage(y, lead_time_days=7, target=1.0)
    assert coverage == pytest.approx(0.0)


def test_realized_coverage_rejects_too_short_test():
    y = _series([1.0] * 3)
    with pytest.raises(ValueError):
        realized_coverage(y, lead_time_days=7, target=10.0)
