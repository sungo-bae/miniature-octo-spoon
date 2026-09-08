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

  /* ---------------- 예시 일자리 데이터 ----------------
     실제 서비스에서는 이 배열을 API 응답으로 교체하세요. */
  var JOBS = [
    { title: "○○아파트 관리사무소 관리보조", company: "○○아파트관리사무소", region: "서울", job: "시설관리", type: "주 5일 · 오전 근무", pay: "월 130만원", isNew: true },
    { title: "구청 민원실 사무보조", company: "○○구청", region: "서울", job: "사무보조", type: "주 5일 · 단시간", pay: "시급 10,500원", isNew: false },
    { title: "초등학교 급식 조리보조", company: "○○초등학교", region: "경기·인천", job: "조리", type: "주 5일 · 학기중", pay: "월 118만원", isNew: true },
    { title: "지하철역 미화 도우미", company: "○○교통공사", region: "서울", job: "미화", type: "주 5일 · 교대근무", pay: "시급 10,200원", isNew: false },
    { title: "공영주차장 안전관리요원", company: "○○시설공단", region: "부산·경남", job: "경비안전", type: "주 3일 · 야간 가능", pay: "시급 10,800원", isNew: false },
    { title: "지역아동센터 사회공헌활동가", company: "○○복지관", region: "대전·충청", job: "사회공헌", type: "주 3일 · 오후", pay: "활동비 월 30만원", isNew: true },
    { title: "빌딩 시설관리 보조", company: "○○빌딩관리", region: "경기·인천", job: "시설관리", type: "주 5일 · 오전", pay: "월 142만원", isNew: false },
    { title: "도서관 사무보조", company: "○○구립도서관", region: "대구·경북", job: "사무보조", type: "주 4일 · 단시간", pay: "시급 10,500원", isNew: false },
    { title: "노인복지관 급식 조리보조", company: "○○노인복지관", region: "광주·전라", job: "조리", type: "주 5일 · 오전", pay: "월 125만원", isNew: false }
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

  renderJobs("", "");

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
