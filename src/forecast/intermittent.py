"""4.6절 보완 B5 대응책: 간헐·럼피수요 SKU 전용 모델 (Croston SBA, TSB).

리트머스 테스트(experiments/2026-11-03-m5-litmus-test)에서 기존
기준모델 0.5 + GradientBoosting 0.5 블렌드가 B/C등급 간헐수요에서
기준모델보다 더 나쁜 결과(C등급 간헐 -9.1%)를 보였다. 간헐수요는
대부분의 날이 0판매이기 때문에 회귀모델이 평균으로 회귀하는 예측을
내지 못하고, WAPE 분모(실제판매 합)도 작아 지표가 불안정해진다.

Croston(1972)과 Syntetos-Boylan Approximation(SBA, 2005) 보정을 적용한
고전적 간헐수요 예측법으로 대체한다: 비영(非零) 수요크기와 수요간격을
각각 지수평활하여 "평균 수요크기 / 평균 수요간격"을 평평한(flat) 예측치로
사용한다.

Croston SBA는 간헐수요(intermittent)에서는 model_selector.py 블렌드보다
나았지만, 럼피수요(lumpy, 수요크기 변동 자체가 큰 패턴)에는 도움이 안
됐다(모델선택 설계문서 참고). TSB(Teunter-Syntetos-Babai, 2011)를 추가
후보로 넣어, 수요발생확률을 매 기간(비영 수요가 없는 날에도) 갱신하는
방식이 럼피수요에 더 적합한지 실증 확인한다.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def croston_sba_forecast(y_train: pd.Series, horizon: int, alpha: float = 0.1) -> np.ndarray:
    """SBA 보정이 적용된 Croston 예측. horizon일 동안 동일한 평평한 값을 반환한다.

    Args:
        y_train: 학습구간 일별 판매량 (0 포함).
        horizon: 예측할 일수.
        alpha: 지수평활 계수 (Croston 권장 범위 0.1~0.3).
    """
    if horizon <= 0:
        raise ValueError("horizon은 1 이상이어야 합니다.")

    values = y_train.to_numpy(dtype=float)
    nonzero_idx = np.flatnonzero(values > 0)
    if len(nonzero_idx) == 0:
        return np.zeros(horizon)

    demand_sizes = values[nonzero_idx]
    # 수요간격: 학습구간 시작부터 첫 비영 수요까지를 첫 간격으로 포함한다.
    intervals = np.diff(nonzero_idx, prepend=-1).astype(float)

    z = demand_sizes[0]
    p = intervals[0]
    for i in range(1, len(demand_sizes)):
        z = alpha * demand_sizes[i] + (1 - alpha) * z
        p = alpha * intervals[i] + (1 - alpha) * p

    rate = (1 - alpha / 2) * (z / p)  # SBA 보정: 고전 Croston의 양의 편향을 완화
    return np.full(horizon, rate)


def tsb_forecast(
    y_train: pd.Series, horizon: int, alpha: float = 0.1, beta: float = 0.1
) -> np.ndarray:
    """TSB(Teunter-Syntetos-Babai, 2011) 예측. horizon일 동안 동일한 평평한 값을 반환한다.

    Croston과의 핵심 차이: 수요발생확률(p)을 비영 수요가 없는 날에도 매
    기간 갱신한다(Croston은 비영 수요가 발생한 시점에만 간격을 갱신).
    이 덕분에 수요 발생 빈도가 최근 들어 바뀌는 추세에 더 빠르게
    반응하고, 수요가 완전히 끊기는 경우(obsolescence)에도 Croston처럼
    예측값이 영원히 남아있지 않고 0으로 수렴한다.

    Args:
        y_train: 학습구간 일별 판매량 (0 포함).
        horizon: 예측할 일수.
        alpha: 수요크기 지수평활 계수.
        beta: 수요발생확률 지수평활 계수.
    """
    if horizon <= 0:
        raise ValueError("horizon은 1 이상이어야 합니다.")

    values = y_train.to_numpy(dtype=float)
    nonzero_idx = np.flatnonzero(values > 0)
    if len(nonzero_idx) == 0:
        return np.zeros(horizon)

    p = len(nonzero_idx) / len(values)  # 초기 발생확률: 전체 기간 중 비영 비율
    z = values[nonzero_idx[0]]  # 초기 크기: 첫 비영 수요값

    for t in range(len(values)):
        occurred = values[t] > 0
        p = p + beta * (float(occurred) - p)
        if occurred:
            z = z + alpha * (values[t] - z)

    rate = p * z
    return np.full(horizon, rate)
