// 실버잡(silverjob.kr) 홈페이지 스크립트
// 1) 글자 크기 조절  2) 모바일 메뉴  3) 예시 일자리 데이터 렌더링 및 검색 필터

(function () {
  "use strict";

  /* ---------------- 글자 크기 조절 ---------------- */
  var root = document.documentElement;
  var FONT_STEPS = [1, 1.12, 1.25];
  var STORAGE_KEY = "silverjob-font-step";

  function applyFontStep(step) {
    root.style.setProperty("--font-scale", FONT_STEPS[step]);
    try { localStorage.setItem(STORAGE_KEY, String(step)); } catch (e) {}
  }

  function getSavedStep() {
    var saved = 0;
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw !== null) saved = Math.min(FONT_STEPS.length - 1, Math.max(0, parseInt(raw, 10)));
    } catch (e) {}
    return saved;
  }

  var currentStep = getSavedStep();
  applyFontStep(currentStep);

  var fsUp = document.getElementById("fsUp");
  var fsDown = document.getElementById("fsDown");
  var fsReset = document.getElementById("fsReset");

  if (fsUp) fsUp.addEventListener("click", function () {
    currentStep = Math.min(FONT_STEPS.length - 1, currentStep + 1);
    applyFontStep(currentStep);
  });
  if (fsDown) fsDown.addEventListener("click", function () {
    currentStep = Math.max(0, currentStep - 1);
    applyFontStep(currentStep);
  });
  if (fsReset) fsReset.addEventListener("click", function () {
    currentStep = 0;
    applyFontStep(currentStep);
  });

  /* ---------------- 모바일 메뉴 ---------------- */
  var hamburger = document.getElementById("hamburger");
  var mainNav = document.getElementById("mainNav");

  if (hamburger && mainNav) {
    hamburger.addEventListener("click", function () {
      var isOpen = mainNav.classList.toggle("open");
      hamburger.setAttribute("aria-expanded", String(isOpen));
    });

    mainNav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        mainNav.classList.remove("open");
        hamburger.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* ---------------- 일자리 데이터 ----------------
     실제 데이터는 content/jobs.json에서 불러옵니다.
     관리자 화면(/admin)에서 채용정보를 등록/수정하면 그 파일이 갱신되고,
     새로 배포된 뒤 여기 반영됩니다. 아래는 fetch 실패 시에만 쓰는 예비 데이터입니다. */
  var JOBS = [];
  var FALLBACK_JOBS = [
    { title: "○○아파트 관리사무소 관리보조", company: "○○아파트관리사무소", region: "서울", job: "시설관리", type: "주 5일 · 오전 근무", pay: "월 130만원", isNew: true },
    { title: "구청 민원실 사무보조", company: "○○구청", region: "서울", job: "사무보조", type: "주 5일 · 단시간", pay: "시급 10,500원", isNew: false }
  ];

  var jobGrid = document.getElementById("jobGrid");
  var jobEmpty = document.getElementById("jobEmpty");

  function jobCardHTML(job) {
    return (
      '<article class="job-card">' +
        '<div class="job-card-top">' +
          '<div>' +
            '<p class="job-title">' + job.title + '</p>' +
            '<p class="job-company">' + job.company + '</p>' +
          '</div>' +
          (job.isNew ? '<span class="job-tag">NEW</span>' : '') +
        '</div>' +
        '<div class="job-meta"><span>' + job.region + '</span><span>' + job.type + '</span></div>' +
        '<p class="job-pay">' + job.pay + '</p>' +
      '</article>'
    );
  }

  function renderJobs(filterRegion, filterJob) {
    if (!jobGrid) return;
    var filtered = JOBS.filter(function (job) {
      var regionOk = !filterRegion || job.region === filterRegion;
      var jobOk = !filterJob || job.job === filterJob;
      return regionOk && jobOk;
    });

    jobGrid.innerHTML = filtered.map(jobCardHTML).join("");

    if (jobEmpty) jobEmpty.hidden = filtered.length !== 0;
  }

  /* ---------------- 현황 통계 (카테고리별/전체 일자리 건수) ----------------
     content/jobs.json에 등록된 실제 건수를 세어 표시합니다.
     관리자가 CMS에서 일자리를 추가/삭제하면 배포 후 이 숫자도 자동으로 바뀝니다. */
  function updateStats() {
    var totalEl = document.getElementById("statTotalJobs");
    if (totalEl) totalEl.textContent = JOBS.length.toLocaleString("ko-KR") + "개";

    // 신규 일자리: 관리자가 CMS에서 "신규 표시"를 켠 채용정보 수
    var newEl = document.getElementById("statNewJobs");
    if (newEl) {
      var newCount = JOBS.filter(function (j) { return j.isNew; }).length;
      newEl.textContent = newCount.toLocaleString("ko-KR") + "개";
    }

    // 제휴 기관·기업: 등록된 일자리들의 company(기관/업체명)를 중복 제거해서 집계
    var partnersEl = document.getElementById("statPartners");
    if (partnersEl) {
      var companies = {};
      JOBS.forEach(function (j) { if (j.company) companies[j.company] = true; });
      var partnerCount = Object.keys(companies).length;
      partnersEl.textContent = partnerCount.toLocaleString("ko-KR") + "곳";
    }

    document.querySelectorAll(".category-card").forEach(function (card) {
      var job = card.getAttribute("data-job");
      var countEl = card.querySelector(".cat-count");
      if (!job || !countEl) return;
      var count = JOBS.filter(function (j) { return j.job === job; }).length;
      var label = job === "사회공헌" ? "활동" : "일자리";
      countEl.textContent = label + " " + count + "건";
    });
  }

  fetch("content/jobs.json")
    .then(function (res) { return res.ok ? res.json() : Promise.reject(res.status); })
    .then(function (data) { JOBS = data.jobs || FALLBACK_JOBS; })
    .catch(function () { JOBS = FALLBACK_JOBS; })
    .then(function () {
      var regionEl = document.getElementById("searchRegion");
      var jobEl = document.getElementById("searchJob");
      renderJobs(regionEl ? regionEl.value : "", jobEl ? jobEl.value : "");
      updateStats();
    });

  /* ---------------- 공지사항 (content/notices.json에서 불러옴) ---------------- */
  var noticeList = document.getElementById("noticeList");
  var FALLBACK_NOTICES = [
    { title: "실버잡 홈페이지 오픈 안내", date: "2026.09.08", isNew: true, link: "" }
  ];

  function noticeItemHTML(notice) {
    var safeHref = notice.link ? notice.link : "#";
    return (
      '<li>' +
        (notice.isNew ? '<span class="tag tag-new">신규</span>' : '') +
        '<a href="' + safeHref + '">' + notice.title + '</a>' +
        '<time>' + notice.date + '</time>' +
      '</li>'
    );
  }

  function renderNotices(notices) {
    if (!noticeList) return;
    noticeList.innerHTML = notices.map(noticeItemHTML).join("");
  }

  fetch("content/notices.json")
    .then(function (res) { return res.ok ? res.json() : Promise.reject(res.status); })
    .then(function (data) { renderNotices(data.notices || FALLBACK_NOTICES); })
    .catch(function () { renderNotices(FALLBACK_NOTICES); });

  /* ---------------- 검색 폼 ---------------- */
  var searchForm = document.getElementById("searchForm");
  if (searchForm) {
    searchForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var region = document.getElementById("searchRegion").value;
      var job = document.getElementById("searchJob").value;
      renderJobs(region, job);
      document.getElementById("jobs").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  /* ---------------- 직종 카드 클릭 시 해당 직종으로 필터링 ---------------- */
  document.querySelectorAll(".category-card").forEach(function (card) {
    card.addEventListener("click", function (e) {
      var job = card.getAttribute("data-job");
      if (!job) return;
      e.preventDefault();
      var jobSelect = document.getElementById("searchJob");
      if (jobSelect) jobSelect.value = job;
      renderJobs(document.getElementById("searchRegion").value, job);
      document.getElementById("jobs").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
})();
