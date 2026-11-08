// GET /api/visit-stats?days=30   (헤더 x-admin-key 필요)
// Netlify 환경변수 ADMIN_STATS_PASSWORD 와 일치해야 통계를 돌려줍니다.
import { store, kstDate } from "./lib/visit-store.mjs";

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export default async (req) => {
  const secret = Netlify.env.get("ADMIN_STATS_PASSWORD");
  if (!secret) return Response.json({ error: "ADMIN_STATS_PASSWORD 환경변수가 설정되지 않았습니다." }, { status: 500 });
  if (!safeEqual(req.headers.get("x-admin-key") || "", secret)) {
    await new Promise((r) => setTimeout(r, 500)); // 무차별 대입 지연
    return Response.json({ error: "비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  const url = new URL(req.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "30", 10) || 30, 1), 365);
  const s = store();

  const now = new Date();
  const keys = [];
  for (let i = days - 1; i >= 0; i--) keys.push(kstDate(new Date(now.getTime() - i * 86400000)));

  const [total, ...daily] = await Promise.all([
    s.get("total", { type: "json" }),
    ...keys.map((k) => s.get(`day/${k}`, { type: "json" })),
  ]);

  const series = keys.map((date, i) => ({
    date,
    pv: daily[i]?.pv || 0,
    uv: daily[i]?.uv || 0,
  }));

  // 기간 내 인기 페이지 합산
  const pages = {};
  daily.forEach((d) => {
    for (const [p, n] of Object.entries(d?.pages || {})) pages[p] = (pages[p] || 0) + n;
  });
  const topPages = Object.entries(pages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([path, pv]) => ({ path, pv }));

  return Response.json(
    { today: kstDate(now), total: total || { pv: 0, uv: 0, since: null }, series, topPages },
    { headers: { "cache-control": "no-store" } }
  );
};

export const config = { path: "/api/visit-stats" };
