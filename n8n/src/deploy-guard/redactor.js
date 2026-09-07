// FINMENTOR — the canonical redactor.
//
// WHY THIS FILE EXISTS, AND WHAT IT REPLACES.
//
// `ConvertTo-Redacted` in scripts/n8n-lib.ps1 redacted by FIELD NAME:
//
//     (?<="(?:chat_?[Ii]d|chatId|...)"\s*:\s*")[^"]*   ->  <REDACTED_CHAT_ID>
//
// That rule replaces the string value of any chat-id-named field, whatever the value is. It
// could not tell a concrete Telegram identity from an n8n EXPRESSION, so
// `={{ $json.chat_id }}` — a template that contains no identity at all — became
// `<REDACTED_CHAT_ID>` in every tracked export.
//
// P7.5 then generated a production cutover from such an export and deployed it. The bot kept
// running, kept minting keys, and could not have replied to anyone, because every reply was
// addressed to a literal string. It was rolled back with exact restoration proven.
//
// THE CORRECTED SEMANTICS. Redaction is decided by the VALUE, never by the field name alone:
//
//   * A concrete sensitive literal is redacted — a bot token, an API key, a bare Telegram id.
//   * An n8n EXPRESSION is preserved byte-for-byte. An expression is any string beginning with
//     `=` or containing `{{`. Those are code, not data, and they carry no identity.
//   * A field NAME never triggers redaction on its own. `chat_id: "={{ $json.chat_id }}"` keeps
//     its value; `chat_id: "123456789"` does not.
//
// Embedded literals are still caught: an expression is scanned for token-shaped substrings, so
// `={{ "12345678:AAH..." }}` would still lose the token while keeping the expression around it.
//
// SCOPE. This module works on the PARSED workflow object rather than on raw JSON text. The old
// implementation was a stack of regexes over a serialized document, which is why a lookbehind on
// a key name was the only tool it had. Walking the object means the rule can say "this value is
// an expression" instead of guessing from surrounding punctuation.
//
// NOTHING HERE PRINTS A SECRET. The module returns redacted documents and booleans. Callers must
// not log the input.

'use strict';

const MARKER_CHAT = '<REDACTED_CHAT_ID>';
const MARKER_TOKEN = '<REDACTED_BOT_TOKEN>';
const MARKER_KEY = '<REDACTED_API_KEY>';
const ALL_MARKERS = [MARKER_CHAT, MARKER_TOKEN, MARKER_KEY];

// Field names whose CONCRETE values are Telegram identities.
const CHAT_FIELD_RE = /^(chat_?id|chatId|owner_chat_id|manager_chat_id|allowed_chat_ids)$/i;

// Canonical spreadsheet tab ids. They are configuration, not identity, and they are the same
// shape as Telegram chat ids — which is why a digit-run rule cannot be applied blindly.
const CANONICAL_GIDS = [
  '1871239368', '409890193', '936189533', '1883973304', '962064347', '623316892',
  '1810362432', '1651979710', '532676168', '1289462207', '1584265787', '1612014214',
  '1997367085'
];

// Concrete secret shapes. Each matches a literal value, never a template.
const TOKEN_PATTERNS = [
  { re: /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g, marker: MARKER_TOKEN },
  { re: /\bsk-[A-Za-z0-9_-]{20,}\b/g, marker: MARKER_KEY },
  { re: /\bAIza[A-Za-z0-9_-]{30,}\b/g, marker: MARKER_KEY }
];

// THE distinction the old redactor could not make.
//
// An n8n expression begins with `=` (the editor's marker for "this is code") or contains a
// `{{ }}` template. Either way it is a program that computes a value at runtime; it is not the
// value. Preserving it is not a relaxation of redaction — there was never anything to redact.
function isExpression(v) {
  if (typeof v !== 'string') { return false; }
  return v.charAt(0) === '=' || v.indexOf('{{') !== -1;
}

function isConcreteChatId(v) {
  return typeof v === 'string' && /^\d{6,12}$/.test(v.trim());
}

// Applies the token patterns to any string. Safe on expressions: it only removes literal
// secrets embedded inside them and leaves the surrounding template intact.
function redactLiteralSecrets(s) {
  let out = String(s);
  TOKEN_PATTERNS.forEach((p) => { out = out.replace(p.re, p.marker); });
  return out;
}

// Quoted 6-12 digit runs inside a Code body are hardcoded Telegram ids — the classic owner
// fallback. Canonical gids are exempt. Applied ONLY to jsCode, because that is the only place
// this shape means an identity rather than a number.
function redactCodeBody(code) {
  let out = redactLiteralSecrets(code);
  out = out.replace(/(['"])(\d{6,12})\1/g, (m, q, digits) => (
    CANONICAL_GIDS.indexOf(digits) !== -1 ? m : q + MARKER_CHAT + q
  ));
  return out;
}

// Redacts one value found under a chat-id-named key.
function redactChatValue(v) {
  if (isExpression(v)) { return redactLiteralSecrets(v); }   // code, not identity
  if (typeof v === 'number') {
    return (String(Math.trunc(Math.abs(v))).length >= 6) ? MARKER_CHAT : v;
  }
  if (typeof v !== 'string') { return v; }
  if (v.trim() === '') { return v; }
  if (isConcreteChatId(v)) { return MARKER_CHAT; }
  // A delimited list of ids, e.g. allowed_chat_ids: "123456789, 987654321".
  if (/^[\s,;]*\d{6,12}(\s*[,;]\s*\d{6,12})*[\s,;]*$/.test(v)) {
    return v.replace(/\d{6,12}/g, (d) => (CANONICAL_GIDS.indexOf(d) !== -1 ? d : MARKER_CHAT));
  }
  return redactLiteralSecrets(v);
}

// Deep walk. `key` is the property name the value sits under, so a rule can be field-aware
// without being field-ONLY.
function walk(value, key) {
  if (Array.isArray(value)) { return value.map((v) => walk(v, key)); }
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach((k) => { out[k] = walk(value[k], k); });
    return out;
  }
  if (typeof value === 'string') {
    if (key === 'jsCode') { return redactCodeBody(value); }
    if (CHAT_FIELD_RE.test(String(key))) { return redactChatValue(value); }
    return redactLiteralSecrets(value);
  }
  if (typeof value === 'number' && CHAT_FIELD_RE.test(String(key))) {
    return redactChatValue(value);
  }
  return value;
}

// The canonical redaction. Input is a parsed workflow (or any object); output is a new object.
function redactWorkflow(wf) {
  return walk(JSON.parse(JSON.stringify(wf)), '');
}

// Every redaction marker present in a document, with counts. Used by the deployment guards,
// which treat ANY marker as disqualifying.
function findMarkers(doc) {
  const blob = typeof doc === 'string' ? doc : JSON.stringify(doc);
  const out = [];
  ALL_MARKERS.forEach((m) => {
    const n = blob.split(m).length - 1;
    if (n > 0) { out.push({ marker: m, count: n }); }
  });
  // Catch a marker shape this module does not know about yet, rather than silently passing it.
  const generic = blob.match(/<REDACTED_[A-Z_]+>/g) || [];
  generic.forEach((g) => {
    if (ALL_MARKERS.indexOf(g) === -1 && !out.some((o) => o.marker === g)) {
      out.push({ marker: g, count: blob.split(g).length - 1 });
    }
  });
  return out;
}

function hasMarkers(doc) { return findMarkers(doc).length > 0; }

// Node names carrying a marker, so a report can name the damage instead of counting it.
function markedNodes(wf) {
  const out = [];
  (wf.nodes || []).forEach((n) => {
    if (hasMarkers(n) && out.indexOf(n.name) === -1) { out.push(n.name); }
  });
  return out;
}

module.exports = {
  MARKER_CHAT,
  MARKER_TOKEN,
  MARKER_KEY,
  ALL_MARKERS,
  CHAT_FIELD_RE,
  CANONICAL_GIDS,
  isExpression,
  isConcreteChatId,
  redactLiteralSecrets,
  redactCodeBody,
  redactChatValue,
  redactWorkflow,
  findMarkers,
  hasMarkers,
  markedNodes
};
