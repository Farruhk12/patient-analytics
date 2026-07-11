'use strict';

/**
 * Сборка: dist/ + публичный config.js (без секретов).
 * Секреты остаются только в env на Vercel / локальном .env для API.
 */
var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var envFile = path.join(root, '.env');

if (fs.existsSync(envFile)) {
  try {
    require('dotenv').config({ path: envFile });
  } catch (e) {
    console.warn('dotenv не установлен; npm install');
  }
}

function trimEnv(name, fallback) {
  var v = process.env[name];
  if (v == null || v === '') return fallback;
  return String(v).trim();
}

// Только публичные поля для браузера — никаких паролей и API-ключей
var publicCfg = {
  SCRIPT_URL: trimEnv('SCRIPT_URL', ''),
  AI_PROVIDER: (trimEnv('AI_PROVIDER', '') || 'deepseek').toLowerCase(),
  GEMINI_MODEL: trimEnv('GEMINI_MODEL', 'gemini-2.0-flash') || 'gemini-2.0-flash',
  DEEPSEEK_MODEL: trimEnv('DEEPSEEK_MODEL', 'deepseek-chat') || 'deepseek-chat',
  AUTH_API: true
};

if (publicCfg.AI_PROVIDER === 'gemini' && trimEnv('DEEPSEEK_API_KEY', '') && !trimEnv('GEMINI_API_KEY', '')) {
  publicCfg.AI_PROVIDER = 'deepseek';
}

var dist = path.join(root, 'dist');
if (fs.existsSync(dist)) {
  fs.rmSync(dist, { recursive: true });
}
fs.mkdirSync(dist, { recursive: true });

var staticFiles = [
  'index.html',
  'login.html',
  'app.js',
  'enhancements.js',
  'auth.js',
  'norms.js',
  'style.css',
  'manifest.json',
  'google-apps-script.js',
  'favicon.svg',
  'apple-touch-icon.svg',
  'icon-192.svg',
  'icon-512.svg',
];

staticFiles.forEach(function (name) {
  var from = path.join(root, name);
  if (!fs.existsSync(from)) {
    console.warn('Нет файла: ' + name);
    return;
  }
  fs.copyFileSync(from, path.join(dist, name));
});

var out =
  '// Сгенерировано scripts/build.js — только публичный конфиг (без секретов)\n' +
  'window.APP_CONFIG = ' +
  JSON.stringify(publicCfg, null, 2) +
  ';\n';
fs.writeFileSync(path.join(dist, 'config.js'), out, 'utf8');
fs.writeFileSync(path.join(dist, '.nojekyll'), '', 'utf8');

var hasAdminPass = !!trimEnv('ADMIN_PASSWORD', '');
var hasScript = !!publicCfg.SCRIPT_URL;
var hasDeepseek = !!trimEnv('DEEPSEEK_API_KEY', '');
var hasGemini = !!trimEnv('GEMINI_API_KEY', '');

console.log('=== BUILD CONFIG CHECK (public → config.js) ===');
console.log('SCRIPT_URL задан=' + (hasScript ? 'ДА' : 'НЕТ'));
console.log('AI_PROVIDER=' + publicCfg.AI_PROVIDER);
console.log('AUTH_API=true (логин и AI через /api/*)');
console.log('=== SERVER ENV (не попадают в браузер) ===');
console.log('ADMIN_PASSWORD задан=' + (hasAdminPass ? 'ДА' : 'НЕТ'));
console.log('SESSION_SECRET задан=' + (trimEnv('SESSION_SECRET', '') ? 'ДА' : 'нет (будет ADMIN_PASSWORD)'));
console.log('DEEPSEEK_API_KEY задан=' + (hasDeepseek ? 'ДА' : 'НЕТ'));
console.log('GEMINI_API_KEY задан=' + (hasGemini ? 'ДА' : 'НЕТ'));
console.log('==============================================');

var missing = [];
if (!hasAdminPass) missing.push('ADMIN_PASSWORD');
if (!hasScript) missing.push('SCRIPT_URL');

if (missing.length) {
  console.error('');
  console.error('ОШИБКА: не заданы переменные окружения: ' + missing.join(', '));
  console.error('Vercel → Settings → Environment Variables (Production):');
  console.error('  SCRIPT_URL, ADMIN_LOGIN, ADMIN_PASSWORD, SESSION_SECRET,');
  console.error('  AI_PROVIDER, DEEPSEEK_API_KEY (или GEMINI_API_KEY)');
  process.exit(1);
}

if (publicCfg.AI_PROVIDER === 'deepseek' && !hasDeepseek) {
  console.warn('ПРЕДУПРЕЖДЕНИЕ: AI_PROVIDER=deepseek, но DEEPSEEK_API_KEY пуст на сервере.');
}
if (publicCfg.AI_PROVIDER === 'gemini' && !hasGemini) {
  console.warn('ПРЕДУПРЕЖДЕНИЕ: AI_PROVIDER=gemini, но GEMINI_API_KEY пуст на сервере.');
}
