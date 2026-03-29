'use strict';

/**
 * Сборка для Vercel / CI: каталог dist/ со всей статикой + config.js.
 * Так Vercel не отбрасывает config.js из-за записи в .gitignore (корень репо).
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

var cfg = {
  SCRIPT_URL: trimEnv('SCRIPT_URL', ''),
  GEMINI_API_KEY: trimEnv('GEMINI_API_KEY', ''),
  GEMINI_MODEL: trimEnv('GEMINI_MODEL', 'gemini-2.0-flash') || 'gemini-2.0-flash',
  ADMIN_LOGIN: trimEnv('ADMIN_LOGIN', 'admin') || 'admin',
  ADMIN_PASSWORD: trimEnv('ADMIN_PASSWORD', ''),
};

var dist = path.join(root, 'dist');
if (fs.existsSync(dist)) {
  fs.rmSync(dist, { recursive: true });
}
fs.mkdirSync(dist, { recursive: true });

var staticFiles = [
  'index.html',
  'login.html',
  'app.js',
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
  '// Сгенерировано scripts/build.js\n' +
  'window.APP_CONFIG = ' +
  JSON.stringify(cfg, null, 2) +
  ';\n';
fs.writeFileSync(path.join(dist, 'config.js'), out, 'utf8');

fs.writeFileSync(path.join(dist, '.nojekyll'), '', 'utf8');

console.log('=== BUILD CONFIG CHECK ===');
console.log('ADMIN_LOGIN  длина=' + cfg.ADMIN_LOGIN.length  + '  значение=' + cfg.ADMIN_LOGIN);
console.log('ADMIN_PASSWORD длина=' + cfg.ADMIN_PASSWORD.length);
console.log('SCRIPT_URL задан=' + (cfg.SCRIPT_URL ? 'ДА' : 'НЕТ'));
console.log('GEMINI_API_KEY задан=' + (cfg.GEMINI_API_KEY ? 'ДА' : 'НЕТ'));
console.log('==========================');

if (!cfg.ADMIN_PASSWORD) {
  console.error('ОШИБКА: ADMIN_PASSWORD пустой! Добавьте переменную окружения ADMIN_PASSWORD в Vercel и передеплойте.');
  process.exit(1);
}
