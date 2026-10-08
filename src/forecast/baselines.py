"""4.2절 기준모델: 7일 계절 나이브."""
from __future__ import annotations

import pandas as pd


def seasonal_naive_7(y: pd.Series) -> pd.Series:
    """직전 7일의 동일 요일 판매량을 그대로 예측값으로 사용한다."""
    return y.shift(7)
