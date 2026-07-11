/**
 * Vercel serverless: AI proxy — ключи остаются на сервере.
 * POST /api/analyze  { prompt, provider?: 'deepseek'|'gemini' }
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  var body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};
  var prompt = body.prompt;
  if (!prompt || typeof prompt !== 'string') {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'prompt required' }));
  }

  var provider = (body.provider || process.env.AI_PROVIDER || 'deepseek').toLowerCase();
  try {
    var text;
    if (provider === 'gemini') {
      text = await callGemini(prompt);
    } else {
      text = await callDeepSeek(prompt);
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ text: text }));
  } catch (err) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: err.message || 'AI error' }));
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
