const { google } = require('googleapis');

function getOAuthClient() {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oAuth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return oAuth2Client;
}

function decodeBody(payload) {
  // Busca la parte de texto plano; si no hay, usa el snippet.
  function findPart(part) {
    if (!part) return null;
    if (part.mimeType === 'text/plain' && part.body?.data) return part.body.data;
    if (part.parts) {
      for (const p of part.parts) {
        const found = findPart(p);
        if (found) return found;
      }
    }
    return null;
  }
  const data = findPart(payload) || payload?.body?.data;
  if (!data) return '';
  return Buffer.from(data, 'base64').toString('utf-8');
}

/**
 * Devuelve los emails recientes de la bandeja (según GMAIL_QUERY, default: último día).
 */
async function getRecentEmails() {
  const auth = getOAuthClient();
  const gmail = google.gmail({ version: 'v1', auth });

  const list = await gmail.users.messages.list({
    userId: 'me',
    q: process.env.GMAIL_QUERY || 'newer_than:1d',
    maxResults: 25,
  });

  const messages = list.data.messages || [];
  const results = [];

  for (const m of messages) {
    const full = await gmail.users.messages.get({
      userId: 'me',
      id: m.id,
      format: 'full',
    });
    const headers = full.data.payload.headers || [];
    const getHeader = (name) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    results.push({
      threadId: full.data.threadId,
      from: getHeader('From'),
      subject: getHeader('Subject'),
      snippet: full.data.snippet,
      body: decodeBody(full.data.payload) || full.data.snippet,
      receivedAt: new Date(parseInt(full.data.internalDate, 10)).toISOString(),
    });
  }

  return results;
}

module.exports = { getRecentEmails };
