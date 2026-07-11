'use strict';

/**
 * HMAC-сессия без внешних зависимостей (Node crypto).
 * Токен: base64url(JSON).base64url(HMAC-SHA256)
 */
var crypto = require('crypto');

var COOKIE_NAME = 'med_token';
var SESSION_HOURS = 8;

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlDecode(str) {
  str = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString('utf8');
}

function getSecret() {
  var s = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || '';
  if (!s) throw new Error('SESSION_SECRET (или ADMIN_PASSWORD) не задан на сервере');
  return s;
}

function signSession(user) {
  var payload = {
    role: user.role,
    name: user.name,
    login: user.login,
    accessList: user.accessList || [],
    exp: Date.now() + SESSION_HOURS * 3600 * 1000
  };
  var body = b64urlEncode(JSON.stringify(payload));
  var sig = crypto.createHmac('sha256', getSecret()).update(body).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return body + '.' + sig;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  var parts = token.split('.');
  if (parts.length !== 2) return null;
  var body = parts[0];
  var sig = parts[1];
  var expected = crypto.createHmac('sha256', getSecret()).update(body).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  var a = Buffer.from(sig);
  var b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    var payload = JSON.parse(b64urlDecode(body));
    if (!payload || !payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function parseCookies(req) {
  var header = req.headers && (req.headers.cookie || req.headers.Cookie) || '';
  var out = {};
  String(header).split(';').forEach(function(part) {
    var i = part.indexOf('=');
    if (i < 0) return;
    var k = part.slice(0, i).trim();
    var v = part.slice(i + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function getTokenFromRequest(req) {
  var auth = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  if (auth.toLowerCase().indexOf('bearer ') === 0) {
    return auth.slice(7).trim();
  }
  var cookies = parseCookies(req);
  return cookies[COOKIE_NAME] || '';
}

function requireSession(req) {
  return verifyToken(getTokenFromRequest(req));
}

function sessionCookie(token) {
  var maxAge = SESSION_HOURS * 3600;
  var parts = [
    COOKIE_NAME + '=' + encodeURIComponent(token),
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + maxAge
  ];
  // Secure only on HTTPS (Vercel production)
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function clearSessionCookie() {
  return COOKIE_NAME + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

function readJsonBody(req) {
  return new Promise(function(resolve) {
    if (req.body && typeof req.body === 'object') {
      resolve(req.body);
      return;
    }
    if (typeof req.body === 'string') {
      try { resolve(JSON.parse(req.body)); } catch (e) { resolve({}); }
      return;
    }
    var raw = '';
    req.on('data', function(chunk) { raw += chunk; });
    req.on('end', function() {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { resolve({}); }
    });
  });
}

function sendJson(res, status, data, extraHeaders) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (extraHeaders) {
    Object.keys(extraHeaders).forEach(function(k) {
      res.setHeader(k, extraHeaders[k]);
    });
  }
  res.end(JSON.stringify(data));
}

module.exports = {
  COOKIE_NAME: COOKIE_NAME,
  signSession: signSession,
  verifyToken: verifyToken,
  requireSession: requireSession,
  getTokenFromRequest: getTokenFromRequest,
  sessionCookie: sessionCookie,
  clearSessionCookie: clearSessionCookie,
  readJsonBody: readJsonBody,
  sendJson: sendJson
};
