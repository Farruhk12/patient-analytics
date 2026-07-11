'use strict';

// ============================================================
// Локальный dev-сервер (без Vercel).
// Отдаёт статику из корня проекта и выполняет функции из папки api/.
// Запуск:  node dev-server.js   →   http://localhost:3000
// ============================================================

try { require('dotenv').config(); } catch (e) { /* dotenv не обязателен */ }

var http = require('http');
var fs = require('fs');
var path = require('path');
var url = require('url');

var ROOT = __dirname;
var PORT = process.env.PORT || 3000;

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

function loadApiHandler(apiPath) {
  var file = path.join(ROOT, 'api', apiPath + '.js');
  if (!fs.existsSync(file)) return null;
  delete require.cache[require.resolve(file)];
  return require(file);
}

var server = http.createServer(async function (req, res) {
  var parsed = url.parse(req.url, true);
  var pathname = decodeURIComponent(parsed.pathname);

  // --- API-маршруты ---
  if (pathname.indexOf('/api/') === 0) {
    var apiName = pathname.slice('/api/'.length).replace(/\/+$/, '');
    var handler = loadApiHandler(apiName);
    if (!handler) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'API not found: ' + apiName }));
      return;
    }
    req.query = parsed.query;
    try {
      await handler(req, res);
    } catch (err) {
      console.error('API error:', err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: err.message || 'Internal error' }));
      }
    }
    return;
  }

  // --- Статика ---
  var rel = pathname === '/' ? '/index.html' : pathname;
  var filePath = path.join(ROOT, rel);

  // Защита от выхода за пределы корня
  if (filePath.indexOf(ROOT) !== 0) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, function (err, stat) {
    if (err || !stat.isFile()) {
      // SPA-фолбэк: если запрошен несуществующий путь без расширения — отдаём index.html
      if (!path.extname(filePath)) {
        return serveFile(path.join(ROOT, 'index.html'), res);
      }
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    serveFile(filePath, res);
  });
});

function serveFile(filePath, res) {
  fs.readFile(filePath, function (err, data) {
    if (err) {
      res.statusCode = 500;
      res.end('Read error');
      return;
    }
    var ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.end(data);
  });
}

server.listen(PORT, function () {
  console.log('');
  console.log('  MedAnalytics dev-server запущен');
  console.log('  →  http://localhost:' + PORT + '/login.html');
  console.log('  Логин: ' + (process.env.ADMIN_LOGIN || 'admin') +
              '  Пароль: ' + (process.env.ADMIN_PASSWORD || '(не задан в .env)'));
  console.log('  Остановить: Ctrl+C');
  console.log('');
});
