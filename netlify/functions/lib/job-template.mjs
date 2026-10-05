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

export function pageShell({ title, description, slug, path, bodyHtml, jsonLd }) {
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
