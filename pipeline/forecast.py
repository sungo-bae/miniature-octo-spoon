"""주간 신규 공고 수 예측 (시도별 + 전국).

방법
  1. 후보 모델: 직전 주(기준선), 최근 4주 평균, 작년 같은 주(52주 이상 쌓이면),
     감쇠 추세 지수평활(Holt).
  2. 과거 시점마다 "그때까지의 데이터만으로" 1~4주 앞을 예측해 실제와 비교(롤링 백테스트).
  3. 오차가 가장 작은 모델을 고르고, 백테스트 오차의 10~90% 분위로 예측 범위를 만든다.
  4. 기준선보다 정확하고 데이터가 충분할 때만 publishable=true → 홈페이지에 노출.

  python -m pipeline.forecast            # Supabase에서 읽고 job_forecasts에 기록
  python -m pipeline.forecast --dry-run  # 기록하지 않고 결과만 출력
"""
import argparse
import json
from datetime import date, timedelta

import numpy as np
import pandas as pd

HORIZON = 4          # 몇 주 앞까지 예측할지
MIN_TRAIN = 8        # 백테스트 시점마다 필요한 최소 학습 주 수
BACKTEST_ORIGINS = 12
MIN_WEEKS_TO_PUBLISH = 16
SEASON = 52


# ───────────── 모델: 학습 시계열(np.array) → 1..h 주 앞 예측 ─────────────

def naive(y, h):
    return np.repeat(y[-1], h).astype(float)


def mean_4w(y, h):
    return np.repeat(y[-4:].mean(), h)


def seasonal_naive(y, h):
    if len(y) < SEASON + h:
        return None
    return y[len(y) - SEASON: len(y) - SEASON + h].astype(float)


def holt_damped(y, h, phi=0.9):
    """감쇠 추세 지수평활. alpha/beta는 1-step 제곱오차 최소화로 격자 탐색."""
    if len(y) < 6:
        return None
    best = None
    for alpha in (0.1, 0.2, 0.3, 0.5, 0.7):
        for beta in (0.01, 0.05, 0.1, 0.2):
            level, trend, sse = y[0], y[1] - y[0], 0.0
            for t in range(1, len(y)):
                pred = level + phi * trend
                sse += (y[t] - pred) ** 2
                new_level = alpha * y[t] + (1 - alpha) * pred
                trend = beta * (new_level - level) + (1 - beta) * phi * trend
                level = new_level
            if best is None or sse < best[0]:
                best = (sse, level, trend)
    _, level, trend = best
    damp = np.cumsum(phi ** np.arange(1, h + 1))
    return level + damp * trend


MODELS = {
    "naive": naive,
    "mean_4w": mean_4w,
    "seasonal_naive": seasonal_naive,
    "holt_damped": holt_damped,
}


# ───────────── 백테스트 / 선택 / 구간 ─────────────

def backtest(y, model):
    """각 시점의 (horizon, 실제-예측) 오차 목록. 모델이 적용 불가면 None."""
    errors = []
    last_origin = len(y) - 1
    first_origin = max(MIN_TRAIN, len(y) - BACKTEST_ORIGINS - HORIZON)
    for origin in range(first_origin, last_origin):
        h = min(HORIZON, len(y) - origin)
        pred = model(y[:origin], h)
        if pred is None:
            return None
        errors += [(k + 1, y[origin + k] - pred[k]) for k in range(h)]
    return errors or None


def forecast_series(y):
    """한 지역의 주간 시계열 → 선택 모델과 1..HORIZON 주 예측(범위 포함)."""
    y = np.asarray(y, dtype=float)
    if len(y) < MIN_TRAIN + 2:
        return None

    scores = {}
    for name, model in MODELS.items():
        errs = backtest(y, model)
        if errs:
            scores[name] = (np.mean([abs(e) for _, e in errs]), errs)
    naive_mae = scores["naive"][0]
    method = min(scores, key=lambda m: scores[m][0])
    mae, errs = scores[method]
    rel_mae = mae / naive_mae if naive_mae > 0 else (0.0 if mae == 0 else float("inf"))

    point = MODELS[method](y, HORIZON)
    out = []
    for k in range(HORIZON):
        e = np.array([err for hh, err in errs if hh == k + 1])
        if len(e) >= 5:
            lo_off, hi_off = np.quantile(e, [0.1, 0.9])
        else:  # 오차 표본이 적으면 정규 근사로 넉넉하게
            sd = np.std([err for _, err in errs]) or 1.0
            lo_off, hi_off = -1.28 * sd, 1.28 * sd
        expected = max(point[k], 0.0)
        out.append({
            "step": k + 1,
            "expected": float(round(expected, 1)),
            "lower": float(round(max(point[k] + lo_off, 0.0), 1)),
            "upper": float(round(max(point[k] + hi_off, expected), 1)),
        })
    return {
        "method": method,
        "rel_mae": round(float(rel_mae), 3),
        "publishable": bool(rel_mae < 1 and method != "naive" and len(y) >= MIN_WEEKS_TO_PUBLISH),
        "steps": out,
    }


def weekly_matrix(postings, today):
    """공고 목록 → (주 시작일 × 시도) 신규 공고 수. 빈 주는 0, 진행 중인 이번 주는 제외."""
    df = pd.DataFrame(postings)
    df["sido"] = df["sido"].fillna("지역 미상")
    df["day"] = pd.to_datetime(df["posted_date"].fillna(df["first_seen_date"]))
    df["week"] = df["day"].dt.to_period("W-SUN").dt.start_time
    this_week = pd.Timestamp(today - timedelta(days=today.weekday()))
    df = df[df["week"] < this_week]
    if df.empty:
        return pd.DataFrame()
    table = df.pivot_table(index="week", columns="sido", values="day", aggfunc="count", fill_value=0)
    full = pd.date_range(table.index.min(), this_week - pd.Timedelta(days=7), freq="W-MON")
    table = table.reindex(full, fill_value=0)
    table["전국"] = table.sum(axis=1)
    return table


def build_forecasts(postings, today):
    if not postings:
        return []
    table = weekly_matrix(postings, today)
    if table.empty:
        return []
    last_week = table.index.max().date()
    rows = []
    for sido in table.columns:
        result = forecast_series(table[sido].to_numpy())
        if not result:
            continue
        for s in result["steps"]:
            rows.append({
                "generated_on": today.isoformat(),
                "sido": sido,
                "category": "전체",
                "week_start": (last_week + timedelta(weeks=s["step"])).isoformat(),
                "expected": s["expected"],
                "lower": s["lower"],
                "upper": s["upper"],
                "method": result["method"],
                "backtest_rel_mae": result["rel_mae"],
                "publishable": result["publishable"],
            })
    return rows


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--today", default=date.today().isoformat())
    args = ap.parse_args(argv)
    today = date.fromisoformat(args.today)

    from pipeline.supabase_rest import SupabaseRest
    db = SupabaseRest()
    postings = db.select("job_postings", {"select": "source,source_id,sido,posted_date,first_seen_date"})
    seen = {(p["source"], p["source_id"]) for p in postings}
    history = db.select("job_postings_history", {"select": "source,source_id,sido,posted_date"})
    postings += [dict(h, first_seen_date=h["posted_date"]) for h in history
                 if (h["source"], h["source_id"]) not in seen]
    rows = build_forecasts(postings, today)
    if args.dry_run:
        print(json.dumps(rows, ensure_ascii=False, indent=1))
    elif rows:
        db.upsert("job_forecasts", rows, on_conflict="generated_on,sido,category,week_start")
    print(f"{len(rows)} forecast rows, publishable regions: "
          f"{sorted({r['sido'] for r in rows if r['publishable']})}")


if __name__ == "__main__":
    main()
