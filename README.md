# Panel GO! Estudio — Backend automático

Este backend corre solo (sin que nadie tenga que abrir el dashboard) y hace tres cosas cada 15 minutos:

1. Revisa emails nuevos en Gmail y los clasifica por urgencia con IA (Urgente / AFIP / Revisar / Normal).
2. Revisa reuniones nuevas grabadas en Fathom y determina si el cliente asistió y si cerró, quedó pensando, o no cerró.
3. Guarda todo en Airtable, que funciona como base de datos central.

El `dashboard.html` (versión conectada, en `/dashboard`) lee de una API que expone este backend — no de Airtable directamente — para no exponer claves en el navegador.

---

## 1. Armar la base en Airtable

Creá una base nueva en Airtable con estas 4 tablas (los nombres de columnas deben coincidir exacto, mayúsculas incluidas):

**Tabla `Emails`**
| Campo | Tipo |
|---|---|
| ThreadId | Single line text (clave única) |
| From | Single line text |
| Subject | Single line text |
| Snippet | Long text |
| ReceivedAt | Date (con hora) |
| Tag | Single select: `urgent`, `afip`, `review`, `normal` |
| AISummary | Long text |
| WaMsg | Long text |

**Tabla `Meetings`**
| Campo | Tipo |
|---|---|
| FathomId | Single line text (clave única) |
| ClientName | Single line text |
| MeetingDate | Date (con hora) |
| Attended | Checkbox |
| Outcome | Single select: `cerrado`, `pensando`, `no_cerrado`, `n/a` |
| Summary | Long text |

**Tabla `Clients`** — ⚠️ NO crear esta: ya existe en tu base como **"GO Estudio Clientes Consolidados"** (la trajiste de Drive). El backend la lee directo de ahí — soporta que las columnas estén en español (`Nombre`, `Categoría`, `Estado`, `Último contacto`, `CUIT`) y normaliza el campo `Estado` aunque diga "Activo"/"Dormido"/"Inactivo" en vez de códigos cortos. Si el nombre de la tabla en tu base es distinto a "GO Estudio Clientes Consolidados", ajustalo en la variable `AIRTABLE_TABLE_CLIENTS` del `.env`.

**Tabla `Team`**
| Campo | Tipo |
|---|---|
| Name | Single line text |
| Role | Single line text |
| Done | Number |
| Pending | Number |

Después conseguí:
- `AIRTABLE_BASE_ID`: en la URL de la base (empieza con `app...`) o en la [documentación de la API](https://airtable.com/api).
- `AIRTABLE_API_KEY`: creá un **Personal Access Token** en https://airtable.com/create/tokens con scopes `data.records:read` y `data.records:write` sobre esta base.

---

## 2. Habilitar Gmail (OAuth2)

1. Andá a [Google Cloud Console](https://console.cloud.google.com/) → creá un proyecto.
2. Habilitá la **Gmail API**.
3. Configurá la pantalla de consentimiento OAuth (modo "Externo", agregá el mail del estudio como usuario de prueba si no vas a verificar la app).
4. Creá credenciales OAuth 2.0 tipo "App de escritorio" → te da `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`.
5. Generá un `GOOGLE_REFRESH_TOKEN` una única vez corriendo el flujo OAuth localmente (usando [Google's OAuth Playground](https://developers.google.com/oauthplayground/) con tu Client ID/Secret y el scope `https://www.googleapis.com/auth/gmail.readonly` es la forma más rápida).

---

## 3. Habilitar Fathom

1. En Fathom, entrá a la configuración de tu cuenta/equipo y generá un **API key** (Fathom for Teams/Business tiene API — si el plan actual no la incluye, hay que subir de plan).
2. Revisá el endpoint exacto en la [documentación oficial de Fathom API](https://developers.fathom.ai) — `src/fathom.js` tiene un endpoint de referencia (`/external/v1/meetings`) que puede necesitar ajuste según la versión vigente.

---

## 4. Desplegar en Railway

1. Subí esta carpeta a un repo de GitHub (privado, recomendado) — Railway también permite deploy directo desde CLI sin GitHub, pero con repo es más prolijo para futuros cambios.
2. En [Railway](https://railway.app) → **New Project** → **Deploy from GitHub repo** → elegí el repo.
3. Railway detecta que es Node.js automáticamente (por el `package.json`):
   - **Build command:** `npm install` (autodetectado, no hace falta tocarlo)
   - **Start command:** `npm start` (ya está definido en `package.json` → `node src/server.js`)
4. Andá a la pestaña **Variables** del servicio y cargá todas las variables de `.env.example` con los valores reales (`ANTHROPIC_API_KEY`, `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `FATHOM_API_KEY`, `DASHBOARD_API_KEY`, `POLL_CRON`). Railway también tiene un botón "Raw Editor" donde podés pegar el `.env` completo de una.
5. En **Settings → Networking**, generá un dominio público (**Generate Domain**). Te da una URL tipo `https://estudio-backend-production.up.railway.app`.
6. Importante: a diferencia de Render Free, Railway **no duerme el servicio** en el plan de uso pago estándar (se cobra por consumo) — así que el cron corre siempre sin que nadie tenga que "despertarlo". Revisá que el servicio quede como **Web Service** (no "Cron Job" de Railway) porque necesitamos que el proceso quede corriendo permanentemente para que `node-cron` funcione — el cron está *adentro* del proceso Node, no es un cron job separado de Railway.
7. Probá: `GET https://tu-dominio.up.railway.app/health` → debería responder `{"ok":true}`.
8. Para forzar un ciclo de prueba sin esperar el cron:
   ```
   curl -X POST https://tu-dominio.up.railway.app/api/run-now \
     -H "x-api-key: TU_DASHBOARD_API_KEY"
   ```
9. Los logs en vivo (útil para ver si el cron corrió, o errores de Gmail/Fathom/Airtable) están en la pestaña **Deployments → Logs** de Railway.

---

## 5. Conectar el dashboard

En `dashboard/dashboard.html`, al principio del `<script>`, configurá:

```js
const API_BASE = 'https://tu-dominio.up.railway.app';
const API_KEY  = 'TU_DASHBOARD_API_KEY'; // el mismo valor que pusiste en Railway
```

Listo — el dashboard va a pedir `GET /api/dashboard` cada vez que se abre (y podés agregar un refresh automático cada X minutos si querés).

---

## Notas de seguridad

- `DASHBOARD_API_KEY` es una protección mínima. Si van a compartir el link del dashboard fuera del equipo, conviene sumar autenticación real (login) antes de producción.
- Los emails clasificados como "urgent" o "afip" son buenos candidatos para además mandar una notificación push/WhatsApp automática — se puede sumar como paso siguiente usando la API de WhatsApp Business o un webhook a Slack.
