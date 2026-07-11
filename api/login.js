'use strict';

/**
 * POST /api/login  { login, password }
 * Проверяет админа (env) или пользователей из SCRIPT_URL (серверно).
 * Возвращает JWT-подобную HMAC-сессию + Set-Cookie.
 */
var session = require('./_lib/session');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    return session.sendJson(res, 405, { error: 'Method not allowed' });
  }

  var body = await session.readJsonBody(req);
  var loginVal = String(body.login || '').trim().slice(0, 64);
  var password = String(body.password || '').trim().slice(0, 128);

  if (!loginVal || !password) {
    return session.sendJson(res, 400, { ok: false, error: 'Укажите логин и пароль' });
  }

  try {
    var user = await authenticate(loginVal, password);
    if (!user) {
      return session.sendJson(res, 401, { ok: false, error: 'Неверный логин или пароль' });
    }
    var token = session.signSession(user);
    return session.sendJson(res, 200, {
      ok: true,
      token: token,
      user: {
        role: user.role,
        name: user.name,
        login: user.login,
        accessList: user.accessList || []
      }
    }, {
      'Set-Cookie': session.sessionCookie(token)
    });
  } catch (err) {
    console.error('login error:', err);
    return session.sendJson(res, 500, { ok: false, error: err.message || 'Ошибка входа' });
  }
};

async function authenticate(loginVal, password) {
  var adminLogin = String(process.env.ADMIN_LOGIN || 'admin').trim();
  var adminPassword = String(process.env.ADMIN_PASSWORD || '').trim();

  if (adminPassword && loginVal === adminLogin && password === adminPassword) {
    return {
      role: 'admin',
      name: 'Администратор',
      login: loginVal,
      accessList: []
    };
  }

  // Пользователи — с сервера из Google Apps Script (пароли не доверяем клиенту)
  var scriptUrl = String(process.env.SCRIPT_URL || '').trim();
  if (!scriptUrl) return null;

  var resp = await fetch(scriptUrl);
  if (!resp.ok) throw new Error('Не удалось загрузить пользователей (' + resp.status + ')');
  var json = await resp.json();
  if (!json || !json.success) throw new Error((json && json.error) || 'Ошибка данных');

  var patients = json.patients || [];
  for (var i = 0; i < patients.length; i++) {
    var p = patients[i];
    if (p && p.login && p.password && p.login === loginVal && p.password === password) {
      return {
        role: 'user',
        name: p.name,
        login: loginVal,
        accessList: p.accessList || []
      };
    }
  }
  return null;
}
