/* 실버잡 일자리 날씨 끼워 넣기 도우미
 *
 *   <div class="silverjob-weather" data-region="서울특별시" data-accent="#005bac"></div>
 *   <script src="https://sungo-bae.github.io/miniature-octo-spoon/embed.js" defer></script>
 *
 * data-region  처음 보여줄 지역 (생략하면 전국)
 * data-lock    "1" 이면 지역 선택을 숨기고 그 지역만 보여줌
 * data-accent  머리띠 색 (#RRGGBB) — 홈페이지 대표색에 맞출 때
 * data-bg      바탕색 (#RRGGBB) — 홈페이지 바탕이 흰색이면 "#ffffff"
 * data-theme   "light" 또는 "dark" (생략하면 방문자 기기 설정을 따름)
 * data-page    "report" 이면 일자리 현황 리포트 (생략하면 일자리 날씨)
 */
(function () {
  var script = document.currentScript;
  var base = new URL(".", script ? script.src : location.href).href;

  function mount(el) {
    if (el.dataset.mounted) return;
    el.dataset.mounted = "1";
    var q = new URLSearchParams({ embed: "1" });
    ["region", "lock", "accent", "bg", "theme"].forEach(function (k) { if (el.dataset[k]) q.set(k, el.dataset[k]); });
    var frame = document.createElement("iframe");
    var report = el.dataset.page === "report";
    frame.src = base + (report ? "report.html?" : "index.html?") + q.toString();
    frame.title = report ? "실버잡 일자리 현황 리포트" : "실버잡 일자리 날씨";
    frame.loading = "lazy";
    frame.style.cssText = "width:100%;border:0;display:block;min-height:600px;";
    el.appendChild(frame);
    window.addEventListener("message", function (e) {
      if (e.source !== frame.contentWindow || !e.data || e.data.type !== "silverjob:height") return;
      frame.style.height = e.data.height + "px";
      frame.style.minHeight = "0";
    });
  }

  function init() { document.querySelectorAll(".silverjob-weather").forEach(mount); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
