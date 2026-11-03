#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""run_litmus.py와 동일한 표본(RNG_SEED=42)에 대해 기존 블렌드 모델과
수요패턴 분기(Croston SBA 포함, model_selector.run_pattern_aware_backtest) 모델을
WAPE로 비교한다.

사용법:
    python3 compare_pattern_aware.py <sales_sample.csv> <calendar.csv> [출력 디렉터리]

run_litmus.py와 동일한 M5 CA_1 데이터가 필요하다 (원본 CSV는 용량 문제로
이 저장소에 포함하지 않음 — findings.md 참고).
"""
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, REPO_ROOT)

import numpy as np
import pandas as pd

from src.external.calendar_features import make_calendar_lag_features
from src.forecast.model_selector import run_baseline_candidate_backtest, run_pattern_aware_backtest
from src.evaluation.poc_metrics import wape

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
    print("데이터 로드 중...")
    d_to_date, holiday_df = load_calendar()
    df, d_cols, dates = load_sales_long(d_to_date)

    values = df[d_cols].to_numpy()
    total_sales = pd.Series(values.sum(axis=1), index=df.index)
    abc = abc_class(total_sales)
    pattern = pd.Series([classify_sku(values[i]) for i in range(len(df))], index=df.index)

    meta = pd.DataFrame({
        "id": df["id"], "cat_id": df["cat_id"], "abc": abc, "pattern": pattern,
        "total_sales": total_sales,
    })

    rng = np.random.default_rng(RNG_SEED)
    sampled_idx = []
    for (a, p), group in meta.groupby(["abc", "pattern"]):
        if a is None or p == "unsellable":
            continue
        take = min(N_PER_CELL, len(group))
        sampled_idx.extend(rng.choice(group.index, size=take, replace=False).tolist())
    print(f"표본 SKU 수: {len(sampled_idx)}개")

    test_start = dates[-TEST_DAYS]
    results = []
    for n, i in enumerate(sampled_idx, 1):
        sku_id = df.loc[i, "id"]
        y = pd.Series(values[i], index=dates, dtype=float)
        features = make_calendar_lag_features(
            y, lags=[1, 2, 3, 7, 14, 21, 28], holiday_calendar=holiday_df
        )
        try:
            old_result = run_baseline_candidate_backtest(
                y, features, test_start=test_start, bias_window=BIAS_WINDOW
            )
            new_result = run_pattern_aware_backtest(
                y, features, test_start=test_start, bias_window=BIAS_WINDOW
            )
        except Exception as exc:
            print(f"  [{n}/{len(sampled_idx)}] {sku_id} 실패: {exc}")
            continue

        actual = y.loc[old_result.candidate.index]
        if actual.abs().sum() == 0:
            print(f"  [{n}/{len(sampled_idx)}] {sku_id} 건너뜀 (검증구간 실제판매 0)")
            continue

        w_base = wape(actual, old_result.baseline)
        w_old = wape(actual, old_result.candidate)
        w_new = wape(actual, new_result.candidate)
        results.append({
            "id": sku_id, "cat_id": meta.loc[i, "cat_id"], "abc": meta.loc[i, "abc"],
            "pattern": meta.loc[i, "pattern"], "total_sales": meta.loc[i, "total_sales"],
            "wape_baseline": w_base, "wape_old_blend": w_old, "wape_new_pattern_aware": w_new,
            "new_method": new_result.method,
            "test_actual_sum": actual.sum(),
        })
        if n % 10 == 0 or n == len(sampled_idx):
            print(f"  [{n}/{len(sampled_idx)}] 처리 완료")

    res_df = pd.DataFrame(results)
    res_df.to_csv(f"{OUT_DIR}/compare_results_per_sku.csv", index=False)

    w = res_df["test_actual_sum"]
    overall_base = (res_df["wape_baseline"] * w).sum() / w.sum()
    overall_old = (res_df["wape_old_blend"] * w).sum() / w.sum()
    overall_new = (res_df["wape_new_pattern_aware"] * w).sum() / w.sum()

    print("\n" + "=" * 70)
    print("전체 가중 WAPE 비교")
    print(f"  기준모델(계절나이브):        {overall_base:.4f}")
    print(f"  기존 블렌드 모델:            {overall_old:.4f} (개선율 {(overall_base-overall_old)/overall_base*100:.1f}%)")
    print(f"  신규 패턴분기 모델(Croston): {overall_new:.4f} (개선율 {(overall_base-overall_new)/overall_base*100:.1f}%)")
    print("=" * 70)

    print("\n셀(ABC x 패턴)별 비교:")
    def agg(g):
        wb = (g["wape_baseline"] * g["test_actual_sum"]).sum() / g["test_actual_sum"].sum()
        wo = (g["wape_old_blend"] * g["test_actual_sum"]).sum() / g["test_actual_sum"].sum()
        wn = (g["wape_new_pattern_aware"] * g["test_actual_sum"]).sum() / g["test_actual_sum"].sum()
        return pd.Series({
            "n_sku": len(g),
            "wape_baseline": wb,
            "wape_old_blend": wo,
            "wape_new_pattern_aware": wn,
            "old_improve_pct": (wb - wo) / wb * 100,
            "new_improve_pct": (wb - wn) / wb * 100,
        })

    cell_summary = res_df.groupby(["abc", "pattern"]).apply(agg, include_groups=False)
    print(cell_summary.to_string())
    cell_summary.to_csv(f"{OUT_DIR}/compare_results_by_cell.csv")
    print(f"\n결과 저장: {OUT_DIR}")


if __name__ == "__main__":
    main()
