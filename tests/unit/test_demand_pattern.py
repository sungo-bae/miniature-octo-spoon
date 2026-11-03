from __future__ import annotations

import numpy as np
import pandas as pd

from src.forecast.demand_pattern import classify_demand_pattern


def _series(values: list[float]) -> pd.Series:
    idx = pd.date_range("2025-01-01", periods=len(values), freq="D")
    return pd.Series(values, index=idx, dtype=float)


def test_classify_smooth_demand():
    rng = np.random.default_rng(0)
    values = (50 + rng.normal(0, 2, size=200)).round().clip(min=1).tolist()
    assert classify_demand_pattern(_series(values)) == "smooth"


def test_classify_intermittent_demand():
    values = [0.0] * 200
    for i in range(0, 200, 5):
        values[i] = 3.0
    assert classify_demand_pattern(_series(values)) == "intermittent"


def test_classify_unsellable_when_all_zero():
    assert classify_demand_pattern(_series([0.0] * 50)) == "unsellable"


def test_classify_lumpy_demand():
    # 드문 수요(ADI 큼) + 수요크기 변동성 큼(CV^2 큼, 1 또는 100이 번갈아 등장)
    values = [0.0] * 200
    sparse_idx = list(range(0, 200, 10))
    for n, i in enumerate(sparse_idx):
        values[i] = 1.0 if n % 2 == 0 else 100.0
    assert classify_demand_pattern(_series(values)) == "lumpy"
