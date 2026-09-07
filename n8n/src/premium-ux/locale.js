'use strict';

// FINMENTOR Premium UX — the locale authority and the presentation resolver.
//
// SPRINT 1, OPTION A. Two languages, one state machine, one set of business logic. The Russian
// strings in branches.js stay the canonical machine values in BOTH languages; this module only
// decides which text is shown in their place.
//
// WHY THERE IS NO RUNTIME FALLBACK. `resolve()` is called by the content generator at BUILD time,
// and `assertComplete()` refuses to let the build finish while any customer-visible string lacks a
// Romanian label. A missing translation is therefore a failed build, never a Russian sentence in
// front of a Romanian customer. Nothing here can throw in production because nothing here runs in
// production — the browser bundle receives an already-resolved table.

const { RO_LABELS, SHELL_RO } = require('./ro-labels.js');

// The two dictionaries are kept apart in the source — one tracks the branches.js contract, the
// other the app.js chrome — but a renderer only ever needs one lookup.
const ALL_RO = Object.assign(Object.create(null), RO_LABELS, SHELL_RO);

const LOCALES = ['ru', 'ro'];
const DEFAULT_LOCALE = 'ru';

// ── locale authority ─────────────────────────────────────────────────────────────────────────
//
// First match wins, and the answer is persisted with the session/lead rather than re-derived, so a
// returning customer keeps the language they started in.
//
//   1. the customer journey origin  — a lead entering from /ro/ carries locale=ro in the payload;
//   2. the persisted session locale — already resolved once, never recomputed;
//   3. Telegram `language_code`     — a HINT, used only for a cold Telegram first contact;
//   4. 'ru'                         — the default.
//
// No model call participates. Telegram's UI language never overrides an authoritative locale that
// the customer's own journey already established: a Romanian who reads Telegram in Russian stays
// Romanian.
function normalize(tag) {
  const s = String(tag == null ? '' : tag).trim().toLowerCase();
  if (/^ro(-|$)/.test(s)) { return 'ro'; }
  if (/^ru(-|$)/.test(s)) { return 'ru'; }
  return '';
}

function resolveLocale(sources) {
  const s = sources || {};
  return normalize(s.journeyLocale)      // 1 — authoritative: the page the customer entered from
    || normalize(s.sessionLocale)        // 2 — authoritative: already decided for this session
    || normalize(s.telegramLanguageCode) // 3 — hint only
    || DEFAULT_LOCALE;                   // 4
}

// ── the customer-visible string inventory ────────────────────────────────────────────────────
//
// Walks the branches.js exports that reach a customer and returns every distinct Cyrillic-bearing
// string. The generator and qa/premium-ux-ro-parity.test.mjs both read THIS function, so the
// completeness gate can never drift from what the build actually emits.
//
// meeting-brief.js is deliberately absent: the brief is owner-facing and stays Russian by design.
const VISIBLE_EXPORTS = [
  'OBJECTIVES', 'OBJECTIVE_SCREEN', 'PROBLEMS', 'PROBLEM_FREE_TEXT_OPTION',
  'OUTCOMES', 'OUTCOME_FREE_TEXT_OPTION', 'COMPANY_SCREEN', 'SCALE_OPTIONS',
  'CURRENT_SETUP', 'DECISION_HORIZON', 'DOCUMENTS', 'CONTACT', 'IMPORTANT_CONTEXT',
  'REVIEW', 'FOCUS_MAP', 'FOCUS_DISCLAIMER', 'PRIVACY', 'EDIT', 'SUCCESS',
  'CLOSE_HINT', 'FAILURE', 'BOOTSTRAP_FAILURE', 'SESSION_EXPIRED', 'RESUME',
  'STAGES', 'TG_COPY'
];

const CYRILLIC = /[А-яЁё]/;

function collectVisibleStrings(branches) {
  const out = [];
  const seen = Object.create(null);
  function walk(v) {
    if (typeof v === 'string') {
      if (CYRILLIC.test(v) && !seen[v]) { seen[v] = 1; out.push(v); }
      return;
    }
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) { walk(v[i]); } return; }
    if (v && typeof v === 'object') {
      const keys = Object.keys(v);
      for (let i = 0; i < keys.length; i++) { walk(v[keys[i]]); }
    }
  }
  for (let i = 0; i < VISIBLE_EXPORTS.length; i++) { walk(branches[VISIBLE_EXPORTS[i]]); }
  return out;
}

// ── completeness ─────────────────────────────────────────────────────────────────────────────
//
// Returns the machine values that have no Romanian label. The generator turns a non-empty result
// into a failed build; the QA gate turns it into a failed gate. Both refuse to ship a Romanian
// customer path with a Russian string on it.
function missingRoLabels(branches) {
  const strings = collectVisibleStrings(branches);
  const missing = [];
  for (let i = 0; i < strings.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(RO_LABELS, strings[i])) { missing.push(strings[i]); }
  }
  return missing;
}

function assertComplete(branches) {
  const missing = missingRoLabels(branches);
  if (missing.length) {
    throw new Error('RO parity incomplete — ' + missing.length + ' customer-visible string(s) have '
      + 'no Romanian label in n8n/src/premium-ux/ro-labels.js. There is no fallback to Russian on '
      + 'a Romanian customer path. First missing: ' + JSON.stringify(missing[0]));
  }
  return true;
}

// ── the Mini App shell ───────────────────────────────────────────────────────────────────────
//
// app-premium/app.js is hand-written, not generated, so its Russian chrome cannot be walked as an
// object. It is extracted from the source text instead: every quoted Cyrillic literal OUTSIDE the
// `UI` locale table, which is already bilingual and needs no lookup.
function collectShellStrings(appSource) {
  const lines = String(appSource).split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) { if (/^\s*var UI = \{/.test(lines[i])) { start = i; break; } }
  let end = -1;
  if (start !== -1) {
    let depth = 0;
    for (let i = start; i < lines.length; i++) {
      depth += (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
      if (i > start && depth <= 0) { end = i; break; }
    }
  }
  const out = [];
  const seen = Object.create(null);
  for (let i = 0; i < lines.length; i++) {
    if (start !== -1 && i >= start && i <= end) { continue; }
    const found = lines[i].match(/'[^']*[А-яЁё][^']*'|"[^"]*[А-яЁё][^"]*"/g) || [];
    for (let j = 0; j < found.length; j++) {
      const s = found[j].slice(1, -1);
      if (!seen[s]) { seen[s] = 1; out.push(s); }
    }
  }
  return out;
}

function missingShellLabels(appSource) {
  const strings = collectShellStrings(appSource);
  const missing = [];
  for (let i = 0; i < strings.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(ALL_RO, strings[i])) { missing.push(strings[i]); }
  }
  return missing;
}

// The resolved presentation table the browser bundle receives: machine value -> Romanian label.
// Russian needs no table at all, because for `ru` the machine value IS the label.
function roTable(branches) {
  assertComplete(branches);
  const table = {};
  const contract = collectVisibleStrings(branches);
  for (let i = 0; i < contract.length; i++) { table[contract[i]] = RO_LABELS[contract[i]]; }
  const shellKeys = Object.keys(SHELL_RO);
  for (let i = 0; i < shellKeys.length; i++) { table[shellKeys[i]] = SHELL_RO[shellKeys[i]]; }
  return table;
}

module.exports = {
  LOCALES, DEFAULT_LOCALE, normalize, resolveLocale,
  VISIBLE_EXPORTS, collectVisibleStrings, missingRoLabels, assertComplete, roTable,
  collectShellStrings, missingShellLabels
};
