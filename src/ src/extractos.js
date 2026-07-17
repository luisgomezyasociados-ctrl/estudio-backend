const fetch = require('node-fetch');

// Airtable separa la creación de registros (API normal) de la subida de
// archivos adjuntos (API de contenido, distinta URL). Primero se crea el
// registro vacío, y después se le sube el binario a ese registro puntual.
const CONTENT_API_BASE = 'https://content.airtable.com/v0';

async function uploadAttachment({ baseId, apiKey, recordId, fieldName, fileBuffer, filename, contentType }) {
  const url = `${CONTENT_API_BASE}/${baseId}/${recordId}/${encodeURIComponent(fieldName)}/uploadAttachment`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contentType,
      filename,
      file: fileBuffer.toString('base64'),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable uploadAttachment ${res.status}: ${text}`);
  }
  return res.json();
}

module.exports = { uploadAttachment };
