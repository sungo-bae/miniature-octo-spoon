// 공고 1건의 "우대사항"을 그 공고를 실제로 열어보는 사용자에게만, 그 순간에 불러오는 함수입니다.
// 목록 동기화(sync-work24-jobs)는 work24 "목록" API만 쓰는데, 우대사항은 목록 API에 없고
// 공고별 "상세정보" API에서만 내려줍니다. 전체 공고(하루 약 200여 건)를 매번 상세 조회하면
// 호출량이 크게 늘어 함수 실행 시간/데이터포털 일일 호출 한도 위험이 커지므로,
// 사용자가 실제로 공고 상세를 열어볼 때만 그 1건에 대해서만 호출합니다.
//
// 요청: GET /.netlify/functions/job-detail?id=<wantedAuthNo>
// 응답: { prefer: "우대사항 원문" } (정보가 없으면 빈 문자열 — 없는 내용을 지어내지 않습니다)

import { extractTag } from "./lib/xml-utils.mjs";

const WORK24_DETAIL_URL = "https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210D01.do";

// 같은 공고를 여러 사용자가 연달아 열어볼 때 매번 work24에 재요청하지 않도록,
// 이 함수 인스턴스가 살아있는 동안만 유지되는 아주 가벼운 메모리 캐시입니다.
const cache = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6시간

export default async (req) => {
  const url = new URL(req.url);
  const id = (url.searchParams.get("id") || "").trim();
  if (!id) {
    return new Response(JSON.stringify({ prefer: "" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const cached = cache.get(id);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return new Response(JSON.stringify(cached.data), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" }
    });
  }

  const apiKey = process.env.WORK24_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ prefer: "" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const apiUrl = new URL(WORK24_DETAIL_URL);
    apiUrl.searchParams.set("authKey", apiKey);
    apiUrl.searchParams.set("callTp", "D");
    apiUrl.searchParams.set("returnType", "XML");
    apiUrl.searchParams.set("wantedAuthNo", id);

    const res = await fetch(apiUrl.toString());
    if (!res.ok) throw new Error("work24 상세 API 요청 실패: " + res.status);
    const xml = await res.text();

    const data = { prefer: extractTag(xml, "prefer") };

    // 임시 디버그 모드: ?debug=1을 붙이면 work24가 실제로 내려준 원문 XML을 그대로 보여줍니다.
    // 올바른 필드명을 확인한 뒤 이 블록은 제거할 예정입니다.
    if (url.searchParams.get("debug") === "1") {
      return new Response(JSON.stringify({ ...data, rawXml: xml.slice(0, 4000) }, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    cache.set(id, { at: Date.now(), data });

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" }
    });
  } catch (err) {
    console.error("job-detail failed:", err);
    // 실패해도 홈페이지 쪽은 조용히 "우대사항 없음"으로 처리되도록 200 + 빈 값을 돌려줍니다.
    return new Response(JSON.stringify({ prefer: "" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
};
