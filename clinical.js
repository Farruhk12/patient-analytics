// ============================================================
// MedAnalytics — Клинический движок (clinical.js)
// Подключается ПОСЛЕ norms.js и ДО app.js.
//
// Реализует:
//   2. Синдромальная интерпретация паттернов (анемии, щитовидка, печень…)
//   3. Критические значения (panic values)
//   4. Возрастные / физиологические референсы (дети, беременность, фаза цикла)
//   5. Динамика: delta-check, целевые значения, личный базовый уровень
//   6. Единицы измерения и конверсия
//   7. Контекст пациента (диагнозы / препараты / жалобы / беременность / цикл)
//   8. Сводка по системам органов + отчёт для врача
//
// Всё — вспомогательное, не является медицинским заключением.
// ============================================================

var CLINICAL = (function () {
  'use strict';

  // Безопасный парсер числа (используем глобальный, если есть)
  function toNum(raw) {
    if (typeof numericValue === 'function') return numericValue(raw);
    var n = parseFloat(String(raw).replace(',', '.'));
    return isNaN(n) ? NaN : n;
  }

  function round(n, d) {
    var p = Math.pow(10, d || 0);
    return Math.round(n * p) / p;
  }

  // ---------------------------------------------------------
  // Алиасы: разные написания одного и того же аналита в NORMS
  // ---------------------------------------------------------
  var ALIASES = {
    hb:      ['Гемоглобин HGB (Hb)'],
    mcv:     ['MCV (ср. объем эритроцита)'],
    mch:     ['MCH (ср. масса гемоглобина)'],
    rdw:     ['RDW (ширина распределения по объему)'],
    rbc:     ['Эритроциты (RBC)'],
    wbc:     ['Лейкоциты (WBC)'],
    plt:     ['Тромбоциты (PLT)'],
    neuAbs:  ['Абсолютные нейтрофилы (NEU#)'],
    esr:     ['СОЭ (скорость оседания эритроцитов)'],
    ferritin:['Ферритин'],
    iron:    ['Железо сыворотки', 'Железо (Fe)'],
    transferrin: ['Трансферрин'],
    tibc:    ['ОЖСС (общая железосвязывающая способность)'],
    b12:     ['Витамин B12'],
    folate:  ['Фолиевая кислота', 'Фолиевая кислота (B9)'],
    alt:     ['АЛТ (аланинаминотрансфераза)'],
    ast:     ['АСТ (аспартатаминотрансфераза)'],
    ggt:     ['Гамма-ГТ (ГГТ)'],
    alp:     ['Щелочная фосфатаза (ЩФ)'],
    biliTotal:['Общий билирубин'],
    biliDirect:['Прямой билирубин'],
    albumin: ['Альбумин'],
    protein: ['Общий белок'],
    glucose: ['Глюкоза'],
    hba1c:   ['Гликированный гемоглобин (HbA1c)'],
    insulin: ['Инсулин'],
    homa:    ['HOMA-IR (индекс ИР)'],
    chol:    ['Холестерин общий'],
    hdl:     ['ЛПВП (HDL)'],
    ldl:     ['ЛПНП (LDL)'],
    tg:      ['Триглицериды'],
    atherog: ['Индекс атерогенности'],
    uricAcid:['Мочевая кислота'],
    creatinine:['Креатинин'],
    urea:    ['Мочевина', 'Остаточный азот (BUN)'],
    crp:     ['С-реактивный белок (СРБ)', 'С-реактивный белок (СРБ / CRP)', 'hs-CRP (высокочувств. СРБ)', 'СРБ высокочувствительный (hs-CRP)'],
    pct:     ['Прокальцитонин (PCT)'],
    potassium:['Калий'],
    sodium:  ['Натрий'],
    chloride:['Хлор'],
    calcium: ['Кальций общий'],
    calciumIon:['Кальций ионизированный'],
    magnesium:['Магний', 'Магний (Mg)'],
    phosphorus:['Фосфор', 'Фосфор (P)'],
    tsh:     ['ТТГ (тиреотропный гормон)'],
    ft4:     ['Т4 свободный'],
    ft3:     ['Т3 свободный'],
    antiTPO: ['Антитела к ТПО (anti-TPO)'],
    antiTG:  ['Антитела к ТГ (anti-TG)'],
    vitD:    ['Витамин D (25(OH)D)'],
    inr:     ['МНО (международное нормализованное отношение)'],
    fibrinogen:['Фибриноген А', 'Фибриноген'],
    dDimer:  ['D-димер'],
    ntprobnp:['NT-proBNP (N-terminal proBNP)'],
    lh:      ['ЛГ (лютеинизирующий гормон)'],
    fsh:     ['ФСГ (фолликулостимулирующий гормон)'],
    estradiol:['Эстрадиол (E2)'],
    progesterone:['Прогестерон']
  };

  // ---------------------------------------------------------
  // 3. КРИТИЧЕСКИЕ ЗНАЧЕНИЯ (panic values), взрослые.
  //    Единицы — как в norms.js (СИ). Пороги ориентировочные.
  // ---------------------------------------------------------
  var PANIC = {
    'Калий':                              { low: 2.8, high: 6.0, unit: 'ммоль/л' },
    'Натрий':                             { low: 120, high: 160, unit: 'ммоль/л' },
    'Глюкоза':                            { low: 2.8, high: 22,  unit: 'ммоль/л' },
    'Кальций общий':                      { low: 1.6, high: 3.5, unit: 'ммоль/л' },
    'Кальций ионизированный':             { low: 0.8, high: 1.6, unit: 'ммоль/л' },
    'Магний':                             { low: 0.4, high: 2.0, unit: 'ммоль/л' },
    'Гемоглобин HGB (Hb)':                { low: 70,  high: 200, unit: 'г/л' },
    'Тромбоциты (PLT)':                   { low: 30,  high: 1000, unit: '10⁹/л' },
    'Лейкоциты (WBC)':                    { low: 2.0, high: 30,  unit: '10⁹/л' },
    'Абсолютные нейтрофилы (NEU#)':       { low: 0.5, high: null, unit: '10⁹/л' },
    'Креатинин':                          { low: null, high: 700, unit: 'мкмоль/л' },
    'МНО (международное нормализованное отношение)': { low: null, high: 5, unit: '' },
    'Фибриноген А':                       { low: 1.0, high: null, unit: 'г/л' },
    'Фибриноген':                         { low: 1.0, high: null, unit: 'г/л' },
    'Глюкоза (HbA1c)':                    { low: null, high: null }
  };

  // ---------------------------------------------------------
  // 6. ЕДИНИЦЫ И КОНВЕРСИЯ.
  //    Каноническая единица (как в norms.js) + множители перевода
  //    из распространённых альтернативных единиц В каноническую.
  // ---------------------------------------------------------
  var UNITS = {
    'Глюкоза':          { canonical: 'ммоль/л', alt: { 'мг/дл': 0.0555, 'mg/dl': 0.0555 } },
    'Холестерин общий': { canonical: 'ммоль/л', alt: { 'мг/дл': 0.0259, 'mg/dl': 0.0259 } },
    'ЛПВП (HDL)':       { canonical: 'ммоль/л', alt: { 'мг/дл': 0.0259, 'mg/dl': 0.0259 } },
    'ЛПНП (LDL)':       { canonical: 'ммоль/л', alt: { 'мг/дл': 0.0259, 'mg/dl': 0.0259 } },
    'Триглицериды':     { canonical: 'ммоль/л', alt: { 'мг/дл': 0.0113, 'mg/dl': 0.0113 } },
    'Креатинин':        { canonical: 'мкмоль/л', alt: { 'мг/дл': 88.4, 'mg/dl': 88.4 } },
    'Кальций общий':    { canonical: 'ммоль/л', alt: { 'мг/дл': 0.25, 'mg/dl': 0.25 } },
    'Общий билирубин':  { canonical: 'мкмоль/л', alt: { 'мг/дл': 17.1, 'mg/dl': 17.1 } },
    'Мочевина':         { canonical: 'ммоль/л', alt: { 'мг/дл': 0.357, 'mg/dl': 0.357 } },
    'Мочевая кислота':  { canonical: 'мкмоль/л', alt: { 'мг/дл': 59.48, 'mg/dl': 59.48 } }
  };

  // Проверка/подсказка по единицам: если значение сильно вне нормы,
  // но перевод из типичной альт-единицы возвращает его в диапазон —
  // вероятно, единицы перепутаны.
  function suggestUnitIssue(name, num, norm) {
    if (!norm || typeof num !== 'number' || isNaN(num)) return '';
    var u = UNITS[name];
    if (!u) return '';
    var lo = norm[0], hi = norm[1];
    // значение уже в норме — вопросов нет
    if (num >= lo && num <= hi) return '';
    var alts = u.alt || {};
    for (var unit in alts) {
      if (!alts.hasOwnProperty(unit)) continue;
      var converted = num * alts[unit];
      if (converted >= lo && converted <= hi) {
        return 'возможно, единицы «' + unit + '» — в ' + u.canonical +
          ' это ≈ ' + round(converted, 2) + ' (×' + alts[unit] + ')';
      }
    }
    return '';
  }

  function convert(name, value, fromUnit) {
    var u = UNITS[name];
    if (!u || !u.alt || !u.alt[fromUnit]) return null;
    return value * u.alt[fromUnit];
  }

  // ---------------------------------------------------------
  // 4. ВОЗРАСТНЫЕ / ФИЗИОЛОГИЧЕСКИЕ РЕФЕРЕНСЫ
  // ---------------------------------------------------------
  // Педиатрические диапазоны (единицы как в norms.js).
  // band: { maxAge, range:[lo,hi] } — берётся первый band, где age < maxAge.
  var PEDIATRIC = {
    'Гемоглобин HGB (Hb)': [
      { maxAge: 0.5, range: [95, 135] },
      { maxAge: 5,   range: [110, 140] },
      { maxAge: 12,  range: [115, 150] },
      { maxAge: 15,  range: [120, 160] }
    ],
    'Щелочная фосфатаза (ЩФ)': [
      { maxAge: 1,   range: [80, 470] },
      { maxAge: 10,  range: [100, 400] },
      { maxAge: 15,  range: [50, 450] } // пубертатный рост
    ],
    'Фосфор': [
      { maxAge: 1,   range: [1.3, 2.3] },
      { maxAge: 12,  range: [1.2, 1.8] },
      { maxAge: 16,  range: [0.95, 1.75] }
    ],
    'Фосфор (P)': [
      { maxAge: 1,   range: [1.3, 2.3] },
      { maxAge: 12,  range: [1.2, 1.8] },
      { maxAge: 16,  range: [0.95, 1.75] }
    ],
    'Креатинин': [
      { maxAge: 1,   range: [18, 35] },
      { maxAge: 6,   range: [27, 55] },
      { maxAge: 12,  range: [35, 70] },
      { maxAge: 16,  range: [45, 85] }
    ]
  };

  // Целевой верхний предел ТТГ по триместру (мЕд/л), международный подход.
  var TSH_PREGNANCY = { 1: [0.1, 2.5], 2: [0.2, 3.0], 3: [0.3, 3.0] };

  // Гормоны, интерпретация которых зависит от фазы цикла — помечаем,
  // но НЕ переопределяем числовой диапазон (единицы лаборатории могут
  // отличаться, безопаснее показать пояснение).
  var CYCLE_HORMONES = {
    'ЛГ (лютеинизирующий гормон)': true,
    'ФСГ (фолликулостимулирующий гормон)': true,
    'Эстрадиол (E2)': true,
    'Прогестерон': true,
    '17-ОН прогестерон': true
  };

  function cyclePhase(day) {
    if (!day || day < 1) return '';
    if (day <= 5) return 'менструальная';
    if (day <= 13) return 'фолликулярная';
    if (day <= 16) return 'овуляторная';
    return 'лютеиновая';
  }

  /**
   * Уточнить норму под возраст / беременность / фазу цикла.
   * @returns {{norm: (number[]|null), note: string}}
   *          norm=null означает «использовать базовую».
   */
  function refineNorm(baseNorm, name, ctx) {
    ctx = ctx || {};
    var age = typeof ctx.age === 'number' ? ctx.age : parseFloat(ctx.age);
    var out = { norm: null, note: '' };

    // Педиатрия
    if (!isNaN(age) && age < 18 && PEDIATRIC[name]) {
      var bands = PEDIATRIC[name];
      for (var i = 0; i < bands.length; i++) {
        if (age < bands[i].maxAge) {
          out.norm = bands[i].range.slice();
          out.note = 'детская норма (возраст ' + age + ')';
          return out;
        }
      }
    }

    // Беременность — ТТГ по триместру
    if (ctx.pregnant && name === 'ТТГ (тиреотропный гормон)') {
      var tri = ctx.trimester || 1;
      var r = TSH_PREGNANCY[tri] || TSH_PREGNANCY[1];
      out.norm = r.slice();
      out.note = 'беременность, ' + tri + '-й триместр';
      return out;
    }
    if (ctx.pregnant && (name === 'D-димер')) {
      out.note = 'при беременности D-димер физиологически повышается — оценивать осторожно';
      return out;
    }

    // Фаза цикла — пояснение без переопределения
    if (ctx.gender === 'Жен' && ctx.cycleDay && CYCLE_HORMONES[name]) {
      var ph = cyclePhase(ctx.cycleDay);
      if (ph) out.note = 'зависит от фазы цикла (день ' + ctx.cycleDay + ', ' + ph + ')';
    }

    return out;
  }

  // ---------------------------------------------------------
  // 5. ЦЕЛЕВЫЕ ЗНАЧЕНИЯ по состоянию (не популяционная норма, а цель терапии)
  // ---------------------------------------------------------
  // Определяем состояния по ключевым словам в conditions.
  var CONDITION_KEYWORDS = {
    diabetes:    ['диабет', 'сахарн', 'diabet', 'сд2', 'сд1', 'сд '],
    prediabetes: ['преддиабет', 'нарушение толерантности'],
    cvd:         ['ибс', 'атероскл', 'инфаркт', 'стенокард', 'ишеми', 'постинфаркт', 'стент', 'шунтир'],
    hypertension:['гипертон', 'аг ', 'гб ', 'артериальн'],
    ckd:         ['хбп', 'почечн', 'нефро', 'клубочков'],
    hypothyroid: ['гипотиреоз', 'аит', 'тиреоидит', 'l-тироксин', 'эутирокс', 'левотироксин'],
    gout:        ['подагр', 'гиперурикеми']
  };

  function detectConditions(ctx) {
    var found = {};
    var list = (ctx && ctx.conditions) || [];
    var meds = (ctx && ctx.meds) || [];
    var hay = list.concat(meds).join(' ').toLowerCase();
    for (var cond in CONDITION_KEYWORDS) {
      if (!CONDITION_KEYWORDS.hasOwnProperty(cond)) continue;
      var kws = CONDITION_KEYWORDS[cond];
      for (var i = 0; i < kws.length; i++) {
        if (hay.indexOf(kws[i]) !== -1) { found[cond] = true; break; }
      }
    }
    return found;
  }

  // Цели терапии: name -> { max?, min?, label, condition }
  function getTargets(ctx) {
    var cond = detectConditions(ctx);
    var t = {};
    if (cond.diabetes) {
      t['Гликированный гемоглобин (HbA1c)'] = { max: 7.0, label: 'цель <7% (диабет)', condition: 'диабет' };
      t['Глюкоза'] = { max: 7.0, label: 'цель натощак <7 (диабет)', condition: 'диабет' };
      t['ЛПНП (LDL)'] = { max: 1.8, label: 'цель <1.8 (диабет, высокий риск)', condition: 'диабет' };
    }
    if (cond.cvd) {
      t['ЛПНП (LDL)'] = { max: 1.4, label: 'цель <1.4 (ССЗ, очень высокий риск)', condition: 'ССЗ' };
    }
    if (cond.hypothyroid) {
      t['ТТГ (тиреотропный гормон)'] = { min: 0.4, max: 2.5, label: 'цель 0.4–2.5 на терапии', condition: 'гипотиреоз' };
    }
    if (cond.gout) {
      t['Мочевая кислота'] = { max: 360, label: 'цель <360 (подагра)', condition: 'подагра' };
    }
    return t;
  }

  // ---------------------------------------------------------
  // Построение индекса показаний по имени (canonical name -> reading)
  // reading: { name, num, norm, cls, unit }
  // ---------------------------------------------------------
  function indexReadings(readings) {
    var byName = {};
    (readings || []).forEach(function (r) {
      if (r && r.name) byName[r.name] = r;
    });
    // accessor: пробуем алиасы
    function pick(aliasKey) {
      var names = ALIASES[aliasKey] || [aliasKey];
      for (var i = 0; i < names.length; i++) {
        if (byName[names[i]]) return byName[names[i]];
      }
      return null;
    }
    return { byName: byName, pick: pick };
  }

  function cls(r) { return r ? r.cls : null; }
  function val(r) { return r ? r.num : null; }

  // ---------------------------------------------------------
  // 2. СИНДРОМАЛЬНАЯ ИНТЕРПРЕТАЦИЯ
  // ---------------------------------------------------------
  // Каждое правило получает accessor idx и ctx, возвращает
  // null или { id, title, system, level, detail }.
  var SYNDROME_RULES = [
    // Анемия + типизация по MCV
    function (idx) {
      var hb = idx.pick('hb'); if (!hb || cls(hb) !== 'low') return null;
      var mcv = idx.pick('mcv');
      var type = 'нормоцитарная';
      if (mcv && cls(mcv) === 'low') type = 'микроцитарная (чаще железодефицит)';
      else if (mcv && cls(mcv) === 'high') type = 'макроцитарная (чаще дефицит B12/фолатов)';
      return {
        id: 'anemia', title: 'Анемия — ' + type, system: 'Кровь', level: 'warn',
        detail: 'Гемоглобин ' + val(hb) + (mcv ? '; MCV ' + val(mcv) + ' → ' + type : '')
      };
    },
    // Железодефицит
    function (idx) {
      var ferritin = idx.pick('ferritin');
      var iron = idx.pick('iron');
      var transferrin = idx.pick('transferrin');
      var tibc = idx.pick('tibc');
      var hits = [];
      if (ferritin && cls(ferritin) === 'low') hits.push('ферритин ↓ ' + val(ferritin));
      if (iron && cls(iron) === 'low') hits.push('железо ↓ ' + val(iron));
      if (transferrin && cls(transferrin) === 'high') hits.push('трансферрин ↑');
      if (tibc && cls(tibc) === 'high') hits.push('ОЖСС ↑');
      if (hits.length === 0) return null;
      var strong = (ferritin && cls(ferritin) === 'low') || hits.length >= 2;
      if (!strong) return null;
      return {
        id: 'iron-def', title: 'Признаки дефицита железа', system: 'Железо', level: 'warn',
        detail: hits.join(', ') + '. Ферритин — самый чувствительный маркёр запасов железа.'
      };
    },
    // Дефицит B12 / фолатов
    function (idx) {
      var b12 = idx.pick('b12');
      var folate = idx.pick('folate');
      var mcv = idx.pick('mcv');
      var hits = [];
      if (b12 && cls(b12) === 'low') hits.push('B12 ↓ ' + val(b12));
      if (folate && cls(folate) === 'low') hits.push('фолаты ↓ ' + val(folate));
      if (hits.length === 0) return null;
      var macro = mcv && cls(mcv) === 'high';
      return {
        id: 'b12-folate', title: 'Дефицит B12 / фолиевой кислоты', system: 'Витамины', level: 'warn',
        detail: hits.join(', ') + (macro ? '; MCV повышен (макроцитоз)' : '')
      };
    },
    // Щитовидная железа
    function (idx) {
      var tsh = idx.pick('tsh'); if (!tsh) return null;
      var ft4 = idx.pick('ft4');
      var tpo = idx.pick('antiTPO');
      var auto = tpo && cls(tpo) === 'high' ? '; АТ-ТПО повышены (аутоиммунный процесс)' : '';
      if (cls(tsh) === 'high') {
        var sub = ft4 && cls(ft4) === 'normal';
        return {
          id: 'hypothyroid', title: sub ? 'Субклинический гипотиреоз' : 'Гипотиреоз', system: 'Щитовидка', level: 'warn',
          detail: 'ТТГ ↑ ' + val(tsh) + (ft4 ? '; Т4св ' + (cls(ft4) === 'low' ? '↓' : 'норма') : '') + auto
        };
      }
      if (cls(tsh) === 'low') {
        var subH = ft4 && cls(ft4) === 'normal';
        return {
          id: 'hyperthyroid', title: subH ? 'Субклинический тиреотоксикоз' : 'Тиреотоксикоз', system: 'Щитовидка', level: 'warn',
          detail: 'ТТГ ↓ ' + val(tsh) + (ft4 ? '; Т4св ' + (cls(ft4) === 'high' ? '↑' : 'норма') : '') + auto
        };
      }
      if (tpo && cls(tpo) === 'high') {
        return {
          id: 'thyroid-auto', title: 'Аутоиммунный тиреоидит (по АТ-ТПО)', system: 'Щитовидка', level: 'info',
          detail: 'АТ-ТПО ↑, ТТГ в норме — носительство антител / ранняя стадия'
        };
      }
      return null;
    },
    // Печень: цитолиз vs холестаз
    function (idx) {
      var alt = idx.pick('alt'), ast = idx.pick('ast');
      var ggt = idx.pick('ggt'), alp = idx.pick('alp'), bili = idx.pick('biliTotal');
      var cyto = (alt && cls(alt) === 'high') || (ast && cls(ast) === 'high');
      var chole = (ggt && cls(ggt) === 'high') || (alp && cls(alp) === 'high') || (bili && cls(bili) === 'high');
      if (!cyto && !chole) return null;
      var parts = [];
      var title;
      if (cyto && chole) title = 'Печень: смешанный паттерн (цитолиз + холестаз)';
      else if (cyto) title = 'Печень: цитолиз (повреждение гепатоцитов)';
      else title = 'Печень: холестаз (застой желчи)';
      if (alt && cls(alt) === 'high') parts.push('АЛТ ↑ ' + val(alt));
      if (ast && cls(ast) === 'high') parts.push('АСТ ↑ ' + val(ast));
      if (ggt && cls(ggt) === 'high') parts.push('ГГТ ↑ ' + val(ggt));
      if (alp && cls(alp) === 'high') parts.push('ЩФ ↑ ' + val(alp));
      if (bili && cls(bili) === 'high') parts.push('билирубин ↑ ' + val(bili));
      // индекс де Ритиса
      if (alt && ast && val(alt) > 0) {
        var ratio = round(val(ast) / val(alt), 2);
        parts.push('АСТ/АЛТ ' + ratio + (ratio > 2 ? ' (>2 — алкоголь/фиброз?)' : ''));
      }
      return { id: 'liver', title: title, system: 'Печень', level: 'warn', detail: parts.join(', ') };
    },
    // Углеводный обмен
    function (idx) {
      var glu = idx.pick('glucose'), a1c = idx.pick('hba1c');
      var ins = idx.pick('insulin'), homa = idx.pick('homa');
      var stage = '';
      if (a1c && val(a1c) != null) {
        if (val(a1c) >= 6.5) stage = 'диабетический диапазон (HbA1c ≥6.5%)';
        else if (val(a1c) >= 5.7) stage = 'преддиабет (HbA1c 5.7–6.4%)';
      }
      if (!stage && glu && val(glu) != null) {
        if (val(glu) >= 7.0) stage = 'гипергликемия натощак ≥7';
        else if (val(glu) >= 6.1) stage = 'нарушенная гликемия натощак 6.1–6.9';
      }
      var ir = (homa && cls(homa) === 'high') || (ins && cls(ins) === 'high');
      if (!stage && !ir) return null;
      var d = [];
      if (glu) d.push('глюкоза ' + val(glu));
      if (a1c) d.push('HbA1c ' + val(a1c) + '%');
      if (ir) d.push('признаки инсулинорезистентности' + (homa ? ' (HOMA-IR ' + val(homa) + ')' : ''));
      return {
        id: 'glucose-metab',
        title: 'Углеводный обмен: ' + (stage || 'инсулинорезистентность'),
        system: 'Углеводы', level: (stage.indexOf('диабет') !== -1 ? 'alert' : 'warn'),
        detail: d.join(', ')
      };
    },
    // Дислипидемия
    function (idx) {
      var ldl = idx.pick('ldl'), tg = idx.pick('tg'), hdl = idx.pick('hdl'), ath = idx.pick('atherog');
      var hits = [];
      if (ldl && cls(ldl) === 'high') hits.push('ЛПНП ↑ ' + val(ldl));
      if (tg && cls(tg) === 'high') hits.push('триглицериды ↑ ' + val(tg));
      if (hdl && cls(hdl) === 'low') hits.push('ЛПВП ↓ ' + val(hdl));
      if (ath && cls(ath) === 'high') hits.push('индекс атерогенности ↑ ' + val(ath));
      if (hits.length === 0) return null;
      return {
        id: 'dyslipidemia', title: 'Дислипидемия (атерогенный профиль)', system: 'Липиды', level: 'warn',
        detail: hits.join(', ')
      };
    },
    // Воспаление
    function (idx) {
      var crp = idx.pick('crp'), esr = idx.pick('esr'), pct = idx.pick('pct');
      var hits = [];
      if (crp && cls(crp) === 'high') hits.push('СРБ ↑ ' + val(crp));
      if (esr && cls(esr) === 'high') hits.push('СОЭ ↑ ' + val(esr));
      if (pct && cls(pct) === 'high') hits.push('прокальцитонин ↑ ' + val(pct));
      if (hits.length < 1) return null;
      var bacterial = pct && cls(pct) === 'high';
      return {
        id: 'inflammation', title: 'Воспалительная реакция' + (bacterial ? ' (прокальцитонин↑ — возможна бактериальная)' : ''),
        system: 'Воспаление', level: bacterial ? 'alert' : 'warn', detail: hits.join(', ')
      };
    },
    // Функция почек
    function (idx) {
      var cr = idx.pick('creatinine'), ur = idx.pick('urea'), ua = idx.pick('uricAcid');
      var hits = [];
      if (cr && cls(cr) === 'high') hits.push('креатинин ↑ ' + val(cr));
      if (ur && cls(ur) === 'high') hits.push('мочевина ↑ ' + val(ur));
      if (hits.length === 0) {
        if (ua && cls(ua) === 'high') {
          return { id: 'uric', title: 'Гиперурикемия', system: 'Почки', level: 'info', detail: 'мочевая кислота ↑ ' + val(ua) + ' — риск подагры' };
        }
        return null;
      }
      return { id: 'renal', title: 'Снижение функции почек (по азотистым)', system: 'Почки', level: 'warn', detail: hits.join(', ') };
    }
  ];

  function detectSyndromes(readings, ctx) {
    var idx = indexReadings(readings);
    var out = [];
    var seen = {};
    for (var i = 0; i < SYNDROME_RULES.length; i++) {
      try {
        var res = SYNDROME_RULES[i](idx, ctx || {});
        if (res && !seen[res.id]) { seen[res.id] = true; out.push(res); }
      } catch (e) { /* правило не должно ронять всё */ }
    }
    return out;
  }

  // ---------------------------------------------------------
  // Проверка panic values
  // ---------------------------------------------------------
  function checkPanic(readings) {
    var out = [];
    (readings || []).forEach(function (r) {
      if (!r || typeof r.num !== 'number' || isNaN(r.num)) return;
      var p = PANIC[r.name];
      if (!p) return;
      if (p.low != null && r.num < p.low) {
        out.push({ name: r.name, value: r.num, dir: 'low', threshold: p.low, unit: p.unit || r.unit || '' });
      } else if (p.high != null && r.num > p.high) {
        out.push({ name: r.name, value: r.num, dir: 'high', threshold: p.high, unit: p.unit || r.unit || '' });
      }
    });
    return out;
  }

  // ---------------------------------------------------------
  // 5. DELTA-CHECK: значимое изменение относительно прошлого
  // ---------------------------------------------------------
  // Порог значимого относительного изменения по типу аналита.
  var DELTA_THRESHOLD = {
    'default': 0.25,
    'Гемоглобин HGB (Hb)': 0.15,
    'Тромбоциты (PLT)': 0.30,
    'Креатинин': 0.25,
    'Калий': 0.15,
    'Натрий': 0.05,
    'ТТГ (тиреотропный гормон)': 0.5,
    'Гликированный гемоглобин (HbA1c)': 0.1
  };

  function deltaCheck(name, current, prev) {
    if (typeof current !== 'number' || typeof prev !== 'number' || isNaN(current) || isNaN(prev)) return null;
    var base = Math.abs(prev) > 1e-9 ? Math.abs(prev) : 1;
    var rel = (current - prev) / base;
    var thr = DELTA_THRESHOLD[name] || DELTA_THRESHOLD['default'];
    if (Math.abs(rel) < thr) return null;
    return {
      dir: rel > 0 ? 'up' : 'down',
      pct: Math.round(rel * 100),
      significant: true,
      from: prev, to: current
    };
  }

  // ---------------------------------------------------------
  // 8. СВОДКА ПО СИСТЕМАМ ОРГАНОВ
  // ---------------------------------------------------------
  var SYSTEM_KEYWORDS = [
    ['Печень',    ['алт', 'аст', 'ггт', 'билирубин', 'щелочная фосфатаза', 'альбумин', 'общий белок', 'тимолов', 'холинэстераз']],
    ['Почки',     ['креатинин', 'мочевина', 'мочевая кислота', 'скф', 'bun', 'остаточный азот', 'цистатин', 'β2-микро']],
    ['Углеводы',  ['глюкоза', 'hba1c', 'гликирован', 'инсулин', 'homa', 'с-пептид', 'глюкагон']],
    ['Липиды',    ['холестерин', 'лпвп', 'лпнп', 'hdl', 'ldl', 'триглицерид', 'атероген', 'липопротеин']],
    ['Электролиты', ['калий', 'натрий', 'хлор', 'кальций', 'магний', 'фосфор']],
    ['Щитовидка', ['ттг', 'т3', 'т4', 'тпо', 'тиреоглоб', 'anti-tg', 'anti-tpo']],
    ['Железо',    ['ферритин', 'железо', 'трансферрин', 'ожсс']],
    ['Воспаление', ['срб', 'crp', 'соэ', 'прокальцитонин', 'ревматоид', 'иммуноглобулин']],
    ['Свёртывание', ['ачтв', 'мно', 'протромбин', 'тромбиновое', 'фибриноген', 'd-димер', 'антитромбин', 'рфмк', 'квик']],
    ['Витамины',  ['витамин', 'b12', 'фолиев', 'цинк', 'медь', 'селен', '25(oh)']],
    ['Сердце',    ['nt-probnp', 'probnp', 'гомоцистеин', 'кфк', 'тропонин', 'лдг']],
    ['Гормоны',   ['кортизол', 'тестостерон', 'эстрадиол', 'прогестерон', 'пролактин', 'лг ', 'фсг', 'дгэа', 'амг', 'паратгормон', 'акдг', 'акту']],
    ['Кровь',     ['гемоглобин', 'эритроцит', 'лейкоцит', 'тромбоцит', 'соэ', 'гематокрит', 'mch', 'mcv', 'mchc', 'лимфоцит', 'моноцит', 'нейтрофил', 'эозинофил', 'базофил', 'rdw', 'ретикулоцит', 'p-lcr', 'pdw', 'mpv']]
  ];

  function systemOf(name, category) {
    var n = String(name || '').toLowerCase();
    for (var i = 0; i < SYSTEM_KEYWORDS.length; i++) {
      var kws = SYSTEM_KEYWORDS[i][1];
      for (var j = 0; j < kws.length; j++) {
        if (n.indexOf(kws[j]) !== -1) return SYSTEM_KEYWORDS[i][0];
      }
    }
    // fallback по категории
    var c = String(category || '').toUpperCase();
    if (c.indexOf('ОАК') !== -1) return 'Кровь';
    if (c.indexOf('ГОРМ') !== -1) return 'Гормоны';
    if (c.indexOf('КОАГ') !== -1) return 'Свёртывание';
    return 'Прочее';
  }

  // readings -> [{ system, total, high, low, worst, status }]
  function buildSystemSummary(readings) {
    var map = {};
    (readings || []).forEach(function (r) {
      if (!r || r.cls == null) return;
      var sys = systemOf(r.name, r.category);
      if (!map[sys]) map[sys] = { system: sys, total: 0, high: 0, low: 0, worst: 'normal' };
      var s = map[sys];
      s.total++;
      if (r.cls === 'high') s.high++;
      if (r.cls === 'low') s.low++;
      var sev = r.severity || (r.cls !== 'normal' ? 'moderate' : 'normal');
      if (sevRank(sev) > sevRank(s.worst)) s.worst = sev;
    });
    var arr = [];
    for (var k in map) {
      if (!map.hasOwnProperty(k)) continue;
      var s = map[k];
      s.deviated = s.high + s.low;
      s.status = s.deviated === 0 ? 'ok' : (s.worst === 'severe' ? 'alert' : 'warn');
      arr.push(s);
    }
    // сначала проблемные
    arr.sort(function (a, b) {
      if ((b.deviated > 0) !== (a.deviated > 0)) return (b.deviated > 0) - (a.deviated > 0);
      return sevRank(b.worst) - sevRank(a.worst);
    });
    return arr;
  }

  function sevRank(s) {
    return s === 'severe' ? 3 : s === 'moderate' ? 2 : s === 'mild' ? 1 : 0;
  }

  // ---------------------------------------------------------
  // 7. КОНТЕКСТ ПАЦИЕНТА (localStorage)
  // ---------------------------------------------------------
  function ctxKey(name) {
    var norm = (typeof normalizeName === 'function') ? normalizeName(name) : String(name || '').toLowerCase().trim();
    return 'med_clin_' + norm;
  }

  function emptyContext() {
    return { conditions: [], meds: [], complaints: '', pregnant: false, trimester: null, cycleDay: null };
  }

  function getContext(name) {
    try {
      var raw = localStorage.getItem(ctxKey(name));
      if (!raw) return emptyContext();
      var obj = JSON.parse(raw);
      var base = emptyContext();
      if (obj && typeof obj === 'object') {
        base.conditions = Array.isArray(obj.conditions) ? obj.conditions : (obj.conditions ? String(obj.conditions).split(',').map(trim) : []);
        base.meds = Array.isArray(obj.meds) ? obj.meds : (obj.meds ? String(obj.meds).split(',').map(trim) : []);
        base.complaints = obj.complaints || '';
        base.pregnant = !!obj.pregnant;
        base.trimester = obj.trimester || null;
        base.cycleDay = obj.cycleDay || null;
      }
      return base;
    } catch (e) { return emptyContext(); }
  }

  function setContext(name, ctx) {
    try { localStorage.setItem(ctxKey(name), JSON.stringify(ctx || emptyContext())); } catch (e) {}
  }

  function trim(s) { return String(s || '').trim(); }

  // Собрать полный контекст (с возрастом/полом пациента) для движка
  function fullContext(patient) {
    var c = getContext(patient.name);
    c.age = (typeof patient.age === 'number') ? patient.age : parseFloat(patient.age);
    c.gender = patient.gender || '';
    return c;
  }

  // Человекочитаемое описание контекста (для AI / отчёта)
  function describeContext(ctx) {
    var parts = [];
    if (ctx.conditions && ctx.conditions.length) parts.push('Диагнозы: ' + ctx.conditions.join(', '));
    if (ctx.meds && ctx.meds.length) parts.push('Препараты: ' + ctx.meds.join(', '));
    if (ctx.pregnant) parts.push('Беременность' + (ctx.trimester ? ' (' + ctx.trimester + '-й триместр)' : ''));
    if (ctx.gender === 'Жен' && ctx.cycleDay) parts.push('День цикла: ' + ctx.cycleDay + ' (' + cyclePhase(ctx.cycleDay) + ' фаза)');
    if (ctx.complaints) parts.push('Жалобы/анамнез: ' + ctx.complaints);
    return parts.join('. ');
  }

  // ---------------------------------------------------------
  // 8. ОТЧЁТ ДЛЯ ВРАЧА (plain text)
  // ---------------------------------------------------------
  function buildDoctorReport(opts) {
    opts = opts || {};
    var patient = opts.patient || {};
    var ctx = opts.ctx || {};
    var readings = opts.readings || [];
    var panic = opts.panic || [];
    var syndromes = opts.syndromes || [];
    var targets = opts.targets || {};
    var dateStr = opts.dateStr || '';
    var lab = opts.lab || '';
    var aiText = opts.aiText || '';

    var L = [];
    L.push('МЕДИЦИНСКИЙ ОТЧЁТ (сформирован MedAnalytics)');
    L.push('Не является медицинским заключением. Требует оценки врачом.');
    L.push('='.repeat(56));
    L.push('Пациент: ' + (patient.name || '—'));
    L.push('Пол: ' + (patient.gender || '—') + '   Возраст: ' + (patient.age || '—'));
    L.push('Дата анализа: ' + (dateStr || '—') + (lab ? '   (' + lab + ')' : ''));
    var cdesc = describeContext(ctx);
    if (cdesc) L.push('Контекст: ' + cdesc);
    L.push('');

    if (panic.length) {
      L.push('!!! КРИТИЧЕСКИЕ ЗНАЧЕНИЯ (проверить немедленно):');
      panic.forEach(function (p) {
        L.push('  • ' + p.name + ': ' + p.value + ' ' + (p.unit || '') +
          ' (' + (p.dir === 'high' ? 'выше' : 'ниже') + ' критического порога ' + p.threshold + ')');
      });
      L.push('');
    }

    var deviated = readings.filter(function (r) { return r.cls === 'high' || r.cls === 'low'; });
    L.push('ОТКЛОНЕНИЯ (' + deviated.length + '):');
    if (deviated.length === 0) L.push('  — не выявлено');
    deviated.sort(function (a, b) { return sevRank(b.severity) - sevRank(a.severity); });
    deviated.forEach(function (r) {
      var arrow = r.cls === 'high' ? '↑' : '↓';
      var normStr = r.norm ? (r.norm[0] + '–' + r.norm[1]) : '—';
      var tgt = targets[r.name] ? '  [' + targets[r.name].label + ']' : '';
      L.push('  ' + arrow + ' ' + r.name + ': ' + r.num + (r.unit ? ' ' + r.unit : '') +
        '  (норма ' + normStr + ')' + tgt + (r.note ? '  — ' + r.note : ''));
    });
    L.push('');

    if (syndromes.length) {
      L.push('СИНДРОМАЛЬНАЯ ИНТЕРПРЕТАЦИЯ:');
      syndromes.forEach(function (s) {
        L.push('  • [' + s.system + '] ' + s.title);
        if (s.detail) L.push('      ' + s.detail);
      });
      L.push('');
    }

    if (aiText) {
      L.push('AI-РАЗБОР:');
      L.push(aiText.trim());
      L.push('');
    }

    L.push('='.repeat(56));
    L.push('Сформировано: ' + new Date().toLocaleString('ru-RU'));
    return L.join('\n');
  }

  // ---------------------------------------------------------
  // Публичный API
  // ---------------------------------------------------------
  return {
    PANIC: PANIC,
    UNITS: UNITS,
    ALIASES: ALIASES,
    refineNorm: refineNorm,
    suggestUnitIssue: suggestUnitIssue,
    convert: convert,
    checkPanic: checkPanic,
    deltaCheck: deltaCheck,
    detectSyndromes: detectSyndromes,
    detectConditions: detectConditions,
    getTargets: getTargets,
    buildSystemSummary: buildSystemSummary,
    systemOf: systemOf,
    cyclePhase: cyclePhase,
    getContext: getContext,
    setContext: setContext,
    fullContext: fullContext,
    describeContext: describeContext,
    buildDoctorReport: buildDoctorReport
  };
})();

if (typeof window !== 'undefined') { window.CLINICAL = CLINICAL; }
if (typeof module !== 'undefined' && module.exports) { module.exports = CLINICAL; }
