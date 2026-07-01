const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function safeParseJSON(text) {
  const cleaned = text.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}

/**
 * Clasifica un email de un estudio contable.
 * Devuelve { tag, aiSummary, waMsg }
 * tag ∈ 'urgent' | 'afip' | 'review' | 'normal'
 */
async function classifyEmail({ from, subject, body }) {
  const prompt = `Sos el asistente de triage de emails de un estudio contable en Argentina.
Clasificá el siguiente email y respondé SOLO con un JSON, sin texto adicional, sin backticks.

De: ${from}
Asunto: ${subject}
Cuerpo:
${body?.slice(0, 3000) || '(sin cuerpo)'}

Formato exacto de respuesta:
{
  "tag": "urgent" | "afip" | "review" | "normal",
  "aiSummary": "resumen de 1-2 frases en español, tono directo, para que el contador entienda rápido de qué se trata y qué se necesita",
  "waMsg": "mensaje corto en español, listo para mandar por WhatsApp al cliente, sin saludo (ej: 'sobre el vencimiento de IVA, ¿coordinamos?')"
}

Criterios:
- "urgent": vencimientos próximos, pedidos de confirmación urgente, prospectos calientes listos para cerrar.
- "afip": cualquier comunicación de AFIP/ARCA (intimaciones, requerimientos).
- "review": documentación para cargar/conciliar, sin apuro.
- "normal": todo lo demás.`;

  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = resp.content.find((c) => c.type === 'text')?.text || '{}';
  try {
    return safeParseJSON(text);
  } catch (e) {
    return { tag: 'normal', aiSummary: 'No se pudo clasificar automáticamente.', waMsg: '' };
  }
}

/**
 * Clasifica el resumen/transcripción de una reunión de Fathom.
 * Devuelve { attended, outcome, summary }
 * outcome ∈ 'cerrado' | 'pensando' | 'no_cerrado' | 'n/a' (para reuniones que no son de venta)
 */
async function classifyMeeting({ title, transcriptOrSummary }) {
  const prompt = `Sos el asistente de un estudio contable que revisa reuniones grabadas con Fathom.
Analizá la siguiente reunión y respondé SOLO con un JSON, sin texto adicional, sin backticks.

Título: ${title}
Contenido:
${transcriptOrSummary?.slice(0, 6000) || '(sin contenido)'}

Formato exacto de respuesta:
{
  "attended": true | false,
  "outcome": "cerrado" | "pensando" | "no_cerrado" | "n/a",
  "summary": "resumen de 2-3 frases en español para que el contador Luis sepa qué pasó, si el cliente/prospecto asistió y en qué quedó"
}

Criterios:
- "attended": false si el prospecto/cliente no se presentó a la reunión.
- "outcome": "cerrado" si quedó como cliente confirmado, "pensando" si dijo que lo va a evaluar, "no_cerrado" si dijo que no, "n/a" si la reunión es interna o no es de venta/cierre.`;

  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = resp.content.find((c) => c.type === 'text')?.text || '{}';
  try {
    return safeParseJSON(text);
  } catch (e) {
    return { attended: true, outcome: 'n/a', summary: 'No se pudo analizar automáticamente.' };
  }
}

module.exports = { classifyEmail, classifyMeeting };
