require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const multer = require('multer');

const gmail = require('./gmail');
const fathom = require('./fathom');
const { classifyEmail, classifyMeeting } = require('./classify');
const airtable = require('./airtable');
const { uploadAttachment } = require('./extractos');

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function checkApiKey(req, res, next) {
  const key = req.header('x-api-key');
  if (!process.env.DASHBOARD_API_KEY || key !== process.env.DASHBOARD_API_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

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

// cron.schedule(process.env.POLL_CRON || '*/15 * * * *', pollAll);

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/api/run-now', checkApiKey, async (req, res) => {
  await pollAll();
  res.json({ ok: true });
});

app.get('/api/dashboard', checkApiKey, async (req, res) => {
  try {
    const [emails, meetings, clients, team, rendiciones, extractos] = await Promise.all([
      airtable.listRecentEmails(20),
      airtable.listRecentMeetings(20),
      airtable.listClients(),
      airtable.listTeam(),
      airtable.listRendiciones(30),
      airtable.listExtractos(20),
    ]);
    res.json({ emails, meetings, clients, team, rendiciones, extractos, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('error en /api/dashboard:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/upload-extracto', checkApiKey, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no_file' });

    const { titular, notas } = req.body;
    const recordId = await airtable.createExtractoRecord({ titular, notas });

    await uploadAttachment({
      baseId: process.env.AIRTABLE_BASE_ID,
      apiKey: process.env.AIRTABLE_API_KEY,
      recordId,
      fieldName: 'Archivo',
      fileBuffer: req.file.buffer,
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    res.json({ ok: true, recordId });
  } catch (err) {
    console.error('error en /api/upload-extracto:', err.message);
    res.status(500).json({ error: 'upload_failed', message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor del estudio corriendo en puerto ${PORT}`);
  console.log(`Cron de polling: ${process.env.POLL_CRON || '*/15 * * * *'}`);
});
