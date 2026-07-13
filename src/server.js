require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const gmail = require('./gmail');
const fathom = require('./fathom');
const { classifyEmail, classifyMeeting } = require('./classify');
const airtable = require('./airtable');

const app = express();
app.use(cors());
app.use(express.json());

// ── Seguridad simple para la API que lee el dashboard ──────────
function checkApiKey(req, res, next) {
  const key = req.header('x-api-key');
  if (!process.env.DASHBOARD_API_KEY || key !== process.env.DASHBOARD_API_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// ── Job: revisar emails nuevos y clasificarlos ──────────────────
async function pollEmails() {
  console.log('[cron] revisando emails nuevos...');
  try {
    const emails = await gmail.getRecentEmails();
    for (const e of emails) {
      const classification = await classifyEmail({ from: e.from, subject: e.subject, body: e.body });
      await airtable.upsertEmail({
        threadId: e.threadId,
        from: e.from,
        subject: e.subject,
        snippet: e.snippet,
        receivedAt: e.receivedAt,
        tag: classification.tag,
        aiSummary: classification.aiSummary,
        waMsg: classification.waMsg,
      });
    }
    console.log(`[cron] ${emails.length} emails procesados.`);
  } catch (err) {
    console.error('[cron] error en pollEmails:', err.message);
  }
}

// ── Job: revisar reuniones nuevas de Fathom y clasificarlas ─────
async function pollMeetings() {
  console.log('[cron] revisando reuniones nuevas...');
  try {
    const meetings = await fathom.getRecentMeetings();
    for (const m of meetings) {
      const classification = await classifyMeeting({
        title: m.title,
        transcriptOrSummary: m.transcriptOrSummary,
      });
      await airtable.upsertMeeting({
        fathomId: m.fathomId,
        clientName: m.clientNameGuess,
        meetingDate: m.date,
        attended: classification.attended,
        outcome: classification.outcome,
        summary: classification.summary,
      });
    }
    console.log(`[cron] ${meetings.length} reuniones procesadas.`);
  } catch (err) {
    console.error('[cron] error en pollMeetings:', err.message);
  }
}

async function pollAll() {
  await pollEmails();
  await pollMeetings();
}

// ── Cron DESACTIVADO ─────────────────────────────────────────────
// El triage de emails y el registro de reuniones de Fathom ahora los
// hacen los workflows de n8n (escriben directo a las mismas tablas de
// Airtable: "Emails" y "Meeting"). Este cron quedó duplicando esa lógica
// con un esquema de campos distinto (ThreadId/Tag/AISummary vs. el real
// Gmail Message ID/Urgencia/Notes), y apuntaba a "Meetings" en plural
// (la tabla real es "Meeting"). Nunca llegó a escribir nada porque el
// token de Google y la key de Fathom vencieron, pero si alguien los
// renueva sin saber esto, empezaría a crear registros duplicados.
// Si en algún momento se decide volver a esta arquitectura en vez de
// n8n, descomentar la línea de abajo y actualizar src/airtable.js para
// que use los nombres de campo reales.
// cron.schedule(process.env.POLL_CRON || '*/15 * * * *', pollAll);

// ── Endpoints ─────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true }));

// Dispara un ciclo manual (útil para probar sin esperar el cron)
app.post('/api/run-now', checkApiKey, async (req, res) => {
  await pollAll();
  res.json({ ok: true });
});

// Lo que consume el dashboard.html
app.get('/api/dashboard', checkApiKey, async (req, res) => {
  try {
    const [emails, meetings, clients, team] = await Promise.all([
      airtable.listRecentEmails(20),
      airtable.listRecentMeetings(20),
      airtable.listClients(),
      airtable.listTeam(),
    ]);
    res.json({ emails, meetings, clients, team, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('error en /api/dashboard:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor del estudio corriendo en puerto ${PORT}`);
  console.log(`Cron de polling: ${process.env.POLL_CRON || '*/15 * * * *'}`);
});

