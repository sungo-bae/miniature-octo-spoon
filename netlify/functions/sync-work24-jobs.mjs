// 워크넷/고용24(work24.go.kr) 공공 채용정보 Open API를 주기적으로 가져와서
// content/jobs-external.json을 자동 갱신하는 Netlify 예약 함수(Scheduled Function)입니다.
//
// ⚠️ 아직 실제로 켜지지 않은 상태입니다. 이 함수가 실제로 동작하려면:
//   1. 공공데이터포털(data.go.kr)에서 워크넷/고용24 채용정보 Open API 활용신청 후 인증키 발급
//   2. GitHub에서 이 저장소에 쓰기 권한이 있는 Personal Access Token 발급
//   3. Netlify 프로젝트 → Environment variables에 아래 값 등록:
//        WORK24_API_KEY   - 발급받은 인증키
//        GITHUB_TOKEN     - GitHub Personal Access Token (repo 쓰기 권한)
//        GITHUB_REPO      - "sungo-bae/miniature-octo-spoon" (기본값, 생략 가능)
//        GITHUB_BRANCH    - "main" (기본값, 생략 가능)
//
// API 응답 형식은 실제 발급 후 받는 문서/샘플 응답을 보고 mapWork24Item()을
// 다시 맞춰야 할 가능성이 높습니다 (공공 API 문서 접근이 지금 이 환경에서
// 막혀 있어 최신 스펙을 직접 확인하지 못한 상태로 작성했습니다).

const GITHUB_API = "https://api.github.com";
const TARGET_PATH = "content/jobs-external.json";

// 워크넷 지역명 -> 사이트에서 쓰는 7개 권역으로 단순 매핑 (필요시 보완)
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

// 직종명 텍스트에서 사이트의 6개 카테고리로 단순 키워드 매핑 (필요시 보완)
function mapJobCategory(rawTitle, rawJobName) {
  const text = (rawTitle || "") + " " + (rawJobName || "");
  if (/경비|보안|안전/.test(text)) return "경비안전";
  if (/청소|미화|환경/.test(text)) return "미화";
  if (/조리|급식|주방/.test(text)) return "조리";
  if (/사무|행정|접수|안내/.test(text)) return "사무보조";
  if (/시설|관리|보수|설비/.test(text)) return "시설관리";
  if (/공헌|봉사|돌봄|복지/.test(text)) return "사회공헌";
  return "사무보조";
}

// ⚠️ 실제 API 응답 필드명은 발급 후 확인 필요. 아래는 최선 추정입니다.
function mapWork24Item(item) {
  return {
    title: item.title || item.wantedTitle || "",
    company: item.company || item.corpNm || "",
    region: mapRegion(item.region || item.workPlaceRegion || ""),
    job: mapJobCategory(item.title || item.wantedTitle, item.jobName),
    type: item.workHours || item.employmentType || "",
    pay: item.salary || item.salaryText || "",
    isNew: !!item.isNew,
    description: item.description || "",
    requirements: item.requirements || "만 60세 이상",
    preferred: item.preferred || "",
    address: item.address || item.workPlaceAddress || "",
    contact: item.contact || "",
    applyUrl: item.applyUrl || item.detailUrl || "",
    source: "워크넷"
  };
}

async function fetchWork24Jobs(apiKey) {
  // ⚠️ 임시 엔드포인트 — 실제 발급받은 API 문서의 엔드포인트/파라미터로 교체 필요
  const apiUrl = process.env.WORK24_API_URL || "https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L21.do";
  const url = new URL(apiUrl);
  url.searchParams.set("authKey", apiKey);
  url.searchParams.set("callTp", "L");
  url.searchParams.set("returnType", "JSON");
  url.searchParams.set("startPage", "1");
  url.searchParams.set("display", "50");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("work24 API request failed: " + res.status);
  const data = await res.json();

  // 실제 응답 구조를 확인한 뒤 이 부분을 맞춰야 합니다.
  const rawList = data.wantedRoot?.wanted || data.result?.list || data.jobs || [];
  return rawList.map(mapWork24Item);
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
    { jobs, syncedAt: new Date().toISOString(), note: "워크넷/고용24 Open API에서 자동으로 가져온 데이터입니다." },
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
