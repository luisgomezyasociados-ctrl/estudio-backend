// Reemplazamos googleapis por fetch directo: la librería googleapis
// tiene un problema de compatibilidad con Node 22 en este entorno
// (error "Premature close" al renovar el token).

async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Error al renovar token de Google: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

function decodeBody(payload) {
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
  const accessToken = await getAccessToken();
  const headers = { Authorization: `Bearer ${accessToken}` };

  const query = process.env.GMAIL_QUERY || 'newer_than:1d';
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=25`;
  const listRes = await fetch(listUrl, { headers });
  const listData = await listRes.json();
  if (!listRes.ok) {
    throw new Error(`Error al listar emails: ${JSON.stringify(listData)}`);
  }

  const messages = listData.messages || [];
  const results = [];

  for (const m of messages) {
    const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`;
    const msgRes = await fetch(msgUrl, { headers });
    const full = await msgRes.json();
    if (!msgRes.ok) {
      throw new Error(`Error al obtener email ${m.id}: ${JSON.stringify(full)}`);
    }

    const msgHeaders = full.payload.headers || [];
    const getHeader = (name) =>
      msgHeaders.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    results.push({
      threadId: full.threadId,
      from: getHeader('From'),
      subject: getHeader('Subject'),
      snippet: full.snippet,
      body: decodeBody(full.payload) || full.snippet,
      receivedAt: new Date(parseInt(full.internalDate, 10)).toISOString(),
    });
  }

  return results;
}

module.exports = { getRecentEmails };
