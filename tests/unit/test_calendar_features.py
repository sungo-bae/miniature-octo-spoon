from __future__ import annotations

import pandas as pd

from src.external.calendar_features import make_calendar_lag_features


def _sample_series(n_days: int = 30) -> pd.Series:
    idx = pd.date_range("2026-01-01", periods=n_days, freq="D")
    values = [50 + (i % 7) for i in range(n_days)]
    return pd.Series(values, index=idx)


def test_make_calendar_lag_features_without_external_data():
    y = _sample_series()
    features = make_calendar_lag_features(y, lags=[1, 7])

    assert list(features.index) == list(y.index)
    assert (features["is_holiday"] == 0).all()
    assert "holiday_name" in features.columns
    assert "lag_1" in features.columns and "lag_7" in features.columns
    # lag_7의 값은 7일 전 실제값과 일치해야 한다
    assert features["lag_7"].iloc[10] == y.iloc[3]


def test_make_calendar_lag_features_with_holiday_calendar():
    y = _sample_series()
    holiday_calendar = pd.DataFrame(
        {
            "date": [pd.Timestamp("2026-01-05")],
            "is_holiday": [True],
            "holiday_name": ["임시공휴일"],
        }
    )
    features = make_calendar_lag_features(y, lags=[1], holiday_calendar=holiday_calendar)

    assert features.loc["2026-01-05", "is_holiday"] == 1
    assert features.loc["2026-01-05", "holiday_name"] == "임시공휴일"
    assert features.loc["2026-01-06", "is_holiday"] == 0


def test_make_calendar_lag_features_with_weather_forecast():
    y = _sample_series()
    weather_forecast = pd.DataFrame(
        {
            "date": [pd.Timestamp("2026-01-20")],
            "tmp_min": [-3.0],
            "tmp_max": [2.0],
            "pop_max": [60.0],
            "precip_expected": [True],
        }
    )
    features = make_calendar_lag_features(y, lags=[1], weather_forecast=weather_forecast)

    assert features.loc["2026-01-20", "tmp_max"] == 2.0
    assert features.loc["2026-01-20", "precip_expected"] == 1
    # 예보 범위 밖은 NaN으로 남아야 한다 (단기예보는 2~3일만 제공)
    assert pd.isna(features.loc["2026-01-01", "tmp_max"])
