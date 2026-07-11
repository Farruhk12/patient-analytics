'use strict';

/**
 * Минимальные тесты парсера и норм (без фреймворка).
 * Запуск: node tests/parse.test.js
 */
var path = require('path');
var fs = require('fs');
var vm = require('vm');

var normsCode = fs.readFileSync(path.join(__dirname, '..', 'norms.js'), 'utf8');
var sandbox = { console: console, module: {}, exports: {} };
vm.runInNewContext(normsCode + '\nthis.parseMedicalValue=parseMedicalValue;this.numericValue=numericValue;this.classifyValue=classifyValue;this.deviationSeverity=deviationSeverity;this.checkPlausibility=checkPlausibility;this.getNorm=getNorm;', sandbox);

var passed = 0;
var failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log('  ✓ ' + msg);
  } else {
    failed++;
    console.error('  ✗ ' + msg);
  }
}

console.log('parseMedicalValue');
assert(sandbox.parseMedicalValue('13,5').num === 13.5, 'запятая → 13.5');
assert(sandbox.parseMedicalValue('1 350').num === 1350, 'пробел в числе');
assert(sandbox.classifyValue(200, 100, 150) === 'high', 'classify high');
assert(sandbox.classifyValue(50, 100, 150) === 'low', 'classify low');
assert(sandbox.classifyValue(120, 100, 150) === 'normal', 'classify normal');

console.log('deviationSeverity');
assert(sandbox.deviationSeverity(120, 100, 150) === 'normal', 'in range = normal');
assert(sandbox.deviationSeverity(160, 100, 150) === 'mild', '~7% over = mild');
assert(sandbox.deviationSeverity(200, 100, 150) === 'moderate', '~33% over = moderate');
assert(sandbox.deviationSeverity(300, 100, 150) === 'severe', '100% over = severe');

console.log('checkPlausibility');
var p = sandbox.checkPlausibility(1350, [130, 170]);
assert(p.suspicious === true, '1350 при норме Hb — подозрительно');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
