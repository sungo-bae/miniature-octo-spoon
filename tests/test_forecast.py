from datetime import date, timedelta

import numpy as np

from pipeline import forecast


def test_short_series_is_skipped():
    assert forecast.forecast_series([3, 4, 5]) is None


def test_constant_zero_series_does_not_crash():
    result = forecast.forecast_series([0] * 20)
    assert all(s["expected"] == 0 and s["lower"] == 0 for s in result["steps"])
    assert result["publishable"] is False


def test_noisy_level_prefers_smoothing_over_naive():
    rng = np.random.default_rng(1)
    y = rng.poisson(20, 40)
    result = forecast.forecast_series(y)
    assert result["method"] != "naive"
    assert result["rel_mae"] < 1
    assert result["publishable"] is True
    for s in result["steps"]:
        assert s["lower"] <= s["expected"] <= s["upper"]
        assert 10 < s["expected"] < 30


def test_build_forecasts_weeks_follow_last_complete_week():
    today = date(2026, 10, 28)  # 수요일 → 이번 주(10/26~)는 제외
    start = today - timedelta(weeks=20)
    postings = [
        {"sido": "경기도" if i % 2 else None, "posted_date": None,
         "first_seen_date": (start + timedelta(days=i % 140)).isoformat()}
        for i in range(600)
    ]
    rows = forecast.build_forecasts(postings, today)
    weeks = sorted({r["week_start"] for r in rows})
    assert weeks == ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"]
    assert {r["sido"] for r in rows} == {"경기도", "지역 미상", "전국"}


def test_low_volume_region_is_not_published():
    rng = np.random.default_rng(2)
    result = forecast.forecast_series(rng.poisson(1, 40))
    assert result["publishable"] is False
