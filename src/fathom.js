const fetch = require('node-fetch');

const FATHOM_API_BASE = 'https://api.fathom.ai/external/v1';

/**
 * Trae las reuniones recientes desde Fathom.
 * NOTA: ajustá el endpoint/parámetros según la versión de la API de Fathom
 * que tenga habilitada la cuenta del estudio (ver docs de Fathom for Teams).
 */
async function getRecentMeetings() {
  const resp = await fetch(`${FATHOM_API_BASE}/meetings?limit=20`, {
    headers: {
      Authorization: `Bearer ${process.env.FATHOM_API_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  if (!resp.ok) {
    throw new Error(`Fathom API error: ${resp.status} ${await resp.text()}`);
  }

  const data = await resp.json();
  const meetings = data.items || data.meetings || [];

  return meetings.map((m) => ({
    fathomId: m.id,
    title: m.title || m.meeting_title || 'Reunión sin título',
    date: m.recorded_at || m.created_at,
    // Preferí la transcripción completa si está disponible; si no, el resumen automático de Fathom.
    transcriptOrSummary: m.summary || m.ai_summary || m.transcript || '',
    clientNameGuess: (m.title || '').split(/[-–—]/)[0]?.trim() || 'Sin identificar',
  }));
}

module.exports = { getRecentMeetings };
