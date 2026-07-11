/**
 * Vercel serverless: AI proxy — ключи только на сервере.
 * POST /api/analyze  { prompt, provider?: 'deepseek'|'gemini' }
 * Требует сессию (Authorization: Bearer <token> или cookie med_token).
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

  var user = null;
  try {
    user = session.requireSession(req);
  } catch (e) {
    return session.sendJson(res, 500, { error: e.message || 'Session misconfigured' });
  }
  if (!user) {
    return session.sendJson(res, 401, { error: 'Требуется вход' });
  }

  var body = await session.readJsonBody(req);
  var prompt = body.prompt;
  if (!prompt || typeof prompt !== 'string') {
    return session.sendJson(res, 400, { error: 'prompt required' });
  }
  if (prompt.length > 12000) {
    return session.sendJson(res, 400, { error: 'prompt too long' });
  }

  var provider = (body.provider || process.env.AI_PROVIDER || 'deepseek').toLowerCase();
  try {
    var text = provider === 'gemini'
      ? await callGemini(prompt)
      : await callDeepSeek(prompt);
    return session.sendJson(res, 200, { text: text });
  } catch (err) {
    return session.sendJson(res, 502, { error: err.message || 'AI error' });
  }
};

async function callDeepSeek(prompt) {
  var key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('DEEPSEEK_API_KEY не задан на сервере');
  var model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  var resp = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + key
    },
    body: JSON.stringify({
      model: model,
      temperature: 0.25,
      max_tokens: 900,
      messages: [
        { role: 'system', content: 'Ты — аккуратный медицинский ассистент. Не ставишь диагнозов.' },
        { role: 'user', content: prompt }
      ]
    })
  });
  if (!resp.ok) {
    var err = await resp.json().catch(function() { return {}; });
    throw new Error((err.error && err.error.message) || ('DeepSeek ' + resp.status));
  }
  var data = await resp.json();
  return data.choices[0].message.content;
}

async function callGemini(prompt) {
  var key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY не задан на сервере');
  var model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model +
    ':generateContent?key=' + encodeURIComponent(key);
  var resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.25, maxOutputTokens: 900 }
    })
  });
  if (!resp.ok) {
    var err = await resp.json().catch(function() { return {}; });
    throw new Error((err.error && err.error.message) || ('Gemini ' + resp.status));
  }
  var data = await resp.json();
  return data.candidates[0].content.parts[0].text;
}
