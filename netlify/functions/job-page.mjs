// 채용 상세페이지(/jobs/<slug>.html)를 요청이 올 때마다 그 자리에서 렌더링합니다.
//
// 예전에는 scripts/generate-job-pages.mjs가 배포될 때마다 공고 수천 건을 전부
// 정적 HTML 파일로 미리 써놨는데, 그 과정이 무거워서 배포 1회당 Netlify 빌드
// 크레딧을 많이 썼습니다(2026-10 초, 닷새 만에 월 크레딧 1,000개를 다 쓴 사태의
// 주원인). 이제는 빌드 시점엔 이 페이지들을 만들지 않고, 실제로 누가 그 URL을
// 열어볼 때만 함수가 즉석에서 같은 HTML을 만들어 돌려줍니다 — 화면에 보이는 내용과
// URL은 전과 완전히 동일합니다.
//
// 라우팅: netlify.toml의 리다이렉트 규칙이 /jobs/* 요청을
// /.netlify/functions/job-page?slug=:splat 로 돌려보냅니다(이미 실제 파일이 있는
// /jobs/index.html은 그 규칙보다 우선해서 그대로 서빙됩니다 — force를 안 썼기 때문).
//
// 데이터는 빌드 시점에 함수 코드 안에 끼워넣지 않고, 홈페이지(js/main.js)가 보는 것과
// 완전히 같은 정적 JSON(/content/jobs.json, /content/jobs-external.json)을 요청마다
// 그대로 가져와서 씁니다. (처음엔 빌드 시점에 import해서 번들에 포함시켰는데, 그렇게
// 하니 실제 배포에서 함수가 보는 데이터와 홈페이지가 보는 최신 데이터가 어긋나는
// 문제가 있어 이 방식으로 바꿨습니다.) 같은 함수 인스턴스가 짧은 시간 안에 여러
// 요청을 처리할 때 매번 다시 받아오지 않도록 몇 분간 메모리에 캐시합니다.

import { collectValidJobs, jobDetailPage, pageShell } from "./lib/job-template.mjs";

const SITE_URL = "https://silverjob.kr";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5분

let cached = null; // { jobBySlug: Map, fallbackDate: string, at: number }

async function fetchJobsFile(path) {
  try {
    const res = await fetch(`${SITE_URL}${path}`);
    if (!res.ok) return { jobs: [] };
    const data = await res.json();
    return { jobs: Array.isArray(data.jobs) ? data.jobs : [], syncedAt: data.syncedAt };
  } catch {
    return { jobs: [] };
  }
}

async function loadJobBySlug() {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached;

  const [adminJobs, externalJobs] = await Promise.all([
    fetchJobsFile("/content/jobs.json"),
    fetchJobsFile("/content/jobs-external.json")
  ]);
  const fallbackDate = (externalJobs.syncedAt || adminJobs.syncedAt || "").slice(0, 10);
  const entries = collectValidJobs(adminJobs.jobs.concat(externalJobs.jobs));

  cached = { jobBySlug: new Map(entries.map((e) => [e.slug, e.job])), fallbackDate, at: Date.now() };
  return cached;
}

function notFoundPage() {
  const bodyHtml = `
      <h1 class="section-title" style="font-size:clamp(1.5rem,3.2vw,2rem);">공고를 찾을 수 없습니다</h1>
      <p class="section-desc">이미 마감되었거나 삭제된 채용정보일 수 있습니다.</p>
      <p><a href="/#jobs" class="btn btn-primary">전체 일자리 보러 가기</a></p>
`;
  return pageShell({
    title: "공고를 찾을 수 없습니다",
    description: "요청하신 채용정보를 찾을 수 없습니다.",
    path: "/jobs/",
    bodyHtml,
    jsonLd: null
  });
}

export default async (req) => {
  const url = new URL(req.url);
  const rawSlug = (url.searchParams.get("slug") || "").trim();
  const slug = rawSlug.replace(/\.html$/i, "");

  const { jobBySlug, fallbackDate } = await loadJobBySlug();
  const job = jobBySlug.get(slug);

  if (!job) {
    return new Response(notFoundPage(), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  return new Response(jobDetailPage(job, slug, fallbackDate), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // 같은 공고를 짧은 시간 안에 여러 번 요청해도 매번 다시 렌더링하지 않도록
      // CDN에서 잠시 캐시합니다. 데이터는 하루 1번 배포될 때만 바뀌므로 넉넉히 둡니다.
      "Netlify-CDN-Cache-Control": "public, max-age=3600"
    }
  });
};
