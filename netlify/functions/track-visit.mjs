// POST /api/track-visit  — 페이지 방문 1건 기록
// body: { path: "/about", unique: true|false }
//  - unique: 이 브라우저가 "오늘 처음" 방문했는지 (js/visit-tracker.js가 판단)
// 개인정보(IP 등)는 저장하지 않습니다.
import { store, kstDate, updateJSON } from "./lib/visit-store.mjs";

const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|headless|lighthouse|preview|monitor/i;

export default async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const ua = req.headers.get("user-agent") || "";
  if (!ua || BOT_RE.test(ua)) return new Response(null, { status: 204 });

  let body = {};
  try { body = await req.json(); } catch {}

  // 경로 정리: 쿼리 제거, 길이 제한, 너무 많은 경로 키가 쌓이지 않도록
  let path = typeof body.path === "string" ? body.path.split("?")[0].split("#")[0] : "/";
  if (!path.startsWith("/")) path = "/";
  path = path.replace(/\/index\.html$/, "/").slice(0, 80) || "/";
  if (path.startsWith("/admin")) return new Response(null, { status: 204 }); // 관리자 페이지는 집계 제외

  const unique = body.unique === true;
  const day = kstDate();
  const s = store();

  await Promise.all([
    updateJSON(s, `day/${day}`, { pv: 0, uv: 0, pages: {} }, (d) => {
      d.pv += 1;
      if (unique) d.uv += 1;
      d.pages = d.pages || {};
      if (d.pages[path] || Object.keys(d.pages).length < 300) {
        d.pages[path] = (d.pages[path] || 0) + 1;
      }
      return d;
    }),
    updateJSON(s, "total", { pv: 0, uv: 0, since: day }, (t) => {
      t.pv += 1;
      if (unique) t.uv += 1;
      return t;
    }),
  ]);

  return new Response(null, { status: 204 });
};

export const config = { path: "/api/track-visit" };
