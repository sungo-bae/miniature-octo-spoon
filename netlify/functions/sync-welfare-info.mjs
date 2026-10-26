// 한국사회보장정보원(복지로)의 "지자체복지서비스" Open API를 주 1회 가져와서
// content/welfare-info.json을 자동 갱신하는 Netlify 예약 함수(Scheduled Function)입니다.
//
// API: 한국사회보장정보원_지자체복지서비스 (data.go.kr, 데이터ID 15108347)
// 요청 URL: https://apis.data.go.kr/B554287/LocalGovernmentWelfareInformations/LcgvWelfarelist
// 응답 형식: XML
//
// "생애주기=노년(코드 006)" 공고만 가져오고, 관심주제(일자리·신체건강·생활지원·보호돌봄)
// 4개를 각각 조회해 합칩니다. 코드값은 공공데이터포털 상세페이지에 첨부된
// "지자체복지서비스_코드표(v1.0).doc"를 직접 확인해서 반영했습니다.
//
// 상세조회(LcgvWelfaredetailed)는 쓰지 않습니다 — 목록조회(LcgvWelfarelist) 응답의
// servDtlLink 필드에 복지로 상세페이지 URL이 이미 포함되어 있어(실제 응답으로 확인),
// 별도 상세조회 호출 없이도 "자세히 보기" 링크를 안전하게 제공할 수 있습니다.
//
// 켜려면 Netlify 프로젝트 → Environment variables에 아래 값을 등록하세요:
//   WELFARE_API_KEY  - data.go.kr에서 발급받은 일반 인증키
//   GITHUB_TOKEN     - 이 저장소에 쓰기 권한이 있는 GitHub Personal Access Token (work24와 공용)
//   GITHUB_REPO      - "sungo-bae/miniature-octo-spoon" (기본값, 생략 가능)
//   GITHUB_BRANCH    - "main" (기본값, 생략 가능)
// 값이 없으면 이 함수는 아무것도 하지 않고 조용히 종료합니다(에러 아님).

import { extractTag } from "./lib/xml-utils.mjs";
import { commitJsonFiles } from "./lib/github-commit.mjs";

const TARGET_PATH = "content/welfare-info.json";
const LIST_URL = "https://apis.data.go.kr/B554287/LocalGovernmentWelfareInformations/LcgvWelfarelist";
const LIFE_STAGE_SENIOR = "006"; // 코드표 기준 "노년"

// 코드표(v1.0)에서 확인한 관심주제 코드 중, 시니어 구직 사이트에 맞는 4개만 선택했습니다.
// label은 API 쿼리용이 아니라 필터 버튼 표시용입니다 — 실제 분류 표시는 응답의
// intrsThemaNmArray(해당 서비스의 전체 관심주제 목록)를 그대로 씁니다.
const THEMES = [
  { code: "050", label: "일자리" },
  { code: "010", label: "신체건강" },
  { code: "030", label: "생활지원" },
  { code: "120", label: "보호·돌봄" }
];

const NUM_OF_ROWS = 100;
const MAX_PAGES_PER_THEME = 10; // 테마당 최대 1,000건
const FETCH_TIME_BUDGET_MS = 20000; // Netlify 함수 실행시간 제한을 넘기지 않도록

// 서비스 1건은 <servList>...</servList>로 감싸여 있습니다(실제 응답으로 확인).
function splitServiceBlocks(xml) {
  return xml.match(/<servList>[\s\S]*?<\/servList>/g) || [];
}

function mapServiceBlock(block) {
  const servId = extractTag(block, "servId");
  const title = extractTag(block, "servNm");
  const description = extractTag(block, "servDgst");
  const ctpvNm = extractTag(block, "ctpvNm");
  const sggNm = extractTag(block, "sggNm");
  const region = [ctpvNm, sggNm].filter(Boolean).join(" ");
  const theme = extractTag(block, "intrsThemaNmArray"); // 예: "서민금융, 일자리"
  const lastModYmd = extractTag(block, "lastModYmd");
  const url = extractTag(block, "servDtlLink"); // 복지로 상세페이지 URL
  const applyMethod = extractTag(block, "aplyMtdNm"); // 예: "방문, 인터넷"
  const benefitType = extractTag(block, "srvPvsnNm"); // 예: "현금지급", "전자바우처(바우처)"
  return { servId, title, description, region, theme, lastModYmd, url, applyMethod, benefitType };
}

async function fetchThemePage(apiKey, themeCode, pageNo) {
  const url = new URL(LIST_URL);
  url.searchParams.set("serviceKey", apiKey);
  url.searchParams.set("callTp", "L");
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("numOfRows", String(NUM_OF_ROWS));
  url.searchParams.set("lifeArray", LIFE_STAGE_SENIOR);
  url.searchParams.set("intrsThemaArray", themeCode);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // data.go.kr는 실패해도 보통 200/403과 함께 resultCode/resultMsg가 담긴 XML을
    // 내려주므로, 원인 파악을 위해 응답 본문을 로그에 그대로 남깁니다(서비스키는
    // URL에 포함되어 있지 않은 응답 본문이라 안전합니다).
    throw new Error(`welfare API request failed (theme ${themeCode}, page ${pageNo}): ${res.status} — ${body.slice(0, 500)}`);
  }
  const xml = await res.text();
  const totalCount = parseInt(extractTag(xml, "totalCount"), 10) || 0;
  return { blocks: splitServiceBlocks(xml), totalCount };
}

async function fetchThemeServices(apiKey, theme, startedAt) {
  const services = [];
  let pageNo = 1;
  let totalCount = Infinity;
  while (pageNo <= MAX_PAGES_PER_THEME && (pageNo - 1) * NUM_OF_ROWS < totalCount) {
    if (Date.now() - startedAt > FETCH_TIME_BUDGET_MS) break;
    const { blocks, totalCount: t } = await fetchThemePage(apiKey, theme.code, pageNo);
    totalCount = t;
    if (blocks.length === 0) break;
    for (const block of blocks) {
      const svc = mapServiceBlock(block);
      if (svc.servId && svc.title) services.push(svc);
    }
    pageNo++;
  }
  return services;
}

async function fetchAllWelfareServices(apiKey) {
  const startedAt = Date.now();
  const all = [];
  for (const theme of THEMES) {
    if (Date.now() - startedAt > FETCH_TIME_BUDGET_MS) break;
    all.push(...(await fetchThemeServices(apiKey, theme, startedAt)));
  }
  // 여러 관심주제에 동시에 해당하는 서비스는 먼저 매칭된 테마로 한 번만 남깁니다.
  const seen = new Map();
  for (const svc of all) {
    if (!seen.has(svc.servId)) seen.set(svc.servId, svc);
  }
  return Array.from(seen.values());
}

export default async () => {
  const apiKey = process.env.WELFARE_API_KEY;
  const githubToken = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || "sungo-bae/miniature-octo-spoon";
  const branch = process.env.GITHUB_BRANCH || "main";

  if (!apiKey || !githubToken) {
    console.log("sync-welfare-info: WELFARE_API_KEY 또는 GITHUB_TOKEN이 설정되지 않아 건너뜁니다.");
    return new Response("skipped: missing env vars", { status: 200 });
  }

  try {
    const services = await fetchAllWelfareServices(apiKey);

    await commitJsonFiles({
      token: githubToken,
      repo,
      branch,
      files: [
        {
          path: TARGET_PATH,
          data: {
            services,
            syncedAt: new Date().toISOString(),
            note: "한국사회보장정보원(복지로) 지자체복지서비스 Open API에서 '노년' 생애주기 기준으로 자동으로 가져온 데이터입니다. 신청 방법 등 자세한 내용은 복지로(www.bokjiro.go.kr), 보건복지상담센터(국번없이 129), 가까운 주민센터에서 확인하실 수 있습니다."
          }
        }
      ],
      message: `chore: sync welfare info from 지자체복지서비스 API (automated, ${services.length}건)`
    });

    console.log(`sync-welfare-info: ${services.length}건 동기화 완료`);
    return new Response(`synced ${services.length} welfare services`, { status: 200 });
  } catch (err) {
    console.error("sync-welfare-info failed:", err);
    return new Response("error: " + err.message, { status: 500 });
  }
};

// 매주 월요일 UTC 18시(KST 화요일 새벽 3시)에 자동 실행. work24 일일 동기화와
// 겹치지 않는 시간대로 맞췄습니다.
export const config = {
  schedule: "0 18 * * 1"
};
