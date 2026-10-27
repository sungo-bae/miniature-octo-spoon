"""데모·테스트용 가상 공고 데이터. 실제 데이터가 아니다.

계절성(연초 모집 집중), 지역 규모 차이, 직종별 마감 속도 차이를 넣어
분석 뷰와 예측이 의도대로 동작하는지 확인하는 데 쓴다.
"""
from datetime import date, timedelta

import numpy as np

REGIONS = {"서울특별시": 30, "경기도": 35, "부산광역시": 12, "전라남도": 6}
CATEGORIES = {  # 직종: (비중, 평균 게시 일수)
    "공익활동": (0.45, 20),
    "돌봄·사회서비스": (0.25, 8),
    "경비·청소": (0.20, 5),
    "사무보조": (0.10, 4),
}


def daily_listings(start, days, seed=0):
    """날짜 → 그날 목록에 보이는 정규화 레코드 목록."""
    rng = np.random.default_rng(seed)
    cats = list(CATEGORIES)
    weights = [CATEGORIES[c][0] for c in cats]
    postings = []
    for i in range(days):
        day = start + timedelta(days=i)
        season = 1 + 0.8 * np.exp(-((day.timetuple().tm_yday - 20) / 25) ** 2)  # 1월 모집 집중
        for sido, weekly in REGIONS.items():
            for _ in range(rng.poisson(weekly / 7 * season)):
                cat = rng.choice(cats, p=weights)
                life = max(1, int(rng.exponential(CATEGORIES[cat][1])))
                n = len(postings)
                postings.append({
                    "source_id": f"S{n:06d}",
                    "title": f"{sido} {cat} 참여자 모집 #{n}",
                    "org_name": f"{sido} 시니어클럽",
                    "sido": sido,
                    "sigungu": None,
                    "category": cat,
                    "employment_type": "공공형" if cat == "공익활동" else "민간형",
                    "wage_amount": float(rng.choice([10030, 11000, 12500])),
                    "wage_unit": "hour",
                    "hours_per_week": float(rng.choice([10, 15, 25, 40])),
                    "posted_date": day.isoformat(),
                    "deadline_date": (day + timedelta(days=life)).isoformat(),
                    "raw": None,
                    "_closes": day + timedelta(days=life),
                })
    by_day = {}
    for i in range(days):
        day = start + timedelta(days=i)
        by_day[day] = [
            {k: v for k, v in p.items() if k != "_closes"}
            for p in postings
            if date.fromisoformat(p["posted_date"]) <= day < p["_closes"]
        ]
    return by_day
