const Airtable = require('airtable');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(
  process.env.AIRTABLE_BASE_ID
);

const T_EMAILS = process.env.AIRTABLE_TABLE_EMAILS || 'Emails';
const T_MEETINGS = process.env.AIRTABLE_TABLE_MEETINGS || 'Meetings';
const T_CLIENTS = process.env.AIRTABLE_TABLE_CLIENTS || 'GO Estudio Clientes Consolidados';
const T_TEAM = process.env.AIRTABLE_TABLE_TEAM || 'Team';
const T_RENDICIONES = process.env.AIRTABLE_TABLE_RENDICIONES || 'Rendiciones';

// ---- helpers genéricos ----
async function findByField(table, field, value) {
  const records = await base(table)
    .select({ filterByFormula: `{${field}} = "${value}"`, maxRecords: 1 })
    .firstPage();
  return records[0] || null;
}

async function upsert(table, matchField, matchValue, fields) {
  const existing = await findByField(table, matchField, matchValue);
  if (existing) {
    await base(table).update(existing.id, fields);
    return existing.id;
  }
  const created = await base(table).create({ [matchField]: matchValue, ...fields });
  return created.id;
}

// ---- Emails ----
async function upsertEmail(email) {
  // email: { threadId, from, subject, snippet, receivedAt, tag, aiSummary, waMsg }
  return upsert(T_EMAILS, 'ThreadId', email.threadId, {
    From: email.from,
    Subject: email.subject,
    Snippet: email.snippet,
    ReceivedAt: email.receivedAt,
    Tag: email.tag,
    AISummary: email.aiSummary,
    WaMsg: email.waMsg,
  });
}

async function listRecentEmails(limit = 20) {
  const records = await base(T_EMAILS)
    .select({ sort: [{ field: 'ReceivedAt', direction: 'desc' }], maxRecords: limit })
    .firstPage();
  return records.map((r) => ({ id: r.id, ...r.fields }));
}

// ---- Meetings ----
async function upsertMeeting(meeting) {
  // meeting: { fathomId, clientName, meetingDate, attended, outcome, summary }
  return upsert(T_MEETINGS, 'FathomId', meeting.fathomId, {
    ClientName: meeting.clientName,
    MeetingDate: meeting.meetingDate,
    Attended: meeting.attended,
    Outcome: meeting.outcome,
    Summary: meeting.summary,
  });
}

async function listRecentMeetings(limit = 20) {
  const records = await base(T_MEETINGS)
    .select({ sort: [{ field: 'MeetingDate', direction: 'desc' }], maxRecords: limit })
    .firstPage();
  return records.map((r) => ({ id: r.id, ...r.fields }));
}

// ---- Clients / Team (lectura simple, se cargan/editan a mano en Airtable) ----

// Normaliza el campo "Estado" (que puede venir como "Activo", "Dormido", "Inactivo",
// o ya en código) al código interno que usa el dashboard: act | dorm | inact
function normalizeStatus(raw) {
  const v = (raw || '').toString().trim().toLowerCase();
  if (['act', 'activo', 'activa'].includes(v)) return 'act';
  if (['dorm', 'dormido', 'dormida', 'inactivo temporal'].includes(v)) return 'dorm';
  if (['inact', 'inactivo', 'inactiva', 'baja'].includes(v)) return 'inact';
  return 'act'; // default razonable si viene algo inesperado
}

// Lee un valor probando varios nombres de campo posibles (por si la tabla
// tiene las columnas en español con mayúsculas/tildes distintas).
function pick(fields, ...names) {
  for (const n of names) {
    if (fields[n] !== undefined && fields[n] !== null && fields[n] !== '') return fields[n];
  }
  return '';
}

async function listClients() {
  const records = await base(T_CLIENTS).select({}).all();
  return records.map((r) => {
    const f = r.fields;
    return {
      id: r.id,
      Name: pick(f, 'Clientes por Colaborador', 'Nombre', 'Name', 'Cliente'),
      Category: pick(f, 'Colaborador', 'Categoría', 'Categoria', 'Category'),
      LastContact: pick(f, 'Último contacto', 'Ultimo contacto', 'LastContact'),
      Status: normalizeStatus(pick(f, 'Estado', 'Status')),
      CUIT: pick(f, 'CUIT', 'Cuit'),
      Email: pick(f, 'Email', 'Correo', 'Mail'),
      Phone: pick(f, 'Celular', 'Teléfono', 'Telefono', 'Phone'),
    };
  });
}

async function listTeam() {
  const records = await base(T_TEAM).select({}).all();
  return records.map((r) => ({ id: r.id, ...r.fields }));
}

// ---- Rendiciones (las crea el workflow de n8n que lee adjuntos de email) ----
async function listRendiciones(limit = 30) {
  const [records, clientRecords] = await Promise.all([
    base(T_RENDICIONES).select({ sort: [{ field: 'Fecha', direction: 'desc' }], maxRecords: limit }).firstPage(),
    base(T_CLIENTS).select({}).all(),
  ]);

  const clientMap = {};
  clientRecords.forEach((c) => {
    clientMap[c.id] = pick(c.fields, 'Clientes por Colaborador', 'Nombre', 'Name', 'Cliente');
  });

  return records.map((r) => {
    const f = r.fields;
    const clienteIds = f['Cliente'] || [];
    return {
      id: r.id,
      Name: f['Name'] || '',
      ClienteName: clienteIds.map((id) => clientMap[id]).filter(Boolean).join(', '),
      TipoDocumento: f['Tipo de documento'] || '',
      Monto: f['Monto declarado'] != null ? f['Monto declarado'] : null,
      Fecha: f['Fecha'] || '',
      HonorarioEsperado: f['Honorario esperado'] != null ? f['Honorario esperado'] : null,
      Diferencia: f['Diferencia'] != null ? f['Diferencia'] : 0,
      Estado: f['Estado'] || '',
      Resumen: f['Resumen IA'] || '',
    };
  });
}

module.exports = {
  upsertEmail,
  listRecentEmails,
  upsertMeeting,
  listRecentMeetings,
  listClients,
  listTeam,
  listRendiciones,
};
