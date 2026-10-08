"""A5 PoC 평가엔진: 부록 B KPI 정의서의 WAPE·Bias 계산."""
from __future__ import annotations

import pandas as pd


def wape(actual: pd.Series, predicted: pd.Series) -> float:
    """WAPE = Σ|실제-예측| / Σ|실제| (부록 B)."""
    actual_aligned, predicted_aligned = actual.align(predicted, join="inner")
    denom = actual_aligned.abs().sum()
    if denom == 0:
        raise ValueError("실제값 합이 0이라 WAPE를 계산할 수 없습니다.")
    return float((actual_aligned - predicted_aligned).abs().sum() / denom)


def bias(actual: pd.Series, predicted: pd.Series) -> float:
    """Bias = Σ(예측-실제) / Σ실제. 양수=과대예측, 음수=과소예측 (부록 B)."""
    actual_aligned, predicted_aligned = actual.align(predicted, join="inner")
    denom = actual_aligned.sum()
    if denom == 0:
        raise ValueError("실제값 합이 0이라 Bias를 계산할 수 없습니다.")
    return float((predicted_aligned - actual_aligned).sum() / denom)
