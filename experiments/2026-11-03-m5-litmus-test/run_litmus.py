#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""G0.5 조기 다품목 리트머스 테스트: M5(CA_1 매장) 데이터로 model_selector.py 검증.

4.6절 보완 B5의 ABC x 수요패턴 층화 검증 설계를 간이 적용한다.

사용법:
    python3 run_litmus.py <sales_sample.csv> <calendar.csv> [출력 디렉터리]

원본 데이터: M5 Forecasting Accuracy (Walmart, Kaggle/Zenodo 공개).
sales_sample.csv는 M5 sales_train_validation.csv를 store_id=CA_1로 필터링한 것,
calendar.csv는 M5 원본 calendar.csv 그대로. 이 실험 폴더에는 용량 문제로
원본 CSV를 포함하지 않았다 (findings.md 참조).
"""
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, REPO_ROOT)

import numpy as np
import pandas as pd

from src.external.calendar_features import make_calendar_lag_features
from src.forecast.model_selector import run_baseline_candidate_backtest
from src.evaluation.poc_metrics import wape, bias

if len(sys.argv) < 3:
    print(f"사용법: python3 {sys.argv[0]} <sales_sample.csv> <calendar.csv> [출력 디렉터리]")
    sys.exit(1)

SALES_PATH = sys.argv[1]
CAL_PATH = sys.argv[2]
OUT_DIR = sys.argv[3] if len(sys.argv) > 3 else os.path.dirname(os.path.abspath(__file__))

RNG_SEED = 42
N_PER_CELL = 6  # 4.6절: 셀당 최소 3개 이상 -> 여유있게 6개
TEST_DAYS = 84  # 4.2절과 동일한 홀드아웃 길이
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
    """ADI(평균 수요 간격) CV^2 기준 수요패턴 분류 (4.6절)."""
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
    print(f"전체 SKU: {len(df)}개, 기간: {dates.min().date()} ~ {dates.max().date()} ({len(dates)}일)")

    values = df[d_cols].to_numpy()
    total_sales = pd.Series(values.sum(axis=1), index=df.index)
    abc = abc_class(total_sales)
    pattern = pd.Series([classify_sku(values[i]) for i in range(len(df))], index=df.index)

    meta = pd.DataFrame({
        "id": df["id"], "cat_id": df["cat_id"], "abc": abc, "pattern": pattern,
        "total_sales": total_sales,
    })
    print("\n층화 셀 분포 (ABC x 수요패턴):")
    print(meta.groupby(["abc", "pattern"]).size().unstack(fill_value=0))

    rng = np.random.default_rng(RNG_SEED)
    sampled_idx = []
    for (a, p), group in meta.groupby(["abc", "pattern"]):
        if a is None or p == "unsellable":
            continue
        take = min(N_PER_CELL, len(group))
        sampled_idx.extend(rng.choice(group.index, size=take, replace=False).tolist())
    print(f"\n표본 SKU 수: {len(sampled_idx)}개")

    test_start = dates[-TEST_DAYS]
    results = []
    for n, i in enumerate(sampled_idx, 1):
        sku_id = df.loc[i, "id"]
        y = pd.Series(values[i], index=dates, dtype=float)
        features = make_calendar_lag_features(
            y, lags=[1, 2, 3, 7, 14, 21, 28], holiday_calendar=holiday_df
        )
        try:
            result = run_baseline_candidate_backtest(
                y, features, test_start=test_start, bias_window=BIAS_WINDOW
            )
        except Exception as exc:
            print(f"  [{n}/{len(sampled_idx)}] {sku_id} 실패: {exc}")
            continue

        actual = y.loc[result.candidate.index]
        if actual.abs().sum() == 0:
            # 부록 B KPI 정의서: "실제 총합 0 구간 제외"
            print(f"  [{n}/{len(sampled_idx)}] {sku_id} 건너뜀 (검증구간 실제판매 0)")
            continue
        w_base = wape(actual, result.baseline)
        w_cand = wape(actual, result.candidate)
        b_cand = bias(actual, result.candidate)
        results.append({
            "id": sku_id, "cat_id": meta.loc[i, "cat_id"], "abc": meta.loc[i, "abc"],
            "pattern": meta.loc[i, "pattern"], "total_sales": meta.loc[i, "total_sales"],
            "wape_baseline": w_base, "wape_candidate": w_cand, "bias_candidate": b_cand,
            "test_actual_sum": actual.sum(),
        })
        if n % 10 == 0 or n == len(sampled_idx):
            print(f"  [{n}/{len(sampled_idx)}] 처리 완료")

    res_df = pd.DataFrame(results)
    res_df.to_csv(f"{OUT_DIR}/litmus_results_per_sku.csv", index=False)

    w = res_df["test_actual_sum"]
    overall_base = (res_df["wape_baseline"] * w).sum() / w.sum()
    overall_cand = (res_df["wape_candidate"] * w).sum() / w.sum()
    rel_improve = (overall_base - overall_cand) / overall_base * 100

    print("\n" + "=" * 60)
    print("전체 가중 WAPE (판매량 가중)")
    print(f"  기준모델(계절나이브) WAPE: {overall_base:.4f}")
    print(f"  후보모델 WAPE:          {overall_cand:.4f}")
    print(f"  상대 개선율:            {rel_improve:.1f}%")
    print("=" * 60)

    print("\n셀(ABC x 패턴)별 결과:")
    cell_summary = res_df.groupby(["abc", "pattern"]).apply(
        lambda g: pd.Series({
            "n_sku": len(g),
            "wape_baseline": (g["wape_baseline"] * g["test_actual_sum"]).sum() / g["test_actual_sum"].sum(),
            "wape_candidate": (g["wape_candidate"] * g["test_actual_sum"]).sum() / g["test_actual_sum"].sum(),
        }),
        include_groups=False,
    )
    cell_summary["rel_improve_pct"] = (
        (cell_summary["wape_baseline"] - cell_summary["wape_candidate"])
        / cell_summary["wape_baseline"] * 100
    )
    print(cell_summary.to_string())
    cell_summary.to_csv(f"{OUT_DIR}/litmus_results_by_cell.csv")

    summary = {
        "n_sku_tested": len(res_df),
        "test_start": str(test_start.date()),
        "overall_wape_baseline": overall_base,
        "overall_wape_candidate": overall_cand,
        "overall_relative_improvement_pct": rel_improve,
    }
    pd.Series(summary).to_json(f"{OUT_DIR}/litmus_summary.json", indent=2)
    print(f"\n결과 저장: {OUT_DIR}")


if __name__ == "__main__":
    main()
