// partner.html의 "채용정보 등록 신청" 폼(Netlify Forms, 폼 이름 "job-submission")이
// 제출되면, Netlify의 "Outgoing webhook" 알림이 이 함수를 호출하도록 설정합니다.
// 접수된 내용은 자동으로 사이트에 올라가지 않고, content/jobs-pending.json에
// "검토 대기" 상태로만 쌓입니다 — 실제 공개는 검토 후 content/jobs.json으로
// 옮겨야 이루어집니다(시니어 대상 사이트라 검수 없는 자동 공개는 채용사기 등
// 악용 위험이 있어 일부러 두 단계로 나눴습니다).
//
// 설정 방법:
//   1. Netlify 환경변수에 JOB_WEBHOOK_SECRET 값을 아무 임의의 긴 문자열로 등록
//      (GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH는 sync-work24-jobs와 공유해서 씁니다)
//   2. Netlify 대시보드 → Forms → Settings & usage → Form notifications →
//      Add notification → Outgoing webhook
//        - Form: job-submission
//        - URL: https://silverjob.kr/.netlify/functions/job-submission-webhook?token=<JOB_WEBHOOK_SECRET 값>
//   값이 없거나 일치하지 않으면 이 함수는 403으로 거부합니다.

import { getJsonFile, commitJsonFiles } from "./lib/github-commit.mjs";

const PENDING_PATH = "content/jobs-pending.json";
const PENDING_NOTE =
  "채용정보 등록 폼(partner.html)으로 접수된 신청이 검토 대기 상태로 쌓이는 파일입니다. 사이트에는 반영되지 않습니다 — 검토 후 직접 content/jobs.json으로 옮겨야 실제로 공개됩니다.";

function kstTimestamp() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().replace("Z", "") + "+09:00";
}

export default async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const expectedToken = process.env.JOB_WEBHOOK_SECRET;

  if (!expectedToken || token !== expectedToken) {
    console.error("job-submission-webhook: 인증 토큰이 없거나 일치하지 않아 요청을 거부합니다.");
    return new Response("forbidden", { status: 403 });
  }

  const githubToken = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || "sungo-bae/miniature-octo-spoon";
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!githubToken) {
    console.error("job-submission-webhook: GITHUB_TOKEN이 설정되지 않았습니다.");
    return new Response("server not configured", { status: 500 });
  }

  let body;
  try {
    body = await req.json();
  } catch (err) {
    console.error("job-submission-webhook: 요청 본문을 JSON으로 파싱하지 못했습니다:", err.message);
    return new Response("bad request", { status: 400 });
  }

  // Netlify의 실제 웹훅 payload 구조를 완전히 확신할 수 없어(문서화된 형태와 실제
  // 전달 형태가 다를 수 있음 — 이번 세션에서 이미 비슷한 가정 오류를 겪었습니다),
  // 받은 그대로 로그로 남겨서 설정 직후 Functions 로그로 실제 형태를 확인할 수
  // 있게 합니다. 또한 흔히 쓰이는 몇 가지 위치를 순서대로 찾아봅니다.
  console.log("job-submission-webhook: 수신 payload:", JSON.stringify(body).slice(0, 3000));
  const data = body?.payload?.data || body?.data || body?.payload || body || {};

  if (data["bot-field"]) {
    console.log("job-submission-webhook: 허니팟 필드가 채워져 있어 스팸으로 보고 건너뜁니다.");
    return new Response("ignored", { status: 200 });
  }

  if (!data.company || !data.title) {
    console.error("job-submission-webhook: 필수 필드(company/title)가 없습니다. data =", JSON.stringify(data));
    return new Response("missing required fields", { status: 400 });
  }

  const submission = {
    status: "pending",
    submittedAt: kstTimestamp(),
    company: data.company || "",
    managerName: data.managerName || "",
    phone: data.phone || "",
    email: data.email || "",
    title: data.title || "",
    region: data.region || "",
    jobType: data.jobType || "",
    condition: data.condition || "",
    pay: data.pay || "",
    address: data.address || "",
    detail: data.detail || ""
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
      message: `chore: 채용정보 등록 신청 접수 — ${submission.company} (검토 대기)`
    });

    console.log(`job-submission-webhook: 접수 완료 — ${submission.company} / ${submission.title}`);
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("job-submission-webhook: GitHub 커밋 실패:", err.message);
    return new Response("internal error", { status: 500 });
  }
};
