// 실버잡 이용후기 작성 폼 — Netlify Forms로 제출됩니다.
(function () {
  "use strict";

  var form = document.getElementById("reviewForm");
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
        form.submit();
      });
  });
})();
