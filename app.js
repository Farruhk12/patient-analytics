// ============================================================
// MedAnalytics — Дашборд анализов пациентов
// ============================================================

// URL и API-ключи вынесены в config.js (не коммитится в git)
const SCRIPT_URL = window.APP_CONFIG ? window.APP_CONFIG.SCRIPT_URL : '';

// Мета-строки в данных, которые нужно отфильтровать
const META_NAMES = ['единица измерения', 'нжний порог нормы', 'нижний порог нормы', 'верхний порог нормы'];

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_FULL = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const state = {
  patients: [],
  indicators: [],
  categories: [],
  analyses: [],
  selectedPatient: null,
  selectedCategory: '',
  currentMainTab: 'dashboard', // 'dashboard' | 'table' | 'charts'
  currentTab: 'table',         // legacy (used by chart rendering)
  charts: [],
  dashCharts: [],
  tableFilters: { category: '', country: '', lab: '', dateFrom: '', dateTo: '' }
};

// ===== INIT =====
document.addEventListener('DOMContentLoaded', init);

function init() {
  // Проверяем авторизацию
  var session = Auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return;
  }

  setupUserBar(session);
  setupEventListeners();
  fetchData();
}

// ===== USER BAR =====
function setupUserBar(session) {
  var initials = session.name.trim().split(/\s+/).map(function(w) { return w[0] || ''; }).join('').toUpperCase().slice(0, 2);
  $('currentUserAvatar').textContent = initials;
  $('currentUserName').textContent = session.name;
  $('currentUserRole').textContent = session.role === 'admin' ? 'Администратор' : 'Пользователь';

  if (session.role === 'admin') {
    $('adminAccessBtn').classList.remove('hidden');
  }
}

function setupEventListeners() {
  $('refreshBtn').addEventListener('click', function() { fetchData(); });
  $('patientSearch').addEventListener('input', onPatientSearch);
  $('retryBtn').addEventListener('click', function() { fetchData(); });

  // Main profile tabs (Dashboard / Table / Charts)
  document.querySelectorAll('.main-tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { switchMainTab(btn.dataset.mainTab); });
  });

  // Legacy chart category pills (in Charts tab)
  // (pills are rendered dynamically, listeners attached in renderCategoryPills)

  // Mobile sidebar toggle
  $('menuBtn').addEventListener('click', toggleSidebar);
  $('sidebarOverlay').addEventListener('click', closeSidebar);

  // AI toggle
  $('aiToggleBtn').addEventListener('click', toggleAiBody);

  // Logout
  $('logoutBtn').addEventListener('click', function() { Auth.logout(); });

  // Theme toggle
  $('themeToggleBtn').addEventListener('click', toggleTheme);

  // Admin access modal
  $('adminAccessBtn').addEventListener('click', openAccessModal);
  $('closeAccessModal').addEventListener('click', closeAccessModal);
  $('accessModal').addEventListener('click', function(e) {
    if (e.target === $('accessModal')) closeAccessModal();
  });
  $('accessPatientSelect').addEventListener('change', onAccessPatientChange);
  $('saveAccessBtn').addEventListener('click', saveAccess);

  // Table filters
  ['filterCategory', 'filterCountry', 'filterLab', 'filterDateFrom', 'filterDateTo'].forEach(function(id) {
    $(id).addEventListener('change', onFilterChange);
  });
  $('filterResetBtn').addEventListener('click', resetFilters);
}

function toggleSidebar() {
  document.querySelector('.sidebar').classList.toggle('open');
  $('sidebarOverlay').classList.toggle('active');
  document.body.classList.toggle('sidebar-open');
}

function closeSidebar() {
  document.querySelector('.sidebar').classList.remove('open');
  $('sidebarOverlay').classList.remove('active');
  document.body.classList.remove('sidebar-open');
}

// ===== FETCH =====
async function fetchData() {
  showLoading();
  updateStatus('loading');
  setRefreshing(true);

  try {
    var json = null;
    try {
      var response = await fetch(SCRIPT_URL);
      json = await response.json();
    } catch (fetchErr) {
      console.warn('Fetch failed, trying JSONP:', fetchErr);
      json = await fetchJsonp(SCRIPT_URL);
    }

    if (!json || !json.success) {
      throw new Error(json && json.error ? json.error : 'Неизвестная ошибка сервера');
    }

    state.patients = json.patients || [];
    state.indicators = json.indicators || [];
    state.categories = json.categories || [];

    // Фильтруем мета-строки из анализов и очищаем значения-артефакты
    state.analyses = (json.analyses || []).filter(function(a) {
      if (!a.name) return false;
      var lower = a.name.toLowerCase().trim();
      if (META_NAMES.indexOf(lower) >= 0) return false;
      if (!a.testDate) return false;
      return true;
    }).map(function(a) {
      // Убираем ISO-строки дат из значений показателей (артефакт Google Sheets)
      var cleanVals = {};
      Object.keys(a.values).forEach(function(k) {
        var v = a.values[k];
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return;
        cleanVals[k] = v;
      });
      a.values = cleanVals;
      return a;
    });

    // Синхронизируем данные авторизации пользователей из таблицы
    syncPatientsAuth(state.patients);

    updateStatus('connected');
    $('refreshBtn').disabled = false;
    renderPatientList();
    showHomeView();

  } catch (err) {
    console.error('Ошибка загрузки:', err);
    showError('Не удалось загрузить данные: ' + err.message);
    updateStatus('error');
  } finally {
    setRefreshing(false);
  }
}

function fetchJsonp(url) {
  return new Promise(function(resolve, reject) {
    // Имя callback только из безопасных символов (защита от инъекции)
    var cb = '_cb_' + Date.now() + '_' + Math.floor(Math.random() * 9999);
    if (!/^[A-Za-z0-9_]+$/.test(cb)) { reject(new Error('Небезопасное имя callback')); return; }
    var s = document.createElement('script');
    var t = setTimeout(function() { cleanup(); reject(new Error('Таймаут')); }, 30000);
    function cleanup() { clearTimeout(t); delete window[cb]; if (s.parentNode) s.remove(); }
    window[cb] = function(d) { cleanup(); resolve(d); };
    s.onerror = function() { cleanup(); reject(new Error('JSONP ошибка')); };
    // URL только с разрешёнными протоколами
    if (!/^https:\/\//.test(url)) { cleanup(); reject(new Error('Небезопасный URL')); return; }
    s.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'callback=' + encodeURIComponent(cb);
    document.head.appendChild(s);
  });
}

// ===== DATE FORMATTING =====
function parseDate(val) {
  if (!val) return null;
  var s = String(val);
  // ISO format
  if (s.indexOf('T') > 0 || s.indexOf('-') === 4) {
    var d = new Date(s);
    if (!isNaN(d.getTime())) return d;
  }
  // dd.MM.yyyy
  var parts = s.split('.');
  if (parts.length === 3 && parts[2].length === 4) {
    var d2 = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    if (!isNaN(d2.getTime())) return d2;
  }
  return null;
}

function fmtDate(val) {
  var d = parseDate(val);
  if (!d) return String(val || '');
  var day = String(d.getDate()).padStart(2, '0');
  var mon = String(d.getMonth() + 1).padStart(2, '0');
  return day + '.' + mon + '.' + d.getFullYear();
}

function fmtDateLong(val) {
  var d = parseDate(val);
  if (!d) return String(val || '');
  return d.getDate() + ' ' + MONTHS_FULL[d.getMonth()] + ' ' + d.getFullYear();
}

function fmtDateShort(val) {
  var d = parseDate(val);
  if (!d) return String(val || '');
  return MONTHS_SHORT[d.getMonth()] + ' ' + d.getFullYear();
}

function fmtDateChart(val) {
  var d = parseDate(val);
  if (!d) return String(val || '');
  var day = String(d.getDate()).padStart(2, '0');
  var mon = String(d.getMonth() + 1).padStart(2, '0');
  return day + '.' + mon + '.' + String(d.getFullYear()).slice(2);
}

function sortByDate(a, b) {
  var da = parseDate(a.testDate);
  var db = parseDate(b.testDate);
  return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
}

// ===== PATIENT LIST =====
function renderPatientList() {
  var el = $('patientList');
  el.innerHTML = '';

  // Фильтрация по правам доступа
  var visiblePatients = state.patients.filter(function(p) {
    return Auth.canViewPatient(p.name);
  });

  visiblePatients.forEach(function(p) {
    var count = 0;
    for (var i = 0; i < state.analyses.length; i++) {
      if (state.analyses[i].name === p.name) count++;
    }

    var item = document.createElement('div');
    item.className = 'patient-item';
    item.setAttribute('data-name', p.name);

    var initials = p.name.trim().split(/\s+/).map(function(w) { return w[0] || ''; }).join('').toUpperCase().slice(0, 2);

    item.innerHTML =
      '<div class="patient-avatar">' + esc(initials) + '</div>' +
      '<div class="patient-info">' +
        '<div class="patient-name">' + esc(p.name) + '</div>' +
        '<div class="patient-meta">' + esc(p.gender || '') + (p.age ? ', ' + p.age + ' лет' : '') + '</div>' +
      '</div>' +
      (count > 0 ? '<span class="patient-badge">' + count + '</span>' : '');

    item.addEventListener('click', function() { selectPatient(p.name); });
    el.appendChild(item);
  });
}

function onPatientSearch(e) {
  var q = e.target.value.toLowerCase().trim();
  document.querySelectorAll('.patient-item').forEach(function(item) {
    var name = (item.getAttribute('data-name') || '').toLowerCase();
    item.style.display = name.indexOf(q) >= 0 ? '' : 'none';
  });
}

// ===== SELECT PATIENT =====
function selectPatient(name) {
  var patient = null;
  for (var i = 0; i < state.patients.length; i++) {
    if (state.patients[i].name === name) { patient = state.patients[i]; break; }
  }
  if (!patient) return;

  state.selectedPatient = patient;

  document.querySelectorAll('.patient-item').forEach(function(el) {
    el.classList.toggle('active', el.getAttribute('data-name') === name);
  });

  var analyses = getPatientAnalyses(name);
  var cats = getAvailableCategories(analyses);

  if (cats.length > 0) {
    state.selectedCategory = cats[0];
  } else {
    state.selectedCategory = '';
  }

  // Reset table filters
  state.tableFilters = { category: '', country: '', lab: '', dateFrom: '', dateTo: '' };

  hideAllViews();
  $('patientView').classList.remove('hidden');

  renderPatientInfo(patient);

  // Populate filter dropdowns (needs analyses)
  populateFilterDropdowns(analyses, cats);

  // Show dashboard tab by default
  switchMainTab('dashboard');

  // Close sidebar on mobile after selecting patient
  if (window.innerWidth <= 768) {
    closeSidebar();
  }
}

function normalizeName(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function getPatientAnalyses(name) {
  var n = normalizeName(name);
  return state.analyses.filter(function(a) { return normalizeName(a.name) === n; }).sort(sortByDate);
}

function getAvailableCategories(analyses) {
  var set = {};
  analyses.forEach(function(a) {
    state.indicators.forEach(function(ind) {
      if (a.values[ind.name] !== undefined) set[ind.category] = true;
    });
  });
  return state.categories.filter(function(c) { return set[c]; });
}

// ===== PATIENT INFO CARD =====
// Ищет историю конкретного показателя по всем анализам пациента (сортировка по дате)
function getVitalHistory(analyses, keys) {
  var result = [];
  analyses.forEach(function(a) {
    for (var k = 0; k < keys.length; k++) {
      var v = a.values[keys[k]];
      if (v !== undefined && v !== '') {
        var num = parseFloat(String(v).replace(',', '.'));
        if (!isNaN(num)) {
          result.push({ date: a.testDate, value: num, raw: v });
          return;
        }
      }
    }
  });
  return result; // уже отсортирован по дате (getPatientAnalyses → sortByDate)
}

// Строит мини-плашку динамики: текущее значение + дельта к предыдущему
function renderVitalTile(label, unit, history, warnHigh, warnLow) {
  if (history.length === 0) return '';

  var last = history[history.length - 1];
  var prev = history.length > 1 ? history[history.length - 2] : null;

  var deltaHtml = '';
  if (prev) {
    var diff = last.value - prev.value;
    var pct  = prev.value !== 0 ? Math.round(Math.abs(diff) / prev.value * 100) : 0;
    var dir  = diff > 0 ? 'up' : 'down';
    var arrow = diff > 0
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>';
    deltaHtml = '<span class="vital-delta vital-delta--' + dir + '">' + arrow + pct + '%</span>';
  }

  var warn = '';
  if (warnHigh !== undefined && last.value > warnHigh) warn = ' vital-tile--warn';
  if (warnLow  !== undefined && last.value < warnLow)  warn = ' vital-tile--warn';

  return '<div class="vital-tile' + warn + '">' +
    '<div class="vital-tile-label">' + esc(label) + '</div>' +
    '<div class="vital-tile-value">' +
      '<span class="vital-tile-num">' + formatValue(last.value) + '</span>' +
      (unit ? '<span class="vital-tile-unit">' + esc(unit) + '</span>' : '') +
      deltaHtml +
    '</div>' +
    (prev ? '<div class="vital-tile-prev">пред.: ' + formatValue(prev.value) + ' ' + esc(unit || '') + '</div>' : '') +
  '</div>';
}

function renderPatientInfo(patient) {
  var card = $('patientInfoCard');
  var analyses = getPatientAnalyses(patient.name);

  var genderIcon = patient.gender === 'Жен'
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="5"/><path d="M12 13v8"/><path d="M9 18h6"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="14" r="5"/><path d="M19 5l-5.4 5.4"/><path d="M15 5h4v4"/></svg>';
  var genderClass = patient.gender === 'Жен' ? 'info-gender--f' : 'info-gender--m';

  // ── Демография ──
  var demoItems = [];
  if (patient.gender)     demoItems.push({ icon: genderIcon, label: 'Пол',          val: patient.gender });
  if (patient.birthDate)  demoItems.push({ icon: iconCalendar(), label: 'Дата рождения', val: fmtDateLong(patient.birthDate) });
  if (patient.age)        demoItems.push({ icon: iconAge(),    label: 'Возраст',     val: patient.age + ' лет' });
  if (patient.bloodGroup) demoItems.push({ icon: iconBlood(),  label: 'Группа крови',val: patient.bloodGroup });

  var demoHtml = demoItems.map(function(d) {
    return '<div class="demo-item">' +
      '<div class="demo-item-icon">' + d.icon + '</div>' +
      '<div class="demo-item-body">' +
        '<div class="demo-item-label">' + esc(d.label) + '</div>' +
        '<div class="demo-item-val">' + esc(d.val) + '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  // ── Витальные показатели из анализов ──
  var weightH = getVitalHistory(analyses, ['Вес', 'Масса тела', 'Вес (кг)', 'Weight']);
  var heightH = getVitalHistory(analyses, ['Рост', 'Рост (см)', 'Height']);
  var bpSysH  = getVitalHistory(analyses, ['АД систолическое', 'АД сист', 'АД сис', 'Систолическое АД', 'АД (сист.)']);
  var bpDiaH  = getVitalHistory(analyses, ['АД диастолическое', 'АД диаст', 'АД диа', 'Диастолическое АД', 'АД (диаст.)']);

  var vitalsHtml = '';
  vitalsHtml += renderVitalTile('Вес', 'кг', weightH);
  vitalsHtml += renderVitalTile('Рост', 'см', heightH);
  vitalsHtml += renderVitalTile('АД систол.', 'мм рт.ст.', bpSysH, 140, 90);
  vitalsHtml += renderVitalTile('АД диастол.', 'мм рт.ст.', bpDiaH, 90, 60);

  // ИМТ из веса и роста
  var imtHtml = '';
  if (weightH.length > 0 && heightH.length > 0) {
    var w = weightH[weightH.length - 1].value;
    var h = heightH[heightH.length - 1].value / 100;
    if (h > 0) {
      var bmi = Math.round(w / (h * h) * 10) / 10;
      var bmiClass = bmi < 18.5 ? 'imt--low' : bmi < 25 ? 'imt--ok' : bmi < 30 ? 'imt--warn' : 'imt--high';
      var bmiLabel = bmi < 18.5 ? 'Дефицит' : bmi < 25 ? 'Норма' : bmi < 30 ? 'Избыток' : 'Ожирение';
      imtHtml = '<div class="vital-tile ' + bmiClass + '">' +
        '<div class="vital-tile-label">ИМТ</div>' +
        '<div class="vital-tile-value"><span class="vital-tile-num">' + bmi + '</span></div>' +
        '<div class="vital-tile-prev">' + bmiLabel + '</div>' +
      '</div>';
    }
  }

  var hasVitals = vitalsHtml.replace(/<div[^>]*><\/div>/g, '').trim() !== '' || imtHtml !== '';

  card.innerHTML =
    '<div class="info-card-main">' +
      '<div class="info-avatar ' + genderClass + '">' + genderIcon + '</div>' +
      '<div class="info-primary">' +
        '<h2 class="info-name">' + esc(patient.name) + '</h2>' +
        '<div class="info-stats">' +
          '<div class="info-stat"><div class="info-stat-num">' + analyses.length + '</div><div class="info-stat-label">Анализов</div></div>' +
          '<div class="info-stat"><div class="info-stat-num">' + getAvailableCategories(analyses).length + '</div><div class="info-stat-label">Категорий</div></div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="demo-grid">' + demoHtml + '</div>' +
    (hasVitals ? '<div class="vitals-section"><div class="vitals-label">Антропометрия и АД</div><div class="vitals-grid">' + vitalsHtml + imtHtml + '</div></div>' : '');
}

// Иконки SVG для демографии
function iconCalendar() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
}
function iconAge() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
}
function iconBlood() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6 9 4 13 4 16a8 8 0 0016 0c0-3-2-7-8-14z"/></svg>';
}

// ===== DEVIATIONS MINI-REPORT =====
function renderDeviationsReport(patient) {
  var el = $('deviationsReport');
  var analyses = getPatientAnalyses(patient.name);

  if (analyses.length === 0) {
    el.classList.add('hidden');
    return;
  }

  // Берём последний анализ (самую свежую дату)
  var latest = analyses[analyses.length - 1];
  var latestDate = fmtDate(latest.testDate);
  var gender = patient.gender || '';

  // Собираем отклонения
  var highs = [];
  var lows = [];
  var normals = 0;
  var noNorm = 0;

  var keys = Object.keys(latest.values);
  keys.forEach(function(indName) {
    var val = latest.values[indName];
    if (val === undefined || val === '' || val === null) return;
    var num = parseFloat(val);
    if (isNaN(num)) return;

    var norm = getNorm(indName, gender);
    if (!norm) {
      noNorm++;
      return;
    }

    var cls = classifyValue(num, norm[0], norm[1]);
    if (cls === 'high') {
      highs.push({ name: indName, value: num, norm: norm });
    } else if (cls === 'low') {
      lows.push({ name: indName, value: num, norm: norm });
    } else {
      normals++;
    }
  });

  var totalChecked = highs.length + lows.length + normals;
  var totalDeviated = highs.length + lows.length;

  // Строим HTML
  var html = '';

  // Заголовок
  html += '<div class="dev-header">';
  html += '<div class="dev-header-left">';
  html += '<svg class="dev-header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>';
  html += '<div>';
  html += '<div class="dev-title">Последний анализ — ' + esc(latestDate) + '</div>';
  html += '<div class="dev-subtitle">Проверено ' + totalChecked + ' показател' + pluralEnd(totalChecked) + ' с известной нормой</div>';
  html += '</div>';
  html += '</div>';

  // Мини-счётчики + кнопка AI
  html += '<div class="dev-right">';
  html += '<div class="dev-counters">';
  if (totalDeviated === 0) {
    html += '<span class="dev-counter dev-counter--ok"><span class="dev-counter-num">' + normals + '</span> в норме</span>';
  } else {
    if (highs.length > 0) {
      html += '<span class="dev-counter dev-counter--high"><span class="dev-counter-num">' + highs.length + '</span> выше</span>';
    }
    if (lows.length > 0) {
      html += '<span class="dev-counter dev-counter--low"><span class="dev-counter-num">' + lows.length + '</span> ниже</span>';
    }
    html += '<span class="dev-counter dev-counter--ok"><span class="dev-counter-num">' + normals + '</span> в норме</span>';
  }
  html += '</div>';
  if (totalDeviated > 0) {
    html += '<button class="dev-ai-btn" id="devAiBtn">';
    html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a4 4 0 014 4v1a1 1 0 001 1h1a4 4 0 010 8h-1a1 1 0 00-1 1v1a4 4 0 01-8 0v-1a1 1 0 00-1-1H6a4 4 0 010-8h1a1 1 0 001-1V6a4 4 0 014-4z"/><circle cx="12" cy="12" r="2"/></svg>';
    html += ' AI';
    html += '</button>';
  }
  html += '</div>';
  html += '</div>';

  // Если есть отклонения — показываем карточки
  if (totalDeviated > 0) {
    html += '<div class="dev-items">';

    highs.forEach(function(item) {
      var pct = item.norm[1] !== 0 ? Math.round((item.value - item.norm[1]) / item.norm[1] * 100) : 0;
      html += '<div class="dev-item dev-item--high">';
      html += '<div class="dev-item-icon">▲</div>';
      html += '<div class="dev-item-body">';
      html += '<div class="dev-item-name">' + esc(item.name) + '</div>';
      html += '<div class="dev-item-vals">';
      html += '<span class="dev-item-value">' + formatValue(item.value) + '</span>';
      html += '<span class="dev-item-norm">норма: ' + item.norm[0] + '–' + item.norm[1] + '</span>';
      if (pct > 0) html += '<span class="dev-item-pct">+' + pct + '%</span>';
      html += '</div>';
      html += '</div>';
      html += '</div>';
    });

    lows.forEach(function(item) {
      var pct = item.norm[0] !== 0 ? Math.round((item.norm[0] - item.value) / item.norm[0] * 100) : 0;
      html += '<div class="dev-item dev-item--low">';
      html += '<div class="dev-item-icon">▼</div>';
      html += '<div class="dev-item-body">';
      html += '<div class="dev-item-name">' + esc(item.name) + '</div>';
      html += '<div class="dev-item-vals">';
      html += '<span class="dev-item-value">' + formatValue(item.value) + '</span>';
      html += '<span class="dev-item-norm">норма: ' + item.norm[0] + '–' + item.norm[1] + '</span>';
      if (pct > 0) html += '<span class="dev-item-pct">-' + pct + '%</span>';
      html += '</div>';
      html += '</div>';
      html += '</div>';
    });

    html += '</div>';
  } else {
    // Всё в норме
    html += '<div class="dev-all-ok">';
    html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
    html += '<span>Все проверенные показатели в норме</span>';
    html += '</div>';
  }

  el.innerHTML = html;
  el.classList.remove('hidden');

  // Скрываем AI секцию по умолчанию
  $('aiSection').classList.add('hidden');

  // Привязываем кнопку AI
  if (totalDeviated > 0) {
    var allDeviations = [];
    highs.forEach(function(item) {
      allDeviations.push({ name: item.name, value: item.value, norm: item.norm, type: 'high' });
    });
    lows.forEach(function(item) {
      allDeviations.push({ name: item.name, value: item.value, norm: item.norm, type: 'low' });
    });

    $('devAiBtn').addEventListener('click', function() {
      this.disabled = true;
      this.classList.add('active');
      showAiSection(allDeviations, patient);
    });
  }
}

function pluralEnd(n) {
  var mod10 = n % 10;
  var mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return 'ей';
  if (mod10 === 1) return 'ь';
  if (mod10 >= 2 && mod10 <= 4) return 'я';
  return 'ей';
}

function toggleAiBody() {
  var section = $('aiSection');
  section.classList.toggle('collapsed');
}

// ===== AI ANALYSIS (Gemini) =====
var GEMINI_MODEL = window.APP_CONFIG ? window.APP_CONFIG.GEMINI_MODEL : 'gemini-2.0-flash';
var GEMINI_API_KEY = window.APP_CONFIG ? window.APP_CONFIG.GEMINI_API_KEY : '';
var _aiAbort = null;

function showAiSection(deviations, patient) {
  var section = $('aiSection');

  if (!deviations || deviations.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  requestAiAnalysis(deviations, patient);
}

function requestAiAnalysis(deviations, patient) {
  var body = $('aiBody');
  var retryBtn = $('aiRetryBtn');

  // Отменяем предыдущий запрос
  if (_aiAbort) { try { _aiAbort.abort(); } catch(e) {} }
  _aiAbort = new AbortController();

  retryBtn.classList.add('hidden');

  // Показываем загрузку
  body.innerHTML =
    '<div class="ai-loading">' +
      '<div class="ai-loading-dots"><span></span><span></span><span></span></div>' +
      '<span>Анализирую отклонения...</span>' +
    '</div>';

  var gender = patient.gender || 'неизвестно';
  var age = patient.age || 'неизвестно';

  // Формируем список отклонений
  var lines = deviations.map(function(d) {
    var dir = d.type === 'high' ? 'ВЫШЕ нормы' : 'НИЖЕ нормы';
    return d.name + ': ' + d.value + ' (' + dir + ', норма ' + d.norm[0] + '–' + d.norm[1] + ')';
  });

  var prompt = 'Ты — медицинский ассистент. Пользователь: пол ' + gender + ', возраст ' + age + ' лет.\n\n' +
    'Отклонения в последнем анализе крови:\n' + lines.join('\n') + '\n\n' +
    'Ответь СТРОГО в формате трёх блоков (каждый блок начинается с метки на отдельной строке):\n\n' +
    '[ПРИЧИНЫ]\n' +
    'Кратко перечисли 2-4 возможных причины отклонений (каждая с новой строки, начиная с «• »)\n\n' +
    '[ВНИМАНИЕ]\n' +
    'Укажи 2-3 симптома или состояния на которые обратить внимание (каждая с новой строки, начиная с «• »)\n\n' +
    '[ОБСЛЕДОВАНИЯ]\n' +
    'Укажи 2-3 дополнительных обследования (каждая с новой строки, начиная с «• »)\n\n' +
    'Правила: Пиши КРАТКО, по 1 строке на пункт. Не ставь диагнозов. Без вступлений и заключений. Только блоки.';

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + encodeURIComponent(GEMINI_API_KEY);

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: _aiAbort.signal,
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 600
      }
    })
  })
  .then(function(resp) {
    if (!resp.ok) {
      return resp.json().then(function(err) {
        throw new Error(err.error ? err.error.message : 'Ошибка ' + resp.status);
      });
    }
    return resp.json();
  })
  .then(function(data) {
    var text = '';
    try {
      text = data.candidates[0].content.parts[0].text;
    } catch(e) {
      throw new Error('Пустой ответ от модели');
    }
    renderAiResult(text);
    retryBtn.classList.remove('hidden');
  })
  .catch(function(err) {
    if (err.name === 'AbortError') return;
    var msg = err.message || 'Неизвестная ошибка';
    body.innerHTML = '<div class="ai-error">Ошибка: ' + esc(msg) + '</div>';
    retryBtn.classList.remove('hidden');
  });

  // Привязываем retry
  retryBtn.onclick = function() {
    requestAiAnalysis(deviations, patient);
  };
}

function renderAiResult(text) {
  var body = $('aiBody');

  // Парсим блоки [ПРИЧИНЫ], [ВНИМАНИЕ], [ОБСЛЕДОВАНИЯ]
  var blocks = parseAiBlocks(text);
  var html = '<div class="ai-blocks">';

  if (blocks.causes) {
    html += '<div class="ai-block ai-block--red">';
    html += '<div class="ai-block-head">';
    html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    html += '<span>Возможные причины</span></div>';
    html += '<ul>' + blocks.causes.map(function(l) { return '<li>' + escLine(l) + '</li>'; }).join('') + '</ul>';
    html += '</div>';
  }

  if (blocks.attention) {
    html += '<div class="ai-block ai-block--amber">';
    html += '<div class="ai-block-head">';
    html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    html += '<span>Обратите внимание</span></div>';
    html += '<ul>' + blocks.attention.map(function(l) { return '<li>' + escLine(l) + '</li>'; }).join('') + '</ul>';
    html += '</div>';
  }

  if (blocks.tests) {
    html += '<div class="ai-block ai-block--green">';
    html += '<div class="ai-block-head">';
    html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>';
    html += '<span>Рекомендуемые обследования</span></div>';
    html += '<ul>' + blocks.tests.map(function(l) { return '<li>' + escLine(l) + '</li>'; }).join('') + '</ul>';
    html += '</div>';
  }

  // Если парсинг не сработал — фоллбэк
  if (!blocks.causes && !blocks.attention && !blocks.tests) {
    var fallback = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/^[\-\*•]\s+(.+)$/gm, '<li>$1</li>')
      .replace(/\n/g, '<br>');
    fallback = fallback.replace(/((?:<li>[\s\S]*?<\/li>\s*)+)/g, '<ul>$1</ul>');
    html += '<div class="ai-block ai-block--neutral"><p>' + fallback + '</p></div>';
  }

  html += '</div>';
  body.innerHTML = html;
}

function parseAiBlocks(text) {
  var result = { causes: null, attention: null, tests: null };
  var sections = text.split(/\[(?:ПРИЧИНЫ|ВНИМАНИЕ|ОБСЛЕДОВАНИЯ)\]/i);
  var labels = text.match(/\[(?:ПРИЧИНЫ|ВНИМАНИЕ|ОБСЛЕДОВАНИЯ)\]/gi) || [];

  for (var i = 0; i < labels.length; i++) {
    var content = (sections[i + 1] || '').trim();
    var items = content.split('\n')
      .map(function(l) { return l.replace(/^[\-\*•]\s*/, '').replace(/^\d+[\.\)]\s*/, '').trim(); })
      .filter(function(l) { return l.length > 0; });
    if (items.length === 0) continue;

    var tag = labels[i].toUpperCase();
    if (tag.indexOf('ПРИЧИН') >= 0) result.causes = items;
    else if (tag.indexOf('ВНИМАН') >= 0) result.attention = items;
    else if (tag.indexOf('ОБСЛЕДОВ') >= 0) result.tests = items;
  }
  return result;
}

function escLine(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

// ===== DASHBOARD CHARTS =====
// Shows sparklines for top deviating + most-measured indicators
function renderDashboardCharts(patient) {
  var section = $('dashChartsSection');
  var grid = $('dashChartsGrid');
  var analyses = getPatientAnalyses(patient.name);

  // Destroy previous dash charts
  state.dashCharts.forEach(function(c) { try { c.destroy(); } catch(e) {} });
  state.dashCharts = [];
  grid.innerHTML = '';

  if (analyses.length < 2) {
    section.classList.add('hidden');
    return;
  }

  var gender = patient.gender || '';

  // Score indicators: prefer those with deviations, then by data density
  var scored = [];
  state.indicators.forEach(function(ind) {
    var count = 0, devCount = 0;
    analyses.forEach(function(a) {
      var v = a.values[ind.name];
      if (v === undefined) return;
      var num = parseFloat(v);
      if (isNaN(num)) return;
      count++;
      var norm = getNorm(ind.name, gender);
      if (norm && classifyValue(num, norm[0], norm[1]) !== 'normal') devCount++;
    });
    if (count >= 2) scored.push({ ind: ind, count: count, devCount: devCount });
  });

  // Sort: deviations first, then count
  scored.sort(function(a, b) {
    if (b.devCount !== a.devCount) return b.devCount - a.devCount;
    return b.count - a.count;
  });

  var toShow = scored.slice(0, 12);
  if (toShow.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');

  toShow.forEach(function(item, idx) {
    var ind = item.ind;
    var labels = [], data = [];
    analyses.forEach(function(a) {
      var v = a.values[ind.name];
      var num = v !== undefined ? parseFloat(v) : NaN;
      labels.push(fmtDateChart(a.testDate));
      data.push(isNaN(num) ? null : num);
    });

    var norm = getNorm(ind.name, gender);
    var c = CHART_COLORS[idx % CHART_COLORS.length];

    var card = document.createElement('div');
    card.className = 'chart-card';

    var header = document.createElement('div');
    header.className = 'chart-header';
    header.innerHTML = '<span class="chart-title">' + esc(ind.name) + '</span>' +
      (norm ? '<span class="chart-norm-hint">Норма: ' + norm[0] + ' – ' + norm[1] + '</span>' : '');
    card.appendChild(header);

    var cWrap = document.createElement('div');
    cWrap.className = 'chart-body';
    var canvas = document.createElement('canvas');
    cWrap.appendChild(canvas);
    card.appendChild(cWrap);
    grid.appendChild(card);

    var datasets = [];
    if (norm) {
      datasets.push({ label: 'Верхняя граница', data: labels.map(function() { return norm[1]; }), borderColor: 'rgba(34,197,94,.35)', borderWidth: 1, borderDash: [4,3], pointRadius: 0, pointHoverRadius: 0, fill: false, order: 2 });
      datasets.push({ label: 'Нижняя граница', data: labels.map(function() { return norm[0]; }), borderColor: 'rgba(34,197,94,.35)', borderWidth: 1, borderDash: [4,3], pointRadius: 0, pointHoverRadius: 0, fill: '-1', backgroundColor: 'rgba(34,197,94,.08)', order: 2 });
    }
    var pointColors = norm ? data.map(function(v) {
      if (v === null) return c.line;
      var cls = classifyValue(v, norm[0], norm[1]);
      return cls === 'high' ? '#ef4444' : cls === 'low' ? '#3b82f6' : '#22c55e';
    }) : c.line;

    datasets.push({ label: ind.name, data: data, borderColor: c.line, backgroundColor: c.bg, fill: !norm, tension: 0.4, pointRadius: 5, pointHoverRadius: 8, pointBackgroundColor: pointColors, pointBorderColor: '#fff', pointBorderWidth: 2, borderWidth: 2.5, spanGaps: true, order: 1 });

    var chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1e293b', titleFont: { size: 12, weight: '600', family: 'Inter' }, bodyFont: { size: 13, family: 'Inter' }, padding: { top: 8, bottom: 8, left: 12, right: 12 }, cornerRadius: 8, displayColors: false,
            filter: function(item) { return item.dataset.label !== 'Верхняя граница' && item.dataset.label !== 'Нижняя граница'; },
            callbacks: {
              title: function(items) { return items[0] ? items[0].label : ''; },
              label: function(ctx) {
                if (ctx.parsed.y === null) return '';
                var txt = ctx.parsed.y.toString();
                if (norm) { var cls = classifyValue(ctx.parsed.y, norm[0], norm[1]); txt += cls === 'high' ? ' ▲' : cls === 'low' ? ' ▼' : ' ✓'; }
                return txt;
              }
            }
          }
        },
        scales: {
          y: { beginAtZero: false, grid: { color: 'rgba(0,0,0,.04)', drawBorder: false }, border: { display: false }, ticks: { font: { size: 11, family: 'Inter' }, color: '#94a3b8', padding: 8 } },
          x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 10, family: 'Inter' }, color: '#94a3b8', maxRotation: 45, padding: 4 } }
        },
        layout: { padding: { top: 4, right: 8, bottom: 0, left: 0 } }
      }
    });
    state.dashCharts.push(chart);
  });
}

// ===== CATEGORY PILLS =====
function renderCategoryPills(cats) {
  var bar = $('categoryBar');
  bar.innerHTML = '';

  cats.forEach(function(cat) {
    var pill = document.createElement('button');
    pill.className = 'cat-pill';
    pill.setAttribute('data-cat', cat);
    pill.textContent = cat;
    pill.addEventListener('click', function() {
      state.selectedCategory = cat;
      highlightActivePill();
      renderChartsByCategory();
    });
    bar.appendChild(pill);
  });
}

function highlightActivePill() {
  document.querySelectorAll('.cat-pill').forEach(function(p) {
    p.classList.toggle('active', p.getAttribute('data-cat') === state.selectedCategory);
  });
}

// ===== MAIN TAB SWITCHING =====
function switchMainTab(tab) {
  state.currentMainTab = tab;

  document.querySelectorAll('.main-tab-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.mainTab === tab);
  });
  $('dashboardTab').classList.toggle('hidden', tab !== 'dashboard');
  $('tableMainTab').classList.toggle('hidden', tab !== 'table');
  $('chartsMainTab').classList.toggle('hidden', tab !== 'charts');

  if (!state.selectedPatient) return;

  if (tab === 'dashboard') {
    renderDeviationsReport(state.selectedPatient);
    renderDashboardCharts(state.selectedPatient);
  } else if (tab === 'table') {
    renderFilteredTable();
  } else if (tab === 'charts') {
    var analyses = getPatientAnalyses(state.selectedPatient.name);
    var cats = getAvailableCategories(analyses);
    renderCategoryPills(cats);
    highlightActivePill();
    renderChartsByCategory();
  }
}

// ===== FILTER LOGIC =====
function populateFilterDropdowns(analyses, cats) {
  // Category
  var catSel = $('filterCategory');
  catSel.innerHTML = '<option value="">Все категории</option>';
  cats.forEach(function(c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c;
    catSel.appendChild(o);
  });

  // Country & Lab from analyses
  var countries = {}, labs = {};
  analyses.forEach(function(a) {
    if (a.country) countries[a.country] = true;
    if (a.lab) labs[a.lab] = true;
  });

  var countrySel = $('filterCountry');
  countrySel.innerHTML = '<option value="">Все страны</option>';
  Object.keys(countries).sort().forEach(function(c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c;
    countrySel.appendChild(o);
  });

  var labSel = $('filterLab');
  labSel.innerHTML = '<option value="">Все лаборатории</option>';
  Object.keys(labs).sort().forEach(function(l) {
    var o = document.createElement('option'); o.value = l; o.textContent = l;
    labSel.appendChild(o);
  });

  // Reset filter inputs
  $('filterDateFrom').value = '';
  $('filterDateTo').value = '';
}

function onFilterChange() {
  state.tableFilters.category = $('filterCategory').value;
  state.tableFilters.country  = $('filterCountry').value;
  state.tableFilters.lab      = $('filterLab').value;
  state.tableFilters.dateFrom = $('filterDateFrom').value;
  state.tableFilters.dateTo   = $('filterDateTo').value;
  renderFilteredTable();
}

function resetFilters() {
  state.tableFilters = { category: '', country: '', lab: '', dateFrom: '', dateTo: '' };
  $('filterCategory').value = '';
  $('filterCountry').value  = '';
  $('filterLab').value      = '';
  $('filterDateFrom').value = '';
  $('filterDateTo').value   = '';
  renderFilteredTable();
}

function getFilteredAnalyses() {
  if (!state.selectedPatient) return [];
  var f = state.tableFilters;
  var analyses = getPatientAnalyses(state.selectedPatient.name);

  return analyses.filter(function(a) {
    if (f.country && a.country !== f.country) return false;
    if (f.lab && a.lab !== f.lab) return false;
    if (f.dateFrom) {
      var d = parseDate(a.testDate);
      var from = new Date(f.dateFrom);
      if (d && d < from) return false;
    }
    if (f.dateTo) {
      var d2 = parseDate(a.testDate);
      var to = new Date(f.dateTo);
      if (d2 && d2 > to) return false;
    }
    return true;
  });
}

function renderFilteredTable() {
  var analyses = getFilteredAnalyses();
  var cat = state.tableFilters.category;

  var inds;
  if (cat) {
    inds = getCategoryIndicators(cat);
  } else {
    // All indicators that have data in filtered analyses
    inds = state.indicators;
  }
  renderTable(analyses, inds);
}

// ===== RENDER DATA (legacy, kept for chart tab) =====
function renderChartsByCategory() {
  if (!state.selectedPatient) return;
  var analyses = getPatientAnalyses(state.selectedPatient.name);
  var inds = getCategoryIndicators(state.selectedCategory);
  renderCharts(analyses, inds);
}

function getCategoryIndicators(cat) {
  return state.indicators.filter(function(i) { return i.category === cat; });
}

// ===== TABLE =====
function renderTable(analyses, indicators) {
  var table = $('patientTable');
  var wrap = $('tableContent');
  var empty = $('tableEmpty');

  var visible = indicators.filter(function(ind) {
    return analyses.some(function(a) { return a.values[ind.name] !== undefined; });
  });

  if (visible.length === 0 || analyses.length === 0) {
    wrap.classList.add('hidden');
    empty.classList.remove('hidden');
    table.innerHTML = '';
    return;
  }
  wrap.classList.remove('hidden');
  empty.classList.add('hidden');

  var gender = state.selectedPatient ? state.selectedPatient.gender : '';

  // Header: показатель | дата1 (страна · лаб) | дата2 ...
  var html = '<thead><tr><th class="th-name">Показатель</th>';
  analyses.forEach(function(a) {
    var meta = [a.country, a.lab].filter(Boolean).join(' · ');
    html += '<th class="th-date">' + esc(fmtDate(a.testDate));
    if (meta) html += '<div class="th-meta">' + esc(meta) + '</div>';
    html += '</th>';
  });
  html += '</tr></thead><tbody>';

  visible.forEach(function(ind) {
    var norm = getNorm(ind.name, gender);
    var normHint = norm ? ' (норма: ' + norm[0] + '–' + norm[1] + ')' : '';
    html += '<tr><td class="td-name" title="' + escapeAttr(ind.name + normHint) + '">' + esc(ind.name) + '</td>';
    analyses.forEach(function(a) {
      var val = a.values[ind.name];
      if (val !== undefined) {
        var cls = 'td-val';
        if (norm) {
          var verdict = classifyValue(val, norm[0], norm[1]);
          if (verdict === 'normal') cls += ' td-normal';
          else if (verdict === 'high') cls += ' td-high';
          else if (verdict === 'low') cls += ' td-low';
        }
        html += '<td class="' + cls + '">' + formatValue(val) + '</td>';
      } else {
        html += '<td class="td-val td-empty">—</td>';
      }
    });
    html += '</tr>';
  });
  html += '</tbody>';
  table.innerHTML = html;
}

// ===== LEGACY TAB SWITCH (kept for compatibility) =====
function switchTab(tab) {
  state.currentTab = tab;
}

// ===== CHARTS =====
var CHART_COLORS = [
  { line: '#3b82f6', bg: 'rgba(59,130,246,.1)' },
  { line: '#10b981', bg: 'rgba(16,185,129,.1)' },
  { line: '#f59e0b', bg: 'rgba(245,158,11,.1)' },
  { line: '#ef4444', bg: 'rgba(239,68,68,.1)' },
  { line: '#8b5cf6', bg: 'rgba(139,92,246,.1)' },
  { line: '#06b6d4', bg: 'rgba(6,182,212,.1)' },
  { line: '#ec4899', bg: 'rgba(236,72,153,.1)' },
  { line: '#f97316', bg: 'rgba(249,115,22,.1)' },
  { line: '#14b8a6', bg: 'rgba(20,184,166,.1)' },
  { line: '#6366f1', bg: 'rgba(99,102,241,.1)' }
];

function renderCharts(analyses, indicators) {
  var grid = $('chartsGrid');
  var empty = $('chartEmpty');
  destroyCharts();

  var chartable = indicators.filter(function(ind) {
    return analyses.some(function(a) {
      var v = a.values[ind.name];
      return v !== undefined && !isNaN(parseFloat(v));
    });
  });

  if (chartable.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  grid.innerHTML = '';

  var gender = state.selectedPatient ? state.selectedPatient.gender : '';

  chartable.forEach(function(ind, idx) {
    var labels = [];
    var data = [];

    analyses.forEach(function(a) {
      labels.push(fmtDateChart(a.testDate));
      var v = a.values[ind.name];
      if (v !== undefined) {
        var num = parseFloat(v);
        data.push(isNaN(num) ? null : num);
      } else {
        data.push(null);
      }
    });

    var norm = getNorm(ind.name, gender);

    var card = document.createElement('div');
    card.className = 'chart-card';

    var header = document.createElement('div');
    header.className = 'chart-header';
    header.innerHTML = '<span class="chart-title">' + esc(ind.name) + '</span>' +
      (norm ? '<span class="chart-norm-hint">Норма: ' + norm[0] + ' – ' + norm[1] + '</span>' : '');
    card.appendChild(header);

    var cWrap = document.createElement('div');
    cWrap.className = 'chart-body';
    var canvas = document.createElement('canvas');
    cWrap.appendChild(canvas);
    card.appendChild(cWrap);

    grid.appendChild(card);

    var c = CHART_COLORS[idx % CHART_COLORS.length];

    // --- Build datasets ---
    var datasets = [];

    // Norm zone datasets (upper border + lower border with fill between)
    if (norm) {
      var normLowData = labels.map(function() { return norm[0]; });
      var normHighData = labels.map(function() { return norm[1]; });

      datasets.push({
        label: 'Верхняя граница',
        data: normHighData,
        borderColor: 'rgba(34,197,94,.35)',
        borderWidth: 1,
        borderDash: [4, 3],
        pointRadius: 0,
        pointHoverRadius: 0,
        fill: false,
        order: 2
      });
      datasets.push({
        label: 'Нижняя граница',
        data: normLowData,
        borderColor: 'rgba(34,197,94,.35)',
        borderWidth: 1,
        borderDash: [4, 3],
        pointRadius: 0,
        pointHoverRadius: 0,
        fill: '-1',
        backgroundColor: 'rgba(34,197,94,.08)',
        order: 2
      });
    }

    // Point colors based on norm classification
    var pointColors;
    if (norm) {
      pointColors = data.map(function(v) {
        if (v === null) return c.line;
        var cls = classifyValue(v, norm[0], norm[1]);
        if (cls === 'high') return '#ef4444';
        if (cls === 'low') return '#3b82f6';
        return '#22c55e';
      });
    } else {
      pointColors = c.line;
    }

    // Main data line
    datasets.push({
      label: ind.name,
      data: data,
      borderColor: c.line,
      backgroundColor: c.bg,
      fill: norm ? false : true,
      tension: 0.4,
      pointRadius: 5,
      pointHoverRadius: 8,
      pointBackgroundColor: pointColors,
      pointBorderColor: '#fff',
      pointBorderWidth: 2,
      borderWidth: 2.5,
      spanGaps: true,
      order: 1
    });

    var chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1e293b',
            titleFont: { size: 12, weight: '600', family: 'Inter' },
            bodyFont: { size: 13, family: 'Inter' },
            padding: { top: 8, bottom: 8, left: 12, right: 12 },
            cornerRadius: 8,
            displayColors: false,
            filter: function(item) {
              return item.dataset.label !== 'Верхняя граница' && item.dataset.label !== 'Нижняя граница';
            },
            callbacks: {
              title: function(items) {
                return items[0] ? items[0].label : '';
              },
              label: function(ctx) {
                if (ctx.parsed.y === null) return '';
                var txt = ctx.parsed.y.toString();
                if (norm) {
                  var cls = classifyValue(ctx.parsed.y, norm[0], norm[1]);
                  if (cls === 'high') txt += ' ▲';
                  else if (cls === 'low') txt += ' ▼';
                  else txt += ' ✓';
                }
                return txt;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: false,
            grid: { color: 'rgba(0,0,0,.04)', drawBorder: false },
            border: { display: false },
            ticks: { font: { size: 11, family: 'Inter' }, color: '#94a3b8', padding: 8 }
          },
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              font: { size: 10, family: 'Inter' },
              color: '#94a3b8',
              maxRotation: 45,
              padding: 4
            }
          }
        },
        layout: { padding: { top: 4, right: 8, bottom: 0, left: 0 } }
      }
    });

    state.charts.push(chart);
  });
}

function destroyCharts() {
  state.charts.forEach(function(c) { try { c.destroy(); } catch(e) {} });
  state.charts = [];
  state.dashCharts.forEach(function(c) { try { c.destroy(); } catch(e) {} });
  state.dashCharts = [];
}

// ===== UI STATES =====
function updateStatus(s) {
  var b = $('statusBadge');
  var mb = $('mobileStatus');
  if (s === 'connected') {
    b.textContent = 'Онлайн'; b.className = 'badge badge-ok';
    mb.textContent = 'Онлайн'; mb.className = 'badge badge-ok mobile-badge';
  } else if (s === 'loading') {
    b.textContent = 'Загрузка...'; b.className = 'badge badge-loading';
    mb.textContent = '...'; mb.className = 'badge badge-loading mobile-badge';
  } else {
    b.textContent = 'Ошибка'; b.className = 'badge badge-err';
    mb.textContent = 'Ошибка'; mb.className = 'badge badge-err mobile-badge';
  }
}

function setRefreshing(on) {
  var btn = $('refreshBtn');
  btn.classList.toggle('spinning', on);
  btn.disabled = on;
}

function showLoading() { hideAllViews(); $('loadingView').classList.remove('hidden'); }
function showError(msg) { hideAllViews(); $('errorMessage').textContent = msg; $('errorView').classList.remove('hidden'); }
function showEmptyView() { hideAllViews(); $('emptyView').classList.remove('hidden'); }

// ===== THEME =====
function toggleTheme() {
  var html = document.documentElement;
  var current = html.getAttribute('data-theme') || 'light';
  var next = current === 'light' ? 'dark' : 'light';
  html.setAttribute('data-theme', next);
  localStorage.setItem('med_theme', next);
}

function showHomeView() {
  renderHomeView();
  hideAllViews();
  $('emptyView').classList.remove('hidden');
}

function hideAllViews() {
  ['loadingView', 'errorView', 'emptyView', 'patientView'].forEach(function(id) {
    $(id).classList.add('hidden');
  });
}

// ===== UTILS =====
function $(id) { return document.getElementById(id); }

function formatValue(val) {
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return String(val);
    return String(Math.round(val * 100) / 100);
  }
  var s = String(val);
  // Артефакт: ISO-дата попала в ячейку показателя — не показываем
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return '—';
  return esc(s);
}

function esc(s) {
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function escapeAttr(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ===== AUTH SYNC =====
// Синхронизируем кэш авторизации с данными пациентов из таблицы
function syncPatientsAuth(patients) {
  var existing = Auth.getPatientsAuth();
  // Строим карту существующих (сохраняем accessList)
  var map = {};
  existing.forEach(function(p) { map[p.name] = p; });

  var updated = patients.map(function(p) {
    var prev = map[p.name] || {};
    return {
      name: p.name,
      login: p.login || prev.login || '',
      password: p.password || prev.password || '',
      accessList: prev.accessList || []
    };
  });

  Auth.setPatientsAuth(updated);
}

// ===== ADMIN ACCESS MODAL =====
function openAccessModal() {
  var select = $('accessPatientSelect');
  select.innerHTML = '<option value="">— выберите пользователя —</option>';
  state.patients.forEach(function(p) {
    var opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name;
    select.appendChild(opt);
  });
  $('accessPatientDetails').classList.add('hidden');
  $('accessSaveMsg').classList.add('hidden');
  $('accessModal').classList.remove('hidden');
}

function closeAccessModal() {
  $('accessModal').classList.add('hidden');
}

function onAccessPatientChange() {
  var name = $('accessPatientSelect').value;
  if (!name) {
    $('accessPatientDetails').classList.add('hidden');
    return;
  }

  var allAuth = Auth.getPatientsAuth();
  var current = null;
  for (var i = 0; i < allAuth.length; i++) {
    if (allAuth[i].name === name) { current = allAuth[i]; break; }
  }

  $('accessLogin').value = current ? (current.login || '') : '';
  $('accessPassword').value = current ? (current.password || '') : '';

  // Чекбоксы — все пациенты кроме самого себя
  var listEl = $('accessCheckboxList');
  listEl.innerHTML = '';
  var accessList = current ? (current.accessList || []) : [];

  state.patients.forEach(function(p) {
    if (p.name === name) return; // себя пропускаем
    var checked = accessList.indexOf(p.name) >= 0;
    var row = document.createElement('label');
    row.className = 'access-checkbox-row';
    row.innerHTML =
      '<input type="checkbox" value="' + escapeAttr(p.name) + '"' + (checked ? ' checked' : '') + '>' +
      '<span>' + esc(p.name) + '</span>';
    listEl.appendChild(row);
  });

  $('accessPatientDetails').classList.remove('hidden');
  $('accessSaveMsg').classList.add('hidden');
}

function saveAccess() {
  var name = $('accessPatientSelect').value;
  if (!name) return;

  var login = $('accessLogin').value.trim();
  var password = $('accessPassword').value.trim();

  // Собираем выбранные доступы
  var checkboxes = $('accessCheckboxList').querySelectorAll('input[type="checkbox"]');
  var newAccessList = [];
  checkboxes.forEach(function(cb) {
    if (cb.checked) newAccessList.push(cb.value);
  });

  // Обновляем данные в кэше
  var allAuth = Auth.getPatientsAuth();
  for (var i = 0; i < allAuth.length; i++) {
    if (allAuth[i].name === name) {
      allAuth[i].login = login;
      allAuth[i].password = password;
      allAuth[i].accessList = newAccessList;
      break;
    }
  }
  Auth.setPatientsAuth(allAuth);

  // Сохраняем логин/пароль в Google Sheets
  // Используем no-cors т.к. Google Apps Script не отдаёт CORS-заголовки для POST,
  // ответ нельзя прочитать, но запрос выполняется — данные запишутся в таблицу.
  fetch(SCRIPT_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'updateCredentials', name: name, login: login, password: password })
  })
  .catch(function(err) {
    console.warn('Не удалось сохранить в Google Sheets:', err);
  });

  var msg = $('accessSaveMsg');
  msg.classList.remove('hidden');
  setTimeout(function() { msg.classList.add('hidden'); }, 2000);
}

// ===== HOME VIEW =====
function renderHomeView() {
  var session = Auth.getSession();
  if (!session) return;

  var isAdmin = session.role === 'admin';

  // Определяем "себя" и "близких"
  var myPatient = null;
  var familyPatients = [];

  if (isAdmin) {
    // Админ видит всех
    myPatient = null; // у админа нет "своей" карточки пациента
    familyPatients = state.patients.slice();
  } else {
    // Найти своего пациента
    for (var i = 0; i < state.patients.length; i++) {
      if (state.patients[i].name === session.name) {
        myPatient = state.patients[i];
        break;
      }
    }
    // Близкие — те из accessList кто есть в patients
    var accessList = session.accessList || [];
    for (var j = 0; j < state.patients.length; j++) {
      var p = state.patients[j];
      if (p.name !== session.name && accessList.indexOf(p.name) >= 0) {
        familyPatients.push(p);
      }
    }
  }

  var html = '<div class="home-greeting">' +
    '<div class="home-greeting-text">' +
      '<h1 class="home-title">Добро пожаловать' + (session.name ? ', ' + esc(session.name.split(' ')[0]) : '') + '</h1>' +
      '<p class="home-subtitle">Выберите профиль для просмотра анализов</p>' +
    '</div>' +
  '</div>';

  // ── Мои данные (только для пациента) ──
  if (!isAdmin && myPatient) {
    html += '<div class="home-section-label">Мои данные</div>';
    html += '<div class="home-cards">' + renderHomeCard(myPatient, true) + '</div>';
  }

  // ── Данные близких / Все пациенты (для админа) ──
  if (isAdmin) {
    html += '<div class="home-section-label">Все пользователи</div>';
    html += '<div class="home-cards">';
    familyPatients.forEach(function(p) { html += renderHomeCard(p, false); });
    html += '</div>';
  } else {
    html += '<div class="home-section-label">Данные близких</div>';
    if (familyPatients.length > 0) {
      html += '<div class="home-cards">';
      familyPatients.forEach(function(p) { html += renderHomeCard(p, false); });
      html += '</div>';
    } else {
      html += '<div class="home-no-access">' +
        '<div class="home-no-access-icon">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
            '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>' +
            '<circle cx="9" cy="7" r="4"/>' +
            '<path d="M23 21v-2a4 4 0 00-3-3.87"/>' +
            '<path d="M16 3.13a4 4 0 010 7.75"/>' +
          '</svg>' +
        '</div>' +
        '<p class="home-no-access-title">Нет доступа к данным близких</p>' +
        '<p class="home-no-access-text">Чтобы видеть анализы членов вашей семьи,<br>обратитесь к вашему врачу для открытия доступа.</p>' +
      '</div>';
    }
  }

  $('homeContent').innerHTML = html;

  // Навешиваем клики на карточки
  $('homeContent').querySelectorAll('.home-card').forEach(function(card) {
    card.addEventListener('click', function() {
      selectPatient(card.getAttribute('data-name'));
    });
  });
}

function renderHomeCard(patient, isMe) {
  var analyses = getPatientAnalyses(patient.name);
  var initials = patient.name.trim().split(/\s+/).map(function(w) { return w[0] || ''; }).join('').toUpperCase().slice(0, 2);
  var genderClass = patient.gender === 'Жен' ? 'home-card-avatar--f' : 'home-card-avatar--m';

  // Последний анализ
  var lastDate = '';
  if (analyses.length > 0) {
    var sorted = analyses.slice().sort(sortByDate);
    lastDate = fmtDateLong(sorted[sorted.length - 1].testDate);
  }

  // Подсчёт отклонений
  var deviations = 0;
  analyses.forEach(function(a) {
    state.indicators.forEach(function(ind) {
      if (a.values[ind.name] === undefined) return;
      var norm = getNorm(ind.name, patient.gender);
      if (!norm) return;
      var val = parseFloat(a.values[ind.name]);
      if (isNaN(val)) return;
      if (val < norm[0] || val > norm[1]) deviations++;
    });
  });

  var badge = isMe
    ? '<span class="home-card-badge home-card-badge--me">Я</span>'
    : '';

  var devBadge = deviations > 0
    ? '<span class="home-card-dev">' + deviations + ' откл.</span>'
    : '<span class="home-card-dev home-card-dev--ok">В норме</span>';

  return '<div class="home-card" data-name="' + escapeAttr(patient.name) + '">' +
    '<div class="home-card-top">' +
      '<div class="home-card-avatar ' + genderClass + '">' + esc(initials) + '</div>' +
      badge +
    '</div>' +
    '<div class="home-card-name">' + esc(patient.name) + '</div>' +
    '<div class="home-card-meta">' + esc(patient.gender || '') + (patient.age ? ', ' + patient.age + ' лет' : '') + '</div>' +
    '<div class="home-card-stats">' +
      '<div class="home-card-stat"><span class="home-card-stat-num">' + analyses.length + '</span><span class="home-card-stat-label">анализов</span></div>' +
      (lastDate ? '<div class="home-card-stat"><span class="home-card-stat-label">последний</span><span class="home-card-stat-date">' + esc(lastDate) + '</span></div>' : '') +
    '</div>' +
    (analyses.length > 0 ? '<div class="home-card-footer">' + devBadge + '</div>' : '') +
  '</div>';
}
