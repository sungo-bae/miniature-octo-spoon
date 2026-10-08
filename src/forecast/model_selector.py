"""3.2절 A2 모듈: 모델선택·확률예측(점추정 최소 구현).

4.5절 예비분석 코드와 동일한 구조(기준모델/후보모델 동일가중 결합, Bias
보정)를 유지하되, calendar_features의 외부 API 피처(명절·날씨)를 입력에
포함할 수 있도록 일반화한다.

본 모듈은 출발점이며, 확률예측·앙상블 가중치 최적화·롤링 오리진 검증
(3.5절)은 AI·최적화 선임연구원이 실증데이터로 직접 설계·검증해야 한다
(3.5절 직접개발 의무 문구, 6.4절 외주 금지 조항).
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor

from src.forecast.baselines import seasonal_naive_7

# holiday_name 등 텍스트 컬럼은 사람이 읽기 위한 부가정보이며 모델 입력에서 제외한다.
_NON_NUMERIC_FEATURE_COLUMNS = ("holiday_name",)


def _numeric_features(features: pd.DataFrame) -> pd.DataFrame:
    return features.drop(
        columns=[c for c in _NON_NUMERIC_FEATURE_COLUMNS if c in features.columns]
    )


@dataclass
class ForecastResult:
    candidate: pd.Series  # Bias 보정 적용된 최종 예측
    baseline: pd.Series
    bias_factor: float


def fit_bias_factor(actual: pd.Series, candidate: pd.Series) -> float:
    """4.2절과 동일한 방식으로 Bias 보정계수를 산출한다 (actual 합 / candidate 합)."""
    actual_aligned, candidate_aligned = actual.align(candidate, join="inner")
    mask = actual_aligned.notna() & candidate_aligned.notna()
    denom = candidate_aligned[mask].sum()
    if denom == 0:
        return 1.0
    return float(actual_aligned[mask].sum() / denom)


def run_baseline_candidate_backtest(
    y: pd.Series,
    features: pd.DataFrame,
    test_start: pd.Timestamp,
    bias_window: int = 84,
) -> ForecastResult:
    """4.2/4.5절 백테스트를 단순화한 1회 홀드아웃 버전으로 재현한다.

    주의: 이것은 3.5절이 요구하는 고정 컷오프·롤링 오리진 검증의 단순화
    버전(단일 분할)이다. 실제 PoC 판정(7.2절)에는 롤링 오리진 기반의
    반복 백테스트가 필요하며, 이는 AI·최적화 선임연구원이 직접 구현해야
    하는 핵심 연구내용이다.

    Args:
        y: 일별 판매량 Series (DatetimeIndex).
        features: make_calendar_lag_features()의 반환값과 동일한 인덱스.
        test_start: 이 날짜(포함)부터를 검증구간으로 사용한다.
        bias_window: Bias 보정계수 산출에 사용할 검증구간 직전 일수 (기본 84일).
    """
    baseline_full = seasonal_naive_7(y)
    numeric_features = _numeric_features(features)

    train_idx = features.index[features.index < test_start]
    test_idx = features.index[features.index >= test_start]
    if len(train_idx) == 0 or len(test_idx) == 0:
        raise ValueError("test_start 기준으로 학습/검증 구간이 비어 있습니다.")

    train_features = numeric_features.loc[train_idx].dropna()
    train_target = y.loc[train_features.index]
    if train_features.empty:
        raise ValueError("학습 피처가 모두 결측입니다 (지연 피처 warm-up 기간 확인).")

    model = GradientBoostingRegressor(loss="absolute_error")
    model.fit(train_features, train_target)

    test_features = numeric_features.loc[test_idx].dropna()
    ml_pred = pd.Series(model.predict(test_features), index=test_features.index)
    baseline_test = baseline_full.loc[ml_pred.index]
    candidate_raw = 0.5 * baseline_test + 0.5 * ml_pred

    bias_eval_idx = train_idx[-bias_window:] if len(train_idx) > bias_window else train_idx
    bias_eval_features = numeric_features.loc[bias_eval_idx].dropna()
    bias_eval_target = y.loc[bias_eval_features.index]
    bias_ml_pred = pd.Series(model.predict(bias_eval_features), index=bias_eval_features.index)
    bias_baseline = baseline_full.loc[bias_ml_pred.index]
    bias_candidate_raw = 0.5 * bias_baseline + 0.5 * bias_ml_pred
    bias_factor = fit_bias_factor(bias_eval_target, bias_candidate_raw)

    candidate_corrected = candidate_raw * bias_factor
    return ForecastResult(
        candidate=candidate_corrected, baseline=baseline_test, bias_factor=bias_factor
    )
