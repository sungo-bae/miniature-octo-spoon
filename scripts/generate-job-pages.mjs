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

function pageShell({ title, description, slug, bodyHtml, jsonLd }) {
  const url = `${SITE_URL}/jobs/${slug}.html`;
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
      <a href="/#how">이용방법</a>
      <a href="/#reviews">이용후기</a>
      <a href="/#notice">공지사항</a>
      <a href="/partner.html" class="nav-cta">채용정보 등록</a>
    </nav>
    <div class="header-tools">
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
        <p style="margin:0 0 8px;"><strong>${escapeHtml(job.region || "")}</strong> ${job.type ? "· " + escapeHtml(job.type) : ""}</p>
        <p style="margin:0; font-weight:800; color:var(--color-primary-dark); font-size:1.2rem;">${escapeHtml(job.pay || "")}</p>
        ${job.deadline ? `<p style="margin:8px 0 0; color:var(--color-text-muted);">마감일: ${escapeHtml(job.deadline)}</p>` : `<p style="margin:8px 0 0; color:var(--color-text-muted);">상시채용</p>`}
      </div>

      ${job.description ? `<h2 style="font-size:1.1rem;">상세 설명</h2><p>${escapeHtml(job.description)}</p>` : ""}
      ${job.requirements ? `<h2 style="font-size:1.1rem;">자격 요건</h2><p>${escapeHtml(job.requirements)}</p>` : ""}
      ${job.preferred ? `<h2 style="font-size:1.1rem;">우대 사항</h2><p>${escapeHtml(job.preferred)}</p>` : ""}
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
        `        <li style="margin-bottom:10px;"><a href="/jobs/${slug}.html">${escapeHtml(job.title)} — ${escapeHtml(job.company)} (${escapeHtml(job.region || "")})</a></li>`
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

function buildSitemap(entries) {
  const staticUrls = [
    { loc: "/", changefreq: "daily", priority: "1.0" },
    { loc: "/partner.html", changefreq: "monthly", priority: "0.6" },
    { loc: "/review.html", changefreq: "monthly", priority: "0.6" },
    { loc: "/terms.html", changefreq: "yearly", priority: "0.3" },
    { loc: "/privacy.html", changefreq: "yearly", priority: "0.3" },
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

  console.log(`generate-job-pages: ${entries.length}개 채용 상세 페이지 생성 완료`);
}

main();
