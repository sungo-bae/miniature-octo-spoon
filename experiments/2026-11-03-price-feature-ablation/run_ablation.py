#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""가격 피처 ablation 테스트 (합성 데이터).

make_market_price_features()로 만든 가격 피처를 model_selector
파이프라인에 넣었을 때 실제로 WAPE가 개선되는지 "배관"을 검증한다.

중요한 제한: 샌드박스가 apis.data.go.kr에 접속할 수 없어 실제 KAMIS
가격 데이터를 쓸 수 없다. 더 근본적으로는, "실제 원재료 가격이 실제
고객사 수요를 예측하는가"는 실제 고객 파일럿 데이터 없이는 검증할 수
없는 별개의 질문이다. 이 테스트가 확인하는 것은 좁다: 가격-수요
관계가 데이터에 존재할 때, 기존 run_baseline_candidate_backtest
파이프라인이 그 신호를 포착해 WAPE를 개선할 수 있는 구조가 맞는지
여부(파이프라인 배관 검증)이지, "가격 피처가 성오테크 고객 수요
예측에 실제로 도움이 된다"는 사업 가설 검증이 아니다.
"""
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, REPO_ROOT)

import numpy as np
import pandas as pd

from src.external.calendar_features import make_calendar_lag_features
from src.external.market_price_features import make_market_price_features
from src.forecast.model_selector import run_baseline_candidate_backtest
from src.evaluation.poc_metrics import wape, mase

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

RNG_SEED = 7
N_DAYS = 730
TEST_DAYS = 84
ELASTICITY = 0.5  # 가격이 10% 오르면 수요가 약 5% 줄어드는 정도로 설정
EFFECT_LAG_DAYS = 3  # 가격변화가 수요에 반영되기까지의 실제 지연 (실무에서는 미리 알 수 없다고 가정)
PRICE_LAGS = (1, 3, 5, 7, 10, 14, 21)  # 정확한 지연을 모를 때, 모델이 스스로 찾을 수 있도록 넉넉히 제공


def simulate_price_series(n_days: int, rng: np.random.Generator) -> np.ndarray:
    """평균회귀 + 간헐적 급등(명절/기상 충격)을 섞은 합성 원재료 가격."""
    price = np.zeros(n_days)
    level = 1000.0
    price[0] = level
    for t in range(1, n_days):
        shock = 0.0
        # 대략 40일에 한 번꼴로 가격 급등 이벤트 (최대 +40%), 이후 서서히 감쇠
        if rng.random() < 1 / 40:
            shock = rng.uniform(0.15, 0.40)
        mean_reversion = 0.03 * (level - price[t - 1])
        noise = rng.normal(0, level * 0.01)
        price[t] = price[t - 1] + mean_reversion + noise + price[t - 1] * shock
        price[t] = max(price[t], level * 0.5)
    return price


def simulate_demand(
    n_days: int, price: np.ndarray, dow: np.ndarray, rng: np.random.Generator
) -> np.ndarray:
    """요일 계절성 + 지연된 가격 변화율(7일)에 반응하는 합성 수요.

    실제 효과는 EFFECT_LAG_DAYS일 뒤에 나타나도록 했다 — 실무에서는
    정확한 지연을 미리 알 수 없다는 현실적인 가정이다. 모델에는 정확히
    이 지연에 해당하는 단일 피처를 주지 않고, PRICE_LAGS에 정의된 여러
    지연 피처를 넉넉히 제공해서, 모델 스스로 적절한 조합을 찾아낼 수
    있는지를 본다.
    """
    base = 100 + np.where(np.isin(dow, [5, 6]), 15, 0)  # 주말 수요 증가
    price_series = pd.Series(price)
    price_change = price_series.pct_change(periods=7).fillna(0.0).to_numpy()
    lagged_change = np.roll(price_change, EFFECT_LAG_DAYS)
    lagged_change[:EFFECT_LAG_DAYS] = 0.0
    demand_multiplier = 1 - ELASTICITY * np.clip(lagged_change, -0.5, 0.5)
    noise = rng.normal(0, 3, size=n_days)
    demand = base * demand_multiplier + noise
    return np.clip(demand, 0, None).round()


def main():
    rng = np.random.default_rng(RNG_SEED)
    idx = pd.date_range("2024-11-01", periods=N_DAYS, freq="D")
    dow = idx.dayofweek.to_numpy()

    price = simulate_price_series(N_DAYS, rng)
    y_values = simulate_demand(N_DAYS, price, dow, rng)
    y = pd.Series(y_values, index=idx, dtype=float)
    price_df = pd.DataFrame({"date": idx, "price": price})

    calendar_features = make_calendar_lag_features(y, lags=[1, 2, 3, 7, 14, 21, 28])
    features_with_price = make_market_price_features(calendar_features, price_df, lags=PRICE_LAGS)

    # GBR(트리 기반)는 서로 다른 지연의 원시가격을 조합해 "비율"을 근사하는 데
    # 약하다. price_lag_*를 아무리 많이 줘도 price_change_pct_7d 자체를 여러
    # 시차로 미리 계산해서 주지 않으면 못 찾을 수 있다 — 그걸 테스트하기 위해
    # 미리 계산된 변화율을 여러 시차로 추가 제공한다 (실무에서 정확한 지연을
    # 모를 때 권장되는 방식).
    features_with_price_shifted = features_with_price.copy()
    base_change = features_with_price["price_change_pct_7d"]
    for shift_days in (0, 1, 3, 5, 7, 10, 14):
        features_with_price_shifted[f"price_change_pct_7d_shift{shift_days}"] = base_change.shift(shift_days)

    test_start = idx[-TEST_DAYS]
    train_y_for_mase = y.loc[y.index < test_start]

    result_baseline = run_baseline_candidate_backtest(y, calendar_features, test_start=test_start)
    result_with_price = run_baseline_candidate_backtest(y, features_with_price, test_start=test_start)
    result_with_price_shifted = run_baseline_candidate_backtest(
        y, features_with_price_shifted, test_start=test_start
    )

    actual = y.loc[result_baseline.candidate.index]

    w_naive = wape(actual, result_baseline.baseline)
    w_without_price = wape(actual, result_baseline.candidate)
    w_with_price = wape(actual, result_with_price.candidate)
    w_with_price_shifted = wape(actual, result_with_price_shifted.candidate)

    m_without_price = mase(actual, result_baseline.candidate, train_y_for_mase)
    m_with_price = mase(actual, result_with_price.candidate, train_y_for_mase)
    m_with_price_shifted = mase(actual, result_with_price_shifted.candidate, train_y_for_mase)

    print("=" * 70)
    print(f"가격 피처 ablation 결과 (합성 데이터, 실제 효과 지연={EFFECT_LAG_DAYS}일)")
    print("=" * 70)
    print(f"계절나이브 기준모델 WAPE:              {w_naive:.4f}")
    print(f"가격 피처 없음 (기존 파이프라인)        WAPE: {w_without_price:.4f}  (개선율 {(w_naive-w_without_price)/w_naive*100:.1f}%)")
    print(f"가격 피처 포함(원시 lag만)              WAPE: {w_with_price:.4f}  (개선율 {(w_naive-w_with_price)/w_naive*100:.1f}%, 가격피처로 인한 추가개선 {(w_without_price-w_with_price)/w_without_price*100:.1f}%p)")
    print(f"가격 피처 포함(변화율 다중시차 추가)     WAPE: {w_with_price_shifted:.4f}  (개선율 {(w_naive-w_with_price_shifted)/w_naive*100:.1f}%, 가격피처로 인한 추가개선 {(w_without_price-w_with_price_shifted)/w_without_price*100:.1f}%p)")
    print()
    print(f"MASE 가격 피처 없음:            {m_without_price:.4f}")
    print(f"MASE 가격 피처(원시 lag만):      {m_with_price:.4f}")
    print(f"MASE 가격 피처(변화율 다중시차): {m_with_price_shifted:.4f}")

    summary = {
        "wape_naive_baseline": w_naive,
        "wape_without_price": w_without_price,
        "wape_with_price_raw_lags": w_with_price,
        "wape_with_price_shifted_pct_change": w_with_price_shifted,
        "additional_improve_raw_lags_pct": (w_without_price - w_with_price) / w_without_price * 100,
        "additional_improve_shifted_pct_change_pct": (w_without_price - w_with_price_shifted) / w_without_price * 100,
        "mase_without_price": m_without_price,
        "mase_with_price_raw_lags": m_with_price,
        "mase_with_price_shifted_pct_change": m_with_price_shifted,
        "elasticity_used": ELASTICITY,
        "effect_lag_days": EFFECT_LAG_DAYS,
        "n_days": N_DAYS,
        "test_days": TEST_DAYS,
    }
    pd.Series(summary).to_json(f"{OUT_DIR}/ablation_summary.json", indent=2)

    detail = pd.DataFrame({
        "date": actual.index,
        "actual": actual.values,
        "baseline": result_baseline.baseline.values,
        "pred_without_price": result_baseline.candidate.values,
        "pred_with_price_raw_lags": result_with_price.candidate.values,
        "pred_with_price_shifted": result_with_price_shifted.candidate.values,
        "price": price_df.set_index("date")["price"].reindex(actual.index).values,
    })
    detail.to_csv(f"{OUT_DIR}/ablation_detail.csv", index=False)
    print(f"\n결과 저장: {OUT_DIR}")


if __name__ == "__main__":
    main()
