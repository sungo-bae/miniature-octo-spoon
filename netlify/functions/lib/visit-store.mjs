// 방문자 카운터 공용 저장 로직 (Netlify Blobs 사용)
import { getStore } from "@netlify/blobs";

export const STORE_NAME = "visit-stats";

export function store() {
  // strong 일관성: 방금 쓴 값을 바로 읽을 수 있도록
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

// 한국 시간 기준 날짜 (YYYY-MM-DD)
export function kstDate(d = new Date()) {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 동시 접속 시 값이 덮어써지지 않도록 ETag 조건부 쓰기 + 재시도
export async function updateJSON(s, key, fallback, mutate, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const cur = await s.getWithMetadata(key, { type: "json" });
    const value = mutate(cur ? cur.data : structuredClone(fallback));
    const opts = cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true };
    const res = await s.setJSON(key, value, opts);
    if (res?.modified !== false) return value;
    await new Promise((r) => setTimeout(r, 30 + Math.random() * 70));
  }
  // 재시도 실패 시 마지막으로 그냥 기록 (카운트 1 정도 오차 허용)
  const cur = await s.get(key, { type: "json" });
  const value = mutate(cur ?? structuredClone(fallback));
  await s.setJSON(key, value);
  return value;
}
