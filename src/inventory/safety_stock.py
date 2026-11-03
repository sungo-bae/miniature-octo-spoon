"""4.6절 보완 B5 대응책(2): 럼피수요 전용 분위수 기반 안전재고.

experiments/2026-11-03-lumpy-tsb-test에서 B/C등급(저매출) 럼피수요
SKU는 블렌드/Croston/TSB 점추정 모델 모두 WAPE 개선이 없었다. lumpy는
수요크기 변동(CV²) 자체가 크기 때문에, "하루 수요를 정확히 맞히는"
점추정 접근 자체가 이 패턴에 안 맞을 수 있다 — 연구개발계획서 4.6절
보완 B5도 "간헐 SKU에는 WAPE 대신 서비스수준을 주지표로 사용한다"고
이미 규정하고 있었다.

이 모듈은 점추정 모델을 안전재고 공식(평균+Z*표준편차, 정규분포 가정)에
대입하는 대신, 리드타임 동안의 합산수요 분포 자체를 과거 데이터에서
직접 추정(경험적 분위수)해 목표 서비스수준을 달성하는 재고 수준을
구한다. 정규분포를 가정하지 않으므로 럼피수요처럼 비대칭·고첨도
분포에 더 안전하다.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

_Z_SCORE_95 = 1.6448536269514722  # 표준정규분포 95% 분위수


@dataclass(frozen=True)
class SafetyStockTarget:
    quantile_target: float  # 경험적 분위수 기반 목표(리드타임 합산수요)
    normal_target: float  # 정규분포 가정(평균+Z*표준편차) 기반 목표 — 비교용
    lead_time_days: int
    service_level_target: float


def quantile_lead_time_target(
    y_train: pd.Series,
    lead_time_days: int,
    service_level_target: float = 0.95,
) -> SafetyStockTarget:
    """과거 데이터의 리드타임 합산수요 분포에서 목표 서비스수준 분위수를 구한다.

    Args:
        y_train: 학습구간 일별 판매량 (0 포함).
        lead_time_days: 발주 리드타임(일수) — 이 기간 동안의 합산수요를 본다.
        service_level_target: 목표 서비스수준 (예: 0.95 = 95%).

    Returns:
        경험적 분위수 목표(quantile_target)와, 비교용으로 정규분포
        가정(평균+Z*표준편차) 기반 목표(normal_target)를 함께 반환한다.
    """
    if lead_time_days <= 0:
        raise ValueError("lead_time_days는 1 이상이어야 합니다.")
    if not (0 < service_level_target < 1):
        raise ValueError("service_level_target은 0과 1 사이여야 합니다.")

    rolling_sum = y_train.rolling(lead_time_days).sum().dropna()
    if rolling_sum.empty:
        raise ValueError("학습구간이 lead_time_days보다 짧아 롤링합을 계산할 수 없습니다.")

    quantile_target = float(rolling_sum.quantile(service_level_target))

    mean = rolling_sum.mean()
    std = rolling_sum.std()
    z = _Z_SCORE_95 if service_level_target == 0.95 else float(
        pd.Series([service_level_target]).apply(lambda q: _z_from_quantile(q)).iloc[0]
    )
    normal_target = float(mean + z * std)

    return SafetyStockTarget(
        quantile_target=quantile_target,
        normal_target=normal_target,
        lead_time_days=lead_time_days,
        service_level_target=service_level_target,
    )


def realized_coverage(y_test: pd.Series, lead_time_days: int, target: float) -> float:
    """검증구간을 lead_time_days 블록으로 나눠, 각 블록의 실제 합산수요가
    target 이하였던 비율(실현 서비스수준)을 계산한다.

    목표 서비스수준(예: 0.95)과 이 실현값이 가까울수록, 그 target이
    실제로 과거 패턴을 잘 반영했다는 뜻이다.
    """
    if lead_time_days <= 0:
        raise ValueError("lead_time_days는 1 이상이어야 합니다.")
    values = y_test.to_numpy(dtype=float)
    n_blocks = len(values) // lead_time_days
    if n_blocks == 0:
        raise ValueError("검증구간이 lead_time_days보다 짧아 블록을 만들 수 없습니다.")

    hits = 0
    for b in range(n_blocks):
        block_sum = values[b * lead_time_days : (b + 1) * lead_time_days].sum()
        if block_sum <= target:
            hits += 1
    return hits / n_blocks


def _z_from_quantile(q: float) -> float:
    """표준정규분포 분위수 함수(ppf)의 간이 근사치 (scipy 의존성 회피).

    Acklam(2003)의 유리함수 근사 — 흔히 쓰이는 고정밀 근사식이다.
    """
    if q <= 0 or q >= 1:
        raise ValueError("q는 0과 1 사이여야 합니다.")
    # 표준 Acklam 알고리즘 계수
    a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
         1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
    b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
         6.680131188771972e+01, -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
         -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
         3.754408661907416e+00]
    p_low, p_high = 0.02425, 1 - 0.02425
    if q < p_low:
        x = np.sqrt(-2 * np.log(q))
        return (((((c[0] * x + c[1]) * x + c[2]) * x + c[3]) * x + c[4]) * x + c[5]) / \
            ((((d[0] * x + d[1]) * x + d[2]) * x + d[3]) * x + 1)
    if q > p_high:
        x = np.sqrt(-2 * np.log(1 - q))
        return -(((((c[0] * x + c[1]) * x + c[2]) * x + c[3]) * x + c[4]) * x + c[5]) / \
            ((((d[0] * x + d[1]) * x + d[2]) * x + d[3]) * x + 1)
    x = q - 0.5
    r = x * x
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * x / \
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
