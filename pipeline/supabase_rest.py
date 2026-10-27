"""Supabase(PostgREST) 최소 클라이언트. 배치 작업은 서비스 롤 키로 실행한다."""
import os

import requests


class SupabaseRest:
    def __init__(self, url=None, key=None, timeout=60):
        # 대시보드의 Data API 화면은 ".../rest/v1/" 까지 보여주므로 붙여 넣어도 동작하게 한다
        self.url = (url or os.environ["SUPABASE_URL"]).rstrip("/").removesuffix("/rest/v1")
        key = key or os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        })

    def rpc(self, fn, **params):
        # 고용24처럼 수천 건을 한 번에 반영하면 수십 초가 걸린다
        r = self.session.post(f"{self.url}/rest/v1/rpc/{fn}", json=params, timeout=max(self.timeout, 300))
        if not r.ok:
            raise requests.HTTPError(f"{r.status_code} {fn}: {r.text[:500]}", response=r)
        return r.json()

    def delete(self, table, params):
        r = self.session.delete(f"{self.url}/rest/v1/{table}", params=params, timeout=self.timeout)
        r.raise_for_status()

    def select(self, table, params=None, page_size=1000):
        """테이블/뷰 전체를 페이지 단위로 읽는다."""
        rows, offset = [], 0
        while True:
            r = self.session.get(
                f"{self.url}/rest/v1/{table}",
                params={"select": "*", **(params or {})},
                headers={"Range": f"{offset}-{offset + page_size - 1}"},
                timeout=self.timeout,
            )
            r.raise_for_status()
            batch = r.json()
            rows.extend(batch)
            if len(batch) < page_size:
                return rows
            offset += page_size

    def upsert(self, table, rows, on_conflict):
        r = self.session.post(
            f"{self.url}/rest/v1/{table}",
            params={"on_conflict": on_conflict},
            json=rows,
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            timeout=self.timeout,
        )
        r.raise_for_status()
