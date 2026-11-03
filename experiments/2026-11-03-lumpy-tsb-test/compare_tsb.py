#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""럼피수요(lumpy) 셀에서 기존 블렌드/Croston SBA/TSB를 비교한다.

experiments/2026-11-03-m5-litmus-test와 같은 M5 CA_1 표본(RNG_SEED=42)에서
lumpy로 분류된 SKU만 뽑아 비교한다.

사용법:
    python3 compare_tsb.py <sales_sample.csv> <calendar.csv> [출력 디렉터리]

원본 데이터: M5 Forecasting Accuracy (Walmart, Kaggle/Zenodo 공개).
용량 문제로 원본 CSV는 이 폴더에 포함하지 않았다.
"""
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, REPO_ROOT)

import numpy as np
import pandas as pd

from src.external.calendar_features import make_calendar_lag_features
from src.forecast.model_selector import run_baseline_candidate_backtest
from src.forecast.intermittent import croston_sba_forecast, tsb_forecast
from src.evaluation.poc_metrics import wape, service_level

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
    """demand_pattern.classify_demand_pattern()과 동일한 ADI/CV^2 기준."""
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

    # lumpy로 분류된 SKU만 추림 (A/B/C 전체) — run_litmus.py와 동일한 표본이어야
    # 기존 리트머스 테스트 결과와 직접 비교 가능하다.
    lumpy_idx = [i for i in sampled_idx if meta.loc[i, "pattern"] == "lumpy"]
    print(f"lumpy SKU 수: {len(lumpy_idx)}개 (등급별: {meta.loc[lumpy_idx, 'abc'].value_counts().to_dict()})")

    test_start = dates[-TEST_DAYS]
    results = []
    for i in lumpy_idx:
        sku_id = df.loc[i, "id"]
        y = pd.Series(values[i], index=dates, dtype=float)
        features = make_calendar_lag_features(y, lags=[1, 2, 3, 7, 14, 21, 28], holiday_calendar=holiday_df)

        train_y = y.loc[y.index < test_start]
        test_idx = features.index[features.index >= test_start]

        blend_result = run_baseline_candidate_backtest(y, features, test_start=test_start, bias_window=BIAS_WINDOW)
        actual = y.loc[blend_result.candidate.index]
        if actual.abs().sum() == 0:
            print(f"  {sku_id} 건너뜀 (검증구간 실제판매 0)")
            continue

        croston_pred = pd.Series(croston_sba_forecast(train_y, horizon=len(test_idx)), index=test_idx)
        tsb_pred = pd.Series(tsb_forecast(train_y, horizon=len(test_idx)), index=test_idx)

        results.append({
            "id": sku_id, "abc": meta.loc[i, "abc"],
            "wape_baseline": wape(actual, blend_result.baseline),
            "wape_blend": wape(actual, blend_result.candidate),
            "wape_croston": wape(actual, croston_pred),
            "wape_tsb": wape(actual, tsb_pred),
            "service_blend": service_level(actual, blend_result.candidate),
            "service_croston": service_level(actual, croston_pred),
            "service_tsb": service_level(actual, tsb_pred),
            "test_actual_sum": actual.sum(),
        })

    res_df = pd.DataFrame(results)
    w = res_df["test_actual_sum"]

    def wavg(col):
        return (res_df[col] * w).sum() / w.sum()

    print("\n" + "=" * 70)
    print("럼피수요(lumpy) 전체 가중 비교")
    print("=" * 70)
    wape_base = wavg("wape_baseline")
    for label, col in [("기준모델(계절나이브)", "wape_baseline"), ("기존 블렌드", "wape_blend"),
                        ("Croston SBA", "wape_croston"), ("TSB", "wape_tsb")]:
        v = wavg(col)
        improve = (wape_base - v) / wape_base * 100
        print(f"  {label:20s} WAPE={v:.4f}  (개선율 {improve:.1f}%)")

    print()
    for label, col in [("기존 블렌드", "service_blend"), ("Croston SBA", "service_croston"), ("TSB", "service_tsb")]:
        print(f"  {label:20s} 서비스수준={wavg(col):.4f}")

    print("\n등급별 TSB 개선율:")
    for abc_grade, group in res_df.groupby("abc"):
        wg = group["test_actual_sum"]
        wb = (group["wape_baseline"] * wg).sum() / wg.sum()
        wt = (group["wape_tsb"] * wg).sum() / wg.sum()
        print(f"  {abc_grade}등급 lumpy (n={len(group)}): 기준={wb:.4f}, TSB={wt:.4f}, 개선율={(wb-wt)/wb*100:.1f}%")

    res_df.to_csv(f"{OUT_DIR}/lumpy_comparison.csv", index=False)
    print(f"\n결과 저장: {OUT_DIR}")


if __name__ == "__main__":
    main()
