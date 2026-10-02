// 워크넷/고용24(work24.go.kr) 채용정보 Open API를 주기적으로 가져와서
// content/jobs-external.json을 자동 갱신하는 Netlify 예약 함수(Scheduled Function)입니다.
//
// API: 한국고용정보원_워크넷 채용정보 채용목록 및 상세정보 (data.go.kr)
// 요청 URL: https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L01.do
// 응답 형식: XML만 지원 (JSON 미지원) — 공식 문서의 "4. 출력결과" 스펙을 그대로 반영했습니다.
//
// 켜려면 Netlify 프로젝트 → Environment variables에 아래 값을 등록하세요:
//   WORK24_API_KEY   - data.go.kr에서 발급받은 인증키(authKey)
//   GITHUB_TOKEN     - 이 저장소에 쓰기 권한이 있는 GitHub Personal Access Token
//   GITHUB_REPO      - "sungo-bae/miniature-octo-spoon" (기본값, 생략 가능)
//   GITHUB_BRANCH    - "main" (기본값, 생략 가능)
// 값이 없으면 이 함수는 아무것도 하지 않고 조용히 종료합니다(에러 아님).

import { extractTag } from "./lib/xml-utils.mjs";

const GITHUB_API = "https://api.github.com";
const TARGET_PATH = "content/jobs-external.json";
const WORK24_LIST_URL = "https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L01.do";

function splitWantedBlocks(xml) {
  const matches = xml.match(/<wanted>[\s\S]*?<\/wanted>/g);
  return matches || [];
}

function extractTotal(xml) {
  const n = parseInt(extractTag(xml, "total"), 10);
  return isNaN(n) ? 0 : n;
}

// 워크넷 지역 텍스트 -> 사이트에서 쓰는 7개 권역으로 단순 매핑 (필요시 보완)
function mapRegion(rawRegion) {
  if (!rawRegion) return "";
  const r = rawRegion;
  if (r.includes("서울")) return "서울";
  if (r.includes("인천") || r.includes("경기")) return "경기·인천";
  if (r.includes("부산") || r.includes("경남") || r.includes("울산")) return "부산·경남";
  if (r.includes("대구") || r.includes("경북")) return "대구·경북";
  if (r.includes("광주") || r.includes("전남") || r.includes("전북")) return "광주·전라";
  if (r.includes("대전") || r.includes("충남") || r.includes("충북") || r.includes("세종")) return "대전·충청";
  if (r.includes("강원")) return "강원";
  if (r.includes("제주")) return "제주";
  return "";
}

// 1차 필터는 work24 API 자체의 "(준)고령자(50세 이상) 우대" 조건(pfPreferential=8)이
// 맡고 있습니다(아래 fetchWork24Page 참고). 이 함수는 그 이후에도 혹시 섞여 들어올 수 있는,
// 제목만으로도 시니어 일자리와 무관하다고 확신할 수 있는 공고(어린이집/유치원 교사, 수영강사,
// 생산직, 일반 제조·건설·영업 관리직 등)를 한 번 더 걸러내는 보조 안전장치입니다.
function isSeniorUnrelated(title) {
  return /어린이집|유치원|보육교사|보육사|수영강사|생산직|생산팀|품질관리|자동화설비|토목|엔지니어|시공|건설산업안전|산업안전관리자|공장|폐수처리|기술영업|영업관리|현장관리자|설계/.test(title || "");
}

// 채용 제목/업종 텍스트에서 사이트의 6개 카테고리로 단순 키워드 매핑 (필요시 보완)
// 업종코드(indTpNm)는 실제 업무와 무관한 넓은 분류라서 오탐이 많아 더 이상 쓰지 않고,
// 제목(title)만으로 판단합니다. "관리"·"설비"·"안전" 같은 단어 하나만으로는 매칭하지 않도록
// (품질관리·영업관리·산업안전관리자 같은 일반 기업 관리직과 섞이지 않게) 구체적인 단어 조합만 둡니다.
// 시니어 채용 사이트 취지에 맞게, 어느 카테고리에도 매칭되지 않는 공고는 null을 반환해
// 아예 목록에서 제외합니다.
function mapJobCategory(title) {
  if (isSeniorUnrelated(title)) return null;
  const text = title || "";
  if (/경비|보안|주차|지킴이/.test(text)) return "경비안전";
  if (/청소|미화|환경/.test(text)) return "미화";
  if (/조리|급식|주방|영양사/.test(text)) return "조리";
  if (/사무|행정|접수|안내/.test(text)) return "사무보조";
  if (/시설|아파트|건물|빌딩|관리사무소|주택관리|공동주택/.test(text)) return "시설관리";
  if (/공헌|봉사|돌봄|복지|요양|간병|보호사/.test(text)) return "사회공헌";
  return null;
}

// "3000만원 ~ 3000만원"처럼 최소·최대가 동일한 급여 범위를 단일 값으로 정리
function formatPay(raw) {
  if (!raw) return raw;
  const m = raw.match(/^(.+?)\s*~\s*(.+)$/);
  if (m && m[1].trim() === m[2].trim()) return m[1].trim();
  return raw;
}

// regDt(등록일자, YYYYMMDD 또는 YYYY-MM-DD 형태로 추정) 기준 최근 3일 이내면 신규 표시
function isRecent(regDt) {
  if (!regDt) return false;
  const digits = regDt.replace(/[^0-9]/g, "");
  if (digits.length < 8) return false;
  const y = digits.slice(0, 4), m = digits.slice(4, 6), d = digits.slice(6, 8);
  const posted = new Date(`${y}-${m}-${d}T00:00:00+09:00`);
  if (isNaN(posted.getTime())) return false;
  const diffDays = (Date.now() - posted.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays <= 3;
}

function formatDeadline(closeDt) {
  const digits = (closeDt || "").replace(/[^0-9]/g, "");
  if (digits.length < 8) return "";
  return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`;
}

// 구글 일자리 검색(JobPosting)의 datePosted에 쓸 ISO 날짜(YYYY-MM-DD)
function formatIsoDate(rawDt) {
  const digits = (rawDt || "").replace(/[^0-9]/g, "");
  if (digits.length < 8) return "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function mapWantedBlock(block) {
  const title = extractTag(block, "title");
  const minEdubg = extractTag(block, "minEdubg");
  const maxEdubg = extractTag(block, "maxEdubg");
  const career = extractTag(block, "career");
  const requirementsParts = [];
  if (minEdubg) requirementsParts.push("학력: " + minEdubg + (maxEdubg && maxEdubg !== minEdubg ? " ~ " + maxEdubg : ""));
  if (career) requirementsParts.push("경력: " + career);

  return {
    id: extractTag(block, "wantedAuthNo"),
    infoSvc: extractTag(block, "infoSvc"),
    title,
    company: extractTag(block, "company"),
    region: mapRegion(extractTag(block, "region")),
    job: mapJobCategory(title),
    type: extractTag(block, "holidayTpNm"),
    pay: formatPay(extractTag(block, "sal") || extractTag(block, "salTpNm")),
    isNew: isRecent(extractTag(block, "regDt")),
    datePosted: formatIsoDate(extractTag(block, "regDt")),
    description: "", // 목록 API는 상세 설명을 제공하지 않습니다 — 지원하기 링크(원문)에서 확인
    requirements: requirementsParts.join(" · ") || "채용공고 원문 참고",
    preferred: "",
    address: [extractTag(block, "basicAddr"), extractTag(block, "detailAddr")].filter(Boolean).join(" "),
    contact: "",
    applyUrl: extractTag(block, "wantedInfoUrl"),
    deadline: formatDeadline(extractTag(block, "closeDt")),
    source: "워크넷"
  };
}

const PAGE_DISPLAY = 100; // work24 쪽에서 한 페이지당 허용하는 최대 건수
const FALLBACK_PAGE_COUNT = 5; // total을 못 읽었을 때 대비한 기본값
const MAX_PAGES = 150; // 상한선(최대 15,000건) — 보통은 아래 시간 예산에 먼저 걸립니다
const BATCH_SIZE = 20; // 한 번에 동시 요청할 페이지 수 (20개 동시 요청은 안정적으로 동작 확인됨)
const FETCH_TIME_BUDGET_MS = 15000; // Netlify 함수 실행시간 제한에 걸리지 않도록, 조회 단계에 쓸 시간을
// 미리 정해두고 그 안에서 되는 만큼만 가져옵니다(이후 GitHub 커밋 단계에 쓸 여유를 남겨둠).
// 가져오다 만 날도 있을 수 있지만, 커밋은 조회가 다 끝난 뒤 한 번에 하므로 실패해도 그날 하루
// 갱신이 건너뛰어질 뿐 데이터가 깨지지 않습니다 — 다음날 다시 시도됩니다.

async function fetchWork24Page(apiKey, page) {
  const url = new URL(WORK24_LIST_URL);
  url.searchParams.set("authKey", apiKey);
  url.searchParams.set("callTp", "L");
  url.searchParams.set("returnType", "XML");
  url.searchParams.set("startPage", String(page));
  url.searchParams.set("display", String(PAGE_DISPLAY));
  // work24가 공식적으로 "(준)고령자(50세 이상) 우대"로 분류한 공고만 받아옵니다.
  // 기존에는 제목 키워드로 시니어 일자리 여부를 추측했는데, work24가 이미 이 조건을
  // 공고 등록 시점에 분류해두고 있어서 훨씬 정확하고, 전체 풀도 크게 줄어듭니다
  // (전국 13만여 건 중 일부라, 제주처럼 공고량이 적은 지역도 누락될 확률이 낮아집니다).
  url.searchParams.set("pfPreferential", "8");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("work24 API request failed: " + res.status);
  const xml = await res.text();
  return { blocks: splitWantedBlocks(xml), total: extractTotal(xml) };
}

async function fetchWork24Jobs(apiKey) {
  const startedAt = Date.now();

  // 1페이지를 먼저 조회해 전체 건수(total)를 확인합니다.
  // (전체 건수를 못 읽는 예외 상황이면 기존처럼 고정 페이지 수로 대체합니다.)
  const first = await fetchWork24Page(apiKey, 1);
  // 임시 디버그: datePosted가 전부 비어있는 문제의 원인 확인용 — 원인 파악 후 제거할 코드입니다.
  if (first.blocks[0]) {
    console.log("sync-work24-jobs DEBUG first block:", first.blocks[0].slice(0, 1500));
  }
  const totalPages = first.total
    ? Math.min(Math.ceil(first.total / PAGE_DISPLAY), MAX_PAGES)
    : FALLBACK_PAGE_COUNT;

  // 남은 페이지를 BATCH_SIZE개씩 동시 조회하면서, 매 묶음 전에 남은 시간 예산을 확인합니다.
  // 시간이 다 되면 그때까지 모은 페이지만 쓰고 더 요청하지 않습니다.
  const pageResults = [first];
  let nextPage = 2;
  let stoppedEarly = false;
  while (nextPage <= totalPages) {
    if (Date.now() - startedAt > FETCH_TIME_BUDGET_MS) {
      stoppedEarly = true;
      break;
    }
    const batchEnd = Math.min(nextPage + BATCH_SIZE - 1, totalPages);
    const batchPromises = [];
    for (let page = nextPage; page <= batchEnd; page++) {
      batchPromises.push(fetchWork24Page(apiKey, page));
    }
    pageResults.push(...(await Promise.all(batchPromises)));
    nextPage = batchEnd + 1;
  }

  const fetchedPages = pageResults.length;
  console.log(
    `sync-work24-jobs: work24 전체 ${first.total}건 중 ${fetchedPages}페이지(최대 ${fetchedPages * PAGE_DISPLAY}건) 조회` +
      (stoppedEarly ? ` — 시간 예산(${FETCH_TIME_BUDGET_MS}ms) 도달로 중단` : "")
  );

  const allBlocks = pageResults.flatMap((p) => p.blocks);

  // 페이지 간 중복(원문 링크 기준)을 제거합니다.
  const seen = new Set();
  const jobs = allBlocks
    .map(mapWantedBlock)
    .filter((j) => j.title && j.company && j.job)
    .filter((j) => {
      const key = j.applyUrl || j.title + "|" + j.company + "|" + j.region;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  // 이미 마감된 공고는 제외
  const today = new Date();
  return jobs.filter((j) => {
    if (!j.deadline) return true;
    const d = new Date(j.deadline.replace(/\./g, "-"));
    return isNaN(d.getTime()) || d >= today;
  });
}

async function commitToGitHub({ token, repo, branch, jobs }) {
  const [owner, name] = repo.split("/");
  const getUrl = `${GITHUB_API}/repos/${owner}/${name}/contents/${TARGET_PATH}?ref=${branch}`;

  const getRes = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }
  });
  if (!getRes.ok) throw new Error("failed to read existing file: " + getRes.status);
  const existing = await getRes.json();

  const content = JSON.stringify(
    { jobs, syncedAt: new Date().toISOString(), note: "워크넷 Open API에서 자동으로 가져온 데이터입니다." },
    null,
    2
  );

  const putRes = await fetch(`${GITHUB_API}/repos/${owner}/${name}/contents/${TARGET_PATH}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({
      message: "chore: sync jobs from work24 (automated)",
      content: Buffer.from(content, "utf-8").toString("base64"),
      sha: existing.sha,
      branch
    })
  });
  if (!putRes.ok) throw new Error("failed to commit updated file: " + putRes.status);
}

export default async () => {
  const apiKey = process.env.WORK24_API_KEY;
  const githubToken = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || "sungo-bae/miniature-octo-spoon";
  const branch = process.env.GITHUB_BRANCH || "main";

  if (!apiKey || !githubToken) {
    console.log("sync-work24-jobs: WORK24_API_KEY 또는 GITHUB_TOKEN이 설정되지 않아 건너뜁니다.");
    return new Response("skipped: missing env vars", { status: 200 });
  }

  try {
    const jobs = await fetchWork24Jobs(apiKey);
    await commitToGitHub({ token: githubToken, repo, branch, jobs });
    console.log(`sync-work24-jobs: ${jobs.length}건 동기화 완료`);
    return new Response(`synced ${jobs.length} jobs`, { status: 200 });
  } catch (err) {
    console.error("sync-work24-jobs failed:", err);
    return new Response("error: " + err.message, { status: 500 });
  }
};

// 매일 새벽 3시(KST 기준 UTC 18시)에 자동 실행. 필요시 조정하세요.
export const config = {
  schedule: "0 18 * * *"
};
