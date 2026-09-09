"""SKU별 익일(또는 N일) 판매량 예측.

데이터가 충분한 SKU: SARIMAX(계절성) 잔차를 XGBoost로 보정하는 하이브리드.
데이터가 부족한 신규 SKU: 최근 이동평균 기반 naive fallback.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass

import numpy as np
import pandas as pd
from statsmodels.tsa.statespace.sarimax import SARIMAX
from xgboost import XGBRegressor

from app.forecasting.features import MIN_HISTORY_DAYS_FOR_MODEL

MODEL_VERSION = "sarimax_xgb_v1"
FALLBACK_MODEL_VERSION = "naive_moving_avg_v1"


@dataclass(frozen=True)
class ForecastResult:
    predicted_qty: float
    model_version: str


def _naive_forecast(df: pd.DataFrame) -> ForecastResult:
    recent = df["y"].tail(14)
    predicted = float(recent.mean()) if not recent.empty else 0.0
    return ForecastResult(predicted_qty=max(predicted, 0.0), model_version=FALLBACK_MODEL_VERSION)


def _sarimax_xgb_forecast(df: pd.DataFrame) -> ForecastResult:
    y = df["y"].astype(float)

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        sarimax_model = SARIMAX(
            y,
            order=(1, 1, 1),
            seasonal_order=(1, 1, 1, 7),
            enforce_stationarity=False,
            enforce_invertibility=False,
        ).fit(disp=False)

    sarimax_pred = sarimax_model.get_prediction(start=0, end=len(y) - 1).predicted_mean
    residual = y.values - sarimax_pred.values

    feature_cols = ["dayofweek", "is_weekend", "rolling_mean_7", "rolling_mean_28"]
    xgb = XGBRegressor(n_estimators=200, max_depth=3, learning_rate=0.05)
    xgb.fit(df[feature_cols], residual)

    next_day_sarimax = float(sarimax_model.get_forecast(steps=1).predicted_mean.iloc[0])

    last_row = df.iloc[[-1]].copy()
    next_dayofweek = (int(last_row["dayofweek"].iloc[0]) + 1) % 7
    next_features = pd.DataFrame(
        {
            "dayofweek": [next_dayofweek],
            "is_weekend": [1 if next_dayofweek in (5, 6) else 0],
            "rolling_mean_7": [df["y"].tail(7).mean()],
            "rolling_mean_28": [df["y"].tail(28).mean()],
        }
    )
    residual_pred = float(xgb.predict(next_features[feature_cols])[0])

    predicted = max(next_day_sarimax + residual_pred, 0.0)
    return ForecastResult(predicted_qty=predicted, model_version=MODEL_VERSION)


def forecast_next_day(df: pd.DataFrame) -> ForecastResult:
    """df는 features.build_daily_sales_series()의 반환값."""
    if df.empty or len(df) < MIN_HISTORY_DAYS_FOR_MODEL:
        return _naive_forecast(df)

    try:
        return _sarimax_xgb_forecast(df)
    except Exception:  # noqa: BLE001 - 모델 수렴 실패 등은 naive로 안전하게 폴백
        return _naive_forecast(df)
