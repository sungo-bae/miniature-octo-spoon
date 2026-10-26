"""수집 출처 어댑터. 모든 출처는 같은 정규화 레코드 목록을 돌려준다.

정규화 레코드 필드 (DB public.job_postings 와 동일):
  source_id, title, org_name, sido, sigungu, category, employment_type,
  wage_amount, wage_unit, hours_per_week, posted_date, deadline_date, raw
"""
import csv
import json
import os
import re
from datetime import date, datetime

import requests

FIELDS = [
    "source_id", "title", "org_name", "sido", "sigungu", "category", "employment_type",
    "wage_amount", "wage_unit", "hours_per_week", "posted_date", "deadline_date",
]

# 출처마다 시도 표기가 달라(서울/서울시/서울특별시) 집계가 쪼개지지 않도록 통일한다.
SIDO_ALIASES = {
    "서울": "서울특별시", "부산": "부산광역시", "대구": "대구광역시", "인천": "인천광역시",
    "광주": "광주광역시", "대전": "대전광역시", "울산": "울산광역시", "세종": "세종특별자치시",
    "경기": "경기도", "강원": "강원특별자치도", "충북": "충청북도", "충남": "충청남도",
    "전북": "전북특별자치도", "전남": "전라남도", "경북": "경상북도", "경남": "경상남도",
    "제주": "제주특별자치도",
}
OLD_SIDO_NAMES = {"전라북도": "전북특별자치도", "강원도": "강원특별자치도"}


def normalize_sido(value):
    if not value:
        return None
    v = value.strip()
    v = OLD_SIDO_NAMES.get(v, v)
    for short, full in SIDO_ALIASES.items():
        if v == full or v.startswith(short):
            return full
    return v


def parse_date(value):
    if value in (None, ""):
        return None
    if isinstance(value, (date, datetime)):
        return value.strftime("%Y-%m-%d")
    digits = re.sub(r"\D", "", str(value))[:8]
    if len(digits) != 8:
        return None
    return datetime.strptime(digits, "%Y%m%d").strftime("%Y-%m-%d")


def parse_number(value):
    if value in (None, ""):
        return None
    cleaned = re.sub(r"[^\d.]", "", str(value))
    return float(cleaned) if cleaned else None


def normalize(record):
    """출처 필드를 정규화 레코드로 바꾼다. 필수값(source_id, title)이 없으면 None."""
    if not record.get("source_id") or not record.get("title"):
        return None
    out = {k: record.get(k) or None for k in FIELDS}
    out["source_id"] = str(out["source_id"])
    out["sido"] = normalize_sido(out["sido"])
    out["wage_amount"] = parse_number(out["wage_amount"])
    out["hours_per_week"] = parse_number(out["hours_per_week"])
    out["posted_date"] = parse_date(out["posted_date"])
    out["deadline_date"] = parse_date(out["deadline_date"])
    if out["wage_unit"] not in ("hour", "day", "month", "year"):
        out["wage_unit"] = None
    out["raw"] = record.get("raw")
    return out


def from_csv(path):
    """정규화 필드명을 헤더로 쓰는 CSV (수동 적재, 테스트용)."""
    with open(path, encoding="utf-8-sig", newline="") as f:
        return [r for r in (normalize(dict(row, raw=dict(row))) for row in csv.DictReader(f)) if r]


def _dig(obj, path):
    for key in path.split(".") if path else []:
        obj = obj.get(key) if isinstance(obj, dict) else None
    return obj


def from_api(config_path):
    """설정 파일(JSON)에 적힌 대로 공공 API를 페이지 단위로 호출한다.

    API 응답 구조와 필드명은 출처마다 다르므로 코드가 아니라 설정으로 매핑한다.
    인증키는 설정 파일이 아니라 환경변수(config.key_env)에서 읽는다.
    """
    with open(config_path, encoding="utf-8") as f:
        cfg = json.load(f)
    key = os.environ[cfg["key_env"]]
    rows, page = [], 1
    while True:
        params = {**cfg.get("params", {}), cfg["key_param"]: key,
                  cfg["page_param"]: page, cfg["size_param"]: cfg["page_size"]}
        r = requests.get(cfg["url"], params=params, timeout=60)
        r.raise_for_status()
        items = _dig(r.json(), cfg["items_path"]) or []
        if isinstance(items, dict):  # 결과가 1건이면 리스트가 아닌 객체로 오는 API가 많다
            items = [items]
        for item in items:
            mapped = {field: item.get(src) for field, src in cfg["field_map"].items()}
            mapped["raw"] = item
            rec = normalize(mapped)
            if rec:
                rows.append(rec)
        if len(items) < cfg["page_size"] or page >= cfg.get("max_pages", 200):
            return rows
        page += 1
