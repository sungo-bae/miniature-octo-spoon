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

// 2026-10-28: 함수가 켜질 때마다 4.8MB짜리 전체 공고 파일(jobs-external.json)을 받다 보니,
// 구글 크롤러가 한꺼번에 방문하면 시간 제한에 걸려 서버 오류(5xx)가 날 수 있었습니다
// (Search Console에 서버 오류 1,280건 경고). 이제 빌드 때 만든 조각 파일(/job-data/<2자리>.json, 수십 KB) 중 해당 공고가
// 든 조각 하나만 받습니다. 조각이 아직 없는 배포(빌드 전)에서는 예전처럼 전체 파일을 씁니다.

import { collectValidJobs, jobDetailPage, jobShard, pageShell, JOB_SHARD_DIR } from "./lib/job-template.mjs";

const SITE_URL = "https://silverjob.kr";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5분
const FETCH_TIMEOUT_MS = 6000;

const shardCache = new Map(); // shard -> { jobs: {slug: job}, fallbackDate, at }

async function fetchJson(path) {
  const fullUrl = `${SITE_URL}${path}`;
  try {
    const res = await fetch(fullUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      console.log(`job-page: fetch ${fullUrl} -> status ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`job-page: fetch ${fullUrl} failed:`, err && err.message ? err.message : err);
    return null;
  }
}

// 조각 파일이 없을 때만 쓰는 예전 방식 (전체 파일 두 개를 받아 슬러그 목록을 만든다)
async function loadFromFullFiles() {
  const [admin, external] = await Promise.all([
    fetchJson("/content/jobs.json"),
    fetchJson("/content/jobs-external.json")
  ]);
  const list = (x) => (x && Array.isArray(x.jobs) ? x.jobs : []);
  const jobs = {};
  for (const { job, slug } of collectValidJobs(list(admin).concat(list(external)))) jobs[slug] = job;
  return { jobs, fallbackDate: ((external && external.syncedAt) || (admin && admin.syncedAt) || "").slice(0, 10) };
}

async function loadShard(slug) {
  const key = jobShard(slug);
  const hit = shardCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;
  const data = (await fetchJson(`/${JOB_SHARD_DIR}/${key}.json`)) || (await loadFromFullFiles());
  const entry = { jobs: data.jobs || {}, fallbackDate: data.fallbackDate || "", at: Date.now() };
  shardCache.set(key, entry);
  return entry;
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
    jsonLd: null,
    noindex: true
  });
}

export default async (req) => {
  const url = new URL(req.url);
  // netlify.toml의 리다이렉트가 /jobs/* 요청을 이 함수로 그대로 돌려보내는데,
  // req.url은 원래 요청 경로(예: /jobs/job-xxxxxxxx.html)를 그대로 유지합니다
  // (":splat"을 쿼리스트링으로 넘기는 방식은 실제 운영 환경에서 값이 비어
  // 전달되는 문제가 있어, 쿼리스트링 없이 경로에서 직접 슬러그를 뽑습니다).
  const pathMatch = url.pathname.match(/\/jobs\/([^/]+)\.html$/);
  const slug = pathMatch ? pathMatch[1] : "";
  console.log(`job-page: 요청 url=${req.url} pathname=${url.pathname} slug=${JSON.stringify(slug)}`);

  const { jobs, fallbackDate } = slug ? await loadShard(slug) : { jobs: {}, fallbackDate: "" };
  const job = Object.prototype.hasOwnProperty.call(jobs, slug) ? jobs[slug] : null;
  console.log(`job-page: slug=${slug} found=${!!job}`);

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
