// This function runs on Netlify's servers, NOT in the visitor's browser.
// Your Gemini API key lives here as a secret environment variable —
// visitors never see it, no matter how much they inspect the page.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }
  try {
    const { systemPrompt, messages } = JSON.parse(event.body);
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Server is missing GEMINI_API_KEY. Add it in Netlify > Site settings > Environment variables.' })
      };
    }

    const contents = (messages || []).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const model = 'gemini-2.5-flash'; // faster + widely available; avoids slow/unstable preview models
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    // Abort the request ourselves BEFORE Netlify's own timeout kills the function.
    // Netlify's default limit is 10s, so we cut off at 9s and return a clean JSON error.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt || '' }] },
          contents
        }),
        signal: controller.signal
      });
    } catch (fetchErr) {
      clearTimeout(timeout);
      if (fetchErr.name === 'AbortError') {
        return {
          statusCode: 504,
          body: JSON.stringify({ error: 'Gemini API took too long to respond. Please try again.' })
        };
      }
      throw fetchErr;
    }
    clearTimeout(timeout);

    // If Gemini itself returned a non-JSON body (rare, but happens on their outages),
    // don't let response.json() throw an unhandled error.
    let data;
    const rawText = await response.text();
    try {
      data = JSON.parse(rawText);
    } catch {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: `Gemini API returned an unexpected response (status ${response.status}).` })
      };
    }

    if (data.error) {
      return { statusCode: 500, body: JSON.stringify({ error: data.error.message || 'Gemini API error' }) };
    }

    const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    const text = parts ? parts.map(p => p.text || '').join('\n').trim() : '';

    return {
      statusCode: 200,
      body: JSON.stringify({ reply: text || "Sorry, I didn't understand that." })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
