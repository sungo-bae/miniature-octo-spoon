import csv
import gzip
import json
from datetime import datetime

from pipeline import archive


class FakeDb:
    def __init__(self):
        self.calls = []

    def select(self, table, params):
        self.calls.append((table, params))
        if table == "job_postings":
            return [{"id": 1, "title": "아파트 경비원", "raw": {"sal": "월 250만원"}, "closed_date": None}]
        return []


def test_export_writes_every_table_with_manifest(tmp_path):
    db = FakeDb()
    m = archive.export(db, tmp_path, now=datetime(2026, 12, 2, 3, 17, tzinfo=archive.KST))
    assert [t for t, _ in db.calls] == [t for t, _ in archive.TABLES]
    assert all(p["order"] for _, p in db.calls)          # 페이지가 겹치지 않게 늘 정렬해서 읽는다
    assert m["exported_at"] == "2026-12-02T03:17:00+09:00"
    assert m["tables"]["job_postings"]["rows"] == 1
    assert m["tables"]["apply_clicks"]["rows"] == 0

    with gzip.open(tmp_path / "job_postings.csv.gz", "rt", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    assert rows == [{"id": "1", "title": "아파트 경비원", "raw": '{"sal":"월 250만원"}', "closed_date": ""}]
    # 엑셀이 한글을 알아보도록 BOM으로 시작한다
    with gzip.open(tmp_path / "job_postings.csv.gz", "rb") as f:
        assert f.read(3) == b"\xef\xbb\xbf"

    saved = json.loads((tmp_path / "manifest.json").read_text(encoding="utf-8"))
    assert saved["tables"]["job_postings"]["sha256"] == archive.sha256(tmp_path / "job_postings.csv.gz")
    assert (tmp_path / "DATA_DICTIONARY.md").exists() and (tmp_path / "DATA_CHANGELOG.md").exists()
