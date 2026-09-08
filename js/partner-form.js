// 실버잡 채용정보 등록 신청 폼 — Netlify Forms로 제출됩니다.
// 새로고침 없이 제출되도록 fetch로 가로채고, 실패 시 일반 폼 제출로 자연스럽게 넘어갑니다.

(function () {
  "use strict";

  var form = document.getElementById("partnerForm");
  var successBox = document.getElementById("formSuccess");
  if (!form) return;

  function encodeFormData(data) {
    return Object.keys(data)
      .map(function (key) { return encodeURIComponent(key) + "=" + encodeURIComponent(data[key]); })
      .join("&");
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    var formData = {};
    new FormData(form).forEach(function (value, key) { formData[key] = value; });

    var submitBtn = form.querySelector("button[type=submit]");
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "제출 중..."; }

    fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: encodeFormData(formData)
    })
      .then(function (res) {
        if (!res.ok) throw new Error("submit failed: " + res.status);
        form.hidden = true;
        if (successBox) successBox.hidden = false;
      })
      .catch(function () {
        // AJAX 제출이 막힌 환경(예: 로컬 미리보기)이면 일반 폼 제출로 넘어갑니다.
        form.submit();
      });
  });
})();
