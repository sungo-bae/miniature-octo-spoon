// 실버잡 이용후기 작성 폼 — Netlify Forms로 제출됩니다.
(function () {
  "use strict";

  var form = document.getElementById("reviewForm");
  var successBox = document.getElementById("formSuccess");
  if (!form) return;

  var submitBtn = form.querySelector("button[type=submit]");
  var submitBtnDefaultText = submitBtn ? submitBtn.textContent : "";

  // 제출 중 뒤로가기(bfcache)로 돌아오면, 브라우저가 "제출 중..." 버튼 상태를
  // 그대로 복원해서 실제로는 이미 끝난 제출이 계속 진행 중인 것처럼 보일 수
  // 있습니다. 페이지가 캐시에서 복원될 때마다 버튼/폼 상태를 원래대로 되돌립니다.
  window.addEventListener("pageshow", function (e) {
    if (!e.persisted) return;
    form.hidden = false;
    if (successBox) successBox.hidden = true;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = submitBtnDefaultText;
    }
  });

  function encodeFormData(data) {
    return Object.keys(data)
      .map(function (key) { return encodeURIComponent(key) + "=" + encodeURIComponent(data[key]); })
      .join("&");
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    var formData = {};
    new FormData(form).forEach(function (value, key) { formData[key] = value; });

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "제출 중..."; }

    // 네트워크가 불안정해서 응답이 영영 안 올 경우를 대비해, 일정 시간이 지나면
    // 제출을 포기하고 일반 폼 제출로 넘어갑니다(버튼이 "제출 중..."에서 영원히
    // 멈춰있지 않도록).
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timeoutId = setTimeout(function () {
      if (controller) controller.abort();
    }, 10000);

    fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: encodeFormData(formData),
      signal: controller ? controller.signal : undefined
    })
      .then(function (res) {
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error("submit failed: " + res.status);
        form.hidden = true;
        if (successBox) successBox.hidden = false;
      })
      .catch(function () {
        clearTimeout(timeoutId);
        form.submit();
      });
  });
})();
