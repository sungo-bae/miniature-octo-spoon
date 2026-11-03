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
from src.forecast.demand_pattern import classify_demand_pattern
from src.forecast.intermittent import croston_sba_forecast

# Croston SBA 분기 조건 (4.6절 보완 B5, experiments/2026-11-03-m5-litmus-test 실증 결과):
#
# M5 CA_1 매장 48개 SKU 비교 실험에서 Croston SBA는 수요크기 자체가
# 불규칙한 lumpy 패턴에는 전 셀에서 블렌드모델보다 나빴고(flat 예측이
# 큰 변동성을 못 따라감), intermittent 패턴 중에서도 매출 상위(A등급,
# 학습구간 일평균 판매량 대략 2 이상) SKU는 ML 블렌드가 이미 더
# 나았다(블렌드 14.5% 개선 -> Croston 적용시 -1.3%로 악화). 반면
# 매출 하위(B/C등급, 일평균 1 내외) intermittent SKU에서는 Croston이
# 블렌드보다 뚜렷이 나았다(-1.1%/-9.1% 악화 -> +12.8%/+14.4% 개선).
# 따라서 "intermittent 패턴 + 저매출" 조합에만 Croston을 적용한다.
# _LOW_VOLUME_AVG_RATE 임계값은 CA_1 1개 매장 표본에서 A등급과 B/C등급이
# 뚜렷이 갈리는 지점(일평균 약 1.3)으로 정했으며, 다른 매장으로 재검증 시
# 조정이 필요할 수 있다.
_CROSTON_PATTERN = "intermittent"
_LOW_VOLUME_AVG_RATE = 1.3

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
    method: str = "blend"  # "blend"(계절나이브+GBM) | "croston_sba"
    demand_pattern: str | None = None


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

    model = GradientBoostingRegressor(loss="absolute_error", random_state=42)
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


def run_pattern_aware_backtest(
    y: pd.Series,
    features: pd.DataFrame,
    test_start: pd.Timestamp,
    bias_window: int = 84,
) -> ForecastResult:
    """수요패턴(4.6절 보완 B5)에 따라 모델을 분기하는 백테스트.

    학습구간만으로 ADI/CV^2 분류와 일평균 판매량을 계산해, intermittent
    패턴이면서 저매출(_LOW_VOLUME_AVG_RATE 미만)인 SKU만 Croston
    SBA(croston_sba_forecast)를 사용하고, 그 외(smooth/erratic/lumpy,
    고매출 intermittent)에는 기존 run_baseline_candidate_backtest의
    계절나이브+GBM 블렌드를 사용한다. 분류를 검증구간이 아닌 학습구간만
    으로 수행하는 것은 미래 데이터 누출(data leakage)을 막기 위함이다.
    """
    train_y = y.loc[y.index < test_start]
    test_idx = features.index[features.index >= test_start]
    if len(train_y) == 0 or len(test_idx) == 0:
        raise ValueError("test_start 기준으로 학습/검증 구간이 비어 있습니다.")

    pattern = classify_demand_pattern(train_y)
    use_croston = pattern == _CROSTON_PATTERN and train_y.mean() < _LOW_VOLUME_AVG_RATE

    if not use_croston:
        result = run_baseline_candidate_backtest(y, features, test_start, bias_window)
        result.demand_pattern = pattern
        return result

    baseline_full = seasonal_naive_7(y)
    baseline_test = baseline_full.loc[test_idx]

    forecast_values = croston_sba_forecast(train_y, horizon=len(test_idx))
    candidate = pd.Series(forecast_values, index=test_idx)

    return ForecastResult(
        candidate=candidate,
        baseline=baseline_test,
        bias_factor=1.0,
        method="croston_sba",
        demand_pattern=pattern,
    )
