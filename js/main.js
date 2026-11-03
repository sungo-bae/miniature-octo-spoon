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

  /* ---------------- 지원 버튼 클릭 수 ----------------
     "지원하기"·"카카오톡으로 문의하기"를 누르면 어떤 공고·지역·직종에서 눌렸는지만 Supabase에 기록합니다
     (이름·연락처 등 개인정보는 보내지 않습니다). 공개 키는 이 표에 행을 추가만 할 수 있고 읽을 수 없습니다.
     기록이 실패해도 버튼 동작에는 영향이 없습니다. */
  var SUPABASE_REST = "https://idngidaxescxuyjzirob.supabase.co/rest/v1/";
  var SUPABASE_KEY = "sb_publishable_hGMZ7IU3qZZc3jGzUP1ySQ_h1eRn7m0"; // 공개(publishable) 키
  var CLICK_URL = SUPABASE_REST + "apply_clicks";
  var CLICK_KEY = SUPABASE_KEY;

  /* ---------------- 화면에 넣는 글자 지키기 ----------------
     공고 제목·회사명·급여 문구는 고용24에 구인 업체가 직접 쓴 글이라, 그대로 HTML로 넣으면
     그 안의 태그·스크립트가 이 사이트에서 실행될 수 있습니다. 화면 코드(innerHTML)에 넣는 바깥 자료는
     모두 esc()로 감싸고, 링크 주소는 safeUrl()로 http(s)·사이트 안 주소만 허용합니다. */
  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function safeUrl(value, fallback) {
    var url = String(value || "").trim();
    return /^(https?:\/\/|\/(?!\/)|#)/i.test(url) ? url : (fallback || "#");
  }

  function cut40(value) {
    return value ? String(value).slice(0, 40) : null;
  }

  function markApplyButton(el, page, job) {
    el.setAttribute("data-apply-track", page);
    el.setAttribute("data-slug", jobSlug(job));
    el.setAttribute("data-region", job.region || "");
    el.setAttribute("data-category", job.job || "");
  }

  document.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest("[data-apply-track]") : null;
    if (!btn || !window.fetch) return;
    try {
      fetch(CLICK_URL, {
        method: "POST",
        keepalive: true, // 새 창이 열리거나 페이지를 떠나도 요청이 끝까지 가도록
        headers: { apikey: CLICK_KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({
          job_slug: cut40(btn.getAttribute("data-slug")),
          channel: btn.hasAttribute("data-external-apply") ? "external" : "kakao",
          page: btn.getAttribute("data-apply-track"),
          region: cut40(btn.getAttribute("data-region")),
          category: cut40(btn.getAttribute("data-category"))
        })
      }).catch(function () {});
    } catch (err) {}
  });

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

    var counts = getCounts().byRegionDetail[region] || {};
    var names = Object.keys(counts).sort(function (a, b) { return a.localeCompare(b, "ko"); });

    var html = '<option value="">전체</option>';
    names.forEach(function (name) {
      html += '<option value="' + esc(name) + '">' + esc(name) + ' (' + esc(counts[name]) + '건)</option>';
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
    return job.regionDetail ? job.region + " " + job.regionDetail : job.region; // 글자 그대로 — HTML에 넣을 땐 esc()
  }

  function jobCardHTML(job) {
    return (
      '<a class="job-card" href="/jobs/' + esc(jobSlug(job)) + '.html" aria-haspopup="dialog">' +
        '<div class="job-card-top">' +
          '<div>' +
            '<p class="job-title">' + esc(job.title) + '</p>' +
            '<p class="job-company">' + esc(job.company) + '</p>' +
            jobSourceBadge(job) +
          '</div>' +
          (job.isNew ? '<span class="job-tag">NEW</span>' : '') +
        '</div>' +
        '<div class="job-meta"><span>' + esc(jobRegionLabel(job)) + '</span><span>' + esc(job.type) + '</span></div>' +
        '<p class="job-pay">' + esc(job.pay) + '</p>' +
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

  // 목록은 두 가지 방식으로 그립니다.
  //  1) 기본: 매일 아침 전체 고용24 공고(약 2만 건)를 모아 둔 Supabase(mv_site_jobs)에 "지금 보여줄
  //     24건"만 물어봅니다. 4.8MB짜리 전체 파일을 받지 않아 빠르고, 일자리 현황 리포트와 숫자가 같습니다.
  //  2) Supabase에 닿지 않으면 예전처럼 content/*.json 전체를 받아 브라우저에서 거릅니다.
  //  관리자가 직접 등록한 공고(content/jobs.json, ADMIN_JOBS)는 두 방식 모두 맨 앞에 보여줍니다.
  var currentFilter = { region: "", jobs: null, regionDetail: "" };
  var adminMatches = []; // 현재 조건에 맞는 관리자 등록 공고
  var remoteLoaded = []; // Supabase에서 지금까지 받아온 공고
  var remoteTotal = 0; // 현재 조건에 맞는 Supabase 공고 수
  var listRequestSeq = 0; // 검색을 빠르게 바꿀 때 늦게 도착한 예전 응답을 버리기 위한 번호

  function matchesFilter(job) {
    var f = currentFilter;
    return (!f.region || job.region === f.region) &&
      (!f.regionDetail || job.regionDetail === f.regionDetail) &&
      (!f.jobs || f.jobs.indexOf(job.job) !== -1);
  }

  function renderVisiblePage() {
    if (!jobGrid) return;
    var visible = REMOTE_STATS ? adminMatches.concat(remoteLoaded) : currentFullList.slice(0, visibleCount);
    var total = REMOTE_STATS ? adminMatches.length + remoteTotal : currentFullList.length;
    lastFilteredJobs = visible;
    jobGrid.innerHTML = visible.map(jobCardHTML).join("");

    if (jobListStatus) {
      jobListStatus.hidden = total === 0;
      jobListStatus.textContent = "전체 " + total.toLocaleString("ko-KR") + "건 중 " +
        visible.length.toLocaleString("ko-KR") + "건 표시 중";
    }
    if (jobListMoreWrap) jobListMoreWrap.hidden = visible.length >= total;
    if (jobEmpty) jobEmpty.hidden = total !== 0;
  }

  function fetchRemotePage(reset) {
    var seq = ++listRequestSeq;
    var f = currentFilter;
    var params = new URLSearchParams({ select: "*", order: "datePosted.desc,id.desc" });
    if (f.region) params.append("region", "eq." + f.region);
    if (f.regionDetail) params.append("regionDetail", "eq." + f.regionDetail);
    if (f.jobs) params.append("job", "in.(" + f.jobs.map(function (j) { return '"' + j + '"'; }).join(",") + ")");
    var from = reset ? 0 : remoteLoaded.length;
    if (jobListMoreBtn) jobListMoreBtn.disabled = true;
    return fetch(SUPABASE_REST + "mv_site_jobs?" + params.toString(), {
      headers: { apikey: SUPABASE_KEY, Range: from + "-" + (from + JOB_LIST_PAGE_SIZE - 1), Prefer: "count=exact" }
    })
      .then(function (res) {
        if (!res.ok) throw new Error("mv_site_jobs " + res.status);
        var range = res.headers.get("Content-Range") || ""; // 예: "0-23/12345"
        return res.json().then(function (rows) { return { rows: rows, total: parseInt(range.split("/")[1], 10) }; });
      })
      .then(function (page) {
        if (seq !== listRequestSeq) return; // 그 사이 다른 검색을 했으면 버림
        remoteLoaded = reset ? page.rows : remoteLoaded.concat(page.rows);
        remoteTotal = isNaN(page.total) ? remoteLoaded.length : page.total;
        renderVisiblePage();
      })
      .catch(function () {
        if (seq !== listRequestSeq) return;
        if (jobListStatus) {
          jobListStatus.hidden = false;
          jobListStatus.textContent = "일자리 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
        }
      })
      .then(function () { if (jobListMoreBtn) jobListMoreBtn.disabled = false; });
  }

  function renderJobs(filterRegion, filterJob, filterRegionDetail) {
    if (!jobGrid) return;
    // filterJob은 직종 문자열 하나, 직종 배열(활동 강도 필터), 또는 빈 값일 수 있습니다.
    currentFilter = {
      region: filterRegion || "",
      jobs: Array.isArray(filterJob) ? filterJob : (filterJob ? [filterJob] : null),
      regionDetail: filterRegionDetail || ""
    };
    if (REMOTE_STATS) {
      adminMatches = ADMIN_JOBS.filter(matchesFilter).sort(function (a, b) { return jobSortTime(b) - jobSortTime(a); });
      fetchRemotePage(true);
      return;
    }
    var filtered = JOBS.filter(matchesFilter);
    filtered.sort(function (a, b) { return jobSortTime(b) - jobSortTime(a); });
    currentFullList = filtered;
    visibleCount = Math.min(JOB_LIST_PAGE_SIZE, filtered.length); // 새 검색이므로 처음 페이지부터 다시 보여줍니다.
    renderVisiblePage();
  }

  if (jobListMoreBtn) {
    jobListMoreBtn.addEventListener("click", function () {
      if (REMOTE_STATS) {
        fetchRemotePage(false);
        return;
      }
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

    var contactWrap = document.getElementById("jobModalContactWrap");
    if (contactWrap) {
      if (job.contact) {
        contactWrap.hidden = false;
        document.getElementById("jobModalContactText").textContent = job.contact;
      } else {
        contactWrap.hidden = true;
      }
    }

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
      sourceEl.innerHTML = job.source ? jobSourceBadge(job) + " 출처: " + esc(job.source) : "";
    }

    var contactBtn = document.getElementById("jobModalContact");
    if (contactBtn) {
      if (job.applyUrl) {
        contactBtn.href = safeUrl(job.applyUrl, KAKAO_CHANNEL_URL);
        contactBtn.textContent = "지원하기 (원문 공고로 이동)";
        contactBtn.target = "_blank";
        contactBtn.rel = "noopener";
        contactBtn.setAttribute("data-external-apply", "1");
      } else {
        contactBtn.href = KAKAO_CHANNEL_URL || "#";
        contactBtn.textContent = "💬 카카오톡으로 문의하기";
        contactBtn.target = "_blank";
        contactBtn.rel = "noopener";
        contactBtn.removeAttribute("data-external-apply");
      }
      markApplyButton(contactBtn, "modal", job);
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
      if (e.key === "Escape" && !jobModalBackdrop.hidden && (!applyNoticeBackdrop || applyNoticeBackdrop.hidden)) closeJobModal();
    });
  }

  // "지원하기" 버튼이 work24 등 외부 사이트로 연결될 때(data-external-apply 속성이 붙은
  // 링크), 바로 이동시키지 않고 안내 모달을 먼저 띄웁니다. 지역업체 등록 공고(카카오톡
  // 문의)는 이 속성이 없어서 평소처럼 바로 이동합니다.
  var applyNoticeBackdrop = document.getElementById("applyNoticeBackdrop");
  var applyNoticeLastFocused = null;
  var pendingApplyUrl = null;

  function openApplyNotice(url) {
    if (!applyNoticeBackdrop) {
      window.open(url, "_blank", "noopener");
      return;
    }
    pendingApplyUrl = url;
    applyNoticeLastFocused = document.activeElement;
    applyNoticeBackdrop.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeApplyNotice() {
    if (!applyNoticeBackdrop) return;
    applyNoticeBackdrop.hidden = true;
    document.body.style.overflow = jobModalBackdrop && !jobModalBackdrop.hidden ? "hidden" : "";
    pendingApplyUrl = null;
    if (applyNoticeLastFocused && applyNoticeLastFocused.focus) applyNoticeLastFocused.focus();
  }

  if (applyNoticeBackdrop) {
    document.getElementById("applyNoticeClose").addEventListener("click", closeApplyNotice);
    document.getElementById("applyNoticeCancel").addEventListener("click", closeApplyNotice);
    document.getElementById("applyNoticeContinue").addEventListener("click", function () {
      var url = pendingApplyUrl;
      closeApplyNotice();
      if (url) window.open(url, "_blank", "noopener");
    });
    applyNoticeBackdrop.addEventListener("click", function (e) {
      if (e.target === applyNoticeBackdrop) closeApplyNotice();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !applyNoticeBackdrop.hidden) closeApplyNotice();
    });
  }

  document.addEventListener("click", function (e) {
    var link = e.target.closest ? e.target.closest("a[data-external-apply]") : null;
    if (!link) return;
    e.preventDefault();
    openApplyNotice(link.href);
  });

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
  // 홈 화면 숫자. Supabase 요약(mv_site_job_stats)에 관리자 등록 공고를 더하고,
  // 예비 방식(JSON 전체)일 때는 받은 목록에서 직접 셉니다.
  function tally(list) {
    var c = { total: list.length, newCount: 0, companies: {}, byJob: {}, byRegion: {}, byRegionDetail: {} };
    list.forEach(function (j) {
      if (j.isNew) c.newCount++;
      if (j.company) c.companies[j.company] = true;
      if (j.job) c.byJob[j.job] = (c.byJob[j.job] || 0) + 1;
      if (j.region) c.byRegion[j.region] = (c.byRegion[j.region] || 0) + 1;
      if (j.region && j.regionDetail) {
        var d = c.byRegionDetail[j.region] = c.byRegionDetail[j.region] || {};
        d[j.regionDetail] = (d[j.regionDetail] || 0) + 1;
      }
    });
    return c;
  }

  function getCounts() {
    if (!REMOTE_STATS) {
      var all = tally(JOBS);
      all.companyCount = Object.keys(all.companies).length;
      return all;
    }
    var c = tally(ADMIN_JOBS);
    var r = REMOTE_STATS;
    function add(into, from) { Object.keys(from || {}).forEach(function (k) { into[k] = (into[k] || 0) + from[k]; }); }
    add(c.byJob, r.by_job);
    add(c.byRegion, r.by_region);
    Object.keys(r.by_region_detail || {}).forEach(function (region) {
      c.byRegionDetail[region] = c.byRegionDetail[region] || {};
      add(c.byRegionDetail[region], r.by_region_detail[region]);
    });
    c.total += r.total;
    c.newCount += r.new_count;
    c.companyCount = Object.keys(c.companies).length + r.companies; // 관리자 등록 업체와 겹칠 수 있지만 몇 곳 안 됩니다
    return c;
  }

  function updateStats() {
    var counts = getCounts();
    var totalEl = document.getElementById("statTotalJobs");
    if (totalEl) totalEl.textContent = counts.total.toLocaleString("ko-KR") + "개";

    // 신규 일자리: 최근 3일 안에 올라온 공고(관리자 등록 공고는 "신규 표시"를 켠 것)
    var newEl = document.getElementById("statNewJobs");
    if (newEl) newEl.textContent = counts.newCount.toLocaleString("ko-KR") + "개";

    // 제휴 기관·기업: 공고를 낸 기관/업체 수
    var partnersEl = document.getElementById("statPartners");
    if (partnersEl) partnersEl.textContent = counts.companyCount.toLocaleString("ko-KR") + "곳";

    // 건수가 많은 순으로 정렬해서 보여줍니다 (일자리 현황 리포트와 순서를 맞춤)
    var jobCardEntries = Array.prototype.slice.call(document.querySelectorAll(".category-card[data-job]")).map(function (card) {
      var job = card.getAttribute("data-job");
      var countEl = card.querySelector(".cat-count");
      var count = job ? counts.byJob[job] || 0 : 0;
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
      var count = counts.byRegion[region] || 0;
      countEl.textContent = "일자리 " + count + "건";
    });

    document.querySelectorAll(".category-card[data-difficulty]").forEach(function (card) {
      var key = card.getAttribute("data-difficulty");
      var countEl = card.querySelector(".cat-count");
      var entry = DIFFICULTY_MAP[key];
      if (!entry || !countEl) return;
      var count = entry.jobs.reduce(function (sum, j) { return sum + (counts.byJob[j] || 0); }, 0);
      countEl.textContent = "일자리 " + count + "건";
    });
  }

  /* content/jobs.json = 관리자가 CMS로 직접 등록한 일자리 (항상 파일에서 읽음)
     고용24 공고 = Supabase 요약(mv_site_job_stats)·목록(mv_site_jobs). 닿지 않으면
     예전처럼 content/jobs-external.json 전체를 받아서 씁니다. */
  var ADMIN_JOBS = [];
  var REMOTE_STATS = null;

  function fetchJobsFile(path) {
    return fetch(path)
      .then(function (res) { return res.ok ? res.json() : { jobs: [] }; })
      .then(function (data) { return data.jobs || []; })
      .catch(function () { return []; });
  }

  function fetchRemoteStats() {
    return fetch(SUPABASE_REST + "mv_site_job_stats?select=*", { headers: { apikey: SUPABASE_KEY } })
      .then(function (res) { if (!res.ok) throw new Error("stats " + res.status); return res.json(); })
      .then(function (rows) { if (!rows.length || !rows[0].total) throw new Error("stats empty"); return rows[0]; });
  }

  Promise.all([fetchJobsFile("/content/jobs.json"), fetchRemoteStats().catch(function () { return null; })])
    .then(function (results) {
      ADMIN_JOBS = results[0];
      REMOTE_STATS = results[1];
      if (REMOTE_STATS) return;
      return fetchJobsFile("/content/jobs-external.json").then(function (external) {
        var combined = ADMIN_JOBS.concat(external);
        JOBS = combined.length ? combined : FALLBACK_JOBS;
      });
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
    var safeHref = safeUrl(notice.link);
    return (
      '<li>' +
        (notice.isNew ? '<span class="tag tag-new">신규</span>' : '') +
        '<a href="' + esc(safeHref) + '">' + esc(notice.title) + '</a>' +
        '<time>' + esc(notice.date) + '</time>' +
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
        '<p>“' + esc(review.content) + '”</p>' +
        '<cite>' + esc(review.name) + ' · ' + esc(review.jobTitle) + '</cite>' +
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

  /* ---------------- 어르신 복지정보 (welfare.html 전용, content/welfare-info.json에서 불러옴) ---------------- */
  var welfareList = document.getElementById("welfareList");
  if (welfareList) {
    var welfareStatus = document.getElementById("welfareStatus");
    var welfareEmpty = document.getElementById("welfareEmpty");
    var welfareSyncedAt = document.getElementById("welfareSyncedAt");
    var welfareFilter = document.getElementById("welfareFilter");
    var allWelfareServices = [];
    var activeWelfareTheme = "";

    function formatYmd(ymd) {
      var m = /^(\d{4})(\d{2})(\d{2})$/.exec(ymd || "");
      return m ? m[1] + "." + m[2] + "." + m[3] : "";
    }

    function welfareCardHTML(item) {
      var metaParts = [item.theme, item.region].filter(Boolean);
      var detailParts = [];
      if (item.applyMethod) detailParts.push("신청방법: " + item.applyMethod);
      if (item.benefitType) detailParts.push("지원형태: " + item.benefitType);
      return (
        '<div class="legal-box" style="margin-bottom:14px;">' +
          '<p style="margin:0; font-size:.8rem; color:var(--color-text-muted);">' + esc(metaParts.join(" · ")) + '</p>' +
          '<p style="margin:6px 0 0; font-weight:700;">' + esc(item.title) + '</p>' +
          (item.description ? '<p style="margin:6px 0 0;">' + esc(item.description) + '</p>' : "") +
          (detailParts.length ? '<p style="margin:8px 0 0; font-size:.85rem;">' + esc(detailParts.join(" · ")) + '</p>' : "") +
          '<p style="margin:8px 0 0; font-size:.8rem; color:var(--color-text-muted);">' +
            (item.lastModYmd ? "갱신일: " + formatYmd(item.lastModYmd) : "") +
            (item.url ? ' · <a href="' + esc(safeUrl(item.url)) + '" target="_blank" rel="noopener" style="text-decoration:underline; font-weight:700;">복지로에서 자세히 보기 →</a>' : "") +
          '</p>' +
        '</div>'
      );
    }

    function renderWelfareList() {
      // theme은 "서민금융, 일자리"처럼 해당 서비스의 모든 관심주제가 쉼표로 묶여
      // 내려오므로, 필터 버튼 라벨이 그 안에 포함되어 있는지로 판단합니다.
      var filtered = activeWelfareTheme
        ? allWelfareServices.filter(function (s) { return (s.theme || "").indexOf(activeWelfareTheme) !== -1; })
        : allWelfareServices;
      welfareList.innerHTML = filtered.map(welfareCardHTML).join("");
      if (welfareEmpty) welfareEmpty.hidden = filtered.length > 0;
    }

    if (welfareFilter) {
      welfareFilter.addEventListener("click", function (e) {
        var btn = e.target.closest ? e.target.closest("[data-welfare-theme]") : null;
        if (!btn) return;
        activeWelfareTheme = btn.getAttribute("data-welfare-theme") || "";
        Array.prototype.forEach.call(welfareFilter.querySelectorAll("[data-welfare-theme]"), function (b) {
          b.classList.toggle("btn-primary", b === btn);
          b.classList.toggle("btn-outline", b !== btn);
        });
        renderWelfareList();
      });
    }

    fetch("/content/welfare-info.json")
      .then(function (res) { return res.ok ? res.json() : Promise.reject(res.status); })
      .then(function (data) {
        allWelfareServices = data.services || [];
        if (welfareStatus) welfareStatus.hidden = true;
        if (welfareSyncedAt && data.syncedAt) {
          welfareSyncedAt.textContent = "마지막 갱신: " + new Date(data.syncedAt).toLocaleDateString("ko-KR");
        }
        renderWelfareList();
      })
      .catch(function () {
        if (welfareStatus) welfareStatus.textContent = "복지정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
      });
  }

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
