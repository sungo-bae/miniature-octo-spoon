// review.html의 "이용후기 작성" 폼(Netlify Forms, 폼 이름 "review-submission")이
// 제출되면, Netlify의 "Outgoing webhook" 알림이 이 함수를 호출하도록 설정합니다.
// 접수된 내용은 자동으로 사이트에 올라가지 않고, content/reviews-pending.json에
// "검토 대기" 상태로만 쌓입니다 — 실제 공개는 검토 후 이름을 "김○○ 님" 형식으로
// 가린 뒤 content/reviews.json으로 옮겨야 이루어집니다.
//
// job-submission-webhook.mjs와 거의 같은 구조이며, 같은 비밀키(JOB_WEBHOOK_SECRET)와
// GitHub 환경변수를 공유해서 씁니다.
//
// 설정 방법:
//   Netlify 대시보드 → Forms → Settings & usage → Form notifications →
//   Add notification → Outgoing webhook
//     - Form: review-submission
//     - URL: https://silverjob.kr/.netlify/functions/review-submission-webhook?token=<JOB_WEBHOOK_SECRET 값>

import { getJsonFile, commitJsonFiles } from "./lib/github-commit.mjs";

const PENDING_PATH = "content/reviews-pending.json";
const PENDING_NOTE =
  "이용후기 폼(review.html)으로 접수된 후기가 검토 대기 상태로 쌓이는 파일입니다. 사이트에는 반영되지 않습니다 — 검토 후 이름을 '김○○ 님' 형식으로 가린 뒤 content/reviews.json으로 옮겨야 실제로 공개됩니다.";

function kstTimestamp() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().replace("Z", "") + "+09:00";
}

export default async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const expectedToken = process.env.JOB_WEBHOOK_SECRET;

  if (!expectedToken || token !== expectedToken) {
    console.error("review-submission-webhook: 인증 토큰이 없거나 일치하지 않아 요청을 거부합니다.");
    return new Response("forbidden", { status: 403 });
  }

  const githubToken = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || "sungo-bae/miniature-octo-spoon";
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!githubToken) {
    console.error("review-submission-webhook: GITHUB_TOKEN이 설정되지 않았습니다.");
    return new Response("server not configured", { status: 500 });
  }

  let body;
  try {
    body = await req.json();
  } catch (err) {
    console.error("review-submission-webhook: 요청 본문을 JSON으로 파싱하지 못했습니다:", err.message);
    return new Response("bad request", { status: 400 });
  }

  console.log("review-submission-webhook: 수신 payload:", JSON.stringify(body).slice(0, 3000));
  const data = body?.payload?.data || body?.data || body?.payload || body || {};

  if (data["bot-field"]) {
    console.log("review-submission-webhook: 허니팟 필드가 채워져 있어 스팸으로 보고 건너뜁니다.");
    return new Response("ignored", { status: 200 });
  }

  if (!data.name || !data.content) {
    console.error("review-submission-webhook: 필수 필드(name/content)가 없습니다. data =", JSON.stringify(data));
    return new Response("missing required fields", { status: 400 });
  }

  const submission = {
    status: "pending",
    submittedAt: kstTimestamp(),
    name: data.name || "",
    age: data.age || "",
    writer: data.writer || "",
    jobTitle: data.jobTitle || "",
    content: data.content || "",
    phone: data.phone || "",
    email: data.email || ""
  };

  try {
    const existing = await getJsonFile({ token: githubToken, repo, branch, path: PENDING_PATH });
    const pendingData =
      existing && existing.data && Array.isArray(existing.data.submissions)
        ? existing.data
        : { note: PENDING_NOTE, submissions: [] };

    pendingData.submissions.push(submission);

    await commitJsonFiles({
      token: githubToken,
      repo,
      branch,
      files: [{ path: PENDING_PATH, data: pendingData }],
      message: `chore: 이용후기 접수 — ${submission.name} (검토 대기)`
    });

    console.log(`review-submission-webhook: 접수 완료 — ${submission.name} / ${submission.jobTitle}`);
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("review-submission-webhook: GitHub 커밋 실패:", err.message);
    return new Response("internal error", { status: 500 });
  }
};
