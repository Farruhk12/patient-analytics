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

(function patchPatientInfo() {
  if (typeof renderPatientInfo !== 'function') return;
  var _orig = renderPatientInfo;
  window.renderPatientInfo = function(patient) {
    _orig(patient);
    appendPatientNotesUI(patient);
  };
})();
