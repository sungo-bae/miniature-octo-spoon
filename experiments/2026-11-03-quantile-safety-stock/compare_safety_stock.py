#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""B/C등급(저매출) lumpy+intermittent SKU에서 분위수 기반 안전재고 vs
정규분포 가정 안전재고 vs 점추정모델(블렌드) 기반 재고목표를 비교한다.

목표 서비스수준(95%)을 실제로 얼마나 잘 달성하는지(realized_coverage)와,
그걸 달성하기 위해 평균적으로 얼마나 많은 재고가 필요한지를 본다.

사용법:
    python3 compare_safety_stock.py <sales_sample.csv> <calendar.csv> [출력 디렉터리]
"""
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, REPO_ROOT)

import numpy as np
import pandas as pd

from src.external.calendar_features import make_calendar_lag_features
from src.forecast.model_selector import run_baseline_candidate_backtest
from src.inventory.safety_stock import quantile_lead_time_target, realized_coverage

if len(sys.argv) < 3:
    print(f"사용법: python3 {sys.argv[0]} <sales_sample.csv> <calendar.csv> [출력 디렉터리]")
    sys.exit(1)

SALES_PATH = sys.argv[1]
CAL_PATH = sys.argv[2]
OUT_DIR = sys.argv[3] if len(sys.argv) > 3 else os.path.dirname(os.path.abspath(__file__))

RNG_SEED = 42
N_PER_CELL = 6
TEST_DAYS = 84
BIAS_WINDOW = 84
LEAD_TIME_DAYS = 7
SERVICE_LEVEL = 0.95


def load_calendar():
    cal = pd.read_csv(CAL_PATH, parse_dates=["date"])
    d_to_date = dict(zip(cal["d"], cal["date"]))
    holiday_df = pd.DataFrame({
        "date": cal["date"],
        "is_holiday": cal["event_name_1"].notna(),
        "holiday_name": cal["event_name_1"].fillna(""),
    })
    return d_to_date, holiday_df


def load_sales_long(d_to_date):
    df = pd.read_csv(SALES_PATH)
    d_cols = [c for c in df.columns if c.startswith("d_")]
    dates = pd.to_datetime([d_to_date[c] for c in d_cols])
    return df, d_cols, dates


def classify_sku(values: np.ndarray) -> str:
    nonzero = values[values > 0]
    if len(nonzero) == 0:
        return "unsellable"
    adi = len(values) / max(len(nonzero), 1)
    cv2 = (nonzero.std() / nonzero.mean()) ** 2 if nonzero.mean() > 0 else 0.0
    if adi < 1.32 and cv2 < 0.49:
        return "smooth"
    elif adi >= 1.32 and cv2 < 0.49:
        return "intermittent"
    elif adi < 1.32 and cv2 >= 0.49:
        return "erratic"
    else:
        return "lumpy"


def abc_class(total_sales: pd.Series) -> pd.Series:
    sorted_desc = total_sales.sort_values(ascending=False)
    cum_share = sorted_desc.cumsum() / sorted_desc.sum()
    labels = pd.Series(index=sorted_desc.index, dtype="object")
    labels[cum_share <= 0.70] = "A"
    labels[(cum_share > 0.70) & (cum_share <= 0.90)] = "B"
    labels[cum_share > 0.90] = "C"
    return labels.reindex(total_sales.index)


def main():
    d_to_date, holiday_df = load_calendar()
    df, d_cols, dates = load_sales_long(d_to_date)
    values = df[d_cols].to_numpy()
    total_sales = pd.Series(values.sum(axis=1), index=df.index)
    abc = abc_class(total_sales)
    pattern = pd.Series([classify_sku(values[i]) for i in range(len(df))], index=df.index)
    meta = pd.DataFrame({"id": df["id"], "abc": abc, "pattern": pattern, "total_sales": total_sales})

    rng = np.random.default_rng(RNG_SEED)
    sampled_idx = []
    for (a, p), group in meta.groupby(["abc", "pattern"]):
        if a is None or p == "unsellable":
            continue
        take = min(N_PER_CELL, len(group))
        sampled_idx.extend(rng.choice(group.index, size=take, replace=False).tolist())

    bc_hard_idx = [
        i for i in sampled_idx
        if meta.loc[i, "abc"] in ("B", "C") and meta.loc[i, "pattern"] in ("lumpy", "intermittent")
    ]
    print(f"B/C등급 lumpy+intermittent SKU 수: {len(bc_hard_idx)}개")

    test_start = dates[-TEST_DAYS]
    results = []
    for i in bc_hard_idx:
        sku_id = df.loc[i, "id"]
        y = pd.Series(values[i], index=dates, dtype=float)
        train_y = y.loc[y.index < test_start]
        test_y = y.loc[y.index >= test_start]

        if train_y.abs().sum() == 0 or test_y.abs().sum() == 0:
            print(f"  {sku_id} 건너뜀 (학습/검증구간 실제판매 0)")
            continue

        target_info = quantile_lead_time_target(
            train_y, lead_time_days=LEAD_TIME_DAYS, service_level_target=SERVICE_LEVEL
        )
        quantile_coverage = realized_coverage(test_y, LEAD_TIME_DAYS, target_info.quantile_target)
        normal_coverage = realized_coverage(test_y, LEAD_TIME_DAYS, target_info.normal_target)

        features = make_calendar_lag_features(y, lags=[1, 2, 3, 7, 14, 21, 28], holiday_calendar=holiday_df)
        try:
            blend_result = run_baseline_candidate_backtest(
                y, features, test_start=test_start, bias_window=BIAS_WINDOW
            )
            point_forecast_target = blend_result.candidate.iloc[:LEAD_TIME_DAYS].sum()
            point_coverage = realized_coverage(test_y, LEAD_TIME_DAYS, point_forecast_target)
        except Exception as exc:
            print(f"  {sku_id} 블렌드 예측 실패: {exc}")
            point_forecast_target = np.nan
            point_coverage = np.nan

        results.append({
            "id": sku_id, "abc": meta.loc[i, "abc"], "pattern": meta.loc[i, "pattern"],
            "quantile_target": target_info.quantile_target,
            "normal_target": target_info.normal_target,
            "point_forecast_target": point_forecast_target,
            "quantile_coverage": quantile_coverage,
            "normal_coverage": normal_coverage,
            "point_coverage": point_coverage,
        })

    res_df = pd.DataFrame(results)
    print(f"\n목표 서비스수준: {SERVICE_LEVEL:.0%}, 리드타임: {LEAD_TIME_DAYS}일, 평가 SKU 수: {len(res_df)}")
    print("\n실현 서비스수준(목표 95%에 가까울수록 좋음):")
    print(f"  분위수 기반:         평균 {res_df['quantile_coverage'].mean():.3f}  (표준편차 {res_df['quantile_coverage'].std():.3f})")
    print(f"  정규분포 가정:        평균 {res_df['normal_coverage'].mean():.3f}  (표준편차 {res_df['normal_coverage'].std():.3f})")
    print(f"  점추정모델(블렌드)x{LEAD_TIME_DAYS}: 평균 {res_df['point_coverage'].mean():.3f}  (표준편차 {res_df['point_coverage'].std():.3f})")

    print("\n평균 재고 목표치:")
    print(f"  분위수 기반:  {res_df['quantile_target'].mean():.2f}")
    print(f"  정규분포 가정: {res_df['normal_target'].mean():.2f}")
    print(f"  점추정모델:   {res_df['point_forecast_target'].mean():.2f}")

    res_df.to_csv(f"{OUT_DIR}/safety_stock_comparison.csv", index=False)
    print(f"\n결과 저장: {OUT_DIR}")


if __name__ == "__main__":
    main()
