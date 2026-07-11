'use strict';

/**
 * POST /api/logout — сброс cookie сессии
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

  return session.sendJson(res, 200, { ok: true }, {
    'Set-Cookie': session.clearSessionCookie()
  });
};
