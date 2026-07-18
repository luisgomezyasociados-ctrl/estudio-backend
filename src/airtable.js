const Airtable = require('airtable');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(
  process.env.AIRTABLE_BASE_ID
);

const T_EMAILS = process.env.AIRTABLE_TABLE_EMAILS || 'Emails';
const T_MEETINGS = process.env.AIRTABLE_TABLE_MEETINGS || 'Meetings';
const T_CLIENTS = process.env.AIRTABLE_TABLE_CLIENTS || 'GO Estudio Clientes Consolidados';
const T_TEAM = process.env.AIRTABLE_TABLE_TEAM || 'Team';
const T_RENDICIONES = process.env.AIRTABLE_TABLE_RENDICIONES || 'Rendiciones';
const T_EXTRACTOS = process.env.AIRTABLE_TABLE_EXTRACTOS || 'Extractos';

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

function normalizeStatus(raw) {
  const v = (raw || '').toString().trim().toLowerCase();
  if (['act', 'activo', 'activa'].includes(v)) return 'act';
  if (['dorm', 'dormido', 'dormida', 'inactivo temporal'].includes(v)) return 'dorm';
  if (['inact', 'inactivo', 'inactiva', 'baja'].includes(v)) return 'inact';
  return 'act';
}

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

// La tabla "Team" está vacía y no se carga a mano, así que la lista de
// colaboradores sale directo del campo "Colaborador" de Clientes (esa sí
// tiene datos reales) en vez de depender de que alguien la mantenga. El
// workflow de n8n que clasifica emails resuelve ese mismo "Colaborador" a
// partir del cliente asociado y lo graba en cada registro de Emails, así
// que acá cruzamos ambas fuentes para contar pendientes vs. resueltos por
// persona — "resuelto" es cualquier email cuyo Status ya no sea "Pendiente"
// (se cambia a mano en Airtable al atenderlo). Si en algún momento cargan
// la tabla Team, el Role de ahí se suma automáticamente.
async function listTeam() {
  const [teamRecords, emailRecords, clientRecords] = await Promise.all([
    base(T_TEAM).select({}).all(),
    base(T_EMAILS).select({}).all(),
    base(T_CLIENTS).select({}).all(),
  ]);

  const roleByName = {};
  teamRecords.forEach((r) => {
    const f = r.fields;
    const name = pick(f, 'Name', 'Nombre');
    if (name) roleByName[name] = pick(f, 'Role', 'Rol');
  });

  const counts = {};
  emailRecords.forEach((r) => {
    const colaborador = (r.fields['Colaborador'] || '').toString().trim();
    if (!colaborador) return;
    if (!counts[colaborador]) counts[colaborador] = { done: 0, pending: 0 };
    if ((r.fields['Status'] || '').toString().trim() === 'Pendiente') {
      counts[colaborador].pending += 1;
    } else {
      counts[colaborador].done += 1;
    }
  });

  const nombres = new Set();
  clientRecords.forEach((r) => {
    const nombre = pick(r.fields, 'Colaborador', 'Categoría', 'Categoria', 'Category');
    if (nombre) nombres.add(nombre);
  });

  return Array.from(nombres).map((name) => {
    const c = counts[name] || { done: 0, pending: 0 };
    return {
      id: name,
      Name: name,
      Role: roleByName[name] || '',
      Done: c.done,
      Pending: c.pending,
    };
  });
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

// ---- Extractos (los sube Luis desde el dashboard) ----

async function createExtractoRecord({ titular, notas }) {
  const fields = {
    'Fecha de carga': new Date().toISOString(),
    Procesado: false,
  };
  if (titular) fields['Titular de la cuenta'] = titular;
  if (notas) fields['Notas'] = notas;
  const created = await base(T_EXTRACTOS).create(fields);
  return created.id;
}

async function listExtractos(limit = 20) {
  const records = await base(T_EXTRACTOS)
    .select({ sort: [{ field: 'Fecha de carga', direction: 'desc' }], maxRecords: limit })
    .firstPage();
  return records.map((r) => {
    const f = r.fields;
    const archivo = (f['Archivo'] || [])[0];
    return {
      id: r.id,
      Titular: f['Titular de la cuenta'] || '',
      FechaCarga: f['Fecha de carga'] || '',
      Procesado: !!f['Procesado'],
      Notas: f['Notas'] || '',
      Resultado: f['Resultado'] || '',
      ArchivoNombre: archivo ? archivo.filename : '',
      ArchivoUrl: archivo ? archivo.url : '',
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
  createExtractoRecord,
  listExtractos,
};
