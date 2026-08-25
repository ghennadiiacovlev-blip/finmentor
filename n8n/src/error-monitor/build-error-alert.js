// FINMENTOR — build the owner error alert.
//
// Deployed as the Code node "Build Error Alert" in the central Error Monitor, which every
// production workflow points at via settings.errorWorkflow.
//
// The alert carries operational identifiers only: which workflow, which node, what class of
// error, when, and the execution id to open in n8n. It deliberately does NOT carry the
// failing item's payload. An error alert is a notification channel, not a data export, and
// the payload at the point of failure routinely holds lead contact data.

const trigger = $('Error Monitor Trigger').first().json || {};
const cfg = (function () {
  try { return $('Settings to Object').first().json.settings || {}; } catch (e) { return {}; }
})();

const wf = trigger.workflow || {};
const ex = trigger.execution || {};
const err = ex.error || {};

// Order matters. URLs are removed first and whole: a URL can contain digit runs that the
// phone rule would otherwise match, splitting the link and leaving a readable remnant.
//
// The pattern also catches scheme-less forms. n8n splits a thrown message at the first
// ": ", so a URL routinely arrives already decapitated as "//host/path" with its scheme
// stranded in error.description. Matching only https?:// would let that remnant through.
const URL_RE = /(?:[a-z][a-z0-9+.-]*:)?\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S*/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Bounded to a standalone phone-shaped token. An unbounded digit run also matches build
// stamps and ids such as 20260825-204040, which are not personal data and whose removal
// makes an alert harder to act on.
const PHONE_RE = /(?<![\w-])\+?\d[\d\s().-]{5,13}\d(?![\w-])/g;

// Internal identifiers - workflow and node names - are configuration, not personal data.
// Scrubbing them produced alerts that could not be acted on, so they are only bounded.
function label(value, max) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max || 120);
}

// The error message is free text produced by whatever threw, so it is the one field that
// can carry payload data. It gets the full treatment.
function scrubMessage(value, max) {
  return String(value === undefined || value === null ? '' : value)
    .replace(URL_RE, '[link removed]')
    .replace(EMAIL_RE, '[contact removed]')
    .replace(PHONE_RE, '[contact removed]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max || 300);
}

// Classify so repeated failures are recognisable at a glance without reading the message.
function classify(message, name) {
  const m = String(message || '').toLowerCase();
  if (/sheet with id .* not found|unable to parse range|not found/.test(m)) return 'SHEET_LOCATOR';
  if (/quota|rate limit|429/.test(m)) return 'RATE_LIMIT';
  if (/service unavailable|503|502|504|econnreset|etimedout|timeout/.test(m)) return 'UPSTREAM_TRANSIENT';
  if (/auth|credential|401|403|unauthor|forbidden/.test(m)) return 'AUTH';
  if (/json|parse|unexpected token/.test(m)) return 'DATA_SHAPE';
  return String(name || 'ERROR').toUpperCase().slice(0, 32);
}

// n8n splits a thrown error at the first ": " — the head lands in error.description and the
// tail in error.message. Reading only one of them yields a truncated, often meaningless
// alert, and description is precisely the half that tends to carry the payload text. Both
// are recombined and scrubbed as one string. error.stack is deliberately never used.
const rawMessage = [err.description, err.message].filter(Boolean).join(': ');

const errorClass = classify(rawMessage, err.name);
const workflowName = label(wf.name, 120);
const nodeName = label(ex.lastNodeExecuted || (err.node && err.node.name), 120);
const message = scrubMessage(rawMessage, 400);
const when = new Date().toISOString();

// Correlation id: the n8n execution id is the one identifier that ties this alert back to
// the full record without reproducing any of its content.
const correlationId = String(ex.id || '');

const lines = [
  '\u26a0\ufe0f FINMENTOR — сбой в production workflow',
  '',
  'Workflow: ' + (workflowName || 'unknown'),
  'ID: ' + label(wf.id, 40),
  'Узел: ' + (nodeName || 'unknown'),
  'Класс: ' + errorClass,
  'Время: ' + when,
  'Execution: ' + (correlationId || 'n/a'),
  '',
  'Сообщение: ' + (message || 'no message'),
  '',
  'Payload не включён в оповещение.'
];

return [{
  json: {
    owner_chat_id: String(cfg.owner_chat_id || ''),
    alert_text: lines.join('\n'),
    workflow_id: String(wf.id || ''),
    workflow_name: workflowName,
    node_name: nodeName,
    error_class: errorClass,
    error_message: message,
    correlation_id: correlationId,
    ts: when
  }
}];
