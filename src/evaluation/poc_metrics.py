"""A5 PoC 평가엔진: 부록 B KPI 정의서의 WAPE·Bias·MASE·서비스수준 계산."""
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


def mase(actual: pd.Series, predicted: pd.Series, train_actual: pd.Series, seasonal_period: int = 7) -> float:
    """MASE = 평균|실제-예측| / 학습구간 계절나이브 평균오차 (Hyndman & Koehler, 2006).

    간헐수요 SKU는 WAPE 분모(검증구간 실제판매 합)가 작아 지표가
    불안정해지므로, 4.6절은 이런 SKU에 WAPE 대신 MASE를 주지표로 쓰도록
    규정한다.
    """
    actual_aligned, predicted_aligned = actual.align(predicted, join="inner")
    naive_errors = train_actual.diff(seasonal_period).abs().dropna()
    scale = naive_errors.mean()
    if scale == 0:
        raise ValueError("학습구간 계절나이브 평균오차가 0이라 MASE를 계산할 수 없습니다.")
    return float((actual_aligned - predicted_aligned).abs().mean() / scale)


def service_level(actual: pd.Series, predicted: pd.Series) -> float:
    """예측치를 재고량으로 가정했을 때의 서비스수준(수요충족률) 근사치.

    1 - (예측을 초과한 실제수요 합 / 실제수요 합). 값이 작을수록
    예측부족으로 인한 품절 위험이 크다는 뜻이다.
    """
    actual_aligned, predicted_aligned = actual.align(predicted, join="inner")
    total = actual_aligned.sum()
    if total == 0:
        raise ValueError("실제값 합이 0이라 서비스수준을 계산할 수 없습니다.")
    shortfall = (actual_aligned - predicted_aligned).clip(lower=0).sum()
    return float(1 - shortfall / total)
