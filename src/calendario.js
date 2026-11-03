const ical = require('node-ical');
const fetch = require('node-fetch');

const ICS_URL = 'https://calendar.google.com/calendar/ical/luisgomezyasociados%40gmail.com/public/basic.ics';
const ZONA = 'America/Argentina/Buenos_Aires';
const CACHE_MS = 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;
// El feed trae esta serie diaria aunque Google Calendar no la muestra.
const TITULOS_OCULTOS = new Set(['almuerzo']);

let cache = { eventos: null, hasta: 0 };

async function traerEventos() {
  if (cache.eventos && Date.now() < cache.hasta) return cache.eventos;
  const res = await fetch(ICS_URL);
  if (!res.ok) throw new Error(`Google Calendar respondió ${res.status}`);
  const eventos = Object.values(ical.sync.parseICS(await res.text())).filter(
    (e) => e.type === 'VEVENT' && e.status !== 'CANCELLED' && !TITULOS_OCULTOS.has(String(e.summary || '').trim().toLowerCase())
  );
  cache = { eventos, hasta: Date.now() + CACHE_MS };
  return eventos;
}

const fechaEnZona = (d) => d.toLocaleDateString('en-CA', { timeZone: ZONA });
const horaEnZona = (d) =>
  d.toLocaleTimeString('es-AR', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false });

// Argentina no tiene horario de verano, así que el offset -03:00 es fijo.
async function proximosDias(cantidad = 3, ahora = new Date()) {
  const desde = new Date(`${fechaEnZona(ahora)}T00:00:00-03:00`);
  const hasta = new Date(desde.getTime() + cantidad * DIA_MS - 1);

  const dias = Array.from({ length: cantidad }, (_, i) => ({
    fecha: fechaEnZona(new Date(desde.getTime() + i * DIA_MS)),
    eventos: [],
  }));
  const porFecha = new Map(dias.map((d) => [d.fecha, d]));

  for (const evento of await traerEventos()) {
    const instancias = ical.expandRecurringEvent(evento, { from: desde, to: hasta, expandOngoing: true });
    for (const inst of instancias) {
      if (inst.isFullDay) {
        const dia = porFecha.get(inst.start.toISOString().slice(0, 10));
        if (dia) dia.eventos.push({ titulo: String(inst.summary || 'Sin título'), todoElDia: true, orden: '' });
        continue;
      }
      const inicio = inst.start < desde ? desde : inst.start;
      const dia = porFecha.get(fechaEnZona(inicio));
      if (!dia) continue;
      dia.eventos.push({
        titulo: String(inst.summary || 'Sin título'),
        inicio: horaEnZona(inst.start),
        fin: inst.end ? horaEnZona(inst.end) : '',
        todoElDia: false,
        orden: horaEnZona(inicio),
      });
    }
  }

  dias.forEach((d) => {
    d.eventos.sort((a, b) => a.orden.localeCompare(b.orden));
    d.eventos.forEach((e) => delete e.orden);
  });
  return dias;
}

module.exports = { proximosDias };
