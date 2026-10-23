// GitHub Contents/Git Data API로 JSON 파일을 읽고 커밋하는 공통 헬퍼입니다.
// sync-work24-jobs.mjs(일일 동기화)와 job-submission-webhook.mjs(등록 폼 접수)
// 양쪽에서 똑같이 씁니다.

const GITHUB_API = "https://api.github.com";

// GitHub Contents API에서 파일 1건을 읽어옵니다(sha + 내용). 없으면 null.
export async function getJsonFile({ token, repo, branch, path }) {
  const [owner, name] = repo.split("/");
  const getUrl = `${GITHUB_API}/repos/${owner}/${name}/contents/${path}?ref=${branch}`;
  const res = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }
  });
  if (!res.ok) return null;
  const file = await res.json();
  try {
    return { sha: file.sha, data: JSON.parse(Buffer.from(file.content, "base64").toString("utf-8")) };
  } catch {
    return { sha: file.sha, data: null };
  }
}

// 여러 파일을 "한 번의 커밋"으로 함께 올립니다(Git Data API 사용).
// Contents API로 파일마다 따로 PUT하면 파일 수만큼 커밋·배포가 발생해서 Netlify 빌드
// 크레딧을 그만큼 더 씁니다(2026-10 초 배포 크레딧 초과 사태의 주원인).
export async function commitJsonFiles({ token, repo, branch, files, message }) {
  const [owner, name] = repo.split("/");
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };

  const refRes = await fetch(`${GITHUB_API}/repos/${owner}/${name}/git/ref/heads/${branch}`, { headers });
  if (!refRes.ok) throw new Error("failed to read branch ref: " + refRes.status);
  const baseCommitSha = (await refRes.json()).object.sha;

  const baseCommitRes = await fetch(`${GITHUB_API}/repos/${owner}/${name}/git/commits/${baseCommitSha}`, { headers });
  if (!baseCommitRes.ok) throw new Error("failed to read base commit: " + baseCommitRes.status);
  const baseTreeSha = (await baseCommitRes.json()).tree.sha;

  const treeEntries = [];
  for (const file of files) {
    const blobRes = await fetch(`${GITHUB_API}/repos/${owner}/${name}/git/blobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        content: Buffer.from(JSON.stringify(file.data, null, 2), "utf-8").toString("base64"),
        encoding: "base64"
      })
    });
    if (!blobRes.ok) throw new Error(`failed to create blob for ${file.path}: ` + blobRes.status);
    const blobSha = (await blobRes.json()).sha;
    treeEntries.push({ path: file.path, mode: "100644", type: "blob", sha: blobSha });
  }

  const treeRes = await fetch(`${GITHUB_API}/repos/${owner}/${name}/git/trees`, {
    method: "POST",
    headers,
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries })
  });
  if (!treeRes.ok) throw new Error("failed to create tree: " + treeRes.status);
  const newTreeSha = (await treeRes.json()).sha;

  const newCommitRes = await fetch(`${GITHUB_API}/repos/${owner}/${name}/git/commits`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message, tree: newTreeSha, parents: [baseCommitSha] })
  });
  if (!newCommitRes.ok) throw new Error("failed to create commit: " + newCommitRes.status);
  const newCommitSha = (await newCommitRes.json()).sha;

  const updateRefRes = await fetch(`${GITHUB_API}/repos/${owner}/${name}/git/refs/heads/${branch}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ sha: newCommitSha })
  });
  if (!updateRefRes.ok) throw new Error("failed to update branch ref: " + updateRefRes.status);
}
