/**
 * Google Apps Script для передачи данных анализов из Google Sheets
 * 
 * СТРУКТУРА ТАБЛИЦЫ:
 * 
 * Лист 1 — "Список пациентов":
 *   A: ФИО | B: Пол | C: Дата рождения | D: Возраст
 * 
 * Лист 2 — "Общий лист анализов ТЧ":
 *   A: (пусто) | B: ФИО | C: Дата рождения | D: Возраст | E: Дата сдачи | F: Страна | G: Лаборатория
 *   H..LF: показатели
 *     Строка 1 — названия показателей
 *     Строка 2 — категории (ОАК и т.д.)
 *     Строка 3+ — данные
 * 
 * УСТАНОВКА:
 * 1. Откройте вашу таблицу Google Sheets
 * 2. Расширения → Apps Script
 * 3. Вставьте этот код в Code.gs
 * 4. Развёртывание → Новое развёртывание → Веб-приложение → Доступ: Все
 * 5. Скопируйте URL и вставьте в app.js (SCRIPT_URL)
 */

function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // ===== Лист 1: Список пациентов =====
    var patientsSheet = ss.getSheetByName('Список пациентов');
    if (!patientsSheet) {
      throw new Error('Лист "Список пациентов" не найден');
    }

    var patientsRaw = patientsSheet.getDataRange().getValues();
    var patients = [];

    // Строка 0 — заголовки, строки 1+ — данные
    for (var i = 1; i < patientsRaw.length; i++) {
      var row = patientsRaw[i];
      var name = String(row[0] || '').trim();
      if (!name) continue;

      patients.push({
        name: name,
        gender: String(row[1] || '').trim(),
        birthDate: formatCell(row[2]),
        age: row[3] !== '' && row[3] !== null && row[3] !== undefined ? row[3] : '',
        bloodGroup: String(row[4] || '').trim(),  // E: Группа крови
        login: String(row[5] || '').trim(),        // F: Логин
        password: String(row[6] || '').trim()      // G: Пароль
        // Уровень доступа (H) управляется через интерфейс, хранится в сессии
      });
    }

    // ===== Лист 2: Общий лист анализов ТЧ =====
    var analysisSheet = ss.getSheetByName('Общий лист анализов ТЧ');
    if (!analysisSheet) {
      throw new Error('Лист "Общий лист анализов ТЧ" не найден');
    }

    var analysisRaw = analysisSheet.getDataRange().getValues();
    // Отображаемые значения — для показателей (числа) Google Sheets иногда
    // возвращает Date-объект вместо числа если формат столбца — дата.
    // getDisplayValues() даёт строку "1970" вместо объекта.
    var analysisDisplay = analysisSheet.getDataRange().getDisplayValues();

    // Строка 0 (строка 1 в таблице) — названия показателей
    // Строка 1 (строка 2 в таблице) — категории
    var headerRow = analysisRaw[0] || [];
    var categoryRow = analysisRaw[1] || [];

    // Столбцы показателей начинаются с индекса 7 (колонка H, т.к. A=0..G=6)
    var META_COLS = 7;
    var indicators = [];
    var categoriesSet = {};

    for (var c = META_COLS; c < headerRow.length; c++) {
      var indicatorName = String(headerRow[c] || '').trim();
      if (!indicatorName) continue;

      var category = String(categoryRow[c] || '').trim() || 'Другое';

      indicators.push({
        index: c,
        name: indicatorName,
        category: category
      });

      categoriesSet[category] = true;
    }

    var categories = Object.keys(categoriesSet);

    // Строки 2+ (строка 3 в таблице) — данные анализов
    var analyses = [];

    for (var r = 2; r < analysisRaw.length; r++) {
      var row = analysisRaw[r];

      var patientName = String(row[1] || '').trim(); // колонка B
      if (!patientName) continue;

      var record = {
        name: patientName,
        birthDate: formatCell(row[2]),      // C
        ageAtTest: formatCell(row[3]),       // D
        testDate: formatCell(row[4]),        // E
        country: String(row[5] || '').trim(),// F
        lab: String(row[6] || '').trim(),    // G
        values: {}
      };

      for (var j = 0; j < indicators.length; j++) {
        var idx = indicators[j].index;
        var val = row[idx];
        if (val === '' || val === null || val === undefined) continue;

        // Google Sheets иногда возвращает Date-объект для числовых ячеек,
        // если формат столбца выставлен как «Дата».
        // В этом случае getDisplayValues() даёт строку вроде «01.04.2025»,
        // а нам нужно исходное число из ячейки.
        // Решение: переформатируем ячейку через прямой доступ к числовому значению.
        if (val instanceof Date) {
          // Получаем отображаемую строку
          var displayed = String((analysisDisplay[r] || [])[idx] || '').trim();

          // Сначала пробуем распарсить как число (например, "26", "1.5")
          // заменяем запятую на точку для европейских локалей
          var cleaned = displayed.replace(/\s/g, '').replace(',', '.');
          var parsed = parseFloat(cleaned);

          if (!isNaN(parsed)) {
            // Успех — это было число, просто ячейка была отформатирована как дата
            val = parsed;
          } else {
            // Отображаемая строка тоже выглядит как дата — пропускаем значение,
            // так как это скорее всего мусор в столбце показателя
            continue;
          }
        }

        // Дополнительная защита: если пришла строка с ISO-датой — пропускаем
        if (typeof val === 'string' &&
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val)) {
          continue;
        }

        if (val !== '') {
          record.values[indicators[j].name] = val;
        }
      }

      analyses.push(record);
    }

    // ===== Формируем ответ =====
    var result = {
      success: true,
      patients: patients,
      indicators: indicators.map(function(ind) {
        return { name: ind.name, category: ind.category };
      }),
      categories: categories,
      analyses: analyses,
      info: {
        patientsCount: patients.length,
        analysesCount: analyses.length,
        indicatorsCount: indicators.length,
        timestamp: new Date().toISOString()
      }
    };

    var jsonString = JSON.stringify(result);

    // Поддержка JSONP
    var callback = e && e.parameter && e.parameter.callback;
    if (callback) {
      return ContentService
        .createTextOutput(callback + '(' + jsonString + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }

    return ContentService
      .createTextOutput(jsonString)
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    var errorResult = JSON.stringify({
      success: false,
      error: err.toString()
    });

    var cb = e && e.parameter && e.parameter.callback;
    if (cb) {
      return ContentService
        .createTextOutput(cb + '(' + errorResult + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }

    return ContentService
      .createTextOutput(errorResult)
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * doPost — запись логина/пароля пациента обратно в таблицу
 *
 * Тело запроса (JSON): { action: "updateCredentials", name: "...", login: "...", password: "..." }
 */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    if (body.action !== 'updateCredentials') {
      throw new Error('Unknown action: ' + body.action);
    }

    var patientName = String(body.name || '').trim();
    var login       = String(body.login || '').trim().slice(0, 64);
    var password    = String(body.password || '').trim().slice(0, 128);

    if (!patientName) throw new Error('name is required');

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Список пациентов');
    if (!sheet) throw new Error('Лист "Список пациентов" не найден');

    var data = sheet.getDataRange().getValues();
    var updated = false;

    // Строка 0 — заголовки, ищем совпадение по колонке A (ФИО)
    for (var i = 1; i < data.length; i++) {
      var cellName = String(data[i][0] || '').trim();
      if (cellName.toLowerCase() === patientName.toLowerCase()) {
        // F=колонка 6, G=колонка 7 (0-based)
        sheet.getRange(i + 1, 6).setValue(login);
        sheet.getRange(i + 1, 7).setValue(password);
        updated = true;
        break;
      }
    }

    if (!updated) throw new Error('Пользователь не найден: ' + patientName);

    return ContentService
      .createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/** Форматирование ячейки (даты → строка) */
function formatCell(cell) {
  if (cell instanceof Date) {
    return Utilities.formatDate(cell, Session.getScriptTimeZone(), 'dd.MM.yyyy');
  }
  if (cell === null || cell === undefined) return '';
  return cell;
}

/** Тестовая функция — запустите в редакторе Apps Script для проверки */
function testDoGet() {
  var result = doGet({ parameter: {} });
  Logger.log(result.getContent().substring(0, 1000));
}
