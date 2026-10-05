// 배포될 때마다(코드 푸시든, work24 자동 동기화 커밋이든, 관리자 CMS 등록이든) 실행되는
// 빌드 스크립트입니다. 채용공고 1건당 상세페이지(/jobs/<slug>.html, JobPosting
// JSON-LD 포함)는 더 이상 여기서 미리 만들지 않습니다 — 수천 건을 매 배포마다 전부
// 파일로 쓰면 빌드가 무거워져서 Netlify 빌드 크레딧을 많이 썼습니다. 대신
// netlify/functions/job-page.mjs가 요청이 올 때 같은 데이터로 그 자리에서 렌더링합니다
// (URL과 화면은 전과 동일, 크롤러 입장에서도 똑같은 200 응답의 정적 페이지처럼 보입니다).
// 이 스크립트는 그보다 가벼운 목록(/jobs/index.html)·사이트맵·리포트 페이지만 만듭니다.

import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SITE_URL, escapeHtml, jobRegionLabel, pageShell, collectValidJobs } from "../netlify/functions/lib/job-template.mjs";

const ROOT = process.cwd();
const JOBS_DIR = join(ROOT, "jobs");

function readJobsFile(path) {
  if (!existsSync(path)) return { jobs: [] };
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return { jobs: Array.isArray(data.jobs) ? data.jobs : [], syncedAt: data.syncedAt };
  } catch (err) {
    console.warn(`generate-job-pages: ${path} 읽기 실패, 건너뜁니다.`, err.message);
    return { jobs: [] };
  }
}

function jobIndexPage(entries) {
  const items = entries
    .map(
      ({ job, slug }) =>
        `        <li style="margin-bottom:10px;"><a href="/jobs/${slug}.html">${escapeHtml(job.title)} — ${escapeHtml(job.company)} (${escapeHtml(jobRegionLabel(job) || "")})</a></li>`
    )
    .join("\n");

  const bodyHtml = `
      <h1 class="section-title" style="font-size:clamp(1.5rem,3.2vw,2rem);">전체 채용정보 목록</h1>
      <p class="section-desc">실버잡에 올라온 모든 채용정보입니다. 보기 편한 화면은 <a href="/#jobs" style="text-decoration:underline;">홈페이지 일자리찾기</a>를 이용해 주세요.</p>
      <ul style="list-style:disc; padding-left:1.4em; margin:0;">
${items}
      </ul>
`;

  return pageShell({
    title: "전체 채용정보 목록",
    description: "실버잡에 등록된 모든 채용정보 목록입니다.",
    slug: "index",
    bodyHtml,
    jsonLd: null
  });
}

// 시니어 일자리 현황 리포트(/report.html)에서 씁니다. 전체 공고 원문을 다시 노출하는 게
// 아니라, 지역별/직종별 건수만 집계해서 보여주는 통계 페이지입니다.

const CATEGORY_LABELS = {
  시설관리: "아파트·시설관리",
  사무보조: "사무보조",
  미화: "미화·청소",
  조리: "급식·조리보조",
  경비안전: "경비·안전관리",
  사회공헌: "사회공헌활동"
};

// 직종별 준비 방법 — 실제 통계로 검증되지 않은 수치(예: "합격률")는 쓰지 않고,
// 일반적으로 알려진 준비 요령만 담습니다. 공고량 순위처럼 데이터로 확인되는
// 부분은 jobRankNote()에서 그때그때 계산해서 따로 붙입니다.
const CATEGORY_GUIDE = {
  경비안전: "경비지도사·소방안전관리자 자격증이 있으면 지원 시 유리합니다. 2교대·3교대 근무가 많으니 체력과 근무 형태를 먼저 확인해보세요.",
  미화: "특별한 자격증 없이 지원 가능한 경우가 많습니다. 성실하고 꾸준한 근무 이력을 이력서에 강조해보세요.",
  조리: "조리기능사 자격증이나 위생교육 이수 경험이 있으면 가점 요인이 됩니다. 단체급식 경험을 구체적으로 적어주세요.",
  사무보조: "기본적인 컴퓨터 활용(한글·엑셀) 능력과 친절한 응대 태도가 중요합니다. 전화 응대나 문서 작성 경험을 어필해보세요.",
  시설관리: "전기·소방·승강기 관련 자격증이 있으면 아파트·건물 관리 분야에서 크게 유리합니다. 주택관리사(보) 자격증도 도움이 됩니다.",
  사회공헌: "요양보호사·노인맞춤돌봄 관련 자격증이 있으면 선택의 폭이 넓어지지만, 자격증 없이 지원 가능한 활동도 많습니다."
};

// "사회공헌활동" 세부 분류마다, 왜 이 일자리가 생기는지를 실제로 존재하는
// 제도·정책 이름을 근거로 설명합니다. 중요: 특정 수치나 "환율이 오르면 N% 증가"
// 같은 상관관계 주장은 절대 넣지 않습니다 — 저희가 가진 데이터(며칠치)로는
// 그런 분석을 할 근거가 없고, 지어낸 것이 되기 때문입니다. 여기 적힌 내용은
// 전부 실제로 존재하는 법·제도의 구조를 설명한 것이지, 실버잡이 직접 계산한
// 통계적 상관관계가 아닙니다.
const SOCIAL_SUBCATEGORY_CONTEXT = {
  "요양보호사·간병": "노인장기요양보험제도(보건복지부)에 따라 장기요양 등급을 받는 어르신이 늘어날수록 수요가 커지는 구조입니다. 시니어 일자리 중 고령인구 증가와 가장 직접적으로 연동되는 직종입니다.",
  "사회복지사": "사회복지사업법에 따라 노인복지관·재가복지센터 등 복지시설에 의무 배치되는 인력입니다. 지자체·정부의 복지 예산 규모에 영향을 받습니다.",
  "노인맞춤돌봄·생활지원": "보건복지부가 운영하는 '노인맞춤돌봄서비스' 사업의 인력입니다. 매년 정부 예산 편성에 따라 모집 규모가 정해지는 공공사업형 일자리입니다.",
  "간호조무사·병동보조": "요양병원 수 증가와 함께 늘어나는 직종입니다.",
  "간호사": "의료기관(요양병원 포함) 확충과 간호인력 수급 정책에 영향을 받습니다.",
  "물리·작업치료사": "요양병원·요양원의 재활치료 수요와 연동되는 직종입니다.",
  "요양시설 위생관리": "노인요양시설 수 증가와 함께 늘어나는 직종입니다."
};

function socialSubcategoryBlock(name, count, max) {
  const context = SOCIAL_SUBCATEGORY_CONTEXT[name];
  return (
    barRow(name, count, max, context ? 6 : 14) +
    (context
      ? `
      <p style="margin:0 0 20px; color:var(--color-text-muted); font-size:.95rem;">📌 <strong>왜 이 일자리가 생길까요?</strong> ${escapeHtml(context)}</p>`
      : "")
  );
}

// 권역별로 "왜 이 지역에 시니어 채용정보가 많은가/적은가"를 실제 공신력 있는
// 고령인구 통계(통계청·행정안전부·지자체 발표)로 설명합니다. 사회공헌활동 설명과
// 마찬가지로, 실버잡이 직접 계산한 상관관계가 아니라 이미 발표된 공식 통계를
// 인용한 것입니다. 수치는 대략적인 값이며, 출처를 함께 표기합니다.
const REGION_CONTEXT = {
  "서울": "서울의 65세 이상 인구는 약 196만 명으로 전국 17개 시도 중 가장 많습니다(전국 고령인구의 약 17%, 통계청 고령자 통계). 고령인구가 가장 많이 모여 사는 도시인 만큼 시니어 일자리 수요·공급도 가장 활발합니다.",
  "경기·인천": "경기도의 65세 이상 인구는 약 255만 명으로 서울보다도 많고, 2050년에는 518만 명까지 늘어날 것으로 전망됩니다(경기도 발표). 인천을 포함한 수도권 전체 인구 규모가 워낙 크다 보니, 절대적인 채용공고 수도 가장 많습니다.",
  "부산·경남": "부산은 특별·광역시 중 고령인구 비율이 가장 높고(약 22.8%), 고령화 속도도 전국에서 가장 빠른 도시로 조사됐습니다(2026년 고령자 통계). 그만큼 시니어 돌봄·복지 일자리 수요도 빠르게 늘고 있습니다.",
  "대구·경북": "경북은 고령인구 비율이 약 27.6%로 전국에서 손꼽히게 높고, 특히 농촌 지역은 전업농가의 약 65%가 65세 이상일 정도로 고령화가 심합니다(통계청·농림축산식품부 통계). 지역 특성상 농촌형 돌봄·공공근로 일자리 비중이 높습니다.",
  "광주·전라": "전남은 65세 이상 인구 비율이 약 28.6%로 전국 17개 시도 중 가장 높습니다(2026년 고령자 통계). 고령화가 가장 앞서 진행된 지역인 만큼, 시니어 대상 공공일자리·복지 사업도 가장 먼저, 가장 많이 운영되고 있습니다.",
  "대전·충청": "충남·충북은 고령인구 비율이 각각 약 23.1%, 23.2%로 전국 평균(21.6%)을 웃돕니다(통계청). 다만 천안·아산 같은 도시(14~15%)와 서천·부여 같은 농촌(42~43%)의 차이가 커서, 지역 안에서도 일자리 성격이 크게 갈립니다.",
  "강원": "강원은 인구의 약 27%가 65세 이상이며, 30년 뒤에는 인구 절반이 노인일 것으로 전망됩니다(강원도 발표). 고령화가 가장 빠르게 진행되는 지역 중 하나로, 시니어 일자리의 중요성이 특히 큽니다.",
  "제주": "제주는 65세 이상 인구 비율이 약 20.0%로 아직 전국 평균보다 낮지만, 2052년에는 40.9%로 전국 평균을 넘어설 것으로 전망됩니다(통계청). 인구 규모 자체가 작아 다른 지역보다 공고 수가 상대적으로 적습니다."
};

function regionBlock(name, count, max) {
  const context = REGION_CONTEXT[name];
  return (
    barRow(name, count, max, context ? 6 : 14) +
    (context
      ? `
      <p style="margin:0 0 20px; color:var(--color-text-muted); font-size:.95rem;">📌 <strong>왜 이 지역에 시니어 채용정보가 많을까요?</strong> ${escapeHtml(context)}</p>`
      : "")
  );
}

// 지금 집계 결과에서 이 직종이 몇 번째로 많은지에 따라 문구를 다르게 붙입니다.
// (고정된 멘트가 아니라, 매 빌드마다 실제 순위를 다시 계산합니다.)
function jobRankNote(index, total) {
  if (total <= 1) return "";
  if (index === 0) return "실버잡에 가장 많이 올라오는 분야입니다.";
  if (index === total - 1) return "상대적으로 공고 수가 적은 편이니, 보이면 빠르게 지원해보세요.";
  return "";
}

function readStatsHistory(path) {
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return Array.isArray(data.days) ? data.days : [];
  } catch (err) {
    console.warn(`generate-job-pages: ${path} 읽기 실패, 건너뜁니다.`, err.message);
    return [];
  }
}

function computeReportStats(jobs) {
  const byRegion = {};
  const byRegionDetail = {};
  const byJob = {};
  const bySocialSubcategory = {};
  for (const j of jobs) {
    if (j.region) byRegion[j.region] = (byRegion[j.region] || 0) + 1;
    if (j.region && j.regionDetail) {
      const key = `${j.region} ${j.regionDetail}`;
      byRegionDetail[key] = (byRegionDetail[key] || 0) + 1;
    }
    if (j.job) byJob[j.job] = (byJob[j.job] || 0) + 1;
    if (j.job === "사회공헌" && j.socialSubcategory) {
      bySocialSubcategory[j.socialSubcategory] = (bySocialSubcategory[j.socialSubcategory] || 0) + 1;
    }
  }
  return { total: jobs.length, byRegion, byRegionDetail, byJob, bySocialSubcategory };
}

function sortedEntries(obj) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]);
}

function barRow(label, count, max, marginBottom) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return `
      <div style="margin-bottom:${marginBottom == null ? 14 : marginBottom}px;">
        <div style="display:flex; justify-content:space-between; gap:12px; margin-bottom:4px; font-weight:700;">
          <span>${escapeHtml(label)}</span><span>${count.toLocaleString("ko-KR")}건</span>
        </div>
        <div style="background:var(--color-secondary-light); border-radius:999px; height:14px; overflow:hidden;">
          <div style="background:var(--color-primary); width:${pct}%; height:100%;"></div>
        </div>
      </div>`;
}

// 직종 막대그래프 밑에, 그 직종을 준비하는 방법을 바로 붙여서 보여줍니다.
function jobCategoryBlock(name, count, max, index, total) {
  const guide = CATEGORY_GUIDE[name];
  const rankNote = jobRankNote(index, total);
  const tip = [guide, rankNote].filter(Boolean).join(" ");
  return (
    barRow(CATEGORY_LABELS[name] || name, count, max, tip ? 6 : 14) +
    (tip
      ? `
      <p style="margin:0 0 20px; color:var(--color-text-muted); font-size:.95rem;">💡 <strong>준비 방법:</strong> ${escapeHtml(tip)}</p>`
      : "")
  );
}

function buildReportPage(stats, history) {
  const regionEntries = sortedEntries(stats.byRegion);
  const regionMax = regionEntries.length ? regionEntries[0][1] : 0;
  const jobEntries = sortedEntries(stats.byJob);
  const jobMax = jobEntries.length ? jobEntries[0][1] : 0;
  const detailEntries = sortedEntries(stats.byRegionDetail).slice(0, 10);

  const regionBars = regionEntries.map(([name, count]) => regionBlock(name, count, regionMax)).join("");
  const jobBars = jobEntries
    .map(([name, count], i) => jobCategoryBlock(name, count, jobMax, i, jobEntries.length))
    .join("");
  const detailRows = detailEntries
    .map(([name, count], i) => `<p class="legal-item">${i + 1}. ${escapeHtml(name)} — ${count.toLocaleString("ko-KR")}건</p>`)
    .join("\n");

  // "사회공헌활동"은 건수가 가장 많은 카테고리인데 범위가 넓어서, work24 공식
  // 직종분류코드(jobsCd)를 기준으로 더 들여다봅니다. 실제 어떤 일이 많은지 보여줍니다.
  const socialSubEntries = sortedEntries(stats.bySocialSubcategory);
  const socialSubTotal = socialSubEntries.reduce((sum, [, c]) => sum + c, 0);
  const socialSubMax = socialSubEntries.length ? socialSubEntries[0][1] : 0;
  const socialSubBars = socialSubEntries.map(([name, count]) => socialSubcategoryBlock(name, count, socialSubMax)).join("");
  const topSocial = socialSubEntries[0];
  const topSocialPct = topSocial && socialSubTotal ? Math.round((topSocial[1] / socialSubTotal) * 100) : 0;
  const socialInsight = topSocial
    ? `"사회공헌활동"으로 묶이는 공고 ${socialSubTotal.toLocaleString("ko-KR")}건 중 <strong>${topSocialPct}%가 "${escapeHtml(topSocial[0])}"</strong>입니다. work24 공식 직종분류코드를 기준으로 나눴습니다.`
    : "";

  let trendHtml;
  if (history.length < 2) {
    trendHtml = `<p>데이터 수집을 이제 막 시작했습니다. 매일 자동으로 쌓이는 중이니, 며칠 뒤 다시 찾아와 주시면 최근 추이를 보여드릴 수 있어요.</p>`;
  } else {
    const sorted = history.slice().sort((a, b) => a.date.localeCompare(b.date));
    const latest = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2];
    const diff = latest.total - prev.total;
    const diffText = diff === 0 ? "변동 없음" : diff > 0 ? `${diff}건 증가` : `${Math.abs(diff)}건 감소`;
    const recentRows = sorted
      .slice(-7)
      .map((d) => `<p class="legal-item">${escapeHtml(d.date)} — ${d.total.toLocaleString("ko-KR")}건</p>`)
      .join("\n");
    trendHtml = `
      <p>${escapeHtml(prev.date)} ${prev.total.toLocaleString("ko-KR")}건 → ${escapeHtml(latest.date)} ${latest.total.toLocaleString("ko-KR")}건 (${diffText})</p>
      <h3 style="font-size:1rem; margin-top:20px;">최근 ${Math.min(sorted.length, 7)}일 추이</h3>
      ${recentRows}`;
  }

  const today = new Date().toISOString().slice(0, 10);

  const bodyHtml = `
      <h1 class="section-title" style="font-size:clamp(1.6rem,3.4vw,2.2rem);">시니어 일자리 현황 리포트</h1>
      <p class="section-desc" style="margin-bottom:8px;">실버잡에 매일 자동으로 모이는 전국 시니어 채용정보(work24 공공데이터 + 지역업체 등록)를 바탕으로 만든 통계입니다. 기준일: ${today}</p>

      <div class="legal-content">
        <h2>전체 현황</h2>
        <p>현재 실버잡에 등록된 시니어 채용정보는 총 <strong>${stats.total.toLocaleString("ko-KR")}건</strong>입니다.</p>

        <h2>권역별 분포</h2>
        ${
          regionBars
            ? `<p class="section-desc" style="margin-bottom:12px;">아래 "왜 이 지역에 많을까요?" 설명은 통계청·행정안전부 등이 발표한 실제 고령인구 통계를 인용한 것입니다. 실버잡이 직접 계산한 상관관계가 아닙니다.</p>
        ${regionBars}`
            : "<p>데이터가 아직 없습니다.</p>"
        }

        <h2>전국 시/군/구 TOP 10</h2>
        <p class="section-desc" style="margin-bottom:12px;">시니어 채용정보가 가장 많이 등록된 지역 순위입니다.</p>
        ${detailRows || "<p>세부지역 데이터가 아직 충분하지 않습니다.</p>"}

        <h2>직종별 분포 · 준비 방법</h2>
        <p class="section-desc" style="margin-bottom:12px;">각 직종을 준비할 때 참고할 만한 내용을 함께 정리했습니다. 더 자세한 구직 요령은 <a href="/tips.html" style="text-decoration:underline;">구직 꿀팁</a> 페이지에서 확인하실 수 있습니다.</p>
        ${jobBars || "<p>데이터가 아직 없습니다.</p>"}

        <h2>"사회공헌활동", 자세히 들여다보면</h2>
        <p class="section-desc" style="margin-bottom:12px;">${socialInsight || "데이터가 아직 충분하지 않습니다."}</p>
        ${
          socialSubBars
            ? `<p class="section-desc" style="margin-bottom:12px;">아래 "왜 이 일자리가 생길까요?" 설명은 실제로 존재하는 법·제도(노인장기요양보험제도, 사회복지사업법 등)를 근거로 적은 것입니다. 실버잡이 며칠치 데이터로 통계적 상관관계나 순위를 계산한 것이 아니며, 그런 분석은 충분한 기간의 데이터가 쌓인 뒤에만 제공할 계획입니다.</p>
        ${socialSubBars}`
            : "<p>데이터가 아직 없습니다.</p>"
        }

        <h2>최근 추이</h2>
        ${trendHtml}

        <div class="legal-box">
          <p style="margin:0;"><strong>데이터에 대해</strong></p>
          <p style="margin:4px 0 0;">이 통계는 work24(고용24) 오픈API로 받아온 공공 채용정보와 실버잡에 직접 등록된 지역업체 채용정보를 합산한 것입니다. 숫자는 매일 자동 갱신되며, 실제 데이터를 그대로 집계한 것으로 꾸미거나 보정하지 않습니다.</p>
        </div>
      </div>
`;

  return pageShell({
    title: "시니어 일자리 현황 리포트",
    description: `실버잡이 매일 자동으로 모으는 전국 시니어 채용정보 ${stats.total.toLocaleString("ko-KR")}건을 지역별·직종별로 분석한 리포트입니다.`,
    path: "/report.html",
    bodyHtml,
    jsonLd: null
  });
}

function buildSitemap(entries) {
  const staticUrls = [
    { loc: "/", changefreq: "daily", priority: "1.0" },
    { loc: "/about.html", changefreq: "monthly", priority: "0.6" },
    { loc: "/tips.html", changefreq: "monthly", priority: "0.6" },
    { loc: "/partner.html", changefreq: "monthly", priority: "0.6" },
    { loc: "/review.html", changefreq: "monthly", priority: "0.6" },
    { loc: "/terms.html", changefreq: "yearly", priority: "0.3" },
    { loc: "/privacy.html", changefreq: "yearly", priority: "0.3" },
    { loc: "/report.html", changefreq: "daily", priority: "0.7" },
    { loc: "/jobs/index.html", changefreq: "daily", priority: "0.7" }
  ];

  const jobUrls = entries.map(({ slug }) => ({
    loc: `/jobs/${slug}.html`,
    changefreq: "daily",
    priority: "0.8"
  }));

  const all = staticUrls.concat(jobUrls);
  const body = all
    .map(
      (u) =>
        `  <url>\n    <loc>${SITE_URL}${u.loc}</loc>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function main() {
  const adminJobs = readJobsFile(join(ROOT, "content", "jobs.json"));
  const externalJobs = readJobsFile(join(ROOT, "content", "jobs-external.json"));

  const combined = adminJobs.jobs.concat(externalJobs.jobs);
  // 채용 상세페이지(/jobs/<slug>.html)는 더 이상 빌드 시점에 미리 만들지 않습니다
  // (수천 건을 매 배포마다 전부 파일로 쓰면 빌드가 무거워져서 Netlify 빌드 크레딧을
  // 많이 썼습니다). 대신 netlify/functions/job-page.mjs가 요청이 올 때 같은 데이터로
  // 그때그때 렌더링합니다. 여기서는 목록·사이트맵·리포트처럼 가벼운 집계 페이지만 만듭니다.
  const entries = collectValidJobs(combined);

  // /jobs/ 에는 index.html 하나만 남기면 되므로 통째로 비우고 다시 만듭니다.
  rmSync(JOBS_DIR, { recursive: true, force: true });
  mkdirSync(JOBS_DIR, { recursive: true });
  writeFileSync(join(JOBS_DIR, "index.html"), jobIndexPage(entries), "utf-8");
  writeFileSync(join(ROOT, "sitemap.xml"), buildSitemap(entries), "utf-8");

  const reportStats = computeReportStats(entries.map((e) => e.job));
  const statsHistory = readStatsHistory(join(ROOT, "content", "jobs-stats-history.json"));
  writeFileSync(join(ROOT, "report.html"), buildReportPage(reportStats, statsHistory), "utf-8");

  console.log(`generate-job-pages: ${entries.length}건 집계 완료 (상세페이지는 요청 시 동적 렌더링)`);
}

main();
