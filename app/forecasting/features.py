"""SKU별 일별 판매량 시계열 피처 생성."""

from __future__ import annotations

import uuid

import pandas as pd
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.order import Order, OrderItem, OrderStatus


def build_daily_sales_series(db: Session, tenant_id: uuid.UUID, sku_id: uuid.UUID) -> pd.DataFrame:
    """해당 SKU의 일별 판매수량 시계열을 DataFrame으로 반환한다.

    컬럼: ds(날짜), y(판매수량). 취소/반품 상태는 판매량 집계에서 제외한다.
    """
    rows = (
        db.query(
            func.date(Order.ordered_at).label("ds"),
            func.sum(OrderItem.quantity).label("y"),
        )
        .join(OrderItem, OrderItem.order_id == Order.id)
        .filter(
            Order.tenant_id == tenant_id,
            OrderItem.sku_id == sku_id,
            Order.status.notin_([OrderStatus.CANCELLED, OrderStatus.RETURNED]),
        )
        .group_by(func.date(Order.ordered_at))
        .order_by(func.date(Order.ordered_at))
        .all()
    )

    df = pd.DataFrame(rows, columns=["ds", "y"])
    if df.empty:
        return df

    df["ds"] = pd.to_datetime(df["ds"])
    # 판매가 없는 날짜도 0으로 채워 시계열 모델이 빈 날짜를 학습하게 한다.
    full_range = pd.date_range(df["ds"].min(), df["ds"].max(), freq="D")
    df = df.set_index("ds").reindex(full_range, fill_value=0).rename_axis("ds").reset_index()

    df["dayofweek"] = df["ds"].dt.dayofweek
    df["is_weekend"] = df["dayofweek"].isin([5, 6]).astype(int)
    df["rolling_mean_7"] = df["y"].rolling(window=7, min_periods=1).mean()
    df["rolling_mean_28"] = df["y"].rolling(window=28, min_periods=1).mean()
    return df


MIN_HISTORY_DAYS_FOR_MODEL = 28
