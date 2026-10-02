// work24 Open API는 XML만 지원합니다. 응답 구조가 단순(중첩 없는 필드)해서
// 정규식 기반의 아주 단순한 파서로 충분합니다. sync-work24-jobs.mjs와
// job-detail.mjs가 공통으로 사용합니다.

export function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return m ? unescapeXml(m[1].trim()) : "";
}

export function unescapeXml(str) {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
