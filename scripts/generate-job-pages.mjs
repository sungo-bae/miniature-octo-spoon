// 구글 "일자리 검색(Google for Jobs)" 노출을 위해, 채용공고 1건당 고유 URL(/jobs/<slug>.html)을
// 가진 정적 페이지를 만들고, 각 페이지에 JobPosting 구조화 데이터(JSON-LD)를 심습니다.
//
// Netlify가 배포할 때마다(코드 푸시든, work24 자동 동기화 커밋이든, 관리자 CMS 등록이든)
// netlify.toml의 build command로 이 스크립트가 실행되어 /jobs/ 폴더를 통째로 다시 만듭니다.
// 그래서 만료되거나 삭제된 공고의 페이지는 다음 배포에서 자동으로 사라집니다(= 구글에 더 이상
// 노출되지 않음). /jobs/는 빌드 결과물이라 .gitignore에 등록되어 저장소에는 커밋되지 않습니다.

import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SITE_URL = "https://silverjob.kr";
const JOBS_DIR = join(ROOT, "jobs");

// 카카오톡 채널 링크. js/main.js의 KAKAO_CHANNEL_URL과 값이 같아야 합니다(둘 다 고치세요).
const KAKAO_CHANNEL_URL = "https://pf.kakao.com/_tbxnxiX/chat";

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

// js/main.js의 jobSlug()와 동일한 알고리즘입니다. 한쪽만 고치면 링크가 어긋나니 항상 같이 수정하세요.
function jobSlug(job) {
  const key = job.applyUrl || `${job.title}|${job.company}|${job.region}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return "job-" + hash.toString(16).padStart(8, "0");
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// js/main.js의 jobSourceBadge()와 같은 로직입니다. 한쪽만 고치면 표시가 어긋나니 같이 수정하세요.
function jobSourceBadge(job) {
  if (job.source === "워크넷") {
    return '<span class="job-source job-source-public">공공데이터</span>';
  }
  return '<span class="job-source job-source-local">지역업체 등록</span>';
}

// js/main.js의 jobRegionLabel()과 같은 로직입니다. 한쪽만 고치면 표시가 어긋나니 같이 수정하세요.
function jobRegionLabel(job) {
  return job.regionDetail ? `${job.region} ${job.regionDetail}` : job.region;
}

function buildDescription(job) {
  if (job.description && job.description.trim()) return job.description.trim();
  const parts = [];
  parts.push(`${job.company}에서 '${job.title}' 포지션을 모집합니다.`);
  const loc = [job.region, job.address].filter(Boolean).join(" ");
  if (loc) parts.push(`근무지: ${loc}`);
  if (job.type) parts.push(`근무조건: ${job.type}`);
  if (job.pay) parts.push(`급여: ${job.pay}`);
  if (job.requirements) parts.push(`자격요건: ${job.requirements}`);
  if (job.preferred) parts.push(`우대사항: ${job.preferred}`);
  parts.push("자세한 내용은 원문 공고 또는 실버잡 카카오톡 문의로 확인해 주세요.");
  return parts.join(" ");
}

function toIsoDeadline(deadline) {
  // "2026.09.30" -> "2026-09-30"
  if (!deadline) return "";
  const m = deadline.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

function buildJobPostingJsonLd(job, slug, fallbackDate) {
  const datePosted = job.postedDate || job.datePosted || fallbackDate || "";
  const validThrough = toIsoDeadline(job.deadline);
  const url = `${SITE_URL}/jobs/${slug}.html`;

  const jsonLd = {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    title: job.title,
    description: buildDescription(job),
    identifier: { "@type": "PropertyValue", name: "실버잡", value: slug },
    url,
    hiringOrganization: { "@type": "Organization", name: job.company }
  };

  if (datePosted) jsonLd.datePosted = datePosted;
  if (validThrough) jsonLd.validThrough = validThrough;

  if (job.region || job.address) {
    jsonLd.jobLocation = {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        ...(job.address ? { streetAddress: job.address } : {}),
        ...(job.region ? { addressRegion: job.region } : {}),
        addressCountry: "KR"
      }
    };
  }

  return jsonLd;
}

function pageShell({ title, description, slug, path, bodyHtml, jsonLd }) {
  const url = `${SITE_URL}${path || `/jobs/${slug}.html`}`;
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} | 실버잡</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="실버잡">
<meta property="og:locale" content="ko_KR">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${escapeHtml(title)} | 실버잡">
<meta property="og:description" content="${escapeHtml(description)}">
<meta name="twitter:card" content="summary">
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🧡</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Gowun+Dodum&family=Noto+Sans+KR:wght@400;500;700;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9624100064065181" crossorigin="anonymous"></script>
${jsonLd ? `<script type="application/ld+json">\n${JSON.stringify(jsonLd, null, 2)}\n</script>` : ""}
</head>
<body>

<a class="skip-link" href="#main">본문 바로가기</a>

<header class="site-header">
  <div class="header-inner">
    <a class="logo" href="/" aria-label="실버잡 홈으로 이동">
      <span class="logo-mark" aria-hidden="true">🧡</span>
      <span class="logo-text">실버잡<span class="logo-sub">.kr</span></span>
    </a>
    <nav class="main-nav" id="mainNav" aria-label="주요 메뉴">
      <a href="/#jobs">일자리찾기</a>
      <a href="/#categories">직종별 보기</a>
      <a href="/about.html">실버잡 소개</a>
      <a href="/tips.html">구직 꿀팁</a>
      <a href="/report.html">현황 리포트</a>
      <a href="/#how">이용방법</a>
      <a href="/#reviews">이용후기</a>
      <a href="/#notice">공지사항</a>
      <a href="/partner.html">채용정보 등록</a>
    </nav>
    <div class="header-tools">
      <a href="/partner.html" class="header-cta">채용정보 등록</a>
      <div class="font-size-control" role="group" aria-label="글자 크기 조절">
        <span class="fs-label" aria-hidden="true">글자크기</span>
        <button type="button" id="fsDown" aria-label="글자 작게">가<small>−</small></button>
        <button type="button" id="fsReset" aria-label="글자 기본크기">가</button>
        <button type="button" id="fsUp" aria-label="글자 크게">가<small>+</small></button>
      </div>
      <button type="button" class="hamburger" id="hamburger" aria-expanded="false" aria-controls="mainNav" aria-label="메뉴 열기">
        <span></span><span></span><span></span>
      </button>
    </div>
  </div>
</header>

<main id="main">
  <section class="section" style="padding-top:56px;">
    <div class="section-inner" style="max-width:720px;">
${bodyHtml}
    </div>
  </section>
</main>

<footer class="site-footer">
  <div class="footer-inner">
    <div class="footer-brand">
      <span class="logo-mark" aria-hidden="true">🧡</span>
      <span class="logo-text">실버잡<span class="logo-sub">.kr</span></span>
      <p>시니어의 든든한 두 번째 일터, 실버잡</p>
    </div>
    <div class="footer-info">
      <p>상호: 성오테크 · 대표: 배성오</p>
      <p>사업장 소재지: 경기도 수원시 장안구 정조로978번길 43(조원동)</p>
      <p>이메일: sungohtech@gmail.com</p>
      <p>사업자등록번호: 344-01-03748</p>
      <p>직업정보제공사업 신고번호: J1800020260020 (경기지방고용노동청)</p>
    </div>
    <div class="footer-links">
      <a href="/#top">홈으로</a>
      <a href="/about.html">실버잡 소개</a>
      <a href="/tips.html">구직 꿀팁</a>
      <a href="/report.html">현황 리포트</a>
      <a href="/terms.html">이용약관</a>
      <a href="/privacy.html">개인정보처리방침</a>
      <a href="/partner.html">채용정보 등록 신청</a>
      <a href="/review.html">이용후기 작성</a>
      <a href="/admin/">관리자 로그인</a>
    </div>
  </div>
  <p class="footer-copy">© 2026 실버잡(silverjob.kr) · 운영: 성오테크. All rights reserved.</p>
</footer>

<script src="/js/main.js"></script>
</body>
</html>
`;
}

function jobDetailPage(job, slug, fallbackDate) {
  const jsonLd = buildJobPostingJsonLd(job, slug, fallbackDate);
  const applyHref = job.applyUrl || KAKAO_CHANNEL_URL;
  const applyLabel = job.applyUrl ? "지원하기 (원문 공고로 이동)" : "💬 카카오톡으로 문의하기";

  const bodyHtml = `
      <p style="margin:0 0 18px;"><a href="/#jobs" style="color:var(--color-text-muted); text-decoration:underline;">← 전체 일자리로 돌아가기</a></p>
      <h1 class="section-title" style="font-size:clamp(1.5rem,3.2vw,2rem); margin-bottom:6px;">${escapeHtml(job.title)}</h1>
      <p style="color:var(--color-text-muted); font-size:1.1rem; margin:0 0 10px;">${escapeHtml(job.company)}</p>
      <p style="margin:0 0 18px;">${jobSourceBadge(job)}</p>

      <div class="legal-box" style="margin-bottom:24px;">
        <p style="margin:0 0 8px;"><strong>${escapeHtml(jobRegionLabel(job) || "")}</strong> ${job.type ? "· " + escapeHtml(job.type) : ""}</p>
        <p style="margin:0; font-weight:800; color:var(--color-primary-dark); font-size:1.2rem;">${escapeHtml(job.pay || "")}</p>
        ${job.deadline ? `<p style="margin:8px 0 0; color:var(--color-text-muted);">마감일: ${escapeHtml(job.deadline)}</p>` : `<p style="margin:8px 0 0; color:var(--color-text-muted);">상시채용</p>`}
      </div>

      ${job.description ? `<h2 style="font-size:1.1rem;">상세 설명</h2><p>${escapeHtml(job.description)}</p>` : ""}
      ${job.requirements ? `<h2 style="font-size:1.1rem;">자격 요건</h2><p>${escapeHtml(job.requirements)}</p>` : ""}
      ${job.preferred ? `<h2 style="font-size:1.1rem;">우대 사항</h2><p>${escapeHtml(job.preferred)}</p>` : job.id && job.infoSvc ? `<div id="preferredBox" data-job-id="${escapeHtml(job.id)}" data-job-infosvc="${escapeHtml(job.infoSvc)}" hidden><h2 style="font-size:1.1rem;">우대 사항</h2><p id="preferredText"></p></div>` : ""}
      ${job.address ? `<h2 style="font-size:1.1rem;">근무지 주소</h2><p>${escapeHtml(job.address)}</p>` : ""}
      ${job.source ? `<p style="color:var(--color-text-muted); font-size:.9rem; margin-top:24px;">출처: ${escapeHtml(job.source)}</p>` : ""}

      <div style="margin-top:28px;">
        <a href="${escapeHtml(applyHref)}" class="btn btn-primary btn-lg" target="_blank" rel="noopener">${applyLabel}</a>
      </div>
`;

  return pageShell({
    title: job.title,
    description: truncate(buildDescription(job), 160),
    slug,
    bodyHtml,
    jsonLd
  });
}

function truncate(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max - 1).trim() + "…";
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

  const regionBars = regionEntries.map(([name, count]) => barRow(name, count, regionMax)).join("");
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
        ${regionBars || "<p>데이터가 아직 없습니다.</p>"}

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
  const fallbackDate = (externalJobs.syncedAt || adminJobs.syncedAt || "").slice(0, 10);

  const combined = adminJobs.jobs.concat(externalJobs.jobs);

  // 상세 페이지를 만들기에 정보가 너무 부족한 공고(제목/업체명 없음)는 건너뜁니다.
  const valid = combined.filter((j) => j && j.title && j.company);

  // 매 빌드마다 /jobs/를 통째로 비우고 다시 만들어서, 사라진 공고의 페이지도 함께 정리합니다.
  rmSync(JOBS_DIR, { recursive: true, force: true });
  mkdirSync(JOBS_DIR, { recursive: true });

  const seenSlugs = new Set();
  const entries = [];
  for (const job of valid) {
    const slug = jobSlug(job);
    if (seenSlugs.has(slug)) continue; // 동일 공고 중복 방지
    seenSlugs.add(slug);
    entries.push({ job, slug });
    writeFileSync(join(JOBS_DIR, `${slug}.html`), jobDetailPage(job, slug, fallbackDate), "utf-8");
  }

  writeFileSync(join(JOBS_DIR, "index.html"), jobIndexPage(entries), "utf-8");
  writeFileSync(join(ROOT, "sitemap.xml"), buildSitemap(entries), "utf-8");

  const reportStats = computeReportStats(valid);
  const statsHistory = readStatsHistory(join(ROOT, "content", "jobs-stats-history.json"));
  writeFileSync(join(ROOT, "report.html"), buildReportPage(reportStats, statsHistory), "utf-8");

  console.log(`generate-job-pages: ${entries.length}개 채용 상세 페이지 생성 완료`);
}

main();
