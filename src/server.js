require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');

const airtable = require('./airtable');
const { uploadAttachment } = require('./extractos');

const app = express();
app.use(cors());
app.use(express.json());

// Los extractos se reciben en memoria (no se guardan en disco del server)
// y de ahí se suben directo a Airtable. Límite 20MB por archivo.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── Seguridad simple para la API que lee el dashboard ──────────
function checkApiKey(req, res, next) {
  const key = req.header('x-api-key');
  if (!process.env.DASHBOARD_API_KEY || key !== process.env.DASHBOARD_API_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// ── Endpoints ─────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true }));

// Lo que consume el dashboard.html. El triage de emails y las reuniones de
// Fathom los procesan los workflows de n8n, que escriben directo a Airtable;
// acá solo se lee lo que ya está en las tablas.
app.get('/api/dashboard', checkApiKey, async (req, res) => {
  try {
    const [emails, meetings, clients, rendiciones, extractos] = await Promise.all([
      airtable.listRecentEmails(20),
      airtable.listRecentMeetings(20),
      airtable.listClients(),
      airtable.listRendiciones(30),
      airtable.listExtractos(20),
    ]);
    res.json({ emails, meetings, clients, rendiciones, extractos, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('error en /api/dashboard:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

// Búsqueda de contactos (son ~10.500, no se traen todos de una — el
// dashboard solo pide acá cuando el usuario escribe algo en el buscador).
app.get('/api/contactos', checkApiKey, async (req, res) => {
  try {
    const resultados = await airtable.buscarContactos(req.query.q, 50);
    res.json({ contactos: resultados });
  } catch (err) {
    console.error('error en /api/contactos:', err.message);
    res.status(500).json({ error: 'internal_error', detail: err.message });
  }
});

// Página de contactos (10.500 en total) para la pestaña "Inactivos" del
// dashboard. Se pide de a páginas — el frontend guarda el 'nextOffset' que
// devuelve esto y lo manda de vuelta para pedir la página siguiente.
app.get('/api/contactos-pagina', checkApiKey, async (req, res) => {
  try {
    const { offset, pageSize } = req.query;
    const resultado = await airtable.listContactosPaginado({
      offset: offset || undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : 100,
    });
    res.json(resultado);
  } catch (err) {
    console.error('error en /api/contactos-pagina:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

// Luis sube un extracto bancario/de billetera desde el dashboard.
// multipart/form-data: campo "file" (el archivo), "titular" y "notas" opcionales.
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
});
