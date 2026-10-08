"""특일정보·기상청 API를 A2 모델(3.2절)의 달력 피처로 통합한다.

4.5절 예비분석 코드의 make_calendar_lag_features를 확장해, 요일·연중주기·
지연값·이동통계에 더해 명절/공휴일(특일정보 API)과 선택적 날씨(기상청
단기예보 API) 피처를 추가한다.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

import numpy as np
import pandas as pd

from src.external.holiday_api import HolidayClient
from src.external.weather_api import WeatherClient


def build_holiday_calendar(
    start: date, end: date, client: Optional[HolidayClient] = None
) -> pd.DataFrame:
    """start~end(포함) 구간의 날짜별 공휴일/명절 플래그 테이블을 만든다.

    반환 컬럼: date, is_holiday, holiday_name
    """
    client = client or HolidayClient()
    records = client.fetch_range(start, end)
    by_date = {r.locdate: r for r in records}

    rows = []
    d = start
    while d <= end:
        rec = by_date.get(d)
        rows.append(
            {
                "date": pd.Timestamp(d),
                "is_holiday": bool(rec.is_holiday) if rec else False,
                "holiday_name": rec.date_name if rec else "",
            }
        )
        d += timedelta(days=1)
    return pd.DataFrame(rows)


def build_weather_forecast(client: Optional[WeatherClient] = None) -> pd.DataFrame:
    """가장 최근 발표분 단기예보(약 2~3일)를 일 단위 피처로 반환한다.

    반환 컬럼: date, tmp_min, tmp_max, pop_max, precip_expected
    """
    client = client or WeatherClient()
    features = client.fetch_daily_features()
    return pd.DataFrame(
        {
            "date": [pd.Timestamp(f.fcst_date) for f in features],
            "tmp_min": [f.tmp_min for f in features],
            "tmp_max": [f.tmp_max for f in features],
            "pop_max": [f.pop_max for f in features],
            "precip_expected": [f.precip_expected for f in features],
        }
    )


def make_calendar_lag_features(
    y: pd.Series,
    lags: list[int],
    holiday_calendar: Optional[pd.DataFrame] = None,
    weather_forecast: Optional[pd.DataFrame] = None,
) -> pd.DataFrame:
    """일별 판매량 y로부터 달력·지연·이벤트·(선택)날씨 피처를 만든다.

    Args:
        y: DatetimeIndex를 가진 일별 판매량 Series.
        lags: 지연값으로 사용할 일수 목록 (예: [1,2,3,7,14,21,28]).
        holiday_calendar: build_holiday_calendar()의 반환값. None이면
            is_holiday=0으로 채운다 (이벤트 피처 없이도 모델이 동작해야 함).
        weather_forecast: build_weather_forecast()의 반환값. None이면
            날씨 컬럼을 생성하지 않는다 (선택 피처).

    Returns:
        y와 동일한 DatetimeIndex를 가진 피처 DataFrame.
    """
    if not isinstance(y.index, pd.DatetimeIndex):
        raise TypeError("y는 DatetimeIndex를 가진 Series여야 합니다.")

    idx = y.index
    features = pd.DataFrame(index=idx)

    # 요일·주말·연중주기 (연속형 인코딩으로 1/1↔12/31 경계 불연속 방지)
    features["dow"] = idx.dayofweek
    features["is_weekend"] = idx.dayofweek.isin([5, 6]).astype(int)
    features["doy_sin"] = np.sin(2 * np.pi * idx.dayofyear / 365.25)
    features["doy_cos"] = np.cos(2 * np.pi * idx.dayofyear / 365.25)

    # 지연값·이동통계 (4.2절과 동일 설계)
    for lag in lags:
        features[f"lag_{lag}"] = y.shift(lag)
    for window in (7, 14, 28):
        features[f"rollmean_{window}"] = y.shift(1).rolling(window).mean()
    features["same_dow_mean_4w"] = y.shift(7).rolling(4).mean()

    # 이벤트(명절/공휴일) — 특일정보 API (4.4절 추석·설 대목 반영)
    if holiday_calendar is not None:
        hc = holiday_calendar.set_index("date")
        features["is_holiday"] = hc["is_holiday"].reindex(idx).fillna(False).astype(int)
        features["holiday_name"] = hc["holiday_name"].reindex(idx).fillna("")
    else:
        features["is_holiday"] = 0
        features["holiday_name"] = ""

    # 날씨(선택) — 기상청 단기예보 API. 예보 범위를 벗어난 과거 구간은 NaN으로 남는다.
    if weather_forecast is not None:
        wf = weather_forecast.set_index("date")
        for col in ("tmp_min", "tmp_max", "pop_max"):
            features[col] = wf[col].reindex(idx)
        features["precip_expected"] = (
            wf["precip_expected"].reindex(idx).fillna(False).astype(int)
        )

    return features
