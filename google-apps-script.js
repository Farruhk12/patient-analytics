/**
 * Google Apps Script — передача данных анализов из Google Sheets в MedAnalytics
 *
 * ВАЖНО (медицинские данные — критично к точности):
 *  - Показатели с ОДИНАКОВЫМ названием в РАЗНЫХ категориях (например «Глюкоза»
 *    в БАК и в ОАМ, «Эритроциты (RBC)» в ОАК и ОАМ) РАНЬШЕ затирали друг друга,
 *    потому что значения хранились по имени показателя. Теперь каждый показатель
 *    получает УНИКАЛЬНЫЙ ключ (key), а значения хранятся по нему. Имя (name)
 *    остаётся для отображения, категория (category) — для выбора нормы.
 *  - Ячейки-даты, случайно попавшие в столбец показателя (в т.ч. как «серийный
 *    номер» вида 45689), отсекаются, чтобы не превратиться в «космические» цифры.
 *
 * СТРУКТУРА ТАБЛИЦЫ:
 *
 * Лист «Список пациентов»:
 *   A: ФИО | B: Пол | C: Дата рождения | D: Возраст | E: Группа крови
 *   F: Логин | G: Пароль | H: Уровень доступа
 *
 * Лист «Общий лист анализов ТЧ»:
 *   A: (пусто) | B: ФИО | C: Дата рождения | D: Возраст | E: Дата сдачи
 *   F: Страна | G: Лаборатория
 *   H..: показатели
 *     Строка 1 — названия показателей
 *     Строка 2 — категории (ОАК, БАК, ...)
 *     Строка 3 — (опц.) единицы измерения — если у строки в колонке B стоит
 *                «Единица измерения», она используется как единицы и не считается
 *                записью пациента
 *     Строки данных — начиная с первой строки, где в колонке B стоит ФИО пациента
 *
 * УСТАНОВКА:
 * 1. Таблица → Расширения → Apps Script → вставьте код в Code.gs
 * 2. Развёртывание → Новое развёртывание → Веб-приложение → Доступ: «Все»
 * 3. Скопируйте URL в .env (SCRIPT_URL) и выполните `npm run build`
 */

var ANALYSIS_SHEET = 'Общий лист анализов ТЧ';
var PATIENTS_SHEET = 'Список пациентов';
var META_COLS = 7; // A..G — служебные колонки, показатели с H (индекс 7)

// Строки колонки B, которые НЕ являются пациентами (служебные строки-подписи)
var META_ROW_LABELS = [
  'единица измерения', 'ед. изм', 'ед изм', 'единицы',
  'нижний порог нормы', 'нжний порог нормы', 'верхний порог нормы',
  'норма', 'референс', 'референсные значения'
];

function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    var patients = readPatients(ss);
    var analysisData = readAnalyses(ss);

    var result = {
      success: true,
      patients: patients,
      indicators: analysisData.indicators,
      categories: analysisData.categories,
      analyses: analysisData.analyses,
      info: {
        patientsCount: patients.length,
        analysesCount: analysisData.analyses.length,
        indicatorsCount: analysisData.indicators.length,
        timestamp: new Date().toISOString(),
        schema: 2 // версия контракта: значения по уникальному key
      }
    };

    return respond(result, e);
  } catch (err) {
    return respond({ success: false, error: err.toString() }, e);
  }
}

// ─────────────────────────────────────────────────────────────
// Список пациентов
// ─────────────────────────────────────────────────────────────
function readPatients(ss) {
  var sheet = ss.getSheetByName(PATIENTS_SHEET);
  if (!sheet) throw new Error('Лист "' + PATIENTS_SHEET + '" не найден');

  var raw = sheet.getDataRange().getValues();
  var patients = [];

  for (var i = 1; i < raw.length; i++) {
    var row = raw[i];
    var name = String(row[0] || '').trim();
    if (!name) continue;

    patients.push({
      name: name,
      gender: normalizeGender(row[1]),
      birthDate: formatCell(row[2]),
      age: (row[3] !== '' && row[3] !== null && row[3] !== undefined) ? row[3] : '',
      bloodGroup: String(row[4] || '').trim(),
      login: String(row[5] || '').trim(),
      password: String(row[6] || '').trim()
    });
  }
  return patients;
}

function normalizeGender(v) {
  var g = String(v || '').trim().toLowerCase();
  if (g.indexOf('жен') === 0 || g === 'ж' || g === 'f') return 'Жен';
  if (g.indexOf('муж') === 0 || g === 'м' || g === 'm') return 'Муж';
  return String(v || '').trim();
}

// ─────────────────────────────────────────────────────────────
// Анализы + показатели с уникальными ключами
// ─────────────────────────────────────────────────────────────
function readAnalyses(ss) {
  var sheet = ss.getSheetByName(ANALYSIS_SHEET);
  if (!sheet) throw new Error('Лист "' + ANALYSIS_SHEET + '" не найден');

  var raw = sheet.getDataRange().getValues();
  var display = sheet.getDataRange().getDisplayValues();

  var headerRow = raw[0] || [];
  var categoryRow = raw[1] || [];

  // 1) Собираем показатели, считаем, какие имена повторяются
  var nameCount = {};
  var rawIndicators = [];
  for (var c = META_COLS; c < headerRow.length; c++) {
    var indName = String(headerRow[c] || '').trim();
    if (!indName) continue;
    var category = String(categoryRow[c] || '').trim() || 'Другое';
    rawIndicators.push({ index: c, name: indName, category: category });
    nameCount[indName] = (nameCount[indName] || 0) + 1;
  }

  // 2) Присваиваем уникальные ключи (имя, а при коллизии — «имя · категория»)
  var indicators = [];
  var categoriesSet = {};
  var usedKeys = {};
  rawIndicators.forEach(function (ind) {
    var key = ind.name;
    if (nameCount[ind.name] > 1) key = ind.name + ' · ' + ind.category;
    // страховка от полного дубля (одинаковые имя+категория)
    var base = key, n = 2;
    while (usedKeys[key]) { key = base + ' #' + n; n++; }
    usedKeys[key] = true;

    ind.key = key;
    indicators.push(ind);
    categoriesSet[ind.category] = true;
  });

  var categories = Object.keys(categoriesSet);

  // 3) Единицы измерения (если есть строка «Единица измерения»)
  var units = {};
  for (var u = 2; u < raw.length; u++) {
    if (isMetaRowLabel(raw[u][1])) {
      indicators.forEach(function (ind) {
        var uv = String((raw[u][ind.index]) || '').trim();
        if (uv) units[ind.key] = uv;
      });
    }
  }
  indicators.forEach(function (ind) { ind.unit = units[ind.key] || ''; });

  // 4) Данные анализов
  var analyses = [];
  for (var r = 2; r < raw.length; r++) {
    var row = raw[r];
    var patientName = String(row[1] || '').trim();
    if (!patientName) continue;
    if (isMetaRowLabel(patientName)) continue; // служебные строки — не пациенты

    var record = {
      name: patientName,
      birthDate: formatCell(row[2]),
      ageAtTest: formatCell(row[3]),
      testDate: formatCell(row[4]),
      country: String(row[5] || '').trim(),
      lab: String(row[6] || '').trim(),
      values: {}
    };

    for (var j = 0; j < indicators.length; j++) {
      var idx = indicators[j].index;
      var val = row[idx];
      if (val === '' || val === null || val === undefined) continue;

      var displayed = String((display[r] || [])[idx] || '').trim();

      // Ячейка-дата в столбце показателя → это не показатель, отсекаем
      if (val instanceof Date) {
        var parsed = parseFloatLoose(displayed);
        if (parsed !== null) {
          val = parsed; // была просто «числовая ячейка, отформатированная как дата»
        } else {
          continue; // выглядит как реальная дата — мусор в столбце
        }
      }

      // Строка-ISO-дата
      if (typeof val === 'string' &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val)) {
        continue;
      }

      // «Серийный номер даты» просочился как число, а отображается как дата
      // (dd.mm.yyyy / dd/mm/yyyy / dd-mm-yyyy) — отсекаем.
      if (typeof val === 'number' &&
          /^\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}$/.test(displayed)) {
        continue;
      }

      if (val !== '') {
        record.values[indicators[j].key] = val;
      }
    }

    analyses.push(record);
  }

  // Показатели наружу — без служебного index
  var outIndicators = indicators.map(function (ind) {
    return { key: ind.key, name: ind.name, category: ind.category, unit: ind.unit };
  });

  return { indicators: outIndicators, categories: categories, analyses: analyses };
}

function isMetaRowLabel(v) {
  var s = String(v || '').trim().toLowerCase();
  if (!s) return false;
  for (var i = 0; i < META_ROW_LABELS.length; i++) {
    if (s.indexOf(META_ROW_LABELS[i]) === 0) return true;
  }
  return false;
}

// Мягкий парсинг числа: запятая-как-разделитель, пробелы-разделители тысяч.
// Возвращает число или null.
function parseFloatLoose(s) {
  if (s === null || s === undefined) return null;
  var t = String(s).replace(/\s/g, '').replace(',', '.');
  if (!/^[+-]?\d*\.?\d+$/.test(t)) return null;
  var n = parseFloat(t);
  return isNaN(n) ? null : n;
}

// ─────────────────────────────────────────────────────────────
// doPost — запись логина/пароля пациента обратно в таблицу
// ─────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.action !== 'updateCredentials') {
      throw new Error('Unknown action: ' + body.action);
    }

    var patientName = String(body.name || '').trim();
    var login = String(body.login || '').trim().slice(0, 64);
    var password = String(body.password || '').trim().slice(0, 128);
    if (!patientName) throw new Error('name is required');

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(PATIENTS_SHEET);
    if (!sheet) throw new Error('Лист "' + PATIENTS_SHEET + '" не найден');

    var data = sheet.getDataRange().getValues();
    var updated = false;
    for (var i = 1; i < data.length; i++) {
      var cellName = String(data[i][0] || '').trim();
      if (cellName.toLowerCase() === patientName.toLowerCase()) {
        sheet.getRange(i + 1, 6).setValue(login);    // F
        sheet.getRange(i + 1, 7).setValue(password); // G
        updated = true;
        break;
      }
    }
    if (!updated) throw new Error('Пользователь не найден: ' + patientName);

    return respond({ success: true }, e);
  } catch (err) {
    return respond({ success: false, error: err.toString() }, e);
  }
}

// ─────────────────────────────────────────────────────────────
// Общий вывод (JSON + JSONP)
// ─────────────────────────────────────────────────────────────
function respond(obj, e) {
  var json = JSON.stringify(obj);
  var cb = e && e.parameter && e.parameter.callback;
  if (cb && /^[A-Za-z0-9_]+$/.test(cb)) {
    return ContentService
      .createTextOutput(cb + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function formatCell(cell) {
  if (cell instanceof Date) {
    return Utilities.formatDate(cell, Session.getScriptTimeZone(), 'dd.MM.yyyy');
  }
  if (cell === null || cell === undefined) return '';
  return cell;
}

function testDoGet() {
  var result = doGet({ parameter: {} });
  Logger.log(result.getContent().substring(0, 1200));
}
