// ============================================================
// MedAnalytics — enhancements (compare, trends, export, AI UX)
// Подключается после app.js и переопределяет/дополняет функции.
// ============================================================

function favKey(patientName) {
  return 'med_fav_' + normalizeName(patientName);
}
function notesKey(patientName) {
  return 'med_notes_' + normalizeName(patientName);
}
function aiHistKey(patientName) {
  return 'med_ai_hist_' + normalizeName(patientName);
}

function loadPatientExtras(name) {
  try {
    state.favorites = JSON.parse(localStorage.getItem(favKey(name)) || '{}');
  } catch (e) { state.favorites = {}; }
  try {
    state.patientNotes[name] = localStorage.getItem(notesKey(name)) || '';
  } catch (e) { /* ignore */ }
}

function isFavorite(ind) {
  return !!(ind && state.favorites[ind.key || ind.name]);
}

function toggleFavorite(indKey) {
  if (!state.selectedPatient) return;
  if (state.favorites[indKey]) delete state.favorites[indKey];
  else state.favorites[indKey] = true;
  localStorage.setItem(favKey(state.selectedPatient.name), JSON.stringify(state.favorites));
  renderFilteredTable();
}

function analysisDateKey(a) {
  return String(a.testDate || '');
}

function toggleCompareMode() {
  state.tableView.compareMode = !state.tableView.compareMode;
  var bar = $('compareBar');
  var btn = $('compareToggleBtn');
  if (btn) btn.classList.toggle('active', state.tableView.compareMode);
  if (bar) bar.classList.toggle('hidden', !state.tableView.compareMode);
  if (state.tableView.compareMode) populateCompareSelects();
  renderFilteredTable();
}

function populateCompareSelects() {
  if (!state.selectedPatient) return;
  var analyses = getFilteredAnalyses();
  var aSel = $('compareDateA');
  var bSel = $('compareDateB');
  if (!aSel || !bSel) return;
  var opts = analyses.map(function(a) {
    return '<option value="' + escapeAttr(analysisDateKey(a)) + '">' + esc(fmtDate(a.testDate)) + '</option>';
  }).join('');
  aSel.innerHTML = opts;
  bSel.innerHTML = opts;
  if (analyses.length >= 2) {
    state.compareDates.a = analysisDateKey(analyses[analyses.length - 2]);
    state.compareDates.b = analysisDateKey(analyses[analyses.length - 1]);
  } else if (analyses.length === 1) {
    state.compareDates.a = analysisDateKey(analyses[0]);
    state.compareDates.b = analysisDateKey(analyses[0]);
  }
  aSel.value = state.compareDates.a;
  bSel.value = state.compareDates.b;
}

function findPrevNumeric(ind, analyses, beforeIdx) {
  for (var i = beforeIdx - 1; i >= 0; i--) {
    var val = valueOf(analyses[i], ind);
    if (val === undefined) continue;
    var num = numericValue(val);
    if (!isNaN(num)) return { idx: i, value: num, raw: val };
  }
  return null;
}

function trendArrow(curr, prev) {
  if (prev == null || isNaN(curr) || isNaN(prev)) return '';
  if (prev === 0) {
    if (curr === 0) return '<span class="trend trend--flat" title="Без изменений">→</span>';
    return curr > 0
      ? '<span class="trend trend--up" title="Рост">↑</span>'
      : '<span class="trend trend--down" title="Снижение">↓</span>';
  }
  var rel = (curr - prev) / Math.abs(prev);
  if (Math.abs(rel) < 0.03) return '<span class="trend trend--flat" title="Стабильно">→</span>';
  if (rel > 0) return '<span class="trend trend--up" title="Рост vs прошлое">↑</span>';
  return '<span class="trend trend--down" title="Снижение vs прошлое">↓</span>';
}

function severityClass(sev) {
  if (sev === 'severe') return ' td-sev-severe';
  if (sev === 'moderate') return ' td-sev-mod';
  if (sev === 'mild') return ' td-sev-mild';
  return '';
}

function getDisplayAnalyses(analyses, indicators) {
  if (state.tableView.compareMode && state.compareDates.a && state.compareDates.b) {
    var a = null;
    var b = null;
    analyses.forEach(function(x) {
      var k = analysisDateKey(x);
      if (k === state.compareDates.a) a = x;
      if (k === state.compareDates.b) b = x;
    });
    var out = [];
    if (a) out.push(a);
    if (b) out.push(b);
    return out;
  }
  if (!state.tableView.hideEmptyCols) return analyses;
  return analyses.filter(function(a) {
    return indicators.some(function(ind) { return valueOf(a, ind) !== undefined; });
  });
}

function renderTable(analyses, indicators) {
  var table = $('patientTable');
  var wrap = $('tableContent');
  var empty = $('tableEmpty');

  var gender = state.selectedPatient ? state.selectedPatient.gender : '';
  var q = state.tableView.search || '';

  var visible = indicators.filter(function(ind) {
    return analyses.some(function(a) { return valueOf(a, ind) !== undefined; });
  });

  if (q) {
    visible = visible.filter(function(ind) {
      return indDisplayName(ind).toLowerCase().indexOf(q) >= 0 ||
        (ind.category || '').toLowerCase().indexOf(q) >= 0;
    });
  }

  if (state.tableView.onlyFavorites) {
    visible = visible.filter(isFavorite);
  }

  if (state.tableView.onlyDeviations) {
    visible = visible.filter(function(ind) {
      return rowHasDeviation(ind, analyses, gender);
    });
  }

  var displayAnalyses = getDisplayAnalyses(analyses, visible);
  var groupByCat = !state.tableFilters.category && !q;
  var compareOn = state.tableView.compareMode && displayAnalyses.length >= 1;

  if (groupByCat) {
    visible = visible.slice().sort(function(a, b) {
      var c = (a.category || '').localeCompare(b.category || '', 'ru');
      return c !== 0 ? c : a.name.localeCompare(b.name, 'ru');
    });
  }

  if (visible.length === 0 || displayAnalyses.length === 0) {
    wrap.classList.add('hidden');
    empty.classList.remove('hidden');
    table.innerHTML = '';
    updateTableSummary(0, 0);
    return;
  }
  wrap.classList.remove('hidden');
  empty.classList.add('hidden');
  table.className = 'data-table data-table--light';

  var colCount = displayAnalyses.length + 1 + (compareOn && displayAnalyses.length === 2 ? 1 : 0);
  var html = '<thead><tr><th class="th-name">Показатель</th>';
  displayAnalyses.forEach(function(a) {
    var meta = [a.country, a.lab].filter(Boolean).join(' · ');
    var title = fmtDate(a.testDate) + (meta ? ' — ' + meta : '');
    html += '<th class="th-date" title="' + escapeAttr(title) + '">' + esc(fmtDateChart(a.testDate)) + '</th>';
  });
  if (compareOn && displayAnalyses.length === 2) {
    html += '<th class="th-date th-delta">Δ</th>';
  }
  html += '</tr></thead><tbody>';

  var lastCat = null;
  visible.forEach(function(ind) {
    if (groupByCat && ind.category !== lastCat) {
      lastCat = ind.category;
      html += '<tr class="cat-divider"><td colspan="' + colCount + '">' + esc(ind.category) + '</td></tr>';
    }

    var norm = getNorm(ind.name, gender, ind.category);
    var unitHint = ind.unit ? ', ' + ind.unit : '';
    var normHint = norm ? ' (норма: ' + norm[0] + '–' + norm[1] + unitHint + ')' : unitHint;
    var dispName = indDisplayName(ind);
    var fav = isFavorite(ind);
    var star = '<button type="button" class="fav-btn' + (fav ? ' is-fav' : '') + '" data-fav="' +
      escapeAttr(ind.key || ind.name) + '" title="Избранное">' + (fav ? '★' : '☆') + '</button>';

    html += '<tr><td class="td-name" title="' + escapeAttr(dispName + normHint) + '">' +
      star + '<span class="td-name-text">' + esc(dispName) + '</span></td>';

    var nums = [];
    displayAnalyses.forEach(function(a, colIdx) {
      var val = valueOf(a, ind);
      if (val !== undefined) {
        var cls = 'td-val';
        var title = '';
        var num = numericValue(val);
        var cellInner = formatValue(val);

        if (norm) {
          var verdict = classifyValue(val, norm[0], norm[1]);
          if (verdict === 'normal') cls += ' td-normal';
          else if (verdict === 'high') cls += ' td-high';
          else if (verdict === 'low') cls += ' td-low';

          var sev = typeof deviationSeverity === 'function'
            ? deviationSeverity(val, norm[0], norm[1]) : 'normal';
          cls += severityClass(sev);

          var plaus = !isNaN(num) ? checkPlausibility(num, norm) : { suspicious: false };
          if (plaus.suspicious) {
            cls += ' td-suspect';
            title = ' title="' + escapeAttr('Проверьте ввод: ' + plaus.reason) + '"';
          }
        }

        if (state.tableView.showTrends && !isNaN(num)) {
          var prev = null;
          var fullIdx = -1;
          for (var fi = 0; fi < analyses.length; fi++) {
            if (analysisDateKey(analyses[fi]) === analysisDateKey(a)) { fullIdx = fi; break; }
          }
          prev = fullIdx >= 0 ? findPrevNumeric(ind, analyses, fullIdx) : findPrevNumeric(ind, displayAnalyses, colIdx);
          if (prev) cellInner += trendArrow(num, prev.value);
        }

        nums.push(isNaN(num) ? null : num);
        html += '<td class="' + cls + '"' + title + '>' + cellInner + '</td>';
      } else {
        nums.push(null);
        html += '<td class="td-val td-empty">—</td>';
      }
    });

    if (compareOn && displayAnalyses.length === 2) {
      if (nums[0] != null && nums[1] != null) {
        var dlt = Math.round((nums[1] - nums[0]) * 1000) / 1000;
        var dCls = 'td-val td-delta' + (dlt > 0 ? ' td-delta-up' : dlt < 0 ? ' td-delta-down' : '');
        html += '<td class="' + dCls + '">' + (dlt > 0 ? '+' : '') + dlt + '</td>';
      } else {
        html += '<td class="td-val td-empty">—</td>';
      }
    }

    html += '</tr>';
  });
  html += '</tbody>';
  table.innerHTML = html;

  table.querySelectorAll('.fav-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      toggleFavorite(btn.getAttribute('data-fav'));
    });
  });

  updateTableSummary(visible.length, displayAnalyses.length);
}

// ===== EXPORT / PRINT =====
function exportTableCsv() {
  if (!state.selectedPatient) return;
  var analyses = getFilteredAnalyses();
  var cat = state.tableFilters.category;
  var inds = cat ? getCategoryIndicators(cat) : state.indicators;
  var gender = state.selectedPatient.gender || '';

  var visible = inds.filter(function(ind) {
    return analyses.some(function(a) { return valueOf(a, ind) !== undefined; });
  });
  if (state.tableView.search) {
    var q = state.tableView.search;
    visible = visible.filter(function(ind) {
      return indDisplayName(ind).toLowerCase().indexOf(q) >= 0;
    });
  }
  if (state.tableView.onlyFavorites) visible = visible.filter(isFavorite);
  if (state.tableView.onlyDeviations) {
    visible = visible.filter(function(ind) { return rowHasDeviation(ind, analyses, gender); });
  }
  var cols = getDisplayAnalyses(analyses, visible);
  if (!visible.length || !cols.length) {
    alert('Нет данных для экспорта');
    return;
  }

  function csvEsc(s) {
    s = String(s == null ? '' : s);
    if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  var rows = [];
  var header = ['Показатель', 'Категория', 'Ед.'].concat(cols.map(function(a) { return fmtDate(a.testDate); }));
  rows.push(header.map(csvEsc).join(';'));

  visible.forEach(function(ind) {
    var line = [indDisplayName(ind), ind.category || '', ind.unit || ''];
    cols.forEach(function(a) {
      var v = valueOf(a, ind);
      line.push(v !== undefined ? formatValue(v) : '');
    });
    rows.push(line.map(csvEsc).join(';'));
  });

  var blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = (state.selectedPatient.name || 'patient') + '_analyses.csv';
  a.click();
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

function printPatientSummary() {
  if (!state.selectedPatient) return;
  window.print();
}

// ===== AI MODE / COPY / HISTORY =====
function setAiMode(mode) {
  state.aiMode = mode === 'doctor' ? 'doctor' : 'patient';
  var p = $('aiModePatient');
  var d = $('aiModeDoctor');
  if (p) p.classList.toggle('active', state.aiMode === 'patient');
  if (d) d.classList.toggle('active', state.aiMode === 'doctor');
}

function copyAiResult() {
  var text = state.lastAiRaw || ($('aiBody') && $('aiBody').innerText) || '';
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() {
      var btn = $('aiCopyBtn');
      if (btn) {
        btn.classList.add('copied');
        setTimeout(function() { btn.classList.remove('copied'); }, 1200);
      }
    });
  } else {
    prompt('Скопируйте текст:', text);
  }
}

function loadAiHistory() {
  if (!state.selectedPatient) return [];
  try {
    return JSON.parse(localStorage.getItem(aiHistKey(state.selectedPatient.name)) || '[]');
  } catch (e) { return []; }
}

function saveAiHistoryEntry(raw, meta) {
  if (!state.selectedPatient || !raw) return;
  var list = loadAiHistory();
  list.unshift({
    at: new Date().toISOString(),
    mode: state.aiMode,
    date: meta && meta.date ? meta.date : '',
    text: raw
  });
  list = list.slice(0, 12);
  localStorage.setItem(aiHistKey(state.selectedPatient.name), JSON.stringify(list));
}

function toggleAiHistoryPanel() {
  var panel = $('aiHistoryPanel');
  if (!panel) return;
  if (!panel.classList.contains('hidden')) {
    panel.classList.add('hidden');
    return;
  }
  var list = loadAiHistory();
  if (!list.length) {
    panel.innerHTML = '<div class="ai-history-empty">История пуста — запустите AI-анализ</div>';
  } else {
    panel.innerHTML = list.map(function(item, idx) {
      var when = item.at ? String(item.at).slice(0, 16).replace('T', ' ') : '';
      return '<button type="button" class="ai-history-item" data-hist="' + idx + '">' +
        '<span class="ai-history-meta">' + esc(when) +
        (item.date ? ' · ' + esc(item.date) : '') +
        ' · ' + (item.mode === 'doctor' ? 'врач' : 'пациент') + '</span>' +
        '<span class="ai-history-preview">' + esc((item.text || '').slice(0, 120)) + '…</span></button>';
    }).join('');
    panel.querySelectorAll('.ai-history-item').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var item = list[Number(btn.getAttribute('data-hist'))];
        if (!item) return;
        state.lastAiRaw = item.text;
        _origRenderAi(item.text);
        $('aiSection').classList.remove('hidden', 'collapsed');
        panel.classList.add('hidden');
      });
    });
  }
  panel.classList.remove('hidden');
}

var _origBuildAiPrompt = typeof buildAiPrompt === 'function' ? buildAiPrompt : null;
var _origRenderAi = typeof renderAiResult === 'function' ? renderAiResult : null;

if (_origBuildAiPrompt) {
  window.buildAiPrompt = function(deviations, patient, latestAnalysis) {
    var base = _origBuildAiPrompt(deviations, patient, latestAnalysis);
    if (state.aiMode === 'doctor') {
      return base + '\n\nРежим: для врача. Клиническая терминология, в каждом пункте указывай конкретные показатели ' +
        '(напр. «GGT↑ +24%»). Разделяй срочное и плановое.';
    }
    return base + '\n\nРежим: для пациента. Простой язык, спокойно и коротко. Не пугай. Нужна консультация врача.';
  };
}

if (_origRenderAi) {
  window.renderAiResult = function(text) {
    state.lastAiRaw = text || '';
    _origRenderAi(text);
    var copyBtn = $('aiCopyBtn');
    var histBtn = $('aiHistoryBtn');
    if (copyBtn) copyBtn.classList.remove('hidden');
    if (histBtn) histBtn.classList.remove('hidden');
    if (text && state.selectedPatient) {
      var hist = loadAiHistory();
      if (!hist[0] || hist[0].text !== text) {
        saveAiHistoryEntry(text, { date: state.aiSelectedDate || '' });
      }
    }
  };
}

// ===== NOTES in patient card =====
function appendPatientNotesUI(patient) {
  var card = $('patientInfoCard');
  if (!card || !patient) return;
  var existing = card.querySelector('.patient-notes');
  if (existing) existing.remove();

  var note = '';
  try { note = localStorage.getItem(notesKey(patient.name)) || ''; } catch (e) {}

  var wrap = document.createElement('div');
  wrap.className = 'patient-notes info-details-extra';
  wrap.innerHTML =
    '<div class="vitals-label">Заметки</div>' +
    '<textarea id="patientNotesInput" class="patient-notes-input" rows="2" placeholder="Например: начал принимать B12 с марта…"></textarea>';
  card.appendChild(wrap);

  var ta = $('patientNotesInput');
  if (ta) {
    ta.value = note;
    ta.addEventListener('change', function() {
      try { localStorage.setItem(notesKey(patient.name), ta.value); } catch (e) {}
    });
  }
}

// ============================================================
// КЛИНИЧЕСКИЕ РАСШИРЕНИЯ (clinical.js UI)
// panic-values · сводка по системам · синдромы · контекст · отчёт
// ============================================================

var SYS_ICONS = {
  'Кровь':      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2C6 9 4 13 4 16a8 8 0 0016 0c0-3-2-7-8-14z"/></svg>',
  'Печень':     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7c5-2 13-2 18 1 0 5-3 8-8 8-4 0-7-2-8-5-1-2-2-3-2-5z"/></svg>',
  'Почки':      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 3c3 0 4 3 4 6s-2 6-5 6c-2 0-3-2-3-5S5 3 8 3z"/><path d="M16 3c-3 0-4 3-4 6"/></svg>',
  'Углеводы':   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/></svg>',
  'Липиды':     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>',
  'Электролиты':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
  'Щитовидка':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3c-3 3-8 3-8 8a8 8 0 0016 0c0-5-5-5-8-8z"/></svg>',
  'Железо':     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2C6 9 4 13 4 16a8 8 0 0016 0c0-3-2-7-8-14z"/></svg>',
  'Воспаление': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2s6 5 6 11a6 6 0 01-12 0c0-2 1-4 2-5 0 2 1 3 2 3 0-3 2-6 2-10z"/></svg>',
  'Свёртывание':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3v6M5 21h14M7 21c0-4 2-6 5-6s5 2 5 6"/></svg>',
  'Витамины':   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 8l8-5 8 5v8l-8 5-8-5z"/></svg>',
  'Сердце':     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.8 5.6a5.5 5.5 0 00-7.8 0L12 6.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 22l7.8-7.6 1-1a5.5 5.5 0 000-7.8z"/></svg>',
  'Гормоны':    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9 9l6 6M15 9l-6 6"/></svg>',
  'Прочее':     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/></svg>'
};

function sysIcon(name) { return SYS_ICONS[name] || SYS_ICONS['Прочее']; }

// ── Panic-values баннер (feature 3) ──
function renderPanicBanner(panic) {
  var el = $('panicBanner');
  if (!el) return;
  if (!panic || !panic.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }

  var items = panic.map(function(p) {
    var dir = p.dir === 'high' ? 'выше' : 'ниже';
    return '<li><strong>' + esc(p.name) + '</strong>: ' + esc(String(p.value)) +
      (p.unit ? ' ' + esc(p.unit) : '') +
      ' <span class="panic-th">(' + dir + ' критического порога ' + esc(String(p.threshold)) + ')</span></li>';
  }).join('');

  el.innerHTML =
    '<div class="panic-head">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
      '<span>Критические значения — требуют немедленного внимания</span>' +
    '</div>' +
    '<ul class="panic-list">' + items + '</ul>' +
    '<div class="panic-note">Ориентировочные пороги. При реальном ухудшении состояния — срочно к врачу / скорая.</div>';
  el.classList.remove('hidden');
}

// ── Сводка по системам органов (feature 8) ──
function renderSystemSummary(summary) {
  var el = $('systemSummary');
  if (!el) return;
  if (!summary || !summary.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }

  var chips = summary.map(function(s) {
    var statusText = s.deviated === 0
      ? 'в норме'
      : (s.high ? s.high + '↑ ' : '') + (s.low ? s.low + '↓' : '');
    return '<div class="sys-chip sys-chip--' + s.status + '">' +
      '<div class="sys-chip-icon">' + sysIcon(s.system) + '</div>' +
      '<div class="sys-chip-body">' +
        '<div class="sys-chip-name">' + esc(s.system) + '</div>' +
        '<div class="sys-chip-stat">' + statusText.trim() + ' · ' + s.total + '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  el.innerHTML =
    '<div class="sys-summary-label">Системы организма</div>' +
    '<div class="sys-chips">' + chips + '</div>';
  el.classList.remove('hidden');
}

// ── Синдромальная интерпретация (feature 2) ──
function renderSyndromes(syndromes) {
  var el = $('syndromeSection');
  if (!el) return;
  if (!syndromes || !syndromes.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }

  var cards = syndromes.map(function(s) {
    return '<div class="syndrome-card syndrome-card--' + (s.level || 'info') + '">' +
      '<div class="syndrome-card-head">' +
        '<span class="syndrome-sys">' + esc(s.system) + '</span>' +
        '<span class="syndrome-title">' + esc(s.title) + '</span>' +
      '</div>' +
      (s.detail ? '<div class="syndrome-detail">' + esc(s.detail) + '</div>' : '') +
    '</div>';
  }).join('');

  el.innerHTML =
    '<div class="syndrome-label">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>' +
      'Клиническая интерпретация паттернов' +
    '</div>' +
    '<div class="syndrome-cards">' + cards + '</div>' +
    '<div class="syndrome-note">Автоматическая группировка по данным анализа. Не диагноз — уточните у врача.</div>';
  el.classList.remove('hidden');
}

// ── Кнопка «Отчёт для врача» (feature 8) ──
function appendDoctorReportBtn(report) {
  var host = $('deviationsReport');
  if (!host || typeof CLINICAL === 'undefined') return;
  var right = host.querySelector('.dev-right');
  if (!right) return;
  var existing = right.querySelector('.dev-report-btn');
  if (existing) existing.remove();

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dev-report-btn';
  btn.title = 'Скачать структурированный отчёт для врача';
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>' +
    '<span>Отчёт для врача</span>';
  btn.addEventListener('click', function() { downloadDoctorReport(report); });
  right.appendChild(btn);
}

function downloadDoctorReport(report) {
  if (typeof CLINICAL === 'undefined' || !report) return;
  var text = CLINICAL.buildDoctorReport({
    patient: report.patient,
    ctx: report.ctx,
    readings: report.readings,
    panic: report.panic,
    syndromes: report.syndromes,
    targets: report.targets,
    dateStr: report.dateStr,
    lab: report.lab,
    aiText: state.lastAiRaw || ''
  });
  var fname = 'MedReport_' +
    normalizeName(report.patient.name).replace(/\s+/g, '_') + '_' +
    String(report.dateStr || '').replace(/[^\d]/g, '') + '.txt';
  try {
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  } catch (e) {
    // fallback — копируем в буфер
    if (navigator.clipboard) navigator.clipboard.writeText(text);
    alert('Отчёт скопирован в буфер обмена.');
  }
}

// Главный вход — вызывается из renderDeviationsReport (app.js)
function renderClinicalExtras(report) {
  if (!report) return;
  renderPanicBanner(report.panic);
  renderSystemSummary(report.systemSummary);
  renderSyndromes(report.syndromes);
  appendDoctorReportBtn(report);
}

// ── Форма клинического контекста пациента (feature 7) ──
function appendClinicalContextUI(patient) {
  var card = $('patientInfoCard');
  if (!card || !patient || typeof CLINICAL === 'undefined') return;
  var existing = card.querySelector('.clinical-context');
  if (existing) existing.remove();

  var ctx = CLINICAL.getContext(patient.name);
  var isFemale = patient.gender === 'Жен';

  var wrap = document.createElement('div');
  wrap.className = 'clinical-context info-details-extra';
  wrap.innerHTML =
    '<div class="vitals-label">Клинический контекст</div>' +
    '<div class="clin-grid">' +
      '<label class="clin-field">' +
        '<span class="clin-label">Диагнозы <span class="clin-hint">через запятую</span></span>' +
        '<input type="text" id="clinConditions" class="clin-input" placeholder="напр. сахарный диабет 2 типа, гипотиреоз">' +
      '</label>' +
      '<label class="clin-field">' +
        '<span class="clin-label">Препараты <span class="clin-hint">через запятую</span></span>' +
        '<input type="text" id="clinMeds" class="clin-input" placeholder="напр. метформин, левотироксин, статины">' +
      '</label>' +
      '<label class="clin-field clin-field--full">' +
        '<span class="clin-label">Жалобы / анамнез</span>' +
        '<textarea id="clinComplaints" class="clin-input" rows="2" placeholder="напр. слабость, выпадение волос последние 3 месяца"></textarea>' +
      '</label>' +
      (isFemale ?
        '<label class="clin-field clin-field--check">' +
          '<input type="checkbox" id="clinPregnant"> <span>Беременность</span>' +
        '</label>' +
        '<label class="clin-field clin-field--sm">' +
          '<span class="clin-label">Триместр</span>' +
          '<select id="clinTrimester" class="clin-input">' +
            '<option value="">—</option><option value="1">1</option><option value="2">2</option><option value="3">3</option>' +
          '</select>' +
        '</label>' +
        '<label class="clin-field clin-field--sm">' +
          '<span class="clin-label">День цикла</span>' +
          '<input type="number" id="clinCycleDay" class="clin-input" min="1" max="45" placeholder="—">' +
        '</label>'
      : '') +
    '</div>';
  card.appendChild(wrap);

  // Заполняем значения
  var c = $('clinConditions'); if (c) c.value = (ctx.conditions || []).join(', ');
  var m = $('clinMeds'); if (m) m.value = (ctx.meds || []).join(', ');
  var cm = $('clinComplaints'); if (cm) cm.value = ctx.complaints || '';
  if (isFemale) {
    var pg = $('clinPregnant'); if (pg) pg.checked = !!ctx.pregnant;
    var tr = $('clinTrimester'); if (tr) tr.value = ctx.trimester || '';
    var cd = $('clinCycleDay'); if (cd && ctx.cycleDay) cd.value = ctx.cycleDay;
  }

  function splitList(v) {
    return String(v || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  }

  function save() {
    var newCtx = {
      conditions: splitList($('clinConditions') ? $('clinConditions').value : ''),
      meds: splitList($('clinMeds') ? $('clinMeds').value : ''),
      complaints: $('clinComplaints') ? $('clinComplaints').value.trim() : '',
      pregnant: isFemale && $('clinPregnant') ? $('clinPregnant').checked : false,
      trimester: isFemale && $('clinTrimester') && $('clinTrimester').value ? Number($('clinTrimester').value) : null,
      cycleDay: isFemale && $('clinCycleDay') && $('clinCycleDay').value ? Number($('clinCycleDay').value) : null
    };
    CLINICAL.setContext(patient.name, newCtx);
    // Пересчитать дашборд с учётом нового контекста (нормы/цели/синдромы)
    if (state.currentMainTab === 'dashboard' && typeof renderDeviationsReport === 'function') {
      renderDeviationsReport(patient);
    }
  }

  wrap.querySelectorAll('input, textarea, select').forEach(function(elm) {
    elm.addEventListener('change', save);
  });
}

(function patchPatientInfo() {
  if (typeof renderPatientInfo !== 'function') return;
  var _orig = renderPatientInfo;
  window.renderPatientInfo = function(patient) {
    _orig(patient);
    appendPatientNotesUI(patient);
    appendClinicalContextUI(patient);
  };
})();
