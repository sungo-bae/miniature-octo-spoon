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

const GITHUB_API = "https://api.github.com";
const TARGET_PATH = "content/jobs-external.json";
const WORK24_LIST_URL = "https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L01.do";

/* ---------------- 아주 단순한 XML 파서 ----------------
   워크넷 응답 구조가 단순(중첩 없는 필드로만 구성)해서 정규식으로 충분합니다. */
function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return m ? unescapeXml(m[1].trim()) : "";
}

function unescapeXml(str) {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function splitWantedBlocks(xml) {
  const matches = xml.match(/<wanted>[\s\S]*?<\/wanted>/g);
  return matches || [];
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
  return "";
}

// 채용 제목/업종 텍스트에서 사이트의 6개 카테고리로 단순 키워드 매핑 (필요시 보완)
function mapJobCategory(title, indTpNm) {
  const text = (title || "") + " " + (indTpNm || "");
  if (/경비|보안|안전/.test(text)) return "경비안전";
  if (/청소|미화|환경/.test(text)) return "미화";
  if (/조리|급식|주방/.test(text)) return "조리";
  if (/사무|행정|접수|안내/.test(text)) return "사무보조";
  if (/시설|관리|보수|설비/.test(text)) return "시설관리";
  if (/공헌|봉사|돌봄|복지/.test(text)) return "사회공헌";
  return "사무보조";
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

function mapWantedBlock(block) {
  const title = extractTag(block, "title");
  const indTpNm = extractTag(block, "indTpNm");
  const minEdubg = extractTag(block, "minEdubg");
  const maxEdubg = extractTag(block, "maxEdubg");
  const career = extractTag(block, "career");
  const requirementsParts = [];
  if (minEdubg) requirementsParts.push("학력: " + minEdubg + (maxEdubg && maxEdubg !== minEdubg ? " ~ " + maxEdubg : ""));
  if (career) requirementsParts.push("경력: " + career);

  return {
    title,
    company: extractTag(block, "company"),
    region: mapRegion(extractTag(block, "region")),
    job: mapJobCategory(title, indTpNm),
    type: extractTag(block, "holidayTpNm"),
    pay: extractTag(block, "sal") || extractTag(block, "salTpNm"),
    isNew: isRecent(extractTag(block, "regDt")),
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

async function fetchWork24Jobs(apiKey) {
  const url = new URL(WORK24_LIST_URL);
  url.searchParams.set("authKey", apiKey);
  url.searchParams.set("callTp", "L");
  url.searchParams.set("returnType", "XML");
  url.searchParams.set("startPage", "1");
  url.searchParams.set("display", "100");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("work24 API request failed: " + res.status);
  const xml = await res.text();

  const blocks = splitWantedBlocks(xml);
  const jobs = blocks.map(mapWantedBlock).filter((j) => j.title && j.company);

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
