// 직종별 안내 글(/guide/<slug>.html)과 목록(/guide/index.html)을 만드는 빌드 스크립트입니다.
// 고정 설명은 guide-content.mjs에 있고, 숫자(모집 중 공고 수, 최근 7일 새 공고, 실제 공고의
// 급여 분포, 공고가 많은 지역, 최근 공고)는 매일 아침 수집하는 공개 자료(Supabase
// v_site_job_guide)로 채웁니다. 실버잡에만 있는 자료라 다른 구인 사이트와 겹치지 않는 내용이 됩니다.
//
// 자료를 못 읽으면 숫자 부분 없이 설명만으로 페이지를 만듭니다(배포는 멈추지 않음).
// 시험용: GUIDE_STATS_FILE=<json 파일>을 주면 Supabase 대신 그 파일을 읽습니다.

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { escapeHtml as esc, pageShell, SITE_URL } from "../netlify/functions/lib/job-template.mjs";
import { GUIDES } from "./guide-content.mjs";

const ROOT = process.cwd();
const OUT = join(ROOT, "guide");
const SUPABASE_URL = "https://idngidaxescxuyjzirob.supabase.co";
// 공개(publishable) 키: 공개된 뷰만 읽을 수 있습니다. 홈페이지에도 같은 키가 들어 있습니다.
const SUPABASE_KEY = "sb_publishable_hGMZ7IU3qZZc3jGzUP1ySQ_h1eRn7m0";

const UNIT = { hour: "시급", day: "일급", month: "월급", year: "연봉" };
const fmt = (n) => Math.round(n).toLocaleString("ko-KR");

export function won(n, unit) {
  if (unit === "hour" || unit === "day" || n < 10000) return `${fmt(n)}원`;
  return `${fmt(n / 10000)}만 원`;
}

export function kDate(iso) {
  // updated_at(UTC) → 한국 날짜 "11월 10일"
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
}

async function loadStats() {
  if (process.env.GUIDE_STATS_FILE) return JSON.parse(readFileSync(process.env.GUIDE_STATS_FILE, "utf-8"));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/v_site_job_guide?select=*`, {
    headers: { apikey: SUPABASE_KEY },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`v_site_job_guide: ${res.status}`);
  return res.json();
}

const list = (items) => `<ul class="guide-list">${items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;

function barList(rows, labelOf, total) {
  const max = Math.max(...rows.map((r) => r.n), 1);
  return `<ul class="guide-bars">${rows
    .map((r) => `<li><span class="guide-bar-label">${esc(labelOf(r))}</span>` +
      `<span class="guide-bar"><span style="width:${Math.max(4, Math.round((r.n / max) * 100))}%"></span></span>` +
      `<span class="guide-bar-n">${fmt(r.n)}건${total ? ` (${Math.round((r.n / total) * 100)}%)` : ""}</span></li>`)
    .join("")}</ul>`;
}

// 공고 수가 너무 적은 급여 단위는 숫자가 흔들려서 빼고, 많이 쓰는 단위부터 보여 줍니다.
export function wageRows(wages) {
  return Object.entries(wages || {})
    .filter(([unit, w]) => UNIT[unit] && w.n >= 20)
    .sort((a, b) => b[1].n - a[1].n);
}

function summaryBox(g, s) {
  const rows = wageRows(s.wages);
  const month = s.wages?.month;
  const payLine = month && month.n >= 20
    ? `월급으로 적힌 공고의 가운데 값은 <strong>${won(month.med, "month")}</strong>입니다(가운데 절반은 ${won(month.p25, "month")}~${won(month.p75, "month")}).`
    : rows[0] ? `${UNIT[rows[0][0]]}으로 적힌 공고가 가장 많고, 가운데 값은 <strong>${won(rows[0][1].med, rows[0][0])}</strong>입니다.` : "";
  return `
      <div class="legal-box guide-summary">
        <p style="margin:0;"><strong>${esc(kDate(s.updated_at))} 실버잡 수집 자료 기준</strong></p>
        <p style="margin:6px 0 0;">지금 모집 중인 ${esc(g.label)} 공고는 <strong>${fmt(s.total)}건</strong>이고,
          최근 7일 동안 새로 올라온 공고가 ${fmt(s.new_7d)}건입니다. ${fmt(s.companies)}곳의 사업장이 사람을 찾고 있어요.</p>
        ${payLine ? `<p style="margin:6px 0 0;">${payLine}</p>` : ""}
      </div>`;
}

function wageSection(s) {
  const rows = wageRows(s.wages);
  if (!rows.length) return "";
  const total = rows.reduce((a, [, w]) => a + w.n, 0);
  const hour = s.wages?.hour;
  return `
      <h2>급여는 얼마나 받나요?</h2>
      <p>고용24에 올라온 공고에 적힌 금액을 급여 단위별로 모았습니다. "가운데 값"은 공고를 금액 순으로 줄 세웠을 때 한가운데 공고의 금액이고,
        "가운데 절반"은 낮은 쪽 4분의 1과 높은 쪽 4분의 1을 뺀 범위입니다. 금액이 범위로 적힌 공고는 낮은 쪽 금액으로 셌습니다.</p>
      <div class="table-scroll"><table class="guide-table">
        <thead><tr><th>급여 단위</th><th>공고 수</th><th>가운데 값</th><th>가운데 절반</th></tr></thead>
        <tbody>${rows.map(([unit, w]) => `<tr><td>${UNIT[unit]}</td><td>${fmt(w.n)}건 (${Math.round((w.n / total) * 100)}%)</td>` +
          `<td>${won(w.med, unit)}</td><td>${won(w.p25, unit)} ~ ${won(w.p75, unit)}</td></tr>`).join("")}</tbody>
      </table></div>
      ${hour && hour.n >= 20 && hour.med <= 10320 ? `<p>시급 공고는 대부분 2026년 최저시급인 <strong>10,320원</strong>입니다. 하루 근무 시간과 주휴수당 포함 여부를 함께 확인하세요.</p>` : ""}`;
}

function regionSection(s) {
  if (!s.regions?.length) return "";
  return `
      <h2>어디에 공고가 많나요?</h2>
      ${barList(s.regions, (r) => r.region, s.total)}
      ${s.top_areas?.length ? `<p style="margin-top:14px;">시·군·구로 보면 ${s.top_areas.slice(0, 5).map((a) => `${esc(a.detail)}(${esc(a.region)}) ${fmt(a.n)}건`).join(", ")} 순으로 많습니다.</p>` : ""}`;
}

function typeSection(s) {
  const typed = (s.types || []).reduce((a, t) => a + t.n, 0);
  const parts = [];
  if (typed) parts.push(`<p>근무 형태가 적힌 공고 ${fmt(typed)}건 중 ${s.types.map((t) => `${esc(t.type)} ${Math.round((t.n / typed) * 100)}%`).join(", ")}입니다.</p>`);
  if (s.subcategories?.length) {
    parts.push(`<p>세부 직종별로 보면 이렇습니다.</p>${barList(s.subcategories.filter((x) => x.name !== "기타"), (x) => x.name, s.total)}`);
  }
  return parts.length ? `\n      <h2>근무 형태와 세부 직종</h2>\n      ${parts.join("\n      ")}` : "";
}

function latestSection(g, s) {
  // 제목에 직종 단어가 들어가도 다른 일이 중심인 공고(예: "목장 관리 및 착유 … 청소 담당")는 뺍니다
  const latest = (s.latest || []).filter((j) => !(g.latestExclude && g.latestExclude.test(j.title || "")));
  if (!latest.length) return "";
  return `
      <h2>최근 올라온 ${esc(g.label)} 공고</h2>
      <ul class="guide-latest">${latest.map((j) => `<li><a href="/jobs/${esc(j.slug)}.html">${esc(j.title)}</a>` +
        `<span>${esc([j.company, [j.region, j.regionDetail].filter(Boolean).join(" "), j.pay].filter(Boolean).join(" · "))}</span></li>`).join("")}</ul>
      <p><a href="/#categories" class="btn btn-primary">${esc(g.label)} 공고 전체 보기</a></p>`;
}

export function guidePage(g, s) {
  const others = GUIDES.filter((x) => x.slug !== g.slug)
    .map((x) => `<a href="/guide/${x.slug}.html">${x.icon} ${esc(x.label)}</a>`).join(" · ");
  const body = `
    <article class="guide">
      <p class="guide-crumb"><a href="/guide/">직종별 안내</a> › ${esc(g.label)}</p>
      <h1 class="section-title" style="font-size:clamp(1.5rem,3.2vw,2rem);">${g.icon} ${esc(g.title)}</h1>
      <p class="section-desc">${esc(g.summary)}</p>
      ${s ? summaryBox(g, s) : ""}

      <h2>어떤 일을 하나요?</h2>
      ${list(g.what)}

      <h2>이런 분께 잘 맞아요</h2>
      ${list(g.fit)}

      <h2>하루는 이렇게 흘러가요</h2>
      ${list(g.day)}

      <h2>필요한 자격과 준비</h2>
      ${list(g.prepare)}
      ${s ? wageSection(s) + regionSection(s) + typeSection(s) : ""}

      <h2>지원할 때 이렇게 하세요</h2>
      ${list(g.tips)}

      <h2>자주 묻는 질문</h2>
      ${g.faq.map(([q, a]) => `<h3 style="font-size:1.05rem; margin:16px 0 4px;">Q. ${esc(q)}</h3><p style="margin:0;">${esc(a)}</p>`).join("\n      ")}

      <h2>꼭 확인하세요</h2>
      ${list([
        "일을 시작하기 전에 근로계약서를 쓰고 한 부를 받아 두세요. 근무 시간, 휴게 시간, 급여, 계약 기간이 적혀 있어야 합니다.",
        "4대보험 가입 여부와 수습 기간(수습 중 급여)을 확인하세요.",
        "공고 내용과 면접에서 들은 조건이 다르면 그 자리에서 다시 물어보세요. 궁금한 점은 고용노동부 고객상담센터(국번 없이 1350)에서도 상담받을 수 있습니다.",
      ])}
      ${s ? latestSection(g, s) : `<p><a href="/#categories" class="btn btn-primary">${esc(g.label)} 공고 보러 가기</a></p>`}

      <div class="legal-box" style="margin-top:28px;">
        <p style="margin:0;"><strong>다른 직종 안내</strong></p>
        <p style="margin:6px 0 0;">${others}</p>
        <p style="margin:10px 0 0;"><a href="/apply-guide.html">지원 방법 가이드</a> · <a href="/tips.html">구직 꿀팁</a> · <a href="/report.html">일자리 현황 리포트</a></p>
        <p style="margin:10px 0 0; font-size:.85rem; color:var(--color-text-muted);">자료: 고용노동부 고용24 채용정보(고령자 우대 공고 중 실버잡 직종)를 실버잡이 매일 아침 모아 집계했습니다.
          공고마다 조건이 다르니 지원 전 원문 공고를 꼭 확인하세요.</p>
      </div>
    </article>`;
  const description = s
    ? `${g.label} 일자리 ${fmt(s.total)}건 모집 중(${kDate(s.updated_at)} 기준). ${g.summary}`
    : g.summary;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: g.title,
    description,
    inLanguage: "ko",
    mainEntityOfPage: `${SITE_URL}/guide/${g.slug}.html`,
    ...(s ? { dateModified: s.updated_at } : {}),
    author: { "@type": "Organization", name: "실버잡", url: SITE_URL },
    publisher: { "@type": "Organization", name: "실버잡", url: SITE_URL },
  };
  return pageShell({ title: g.title, description, path: `/guide/${g.slug}.html`, bodyHtml: body, jsonLd, noindex: false });
}

export function guideIndexPage(statsByJob) {
  const cards = GUIDES.map((g) => {
    const s = statsByJob[g.job];
    const month = s?.wages?.month;
    return `<a class="category-card" href="/guide/${g.slug}.html">
          <span class="cat-icon" aria-hidden="true">${g.icon}</span>
          <span class="cat-name">${esc(g.label)}</span>
          <span class="cat-count">${s ? `모집 중 ${fmt(s.total)}건${month && month.n >= 20 ? `<br>월급 가운데 ${won(month.med, "month")}` : ""}` : "안내 보기"}</span>
        </a>`;
  }).join("\n        ");
  const body = `
      <h1 class="section-title" style="font-size:clamp(1.5rem,3.2vw,2rem);">직종별 일자리 안내</h1>
      <p class="section-desc">어르신들이 많이 찾는 여섯 가지 일을 하는 일, 필요한 자격, 실제 공고 기준 급여, 지원 요령으로 정리했습니다.
        숫자는 실버잡이 매일 아침 모으는 공고 자료로 새로 계산합니다.</p>
      <div class="category-grid">
        ${cards}
      </div>
      <p style="margin-top:24px;"><a href="/apply-guide.html">처음이라면 지원 방법 가이드부터 보세요 →</a></p>`;
  return pageShell({
    title: "직종별 일자리 안내",
    description: "경비, 미화, 급식·조리, 사무보조, 시설관리, 요양·돌봄 일자리의 하는 일, 자격, 실제 공고 기준 급여와 지원 요령.",
    path: "/guide/",
    bodyHtml: body,
    jsonLd: null,
    noindex: false,
  });
}

async function main() {
  let stats = [];
  try {
    stats = await loadStats();
  } catch (err) {
    console.warn("generate-guides: 자료를 읽지 못해 숫자 없이 안내 글을 만듭니다.", err.message);
  }
  const byJob = Object.fromEntries(stats.map((s) => [s.job, s]));
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  for (const g of GUIDES) writeFileSync(join(OUT, `${g.slug}.html`), guidePage(g, byJob[g.job]), "utf-8");
  writeFileSync(join(OUT, "index.html"), guideIndexPage(byJob), "utf-8");
  console.log(`generate-guides: 직종별 안내 ${GUIDES.length}편 (${stats.length ? "오늘 자료 반영" : "자료 없이"})`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
