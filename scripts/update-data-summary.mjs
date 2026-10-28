// 일자리 현황 리포트(/report.html)·일자리 날씨(/job-weather.html)에 "오늘의 숫자"를 글로 적어 넣는
// 빌드 스크립트입니다. 두 페이지의 그래프는 GitHub Pages에서 끼워 넣은 화면(iframe)이라 검색엔진이
// 실버잡 페이지의 내용으로 읽지 못합니다. 그래서 같은 공개 자료(Supabase 공개 뷰, 매일 아침 6시쯤
// 갱신)를 빌드 때 읽어, 요약 문단·검색 설명(meta description)·구조화 데이터(Dataset)를 채웁니다.
//
// 자료를 못 읽으면 아무것도 바꾸지 않고 끝납니다 — 페이지는 저장소에 있는 기본 문구로 배포됩니다.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SUPABASE_URL = "https://idngidaxescxuyjzirob.supabase.co";
// 공개(publishable) 키: 읽기 전용으로 공개된 표와 뷰만 볼 수 있습니다. 위젯 화면에도 같은 키가 들어 있습니다.
const SUPABASE_KEY = "sb_publishable_hGMZ7IU3qZZc3jGzUP1ySQ_h1eRn7m0";
const SITE_URL = "https://silverjob.kr";

const SHORT = {
  "서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구", "인천광역시": "인천", "대전광역시": "대전",
  "울산광역시": "울산", "세종특별자치시": "세종", "경기도": "경기", "강원특별자치도": "강원", "충청북도": "충북",
  "충청남도": "충남", "전북특별자치도": "전북", "전남광주": "광주·전남", "경상북도": "경북", "경상남도": "경남",
  "제주특별자치도": "제주",
};
const PAY_WORD = { hour: "시급", day: "일급", month: "월급", year: "연봉" };

const fmt = (n) => Math.round(n).toLocaleString("ko-KR");
const fmt1 = (n) => (+n).toLocaleString("ko-KR", { maximumFractionDigits: 1 });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function money(n, unit) {
  if (unit !== "hour" && n >= 10000) return `${fmt(n / 10000)}만 원`;
  return `${fmt(n)}원`;
}

async function api(path, params) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
  const res = await fetch(url, { headers: { apikey: SUPABASE_KEY }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function loadStats() {
  const [runs, pay, opp, fc] = await Promise.all([
    api("ingest_runs", { select: "run_date", order: "run_date.desc", limit: 1 }),
    api("v_category_pay", { select: "category,open_count,gov_count,pay_unit,median_pay,pay_samples", sido: "eq.전국" }),
    api("v_opportunity_index", { select: "sido,open_count,pop_65_plus,per_10k_seniors" }),
    api("v_latest_forecast", { select: "week_start,lower,upper", sido: "eq.전국", order: "week_start.asc", limit: 1 }),
  ]);
  if (!runs.length || !pay.length) throw new Error("자료가 비어 있습니다");
  const total = pay.reduce((a, r) => a + r.open_count, 0);
  const gov = pay.reduce((a, r) => a + r.gov_count, 0);
  const cats = pay.filter((r) => r.category !== "기타").sort((a, b) => b.open_count - a.open_count);
  const byCount = [...opp].sort((a, b) => b.open_count - a.open_count);
  const byPer = [...opp].sort((a, b) => b.per_10k_seniors - a.per_10k_seniors);
  const pop = opp.reduce((a, r) => a + r.pop_65_plus, 0);
  const per10k = pop ? opp.reduce((a, r) => a + r.open_count, 0) * 10000 / pop : 0;
  const [y, m, d] = runs[0].run_date.split("-").map(Number);
  return { day: runs[0].run_date, label: `${y}년 ${m}월 ${d}일`, total, gov, cats, byCount, byPer, per10k, fc: fc[0] };
}

const monthDay = (d) => `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일`;
const payText = (r) => (r.pay_unit && r.pay_samples >= 5 ? `, 보통 ${PAY_WORD[r.pay_unit]} ${money(r.median_pay, r.pay_unit)}` : "");

function reportSummary(s) {
  const cats = s.cats.slice(0, 5).map((r) => `<li>${esc(r.category)} ${fmt(r.open_count)}건${payText(r)}</li>`).join("");
  const regions = s.byPer.slice(0, 5).map((r) => `${esc(SHORT[r.sido] || r.sido)} ${fmt1(r.per_10k_seniors)}건`).join(", ");
  return `
      <div class="legal-box" style="margin:0 0 28px;">
        <p style="margin:0;"><strong>${s.label} 기준 요약</strong></p>
        <p style="margin:4px 0 0;">전국에서 모집 중인 어르신 일자리는 <strong>${fmt(s.total)}건</strong>입니다.
          민간 채용공고 ${fmt(s.total - s.gov)}건, 정부 노인일자리 사업 모집 ${fmt(s.gov)}곳이에요.
          어르신(65세 이상) 1만 명당 공고는 전국 평균 ${fmt1(s.per10k)}건입니다.</p>
        <p style="margin:8px 0 0;"><strong>많이 모집하는 일</strong></p>
        <ul style="margin:4px 0 0; padding-left:1.2em;">${cats}</ul>
        <p style="margin:8px 0 0;"><strong>어르신 1만 명당 공고가 많은 지역</strong> — ${regions}</p>
        ${s.fc ? `<p style="margin:8px 0 0;"><strong>새 공고 예상</strong> — ${monthDay(s.fc.week_start)}부터 한 주 동안 노인 구인공고 ${fmt(s.fc.lower)}~${fmt(s.fc.upper)}건</p>` : ""}
      </div>`;
}

function weatherSummary(s) {
  const regions = s.byCount.slice(0, 6).map((r) => `${esc(SHORT[r.sido] || r.sido)} ${fmt(r.open_count)}건`).join(", ");
  return `
      <div class="legal-box" style="margin:0 0 28px;">
        <p style="margin:0;"><strong>${s.label} 아침 소식</strong></p>
        <p style="margin:4px 0 0;">지금 전국에서 <strong>${fmt(s.total)}건</strong>의 어르신 일자리가 모집 중이에요.
          지역별로는 ${regions} 순으로 많습니다.</p>
        ${s.fc ? `<p style="margin:4px 0 0;">${monthDay(s.fc.week_start)}부터 한 주 동안 새 노인 구인공고는 ${fmt(s.fc.lower)}~${fmt(s.fc.upper)}건 나올 것으로 보여요.</p>` : ""}
        <p style="margin:4px 0 0;">아래에서 우리 지역을 고르면 그 지역 숫자와 마감이 가까운 공고를 볼 수 있어요.</p>
      </div>`;
}

function dataset(name, description, path, s) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Dataset",
    name,
    description,
    url: `${SITE_URL}${path}`,
    dateModified: s.day,
    inLanguage: "ko",
    isAccessibleForFree: true,
    creator: { "@type": "Organization", name: "실버잡", url: SITE_URL },
    spatialCoverage: "대한민국",
    isBasedOn: ["고용24 채용정보(고용노동부)", "한국노인인력개발원 노인 구인정보·자립형일자리 사업모집공고", "행정안전부 주민등록 인구통계"],
  });
}

// 저장소의 기본 문구를 오늘 숫자로 바꿉니다. 표시(<!-- silverjob:summary -->)가 없으면 그 페이지는 건너뜁니다.
function rewrite(file, { description, summary, name }) {
  const path = join(ROOT, file);
  let html = readFileSync(path, "utf-8");
  const start = "<!-- silverjob:summary:start -->", end = "<!-- silverjob:summary:end -->";
  const a = html.indexOf(start), b = html.indexOf(end);
  if (a < 0 || b < a) { console.warn(`update-data-summary: ${file}에 요약 자리 표시가 없어 건너뜁니다.`); return; }
  html = html.slice(0, a + start.length) + summary + "\n      " + html.slice(b);
  const d = esc(description);
  html = html
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${d}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${d}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${d}$2`)
    .replace(/<script type="application\/ld\+json" id="silverjob-dataset">[\s\S]*?<\/script>\n?/, "")
    .replace("</head>", `<script type="application/ld+json" id="silverjob-dataset">${dataset(name, description, "/" + file, sharedStats)}</script>\n</head>`);
  writeFileSync(path, html, "utf-8");
}

let sharedStats;

async function main() {
  try {
    sharedStats = await loadStats();
  } catch (err) {
    console.warn("update-data-summary: 자료를 읽지 못해 기본 문구로 배포합니다.", err.message);
    return;
  }
  const s = sharedStats;
  const top = s.cats[0];
  rewrite("report.html", {
    name: "시니어 일자리 현황 리포트",
    description: `${s.label} 기준 전국 어르신 일자리 ${fmt(s.total)}건. ` +
      (top ? `가장 많은 일은 ${top.category}(${fmt(top.open_count)}건${payText(top)}). ` : "") +
      `지역별 어르신 1만 명당 공고, 직종별 급여, 새 공고 예상을 매일 아침 새 자료로 보여드립니다.`,
    summary: reportSummary(s),
  });
  rewrite("job-weather.html", {
    name: "우리 동네 일자리 날씨",
    description: `${s.label} 아침, 전국에서 어르신 일자리 ${fmt(s.total)}건이 모집 중이에요. ` +
      `우리 동네 공고 수와 이번 주 새 공고 예상을 한눈에 보여드립니다.`,
    summary: weatherSummary(s),
  });
  console.log(`update-data-summary: ${s.label} 자료로 리포트·일자리 날씨 요약을 갱신했습니다 (모집 중 ${fmt(s.total)}건).`);
}

await main();
