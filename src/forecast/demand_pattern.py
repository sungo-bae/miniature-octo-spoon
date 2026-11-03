"""4.6절 보완 B5: ABC x 수요패턴(ADI·CV²) 분류.

Syntetos-Boylan(2005) 분류 기준(ADI 임계 1.32, CV^2 임계 0.49)을 그대로
사용한다. model_selector.py가 이 분류에 따라 모델을 분기하므로, 분류
로직을 테스트 전용 스크립트가 아닌 여기 한 곳에만 둔다.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def classify_demand_pattern(y: pd.Series) -> str:
    """일별 판매량 Series를 smooth/intermittent/erratic/lumpy/unsellable로 분류한다."""
    values = y.to_numpy(dtype=float)
    nonzero = values[values > 0]
    if len(nonzero) == 0:
        return "unsellable"

    adi = len(values) / len(nonzero)
    cv2 = (nonzero.std() / nonzero.mean()) ** 2 if nonzero.mean() > 0 else 0.0

    if adi < 1.32 and cv2 < 0.49:
        return "smooth"
    elif adi >= 1.32 and cv2 < 0.49:
        return "intermittent"
    elif adi < 1.32 and cv2 >= 0.49:
        return "erratic"
    return "lumpy"
