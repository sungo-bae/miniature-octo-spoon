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

// 2026-11-17: 응답 코드를 상황에 맞게 나눕니다.
// - 200: 공고가 있음
// - 410: 조각 파일과 Supabase를 모두 확인했는데 공고가 없음 = 마감·삭제된 공고.
//        410은 "일부러 지움"이라는 뜻이라 구글이 404보다 빨리 검색 목록에서 뺍니다.
// - 404: 주소 형식부터 공고 주소가 아님
// - 503: 데이터를 읽다가 실패해 공고가 있는지 모름(잠시 뒤 다시 오라는 뜻, Retry-After).
//        예전에는 이런 경우에도 "없음"으로 처리하거나, 받아오기를 6초씩 여러 번 기다리다
//        함수 시간 제한에 걸려 서버 오류(5xx)가 났습니다. 이제 받아오기마다 짧게 끊고
//        전체 시간도 정해 두어 제한 시간 안에 반드시 답합니다.

import { collectValidJobs, jobDetailPage, jobShard, pageShell, JOB_SHARD_DIR, escapeHtml } from "./lib/job-template.mjs";

const SITE_URL = "https://silverjob.kr";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5분
const FETCH_TIMEOUT_MS = 3000; // 받아오기 한 번에 쓰는 최대 시간
const SAMPLE_TIMEOUT_MS = 1500; // 마감 안내 화면의 추천 공고는 늦으면 빼고 보냄
const GONE_CACHE = "public, max-age=21600"; // 마감 응답(410)은 CDN에 6시간 저장 — 크롤러 재방문을 빠르게

const shardCache = new Map(); // shard -> { jobs: {slug: job}, fallbackDate, at }

// 결과를 { ok, missing, data } 로 돌려줍니다. missing은 서버가 "그런 파일 없음(404)"이라고 확실히
// 답한 경우, ok=false·missing=false는 시간 초과·네트워크 오류처럼 결과를 모르는 경우입니다.
async function fetchJsonResult(path, timeoutMs = FETCH_TIMEOUT_MS) {
  const fullUrl = `${SITE_URL}${path}`;
  try {
    const res = await fetch(fullUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      console.log(`job-page: fetch ${fullUrl} -> status ${res.status}`);
      return { ok: false, missing: res.status === 404, data: null };
    }
    return { ok: true, missing: false, data: await res.json() };
  } catch (err) {
    console.error(`job-page: fetch ${fullUrl} failed:`, err && err.message ? err.message : err);
    return { ok: false, missing: false, data: null };
  }
}

async function fetchJson(path, timeoutMs) {
  return (await fetchJsonResult(path, timeoutMs)).data;
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
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit, ok: true };
  const r = await fetchJsonResult(`/${JOB_SHARD_DIR}/${key}.json`);
  let data = r.data;
  // 조각 파일이 "없다"고 확실히 답한 배포에서만 예전 방식(전체 파일)으로 찾습니다.
  // 시간 초과일 때 4.8MB 파일까지 받으려 하면 함수 제한 시간을 넘기기 쉬워서입니다.
  if (!r.ok && r.missing) data = await loadFromFullFiles();
  if (!data) return { jobs: {}, fallbackDate: "", ok: false }; // 실패는 캐시하지 않음
  const entry = { jobs: data.jobs || {}, fallbackDate: data.fallbackDate || "", at: Date.now() };
  shardCache.set(key, entry);
  return { ...entry, ok: true };
}

// 검색엔진에 남아있는 옛 링크로 들어온 분이 빈손으로 돌아가지 않도록, 지금 올라와
// 있는 공고 몇 건을 대신 보여드립니다(어떤 직종을 찾으셨는지는 알 수 없어서,
// 고정된 조각 파일(00번) 하나에서 뽑은 표본입니다 — 슬러그가 해시 기반이라
// 특정 조각에 공고가 쏠리지 않습니다).
const SAMPLE_SHARD_KEY = "00";
async function sampleCurrentJobs() {
  try {
    const hit = shardCache.get(SAMPLE_SHARD_KEY);
    const data = hit && Date.now() - hit.at < CACHE_TTL_MS ? hit : await fetchJson(`/${JOB_SHARD_DIR}/${SAMPLE_SHARD_KEY}.json`, SAMPLE_TIMEOUT_MS);
    if (!data || !data.jobs) return [];
    if (!hit) shardCache.set(SAMPLE_SHARD_KEY, { jobs: data.jobs, fallbackDate: data.fallbackDate || "", at: Date.now() });
    return Object.entries(data.jobs)
      .slice(0, 4)
      .map(([slug, job]) => ({ slug, job }));
  } catch {
    return [];
  }
}

function notFoundPage(samples, gone = false) {
  const sampleHtml = samples && samples.length
    ? `
      <h2 style="font-size:1.05rem; margin-top:28px;">대신 이런 공고는 어떠세요?</h2>
      <ul style="list-style:disc; padding-left:1.2em; margin:8px 0 0;">
${samples.map(({ slug, job }) => `        <li style="margin-bottom:6px;"><a href="/jobs/${slug}.html">${escapeHtml(job.title || "")} — ${escapeHtml(job.company || "")}</a></li>`).join("\n")}
      </ul>`
    : "";
  const bodyHtml = `
      <h1 class="section-title" style="font-size:clamp(1.5rem,3.2vw,2rem);">${gone ? "마감된 공고입니다" : "공고를 찾을 수 없습니다"}</h1>
      <p class="section-desc">${gone ? "이 채용정보는 마감되었거나 원문에서 내려갔습니다." : "이미 마감되었거나 삭제된 채용정보일 수 있습니다."}</p>
      <p><a href="/#jobs" class="btn btn-primary">전체 일자리 보러 가기</a></p>
${sampleHtml}
`;
  return pageShell({
    title: gone ? "마감된 공고입니다" : "공고를 찾을 수 없습니다",
    description: gone ? "마감되었거나 원문에서 내려간 채용정보입니다." : "요청하신 채용정보를 찾을 수 없습니다.",
    path: "/jobs/",
    bodyHtml,
    jsonLd: null,
    noindex: true
  });
}

// 빌드 때 만든 조각 파일에 없는 공고는, 매일 아침 전체 고용24 공고를 모아 두는 Supabase
// (mv_site_jobs, 사이트 JSON과 같은 모양)에서 찾습니다. 홈 화면 목록이 이 자료를 쓰므로,
// 목록에서 연 공고의 상세 페이지도 여기서 찾아야 링크가 끊기지 않습니다.
const SUPABASE_REST = "https://idngidaxescxuyjzirob.supabase.co/rest/v1/";
const SUPABASE_KEY = "sb_publishable_hGMZ7IU3qZZc3jGzUP1ySQ_h1eRn7m0"; // 공개(publishable) 키, 읽기 전용

// { ok, job }: ok=false는 조회 자체가 실패해 공고가 있는지 모르는 경우입니다.
async function fetchSupabaseJob(slug) {
  try {
    const url = `${SUPABASE_REST}mv_site_jobs?select=*&slug=eq.${encodeURIComponent(slug)}&limit=1`;
    const res = await fetch(url, { headers: { apikey: SUPABASE_KEY }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      console.log(`job-page: Supabase 조회 status ${res.status}`);
      return { ok: false, job: null };
    }
    const rows = await res.json();
    return { ok: true, job: (Array.isArray(rows) && rows[0]) || null };
  } catch (err) {
    console.error("job-page: Supabase 조회 실패:", err && err.message ? err.message : err);
    return { ok: false, job: null };
  }
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

  const validSlug = /^job-[0-9a-f]{8}$/.test(slug);
  const shard = validSlug ? await loadShard(slug) : { jobs: {}, fallbackDate: "", ok: true };
  let job = Object.prototype.hasOwnProperty.call(shard.jobs, slug) ? shard.jobs[slug] : null;
  let postedDate = shard.fallbackDate;
  let lookupFailed = !shard.ok;
  if (!job && validSlug) {
    const sb = await fetchSupabaseJob(slug);
    if (sb.job) {
      job = sb.job;
      postedDate = job.datePosted || shard.fallbackDate;
      lookupFailed = false;
    } else if (!sb.ok) {
      lookupFailed = true;
    }
  }
  console.log(`job-page: slug=${slug} found=${!!job} lookupFailed=${lookupFailed}`);

  // 정적 페이지와 같은 보안 설정 (netlify.toml의 [[headers]]는 함수 응답에 적용되지 않음)
  const securityHeaders = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "frame-ancestors 'self'; base-uri 'self'; object-src 'none'"
  };

  if (!job && validSlug && lookupFailed) {
    // 공고가 있는지 확인하지 못함: "없음"으로 잘못 알리지 않고 잠시 뒤 다시 오게 합니다.
    return new Response(pageShell({
      title: "잠시 후 다시 시도해 주세요",
      description: "일시적으로 채용정보를 불러오지 못했습니다.",
      path: "/jobs/",
      bodyHtml: `
      <h1 class="section-title" style="font-size:clamp(1.5rem,3.2vw,2rem);">잠시 후 다시 시도해 주세요</h1>
      <p class="section-desc">일시적으로 채용정보를 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.</p>
      <p><a href="/#jobs" class="btn btn-primary">전체 일자리 보러 가기</a></p>
`,
      jsonLd: null,
      noindex: true
    }), {
      status: 503,
      headers: { ...securityHeaders, "Content-Type": "text/html; charset=utf-8", "Retry-After": "120", "Cache-Control": "no-store" }
    });
  }

  if (!job) {
    const samples = await sampleCurrentJobs();
    // 형식이 맞는 공고 주소인데 어디에도 없으면 마감·삭제된 공고 → 410(검색에서 빨리 빠짐)
    const gone = validSlug;
    return new Response(notFoundPage(samples, gone), {
      status: gone ? 410 : 404,
      headers: {
        ...securityHeaders,
        "Content-Type": "text/html; charset=utf-8",
        ...(gone ? { "Netlify-CDN-Cache-Control": GONE_CACHE } : {})
      }
    });
  }

  return new Response(jobDetailPage(job, slug, postedDate), {
    status: 200,
    headers: {
      ...securityHeaders,
      "Content-Type": "text/html; charset=utf-8",
      // 같은 공고를 짧은 시간 안에 여러 번 요청해도 매번 다시 렌더링하지 않도록
      // CDN에서 잠시 캐시합니다. 데이터는 하루 1번 배포될 때만 바뀌므로 넉넉히 둡니다.
      "Netlify-CDN-Cache-Control": "public, max-age=3600"
    }
  });
};
