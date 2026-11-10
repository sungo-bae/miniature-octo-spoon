// 채용 상세페이지(/jobs/<slug>.html) HTML을 만드는 공통 템플릿입니다.
// scripts/generate-job-pages.mjs(목록/사이트맵/리포트 빌드)와
// netlify/functions/job-page.mjs(상세페이지 요청 시 그때그때 렌더링) 양쪽에서
// 똑같이 가져다 씁니다. 전에는 빌드마다 상세페이지 수천 개를 전부 파일로 미리
// 만들어서 배포 1회당 Netlify 빌드 크레딧을 많이 썼는데(1건당 ~15크레딧,
// 2026-10 초 크레딧 초과 사태의 주원인), 이제는 상세페이지를 빌드 시점에
// 미리 만들지 않고 요청이 올 때 함수가 즉석에서 만들어 돌려줍니다.

export const SITE_URL = "https://silverjob.kr";

// 카카오톡 채널 링크. js/main.js의 KAKAO_CHANNEL_URL과 값이 같아야 합니다(둘 다 고치세요).
export const KAKAO_CHANNEL_URL = "https://pf.kakao.com/_tbxnxiX/chat";

// js/main.js의 jobSlug()와 동일한 알고리즘입니다. 한쪽만 고치면 링크가 어긋나니 항상 같이 수정하세요.
export function jobSlug(job) {
  const key = job.applyUrl || `${job.title}|${job.company}|${job.region}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return "job-" + hash.toString(16).padStart(8, "0");
}

export function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 링크 주소는 http(s)·사이트 안 주소만 허용합니다 ("javascript:" 같은 주소로 스크립트가 실행되지 않게).
export function safeUrl(value, fallback = "#") {
  const url = String(value || "").trim();
  return /^(https?:\/\/|\/(?!\/)|#)/i.test(url) ? url : fallback;
}

// js/main.js의 jobSourceBadge()와 같은 로직입니다. 한쪽만 고치면 표시가 어긋나니 같이 수정하세요.
export function jobSourceBadge(job) {
  if (job.source === "워크넷") {
    return '<span class="job-source job-source-public">공공데이터</span>';
  }
  return '<span class="job-source job-source-local">지역업체 등록</span>';
}

// js/main.js의 jobRegionLabel()과 같은 로직입니다. 한쪽만 고치면 표시가 어긋나니 같이 수정하세요.
export function jobRegionLabel(job) {
  return job.regionDetail ? `${job.region} ${job.regionDetail}` : job.region;
}

export function buildDescription(job) {
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

export function truncate(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max - 1).trim() + "…";
}

export function toIsoDeadline(deadline) {
  // "2026.09.30" -> "2026-09-30"
  if (!deadline) return "";
  const m = deadline.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

// ---------------- 구글 검색에 여는 공고 ----------------
// 2026-10-26부터 공고 상세페이지 전체를 noindex로 막았습니다(고용24 원문을 그대로 옮긴 얇은 페이지
// 수천 건이 저품질로 비칠 수 있어서). 이제 "쓸모 있고 살아 있는" 공고만 다시 엽니다:
//  - 실버잡에 직접 등록된 공고는 항상
//  - 고용24 공고는 최근 INDEX_WINDOW_DAYS일 안에 올라왔고, 실제 마감일이 있으며(채용시까지 제외)
//    아직 마감 전이고, 근무지 주소와 급여가 있는 것만
// 마감일이 지나면 자동으로 다시 noindex가 되고, 목록에서 빠지면 404가 됩니다.
export const INDEX_WINDOW_DAYS = 7;

function kstToday(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function isoDaysBefore(isoDate, days) {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function isIndexableJob(job, now = new Date()) {
  if (job.source !== "워크넷") return true; // 실버잡에 직접 등록된 공고
  const deadline = toIsoDeadline(job.deadline);
  const posted = job.postedDate || job.datePosted || "";
  if (!deadline || !posted || !job.address || !job.pay) return false;
  const today = kstToday(now);
  return deadline >= today && posted >= isoDaysBefore(today, INDEX_WINDOW_DAYS);
}

// 직종별 준비 요령 — 고용24 원문에는 없는 실버잡의 안내입니다. 통계로 확인되지 않은 수치(합격률 등)는
// 쓰지 않고, 일반적으로 알려진 준비 방법만 적습니다.
const JOB_TIPS = {
  경비안전: "경비지도사·소방안전관리자 자격이 있으면 유리합니다. 2교대·3교대나 격일 근무가 많으니 근무 형태와 휴게시간을 먼저 확인하세요. 일반경비원 신임교육(24시간) 이수가 필요한 경우가 많습니다.",
  미화: "특별한 자격 없이 지원할 수 있는 경우가 많습니다. 근무 시간대(새벽·오전)와 담당 구역 넓이를 물어보고, 성실하게 오래 일한 경력을 이력서에 적어 보세요.",
  조리: "조리기능사 자격이나 위생교육 이수 경험이 있으면 도움이 됩니다. 단체급식이라면 하루 식수 인원과 근무 시간을 확인하고, 급식·조리 경력을 구체적으로 적어 주세요.",
  사무보조: "문서 작성·엑셀 등 기본 컴퓨터 활용 능력을 묻는 경우가 많습니다. 민원 응대나 안내 업무라면 친절한 응대 경험을 강조해 보세요.",
  시설관리: "전기·보일러·소방 관련 자격이 있으면 크게 유리합니다. 아파트·건물 관리는 야간·휴일 당직이 있는지 꼭 확인하세요.",
  사회공헌: "요양보호사는 국가자격증이 필요합니다. 돌봄·복지 일은 근무 시간과 이동 거리(방문형 여부)를 먼저 확인하고, 봉사·간병 경험을 적어 주세요."
};

function jobTipsHtml(job) {
  const tip = JOB_TIPS[job.job];
  return `
      <div class="legal-box" style="margin-top:28px;">
        <p style="margin:0;"><strong>실버잡 도움말</strong></p>
        ${tip ? `<p style="margin:6px 0 0;">${escapeHtml(tip)}</p>` : ""}
        <p style="margin:6px 0 0;">지원 전 확인할 것: 근무 시간과 휴일, 급여 지급 방식(시급·월급), 4대보험 가입 여부, 출퇴근 거리.
          자세한 요령은 <a href="/apply-guide.html" style="text-decoration:underline;">지원 방법 가이드</a>, 지역·직종별 일자리 흐름은
          <a href="/report.html" style="text-decoration:underline;">일자리 현황 리포트</a>에서 볼 수 있어요.</p>
      </div>`;
}

export function buildJobPostingJsonLd(job, slug, fallbackDate) {
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

export function pageShell({ title, description, slug, path, bodyHtml, jsonLd, noindex }) {
  const url = `${SITE_URL}${path || `/jobs/${slug}.html`}`;
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} | 실버잡</title>
<meta name="description" content="${escapeHtml(description)}">
${noindex ? `<meta name="robots" content="noindex,follow">\n` : ""}<link rel="canonical" href="${url}">
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
      <a href="/guide/">직종별 안내</a>
      <a href="/about.html">실버잡 소개</a>
      <a href="/tips.html">구직 꿀팁</a>
      <a href="/apply-guide.html">지원 방법 가이드</a>
      <a href="/welfare.html">복지정보</a>
      <a href="/faq.html">자주 묻는 질문</a>
      <a href="/report.html">현황 리포트</a>
      <a href="/job-weather.html">일자리 날씨</a>
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
      <p>이메일: contact@silverjob.kr</p>
      <p>사업자등록번호: 344-01-03748</p>
      <p>직업정보제공사업 신고번호: J1800020260020 (경기지방고용노동청)</p>
    </div>
    <div class="footer-links">
      <a href="/#top">홈으로</a>
      <a href="/about.html">실버잡 소개</a>
      <a href="/tips.html">구직 꿀팁</a>
      <a href="/apply-guide.html">지원 방법 가이드</a>
      <a href="/welfare.html">복지정보</a>
      <a href="/faq.html">자주 묻는 질문</a>
      <a href="/report.html">현황 리포트</a>
      <a href="/job-weather.html">일자리 날씨</a>
      <a href="/terms.html">이용약관</a>
      <a href="/privacy.html">개인정보처리방침</a>
      <a href="/partner.html">채용정보 등록 신청</a>
      <a href="/review.html">이용후기 작성</a>
      <a href="/admin/">관리자 로그인</a>
    </div>
  </div>
  <p class="footer-copy">© 2026 실버잡(silverjob.kr) · 운영: 성오테크. All rights reserved.</p>
</footer>

<!-- ===== 외부 사이트 이동 안내 모달 ===== -->
<div class="job-modal-backdrop" id="applyNoticeBackdrop" hidden>
  <div class="job-modal" role="dialog" aria-modal="true" aria-labelledby="applyNoticeTitle" style="max-width:480px;">
    <button type="button" class="job-modal-close" id="applyNoticeClose" aria-label="닫기">✕</button>
    <h2 id="applyNoticeTitle" style="font-size:1.25rem; margin:0 0 12px;">고용24(워크넷)로 이동합니다</h2>
    <p style="margin:0 0 16px;">실버잡을 벗어나 정부가 운영하는 공식 채용 사이트로 연결됩니다. 화면이 낯설게 느껴지시면, 아래 가이드를 먼저 봐주세요.</p>
    <p style="margin:0 0 20px;"><a href="/apply-guide.html" style="text-decoration:underline; font-weight:700;">📖 지원 방법 가이드 보기</a></p>
    <div class="job-modal-actions" style="display:flex; gap:10px; flex-wrap:wrap;">
      <button type="button" class="btn btn-primary btn-lg" id="applyNoticeContinue">계속 이동하기</button>
      <button type="button" class="btn btn-outline btn-lg" id="applyNoticeCancel">닫기</button>
    </div>
  </div>
</div>

<script src="/js/main.js"></script>
</body>
</html>
`;
}

// content/jobs.json + content/jobs-external.json을 합친 원본 배열에서, 상세페이지를
// 만들 수 있는(제목/업체명이 있는) 공고만 남기고 slug 기준 중복을 제거합니다.
// scripts/generate-job-pages.mjs(목록·사이트맵)와 job-page.mjs(상세페이지 조회)가
// 똑같은 목록·슬러그를 보도록 이 함수 하나로 공유합니다.
export function collectValidJobs(combinedJobs) {
  const valid = combinedJobs.filter((j) => j && j.title && j.company);
  const seenSlugs = new Set();
  const entries = [];
  for (const job of valid) {
    const slug = jobSlug(job);
    if (seenSlugs.has(slug)) continue; // 동일 공고 중복 방지
    seenSlugs.add(slug);
    entries.push({ job, slug });
  }
  return entries;
}

export function jobDetailPage(job, slug, fallbackDate) {
  const jsonLd = buildJobPostingJsonLd(job, slug, fallbackDate);
  const applyHref = safeUrl(job.applyUrl, KAKAO_CHANNEL_URL);
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
      ${job.contact ? `<h2 style="font-size:1.1rem;">문의처</h2><p>${escapeHtml(job.contact)}</p>` : ""}
      ${job.source ? `<p style="color:var(--color-text-muted); font-size:.9rem; margin-top:24px;">출처: ${escapeHtml(job.source)}</p>` : ""}

      ${jobTipsHtml(job)}

      <div style="margin-top:28px;">
        <a href="${escapeHtml(applyHref)}" class="btn btn-primary btn-lg"${job.applyUrl ? ' data-external-apply="1"' : ""} data-apply-track="detail" data-slug="${escapeHtml(slug)}" data-region="${escapeHtml(job.region || "")}" data-category="${escapeHtml(job.job || "")}" target="_blank" rel="noopener">${applyLabel}</a>
      </div>
`;

  // 최근에 올라왔고 마감일이 있는 공고만 검색에 엽니다(isIndexableJob). 나머지는 noindex —
  // 사용자·링크 이동(지원하기 등)에는 영향 없습니다.
  return pageShell({
    title: job.title,
    description: truncate(buildDescription(job), 160),
    slug,
    bodyHtml,
    jsonLd,
    noindex: !isIndexableJob(job)
  });
}

// 상세페이지 함수가 4.8MB짜리 전체 공고 파일 대신 작은 조각 하나만 받도록, 빌드 때 공고를
// 슬러그 해시로 256조각(/job-data/00.json ~ ff.json)에 나눠 씁니다. 빌드 스크립트와
// job-page.mjs가 같은 규칙을 쓰도록 이 함수 하나로 공유합니다.
export const JOB_SHARD_DIR = "job-data";

export function jobShard(slug) {
  let h = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h & 0xff).toString(16).padStart(2, "0");
}
