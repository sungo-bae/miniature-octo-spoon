// 실버잡(silverjob.kr) 홈페이지 스크립트
// 1) 글자 크기 조절  2) 모바일 메뉴  3) 예시 일자리 데이터 렌더링 및 검색 필터

(function () {
  "use strict";

  /* ---------------- 카카오톡 채널 링크 ----------------
     채널 생성 후 아래 값을 실제 채널 URL로 바꿔주세요.
     예: "https://pf.kakao.com/_xxXXxx/chat" */
  var KAKAO_CHANNEL_URL = "https://pf.kakao.com/_tbxnxiX/chat";

  var kakaoLinks = document.querySelectorAll(".kakao-link");
  for (var ki = 0; ki < kakaoLinks.length; ki++) {
    kakaoLinks[ki].href = KAKAO_CHANNEL_URL || "#";
  }

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
  var jobListStatus = document.getElementById("jobListStatus");
  var jobListMoreWrap = document.getElementById("jobListMoreWrap");
  var jobListMoreBtn = document.getElementById("jobListMoreBtn");
  var searchRegionEl = document.getElementById("searchRegion");
  var searchRegionDetailEl = document.getElementById("searchRegionDetail");

  // "세부지역" 드롭다운은 고정 목록이 아니라, 선택된 권역 안에 실제로 공고가 있는
  // 시/군/구만 모아서 그때그때 채웁니다. 권역을 고르지 않았으면("전체 지역")
  // 세부지역은 비활성화합니다(전국 시/군/구를 한 목록에 다 늘어놓으면 너무 깁니다).
  function updateRegionDetailOptions(region, keepValue) {
    if (!searchRegionDetailEl) return;
    var prevValue = keepValue ? searchRegionDetailEl.value : "";

    if (!region) {
      searchRegionDetailEl.innerHTML = '<option value="">전체</option>';
      searchRegionDetailEl.disabled = true;
      return;
    }

    var counts = {};
    JOBS.forEach(function (job) {
      if (job.region !== region || !job.regionDetail) return;
      counts[job.regionDetail] = (counts[job.regionDetail] || 0) + 1;
    });
    var names = Object.keys(counts).sort(function (a, b) { return a.localeCompare(b, "ko"); });

    var html = '<option value="">전체</option>';
    names.forEach(function (name) {
      html += '<option value="' + name + '">' + name + ' (' + counts[name] + '건)</option>';
    });
    searchRegionDetailEl.innerHTML = html;
    searchRegionDetailEl.disabled = false;
    if (prevValue && counts[prevValue]) searchRegionDetailEl.value = prevValue;
  }

  if (searchRegionEl) {
    searchRegionEl.addEventListener("change", function () {
      updateRegionDetailOptions(searchRegionEl.value, false);
    });
  }

  // 채용공고별 고유 URL(/jobs/<slug>.html)을 만드는 해시 함수.
  // scripts/generate-job-pages.mjs가 똑같은 함수로 정적 페이지를 생성하므로,
  // 한쪽만 고치면 링크가 어긋나니 두 파일을 항상 같이 수정하세요.
  function jobSlug(job) {
    var key = job.applyUrl || (job.title + "|" + job.company + "|" + job.region);
    var hash = 0x811c9dc5;
    for (var i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return "job-" + ("00000000" + hash.toString(16)).slice(-8);
  }

  // 워크넷(공공데이터)에서 자동으로 가져온 공고인지, 지역 업체가 실버잡에 직접 등록한
  // 공고인지 구분해서 보여줍니다. scripts/generate-job-pages.mjs에도 같은 로직이 있어요.
  function jobSourceBadge(job) {
    if (job.source === "워크넷") {
      return '<span class="job-source job-source-public">공공데이터</span>';
    }
    return '<span class="job-source job-source-local">지역업체 등록</span>';
  }

  // work24 원본 지역 텍스트는 "서울 강남구"처럼 "권역 세부지역"으로 와서, 가능하면
  // 세부지역까지 같이 보여줍니다(세부지역이 없는 공고는 권역만 표시).
  function jobRegionLabel(job) {
    return job.regionDetail ? job.region + " " + job.regionDetail : job.region;
  }

  function jobCardHTML(job) {
    return (
      '<a class="job-card" href="/jobs/' + jobSlug(job) + '.html" aria-haspopup="dialog">' +
        '<div class="job-card-top">' +
          '<div>' +
            '<p class="job-title">' + job.title + '</p>' +
            '<p class="job-company">' + job.company + '</p>' +
            jobSourceBadge(job) +
          '</div>' +
          (job.isNew ? '<span class="job-tag">NEW</span>' : '') +
        '</div>' +
        '<div class="job-meta"><span>' + jobRegionLabel(job) + '</span><span>' + job.type + '</span></div>' +
        '<p class="job-pay">' + job.pay + '</p>' +
        '<p class="job-card-more">자세히 보기 →</p>' +
      '</a>'
    );
  }

  var lastFilteredJobs = []; // 현재 화면에 실제로 그려진(= 더보기로 누적된) 목록
  var currentFullList = []; // 현재 필터 조건에 맞는 전체 목록(정렬된 상태)
  var visibleCount = 0; // currentFullList 중 몇 건째까지 보여주고 있는지
  var JOB_LIST_PAGE_SIZE = 24; // 한 번에 보여줄 개수. 공고가 수천 건이라 한꺼번에 다 그리면 느려집니다.

  // 나이 대신 "몸을 얼마나 쓰는 일인지"로 찾을 수 있도록 직종을 강도별로 묶은 표
  var DIFFICULTY_MAP = {
    light: { label: "가벼운 활동", jobs: ["사무보조", "사회공헌"] },
    medium: { label: "보통 활동", jobs: ["조리", "미화"] },
    active: { label: "활동적인 일", jobs: ["시설관리", "경비안전"] }
  };

  // "2026-09-30" 형태의 postedDate/datePosted를 비교 가능한 값으로 바꿉니다.
  // 날짜 정보가 없는 공고는 맨 뒤로 보냅니다(허위로 "최신"처럼 보이지 않도록).
  function jobSortTime(job) {
    var raw = job.postedDate || job.datePosted || "";
    var t = Date.parse(raw);
    return isNaN(t) ? -Infinity : t;
  }

  function renderVisiblePage() {
    if (!jobGrid) return;
    var visible = currentFullList.slice(0, visibleCount);
    lastFilteredJobs = visible;
    jobGrid.innerHTML = visible.map(jobCardHTML).join("");

    if (jobListStatus) {
      jobListStatus.hidden = currentFullList.length === 0;
      jobListStatus.textContent = "전체 " + currentFullList.length.toLocaleString("ko-KR") + "건 중 " +
        visible.length.toLocaleString("ko-KR") + "건 표시 중";
    }
    if (jobListMoreWrap) jobListMoreWrap.hidden = visible.length >= currentFullList.length;
  }

  function renderJobs(filterRegion, filterJob, filterRegionDetail) {
    if (!jobGrid) return;
    // filterJob은 직종 문자열 하나, 직종 배열(활동 강도 필터), 또는 빈 값일 수 있습니다.
    var jobList = Array.isArray(filterJob) ? filterJob : (filterJob ? [filterJob] : null);
    var filtered = JOBS.filter(function (job) {
      var regionOk = !filterRegion || job.region === filterRegion;
      var regionDetailOk = !filterRegionDetail || job.regionDetail === filterRegionDetail;
      var jobOk = !jobList || jobList.indexOf(job.job) !== -1;
      return regionOk && regionDetailOk && jobOk;
    });
    filtered.sort(function (a, b) { return jobSortTime(b) - jobSortTime(a); });

    currentFullList = filtered;
    visibleCount = Math.min(JOB_LIST_PAGE_SIZE, filtered.length); // 새 검색이므로 처음 페이지부터 다시 보여줍니다.
    renderVisiblePage();

    if (jobEmpty) jobEmpty.hidden = filtered.length !== 0;
  }

  if (jobListMoreBtn) {
    jobListMoreBtn.addEventListener("click", function () {
      visibleCount = Math.min(visibleCount + JOB_LIST_PAGE_SIZE, currentFullList.length);
      renderVisiblePage();
    });
  }

  /* ---------------- 우대사항 상세 조회(지연 로딩) ----------------
     work24 목록 API에는 우대사항이 없어서, 사용자가 공고를 실제로 열어볼 때만
     그 1건에 한해 서버 함수(job-detail)를 통해 work24 상세 API를 조회합니다. */
  function fetchJobPreferredInfo(jobId, infoSvc) {
    if (!jobId || !infoSvc) return Promise.resolve(null);
    return fetch("/.netlify/functions/job-detail?id=" + encodeURIComponent(jobId) + "&infoSvc=" + encodeURIComponent(infoSvc))
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; });
  }

  /* ---------------- 일자리 상세 팝업 ---------------- */
  var jobModalBackdrop = document.getElementById("jobModalBackdrop");
  var jobModalLastFocused = null;
  var jobModalPreferredRequestSeq = 0;

  function openJobModal(job) {
    if (!jobModalBackdrop) return;
    document.getElementById("jobModalTag").textContent = job.isNew ? "NEW" : "";
    document.getElementById("jobModalTitle").textContent = job.title || "";
    document.getElementById("jobModalCompany").textContent = job.company || "";
    document.getElementById("jobModalMeta").textContent = [jobRegionLabel(job), job.type].filter(Boolean).join(" · ");
    document.getElementById("jobModalPay").textContent = job.pay || "";
    var deadlineEl = document.getElementById("jobModalDeadline");
    if (deadlineEl) deadlineEl.textContent = job.deadline ? "마감일: " + job.deadline : "상시채용";
    document.getElementById("jobModalDescription").textContent = job.description || "등록된 상세 설명이 없습니다.";
    document.getElementById("jobModalRequirements").textContent = job.requirements || "제한 없음";
    document.getElementById("jobModalAddress").textContent = job.address || "등록된 주소 정보가 없습니다.";

    var preferredWrap = document.getElementById("jobModalPreferredWrap");
    var requestId = ++jobModalPreferredRequestSeq;
    if (job.preferred) {
      preferredWrap.hidden = false;
      document.getElementById("jobModalPreferred").textContent = job.preferred;
    } else if (preferredWrap) {
      preferredWrap.hidden = true;
      if (job.id && job.infoSvc) {
        fetchJobPreferredInfo(job.id, job.infoSvc).then(function (data) {
          if (requestId !== jobModalPreferredRequestSeq) return; // 그 사이 다른 공고를 열었으면 무시
          if (data && data.prefer) {
            preferredWrap.hidden = false;
            document.getElementById("jobModalPreferred").textContent = data.prefer;
          }
        });
      }
    }

    var sourceEl = document.getElementById("jobModalSource");
    if (sourceEl) {
      sourceEl.innerHTML = job.source ? jobSourceBadge(job) + " 출처: " + job.source : "";
    }

    var contactBtn = document.getElementById("jobModalContact");
    if (contactBtn) {
      if (job.applyUrl) {
        contactBtn.href = job.applyUrl;
        contactBtn.textContent = "지원하기 (원문 공고로 이동)";
        contactBtn.target = "_blank";
        contactBtn.rel = "noopener";
      } else {
        contactBtn.href = KAKAO_CHANNEL_URL || "#";
        contactBtn.textContent = "💬 카카오톡으로 문의하기";
        contactBtn.target = "_blank";
        contactBtn.rel = "noopener";
      }
    }

    jobModalLastFocused = document.activeElement;
    jobModalBackdrop.hidden = false;
    document.body.style.overflow = "hidden";
    var closeBtn = document.getElementById("jobModalClose");
    if (closeBtn) closeBtn.focus();
  }

  function closeJobModal() {
    if (!jobModalBackdrop) return;
    jobModalBackdrop.hidden = true;
    document.body.style.overflow = "";
    if (jobModalLastFocused && jobModalLastFocused.focus) jobModalLastFocused.focus();
  }

  if (jobModalBackdrop) {
    document.getElementById("jobModalClose").addEventListener("click", closeJobModal);
    jobModalBackdrop.addEventListener("click", function (e) {
      if (e.target === jobModalBackdrop) closeJobModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !jobModalBackdrop.hidden) closeJobModal();
    });
  }

  function handleJobCardActivate(target) {
    var card = target.closest ? target.closest(".job-card") : null;
    if (!card || !jobGrid) return;
    var index = Array.prototype.indexOf.call(jobGrid.children, card);
    var job = lastFilteredJobs[index];
    if (job) openJobModal(job);
  }

  if (jobGrid) {
    // 카드는 실제 href를 가진 <a> 태그(크롤러/스크린리더/JS 비활성 환경용)이지만,
    // JS가 동작하는 일반 사용자에게는 페이지 이동 대신 기존처럼 모달을 띄워줍니다.
    jobGrid.addEventListener("click", function (e) {
      var card = e.target.closest ? e.target.closest(".job-card") : null;
      if (!card) return;
      e.preventDefault();
      handleJobCardActivate(e.target);
    });
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

    // 건수가 많은 순으로 정렬해서 보여줍니다 (일자리 현황 리포트와 순서를 맞춤)
    var jobCardEntries = Array.prototype.slice.call(document.querySelectorAll(".category-card[data-job]")).map(function (card) {
      var job = card.getAttribute("data-job");
      var countEl = card.querySelector(".cat-count");
      var count = job ? JOBS.filter(function (j) { return j.job === job; }).length : 0;
      if (countEl) {
        var label = job === "사회공헌" ? "활동" : "일자리";
        countEl.textContent = label + " " + count + "건";
      }
      return { card: card, count: count };
    });
    if (jobCardEntries.length) {
      var jobCardParent = jobCardEntries[0].card.parentNode;
      jobCardEntries
        .slice()
        .sort(function (a, b) { return b.count - a.count; })
        .forEach(function (entry) { jobCardParent.appendChild(entry.card); });
    }

    document.querySelectorAll(".category-card[data-region]").forEach(function (card) {
      var region = card.getAttribute("data-region");
      var countEl = card.querySelector(".cat-count");
      if (!region || !countEl) return;
      var count = JOBS.filter(function (j) { return j.region === region; }).length;
      countEl.textContent = "일자리 " + count + "건";
    });

    document.querySelectorAll(".category-card[data-difficulty]").forEach(function (card) {
      var key = card.getAttribute("data-difficulty");
      var countEl = card.querySelector(".cat-count");
      var entry = DIFFICULTY_MAP[key];
      if (!entry || !countEl) return;
      var count = JOBS.filter(function (j) { return entry.jobs.indexOf(j.job) !== -1; }).length;
      countEl.textContent = "일자리 " + count + "건";
    });
  }

  /* content/jobs.json = 관리자가 CMS로 직접 등록한 일자리
     content/jobs-external.json = 워크넷 등 공공 API에서 자동으로 가져온 일자리 (아직 비어있을 수 있음)
     둘을 합쳐서 보여줍니다. */
  function fetchJobsFile(path) {
    return fetch(path)
      .then(function (res) { return res.ok ? res.json() : { jobs: [] }; })
      .then(function (data) { return data.jobs || []; })
      .catch(function () { return []; });
  }

  Promise.all([fetchJobsFile("/content/jobs.json"), fetchJobsFile("/content/jobs-external.json")])
    .then(function (results) {
      var combined = results[0].concat(results[1]);
      JOBS = combined.length ? combined : FALLBACK_JOBS;
    })
    .catch(function () { JOBS = FALLBACK_JOBS; })
    .then(function () {
      var regionEl = document.getElementById("searchRegion");
      var jobEl = document.getElementById("searchJob");
      updateRegionDetailOptions(regionEl ? regionEl.value : "", true);
      renderJobs(regionEl ? regionEl.value : "", jobEl ? jobEl.value : "", searchRegionDetailEl ? searchRegionDetailEl.value : "");
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

  fetch("/content/notices.json")
    .then(function (res) { return res.ok ? res.json() : Promise.reject(res.status); })
    .then(function (data) { renderNotices(data.notices || FALLBACK_NOTICES); })
    .catch(function () { renderNotices(FALLBACK_NOTICES); });

  /* ---------------- 이용후기 (content/reviews.json에서 불러옴) ---------------- */
  var reviewGrid = document.getElementById("reviewGrid");
  var FALLBACK_REVIEWS = [
    { name: "실버잡", jobTitle: "이용후기", content: "아직 등록된 후기가 없습니다. 첫 번째 후기를 남겨주세요!" }
  ];

  function reviewCardHTML(review) {
    return (
      '<blockquote class="review-card">' +
        '<p>“' + review.content + '”</p>' +
        '<cite>' + review.name + ' · ' + review.jobTitle + '</cite>' +
      '</blockquote>'
    );
  }

  function renderReviews(reviews) {
    if (!reviewGrid) return;
    reviewGrid.innerHTML = reviews.map(reviewCardHTML).join("");
  }

  fetch("/content/reviews.json")
    .then(function (res) { return res.ok ? res.json() : Promise.reject(res.status); })
    .then(function (data) { renderReviews(data.reviews && data.reviews.length ? data.reviews : FALLBACK_REVIEWS); })
    .catch(function () { renderReviews(FALLBACK_REVIEWS); });

  /* ---------------- 검색 폼 ---------------- */
  var searchForm = document.getElementById("searchForm");
  if (searchForm) {
    searchForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var region = document.getElementById("searchRegion").value;
      var job = document.getElementById("searchJob").value;
      var regionDetail = searchRegionDetailEl ? searchRegionDetailEl.value : "";
      renderJobs(region, job, regionDetail);
      document.getElementById("jobs").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  /* ---------------- 직종 카드 클릭 시 해당 직종으로 필터링 ---------------- */
  document.querySelectorAll(".category-card[data-job]").forEach(function (card) {
    card.addEventListener("click", function (e) {
      var job = card.getAttribute("data-job");
      if (!job) return;
      e.preventDefault();
      var jobSelect = document.getElementById("searchJob");
      if (jobSelect) jobSelect.value = job;
      renderJobs(document.getElementById("searchRegion").value, job, searchRegionDetailEl ? searchRegionDetailEl.value : "");
      document.getElementById("jobs").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  /* ---------------- 지역 카드 클릭 시 해당 지역으로 필터링 ---------------- */
  document.querySelectorAll(".category-card[data-region]").forEach(function (card) {
    card.addEventListener("click", function (e) {
      var region = card.getAttribute("data-region");
      if (!region) return;
      e.preventDefault();
      var regionSelect = document.getElementById("searchRegion");
      if (regionSelect) regionSelect.value = region;
      updateRegionDetailOptions(region, false); // 새 권역을 골랐으니 세부지역은 "전체"로 초기화
      var jobSelect = document.getElementById("searchJob");
      renderJobs(region, jobSelect ? jobSelect.value : "", "");
      document.getElementById("jobs").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  /* ---------------- 활동 강도 카드 클릭 시 해당 강도의 직종들로 필터링 ----------------
     나이 정보가 채용 데이터에 없어서, 대신 체력 부담 기준으로 직종을 묶어 필터링합니다. */
  document.querySelectorAll(".category-card[data-difficulty]").forEach(function (card) {
    card.addEventListener("click", function (e) {
      var key = card.getAttribute("data-difficulty");
      var entry = DIFFICULTY_MAP[key];
      if (!entry) return;
      e.preventDefault();
      var jobSelect = document.getElementById("searchJob");
      if (jobSelect) jobSelect.value = ""; // 강도 필터는 여러 직종을 묶으므로 드롭다운은 "전체 직종"으로 되돌림
      renderJobs(document.getElementById("searchRegion").value, entry.jobs, searchRegionDetailEl ? searchRegionDetailEl.value : "");
      document.getElementById("jobs").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  /* ---------------- 채용 상세 페이지(/jobs/*.html)의 우대사항 지연 로딩 ---------------- */
  var preferredBox = document.getElementById("preferredBox");
  if (preferredBox) {
    var preferredJobId = preferredBox.getAttribute("data-job-id");
    var preferredInfoSvc = preferredBox.getAttribute("data-job-infosvc");
    if (preferredJobId && preferredInfoSvc) {
      fetchJobPreferredInfo(preferredJobId, preferredInfoSvc).then(function (data) {
        if (data && data.prefer) {
          document.getElementById("preferredText").textContent = data.prefer;
          preferredBox.hidden = false;
        }
      });
    }
  }
})();
