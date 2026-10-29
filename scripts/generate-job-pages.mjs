// 배포될 때마다(코드 푸시든, work24 자동 동기화 커밋이든, 관리자 CMS 등록이든) 실행되는
// 빌드 스크립트입니다. 채용공고 1건당 상세페이지(/jobs/<slug>.html, JobPosting
// JSON-LD 포함)는 더 이상 여기서 미리 만들지 않습니다 — 수천 건을 매 배포마다 전부
// 파일로 쓰면 빌드가 무거워져서 Netlify 빌드 크레딧을 많이 썼습니다. 대신
// netlify/functions/job-page.mjs가 요청이 올 때 같은 데이터로 그 자리에서 렌더링합니다
// (URL과 화면은 전과 동일, 크롤러 입장에서도 똑같은 200 응답의 정적 페이지처럼 보입니다).
// 이 스크립트는 그보다 가벼운 목록(/jobs/index.html)·사이트맵·리포트 페이지만 만듭니다.

import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SITE_URL, escapeHtml, jobRegionLabel, pageShell, collectValidJobs, jobShard, JOB_SHARD_DIR } from "../netlify/functions/lib/job-template.mjs";

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

// 공고 상세페이지(/jobs/<slug>.html)는 사이트맵에 넣지 않습니다. work24 공고 상당수는
// description이 비어있어 내용이 얇은데, 수천 건을 전부 구글에 색인 요청하면 저품질/중복
// 콘텐츠로 비칠 위험이 있습니다(실제로 이게 애드센스 심사에서 문제가 됐을 가능성이 큽니다).
// 해당 페이지들에는 noindex도 걸려있어(job-template.mjs 참고), 여기서 빼는 것과 함께
// "실버잡이 직접 쓴 콘텐츠"만 색인 대상으로 남도록 합니다.
function buildSitemap() {
  const staticUrls = [
    { loc: "/", changefreq: "daily", priority: "1.0" },
    { loc: "/about.html", changefreq: "monthly", priority: "0.6" },
    { loc: "/tips.html", changefreq: "monthly", priority: "0.6" },
    { loc: "/apply-guide.html", changefreq: "monthly", priority: "0.6" },
    { loc: "/welfare.html", changefreq: "weekly", priority: "0.6" },
    { loc: "/faq.html", changefreq: "monthly", priority: "0.6" },
    { loc: "/partner.html", changefreq: "monthly", priority: "0.6" },
    { loc: "/review.html", changefreq: "monthly", priority: "0.6" },
    { loc: "/terms.html", changefreq: "yearly", priority: "0.3" },
    { loc: "/privacy.html", changefreq: "yearly", priority: "0.3" },
    { loc: "/report.html", changefreq: "daily", priority: "0.7" },
    { loc: "/job-weather.html", changefreq: "daily", priority: "0.7" },
    { loc: "/jobs/index.html", changefreq: "daily", priority: "0.7" }
  ];

  const body = staticUrls
    .map(
      (u) =>
        `  <url>\n    <loc>${SITE_URL}${u.loc}</loc>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

// 상세페이지 함수(job-page.mjs)가 읽는 공고 조각 파일. 함수가 켜질 때마다 4.8MB짜리 전체
// 파일을 받다가 시간 제한에 걸려 서버 오류(5xx)가 나던 것을, 수십 KB짜리 조각 하나로 줄입니다.
function writeJobShards(entries, fallbackDate) {
  const dir = join(ROOT, JOB_SHARD_DIR);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const shards = new Map();
  for (const { job, slug } of entries) {
    const key = jobShard(slug);
    if (!shards.has(key)) shards.set(key, {});
    shards.get(key)[slug] = job;
  }
  // 공고가 없는 조각도 빈 파일로 써서, 함수가 "조각 없음"과 "공고 없음"을 구분할 필요가 없게 합니다.
  for (let i = 0; i < 256; i++) {
    const key = i.toString(16).padStart(2, "0");
    writeFileSync(join(dir, `${key}.json`), JSON.stringify({ fallbackDate, jobs: shards.get(key) || {} }), "utf-8");
  }
}

function main() {
  const adminJobs = readJobsFile(join(ROOT, "content", "jobs.json"));
  const externalJobs = readJobsFile(join(ROOT, "content", "jobs-external.json"));

  const combined = adminJobs.jobs.concat(externalJobs.jobs);
  // 채용 상세페이지(/jobs/<slug>.html)는 더 이상 빌드 시점에 미리 만들지 않습니다
  // (수천 건을 매 배포마다 전부 파일로 쓰면 빌드가 무거워져서 Netlify 빌드 크레딧을
  // 많이 썼습니다). 대신 netlify/functions/job-page.mjs가 요청이 올 때 같은 데이터로
  // 그때그때 렌더링합니다. 여기서는 목록·사이트맵처럼 가벼운 페이지만 만듭니다.
  const entries = collectValidJobs(combined);

  // /jobs/ 에는 index.html 하나만 남기면 되므로 통째로 비우고 다시 만듭니다.
  rmSync(JOBS_DIR, { recursive: true, force: true });
  mkdirSync(JOBS_DIR, { recursive: true });
  writeFileSync(join(JOBS_DIR, "index.html"), jobIndexPage(entries), "utf-8");
  writeFileSync(join(ROOT, "sitemap.xml"), buildSitemap(), "utf-8");
  writeJobShards(entries, (externalJobs.syncedAt || adminJobs.syncedAt || "").slice(0, 10));

  // /report.html 은 더 이상 여기서 만들지 않습니다. 매일 아침 전체 공고로 계산하는
  // 실버잡 데이터 분석(일자리 현황 리포트)을 끼워 넣은 정적 페이지입니다.

  console.log(`generate-job-pages: ${entries.length}건 집계 완료 (상세페이지는 요청 시 동적 렌더링)`);
}

main();
