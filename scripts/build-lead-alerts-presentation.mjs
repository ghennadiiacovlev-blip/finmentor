#!/usr/bin/env node
// FINMENTOR — Lead Alerts, the presentation cutover, as candidates.
//
//   node scripts/build-lead-alerts-presentation.mjs
//
// REPO-ONLY. Reads the live snapshots under n8n/history/, writes candidates under n8n/candidate/,
// and NEVER contacts n8n. Deploying is a separate, explicit act.
//
// ── WHAT IT CHANGES, AND WHAT IT REFUSES TO ────────────────────────────────────────────────────
//
// This is a PRESENTATION pass. In every builder node it replaces the last step — the string
// literal that becomes the owner's message — and leaves everything above it byte-for-byte
// untouched. The filters that decide which leads are overdue, the SLA arithmetic, the anti-spam
// window, the ranking, the stop-stages, the scrubbing in the Error Monitor: none of it moves.
//
// That is not a claim, it is enforced. For each node the builder holds the exact PREFIX of the
// live code that must survive; if the live code no longer starts with that prefix it refuses to
// emit, because a candidate built on a workflow that has changed underneath is a candidate that
// silently reverts whatever changed. qa/lead-alerts-candidates.test.mjs then re-derives the same
// comparison from the snapshots, so the guarantee is checked by something other than the thing
// making the change.
//
// ── WHAT IS DELIBERATELY LEFT ALONE ────────────────────────────────────────────────────────────
//
//   · `Build Short AI Telegram` (Lead Intake). It is an AI work-plan delivery, not one of the
//     eight owner-facing alert types, and B1 says to report a message that does not fit rather
//     than invent a ninth type for it. Untouched, and reported.
//   · `message_template` in the Followup builder. That string is WRITTEN TO THE FOLLOWUPS SHEET —
//     it is stored data, not an owner message, and rewriting it would rewrite records.
//   · Every Command Center reply. Those answer a command the owner typed; they are not alerts.
//   · Every trigger, schedule, filter, credential and connection in all five workflows.
//
// ── HOW THE PRESENTER GETS INTO A CODE NODE ────────────────────────────────────────────────────
//
// An n8n Code node cannot require a repo file, so n8n/src/lead-alerts/presenter.js and tz.js are
// inlined verbatim at the top of each builder node as `LA` and `TZ`. The gate re-extracts them
// from the candidates and requires a byte match against the modules, so the shipped copy and the
// tested copy cannot drift.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC = join(ROOT, 'n8n', 'src', 'lead-alerts');
const HISTORY = join(ROOT, 'n8n', 'history');
const CANDIDATE = join(ROOT, 'n8n', 'candidate');

const fail = [];
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

// ── the inlined modules ────────────────────────────────────────────────────────────────────────

export const PRESENTER_SRC = readFileSync(join(SRC, 'presenter.js'), 'utf8');
export const TZ_SRC = readFileSync(join(SRC, 'tz.js'), 'utf8');

// A module becomes an IIFE returning its exports. `module.exports = {...}` is the last statement in
// both files, so the transform is: wrap, and turn that assignment into a return.
function inline(name, src) {
  const marker = 'module.exports = ';
  const i = src.lastIndexOf(marker);
  if (i === -1) { throw new Error(name + ': no module.exports to convert'); }
  const body = src.slice(0, i);
  const exported = src.slice(i + marker.length).replace(/;\s*$/, '');
  return 'const ' + name + ' = (function () {\n' + body + '\nreturn ' + exported + ';\n})();';
}

export const INLINED =
  '// ─── INLINED FROM n8n/src/lead-alerts/tz.js — DO NOT EDIT HERE ───────────────────────────────\n' +
  '// scripts/build-lead-alerts-presentation.mjs regenerates this block. An edit made in the n8n\n' +
  '// editor is lost on the next build and is invisible to qa/lead-alerts-presentation.test.mjs.\n' +
  inline('LATZ', TZ_SRC) + '\n\n' +
  '// ─── INLINED FROM n8n/src/lead-alerts/presenter.js — DO NOT EDIT HERE ────────────────────────\n' +
  inline('LA', PRESENTER_SRC) + '\n';

// ── the edits ──────────────────────────────────────────────────────────────────────────────────
//
// Each entry names a workflow, a node, the exact tail of the live code to replace, and what
// replaces it. `tail` is matched with indexOf and must occur exactly once: an anchor that matches
// twice would silently rewrite the wrong half.

const EDITS = [
  // ───────────────────────────────────────────────────────────────────────── B3. OWNER DAILY BRIEF
  {
    workflow: 'imeJIDeNyaWDyXzh', file: 'imeJIDeNyaWDyXzh.pre-lead-alerts-presentation.json',
    out: 'lead-alerts-daily-digest-candidate.json',
    node: 'Build Daily Digest',
    // Everything above `let msg;` is selection: filters, ranking, counters. It survives untouched.
    tailStartsWith: 'let msg;',
    replacement: [
      '// ─── PRESENTATION ONLY. Every value below was computed by the selection code above, which',
      '// this pass did not touch. Nothing here re-filters, re-ranks or re-counts anything.',
      'const OFFSET = LATZ.tzOffsetMinutes(TZ, now);',   // TZ is the timezone NAME the digest already resolved
      '',
      '// The roster: the same topActive the digest already ranked, described rather than tabulated.',
      'const briefLeads = topActive.map(r => ({',
      "  company: val(r, 'company'),",
      "  descriptor: val(r, 'role') || val(r, 'business_model') || val(r, 'industry_category'),",
      "  priority: val(r, 'priority'),",
      "  objective: val(r, 'main_pain'),",
      "  nextAction: val(r, 'next_action'),",
      "  dueAt: val(r, 'next_follow_up_at'),",
      '  // Carried for de-duplication only. The renderer never prints it: B11 keeps internal ids',
      '  // out of the digest body.',
      "  leadId: val(r, 'lead_id')",
      '}));',
      '',
      '// «Что требует решения» carries OWNER decisions, each one already counted above. A count of',
      '// zero produces no line at all — that is the whole of B11 in three ifs.',
      '//',
      '// OWNER DECISION, 2026-08-30: the AI-plan counter is NOT here. `aiMissing` is still computed',
      '// above — the selection code is untouched — but «N лидов без AI-плана» reports the state of a',
      '// subsystem, not the state of the business, and the owner channel reports the business. There',
      '// is also no owner action behind it that «без следующего шага» does not already cover, and',
      '// two lines for one decision is worse than none.',
      "const nLead = (n) => n + ' ' + LA.plural(n, 'лид', 'лида', 'лидов');",
      'const decisions = [];',
      "if (noNextAction.length) { decisions.push(nLead(noNextAction.length) + ' без следующего шага'); }",
      "if (noContact.length) { decisions.push(nLead(noContact.length) + ' без контакта'); }",
      "if (snoozedExpired.length) { decisions.push(nLead(snoozedExpired.length) + ' с истёкшим сроком отложения'); }",
      '',
      'const alert_html = LA.renderDailyBrief({',
      '  now: now.toISOString(),',
      '  offsetMinutes: OFFSET,',
      '  counts: {',
      '    active: active.length,',
      '    newToday: newToday.length,',
      "    // «Требуют внимания» is the queue on the owner's desk today: HOT plus WARM, both active.",
      "    needAttention: byP('HOT') + byP('WARM'),",
      '    overdue: overdue.length',
      '  },',
      '  leads: briefLeads,',
      "  moreLeads: Math.max(0, (byP('HOT') + byP('WARM')) - 5),",
      '  decisions: decisions',
      '});',
      '',
      '// `stats` is unchanged and still feeds the activity log.',
      'return [{ json: { alert_html: alert_html, stats: stats } }];'
    ].join('\n'),
    // TZ is read from the same settings object the selection code already read it from.
    telegram: { node: 'Telegram Daily Digest', field: 'alert_html' }
  },

  // ────────────────────────────────────────────────────────────────────────────── B5. PRIORITY
  {
    workflow: 'LZ2mvKXbBikmeVTn', file: 'LZ2mvKXbBikmeVTn.pre-lead-alerts-presentation.json',
    out: 'lead-alerts-sla-watch-candidate.json',
    node: 'SLA Select',
    tailStartsWith: '  const msg =',
    replacement: [
      '  // ─── PRESENTATION ONLY. Which leads reach this point, and why, is decided above and is',
      '  // unchanged: HOT/WARM only, stop-stages excluded, snooze respected, anti-spam window kept.',
      "  const OFFSET = LATZ.tzOffsetMinutes(cfg.timezone || 'Europe/Chisinau', now);",
      '',
      '  // ONE reason, in the owner\'s language. The SLA arithmetic that produced it is above.',
      '  const reason = overdueByFollow',
      "    ? 'Запланированный контакт просрочен.'",
      "    : 'Нет ответа больше ' + slaHours + ' ' + LA.plural(slaHours, 'часа', 'часов', 'часов') + '.';",
      '',
      '  // The deadline the owner is actually late against.',
      '  const dueAt = overdueByFollow ? follow',
      '    : (createdAt ? new Date(new Date(createdAt).getTime() + slaHours * 36e5).toISOString() : \'\');',
      '',
      '  const alert_html = LA.renderPriority({',
      '    company: company,',
      '    reason: reason,',
      '    nextAction: action,',
      '    dueAt: dueAt,',
      '    now: now.toISOString(),',
      '    offsetMinutes: OFFSET,',
      '    leadId: leadId',
      '  });',
      '',
      '  out.push({ json: { lead_id: leadId, company, name, financial_zone: zone, priority,',
      '    alert_html: alert_html, sla_alert_at: now.toISOString() } });',
      '}',
      'return out;  // пусто -> Telegram не получит items -> пустые сообщения не отправляются'
    ].join('\n'),
    telegram: { node: 'Telegram SLA Alert', field: 'alert_html' }
  },

  // ───────────────────────────────────────────────────────────────────────────── B6. FOLLOW-UP
  {
    workflow: 'zeLOCuf0K1bkaKl2', file: 'zeLOCuf0K1bkaKl2.pre-lead-alerts-presentation.json',
    out: 'lead-alerts-followup-candidate.json',
    node: 'Build Followup Plan',
    tailStartsWith: '  const telegram_message =',
    replacement: [
      '  // ─── PRESENTATION ONLY. Section A above still writes `message_template` into the Followups',
      '  // SHEET untouched: that string is stored data, not an owner message, and rewriting it here',
      '  // would rewrite records rather than a notification.',
      "  const OFFSET = LATZ.tzOffsetMinutes(cfg.timezone || 'Europe/Chisinau', now);",
      '',
      '  // The renderer takes a LIST. This workflow emits one item per due follow-up, so it passes',
      '  // one and the message reads correctly for one. The day an aggregation step is approved,',
      '  // the same call produces the numbered list without a second template existing.',
      '  const alert_html = LA.renderFollowUp({',
      '    now: now.toISOString(),',
      '    offsetMinutes: OFFSET,',
      '    items: [{',
      '      company: company,',
      "      action: nextAction && nextAction !== '-' ? nextAction : type,",
      "      dueAt: val(f, 'due_at'),",
      '      leadId: leadId',
      '    }]',
      '  });',
      '',
      '  out.push({ json: {',
      "    item_type: 'due_alert',",
      "    followup_id: val(f, 'followup_id'),",
      '    lead_id: leadId,',
      '    type,',
      '    priority,',
      '    financial_zone: zone,',
      "    due_at: val(f, 'due_at'),",
      '    alert_html: alert_html',
      '  }});',
      '}',
      '',
      'return out;'
    ].join('\n'),
    telegram: { node: 'Telegram Followup Reminder', field: 'alert_html' }
  },

  // ─────────────────────────────────────────────────────────────────────────── B7/B8. SYSTEM ALERT
  {
    workflow: 'RBiFLhVjizMkAzrK', file: 'RBiFLhVjizMkAzrK.pre-lead-alerts-presentation.json',
    out: 'lead-alerts-error-monitor-candidate.json',
    node: 'Build Error Alert',
    // Everything above `const lines = [` is the scrubber: URL/email/phone removal, classification,
    // the deliberate refusal to read error.stack. All of it survives.
    tailStartsWith: 'const lines = [',
    replacement: [
      '// ─── PRESENTATION ONLY. The scrubbing above is unchanged, including the rule that',
      '// error.stack is never read and the payload is never included.',
      '//',
      '// WHAT THIS MESSAGE MAY NOT SAY. The n8n error trigger delivers { execution: { id, url,',
      '// error }, workflow: { id, name } } and nothing else — verified against execution 4240,',
      '// which alerted on failure 4239. There is no runData, so the alert cannot state that a lead',
      '// was not created or that Pipeline was not written. The renderer says so instead of guessing.',
      'const alert_html = LA.renderSystemAlert({',
      '  workflowName: workflowName,',
      '  nodeName: nodeName,',
      '  errorClass: errorClass,',
      '  message: message,',
      '  executionId: correlationId',
      '});',
      '',
      'return [{',
      '  json: {',
      "    owner_chat_id: String(cfg.owner_chat_id || ''),",
      '    alert_html: alert_html,',
      "    workflow_id: String(wf.id || ''),",
      '    workflow_name: workflowName,',
      '    node_name: nodeName,',
      '    error_class: errorClass,',
      '    error_message: message,',
      '    correlation_id: correlationId,',
      '    ts: when',
      '  }',
      '}];'
    ].join('\n'),
    telegram: { node: 'Telegram Error Alert', field: 'alert_html' }
  },

  // ────────────────────────────────────────────────────────────────────────────── B4. NEW LEAD
  {
    workflow: 'QmIyEW2ZEqKregmN', file: 'QmIyEW2ZEqKregmN.pre-lead-alerts-presentation.json',
    out: 'lead-alerts-lead-intake-candidate.json',
    node: 'Build Premium Telegram Brief',
    tailStartsWith: 'const message = `',
    replacement: [
      '// ─── PRESENTATION ONLY. Every local below was extracted by the code above, unchanged.',
      '//',
      '// OWNER DECISION, 2026-08-30 — ONE preferred channel, WITH its value, so the owner can act',
      '// without opening the CRM. Never phone and email together, and never a contact anywhere but',
      '// this one alert.',
      '//',
      '// The channel the CLIENT chose wins. Only when the record carries no stated preference does',
      '// this fall back to whichever contact actually arrived — and a stated preference with no',
      '// value behind it renders «Не указана» rather than promising a route the record lacks.',
      'const contactChannel = LA.contactChannelKey(preferredContact)',
      "  || (telegram ? 'telegram' : (phone ? 'phone' : (email ? 'email' : '')));",
      "const contactValue = contactChannel === 'telegram' ? telegram",
      "  : (contactChannel === 'phone' ? phone : (contactChannel === 'email' ? email : ''));",
      '',
      '// «Ситуация» is a controlled summary built from classified fields, never a client paste.',
      'const situation = [industry, businessModel, turnover, employees]',
      "  .filter(v => String(v || '').trim() !== '').join(' · ');",
      '',
      'const alert_html = LA.renderNewLead({',
      '  company: company,',
      '  role: role,',
      '  objective: mainPain,',
      '  situation: situation,',
      '  priority: priority,',
      '  zone: zone,',
      '  nextAction: recommendedFirstStep,',
      '  // The RAW slug, not the `source` local. That local has already been through the',
      '  // workflow\'s own sourceLabel(), and translating a translation is how the live check',
      '  // found «Источник: Сайт FINMENTOR» on a lead that came from the extended X-Ray.',
      '  source: item.tool || raw.tool,',
      '  contactChannel: contactChannel,',
      '  contactValue: contactValue,',
      '  leadId: item.lead_id',
      '});',
      '',
      'return [{ json: Object.assign({}, item, { alert_html: alert_html }) }];'
    ].join('\n'),
    telegram: { node: 'Telegram Lead Alert', field: 'alert_html' },
    // Two more nodes in the same workflow, applied in the same pass.
    also: [
      {
        node: 'Build Warm Telegram Alert',
        tailStartsWith: 'const message = `',
        replacement: [
          '// ─── PRESENTATION ONLY. Same type as the HOT brief, same renderer; only the model differs,',
          '// because a WARM lead reaches this node with fewer fields extracted.',
          'const warmChannel = LA.contactChannelKey(item.preferred_contact || item.contact_channel)',
          "  || (item.telegram ? 'telegram' : (item.phone ? 'phone' : (item.email ? 'email' : '')));",
          "const warmValue = warmChannel === 'telegram' ? item.telegram",
          "  : (warmChannel === 'phone' ? item.phone : (warmChannel === 'email' ? item.email : ''));",
          'const alert_html = LA.renderNewLead({',
          '  company: item.company,',
          '  role: item.role,',
          '  objective: item.main_pain,',
          "  situation: [item.business_model, item.turnover_range].filter(v => String(v || '').trim() !== '').join(' · '),",
          "  priority: item.lead_temperature || 'WARM',",
          '  zone: item.financial_zone || item.risk_zone || item.score_zone,',
          '  nextAction: item.next_action,',
          '  source: item.tool,',
          '  // Same one-channel policy as the HOT brief. A WARM lead reaches this node with fewer',
          '  // fields extracted, so the stated preference is read from whichever key carries it.',
          "  contactChannel: warmChannel,",
          "  contactValue: warmValue,",
          '  leadId: item.lead_id',
          '});',
          '',
          'return [{ json: Object.assign({}, item, { alert_html: alert_html }) }];'
        ].join('\n'),
        telegram: { node: 'Telegram Warm Alert', field: 'alert_html' }
      },
      {
        node: 'Build Incomplete Telegram Alert',
        tailStartsWith: 'const contact = pick(',
        replacement: [
          '// ─── PRESENTATION ONLY. An incomplete lead is its own type because the owner action is',
          '// different in kind: nothing here can be sold until the record is repaired.',
          '//',
          '// No contact VALUE here, in either direction. Printing the one channel that did arrive',
          '// would put a phone number in an alert whose subject is the absence of a phone number,',
          '// and the owner decision confines contact values to the NEW LEAD alert.',
          '//',
          '// «контакт для связи» is ONE item, not three. The owner does not need to know which of',
          '// phone, Telegram or email is missing to decide to open the record — he needs to know',
          '// there is no way to reach this person.',
          '//',
          '// `priority_reason` still travels in the item for the internal record. It is NOT rendered:',
          '// the reason line is pinned in the renderer, because whatever blocked this lead may be a',
          '// consent question and an owner alert is not where the legal basis gets stated.',
          'const missing = [];',
          "const anyContact = [item.phone, item.telegram, item.email].some(v => String(v || '').trim() !== '');",
          "if (!anyContact) { missing.push('контакт для связи'); }",
          "if (!String(item.company || '').trim()) { missing.push('название компании'); }",
          "if (!String(item.name || '').trim()) { missing.push('контактное лицо'); }",
          '',
          'const alert_html = LA.renderIncomplete({',
          '  company: item.company,',
          '  missing: missing,',
          '  source: item.tool,',
          '  leadId: item.lead_id',
          '});',
          '',
          'return [{ json: Object.assign({}, item, { alert_html: alert_html }) }];'
        ].join('\n'),
        telegram: { node: 'Telegram Incomplete Alert', field: 'alert_html' }
      }
    ]
  }
];

// `Build Short AI Telegram` is NOT in EDITS, and that is the point. It is asserted absent so a
// later edit cannot quietly bring it in without a decision being taken.
export const DELIBERATELY_UNTOUCHED = [
  ['QmIyEW2ZEqKregmN', 'Build Short AI Telegram',
    'an AI work-plan delivery, not one of the eight owner alert types — reported, not redesigned'],
  ['zeLOCuf0K1bkaKl2', 'message_template',
    'written into the Followups sheet: stored data, not an owner message'],
  ['qF9tonlHHIxc8MDd', 'every reply node',
    'answers a command the owner typed; a reply is not an alert']
];

// ── apply ──────────────────────────────────────────────────────────────────────────────────────

function applyEdit(wf, spec) {
  const node = wf.nodes.find((n) => n.name === spec.node);
  if (!node) { fail.push(spec.node + ': not found in the snapshot'); return null; }
  const code = String(node.parameters.jsCode || '');

  const at = code.indexOf(spec.tailStartsWith);
  if (at === -1) { fail.push(spec.node + ': the anchor «' + spec.tailStartsWith + '» is not in the live code'); return null; }
  if (code.indexOf(spec.tailStartsWith, at + 1) !== -1) {
    fail.push(spec.node + ': the anchor «' + spec.tailStartsWith + '» occurs more than once');
    return null;
  }

  const preserved = code.slice(0, at);
  const next = INLINED + '\n' + preserved + spec.replacement + '\n';
  node.parameters.jsCode = next;
  return { preserved, node };
}

function pointTelegram(wf, tg) {
  const n = wf.nodes.find((x) => x.name === tg.node);
  if (!n) { fail.push(tg.node + ': Telegram node not found'); return; }
  // The old expression stripped `<`, `>` and the Markdown metacharacters — necessary for plain
  // text, and fatal for HTML. The renderer escapes at the source, so the value passes through.
  n.parameters.text = '={{ $json.' + tg.field + ' }}';
  n.parameters.additionalFields = Object.assign({}, n.parameters.additionalFields, {
    appendAttribution: false,
    parse_mode: 'HTML'
  });
}

mkdirSync(CANDIDATE, { recursive: true });

const report = [];
for (const spec of EDITS) {
  let snapshot;
  try { snapshot = JSON.parse(readFileSync(join(HISTORY, spec.file), 'utf8')); }
  catch (e) { fail.push(spec.file + ': missing — run scripts/snapshot-lead-alerts.mjs first'); continue; }

  const wf = JSON.parse(JSON.stringify(snapshot));
  const touched = [];

  for (const one of [spec].concat(spec.also || [])) {
    const r = applyEdit(wf, one);
    if (r) { touched.push(one.node); }
    if (one.telegram) { pointTelegram(wf, one.telegram); }
  }

  // The guarantee, restated as a check: every node NOT in this edit set must be byte-identical.
  const changed = [];
  for (const n of wf.nodes) {
    const was = snapshot.nodes.find((x) => x.name === n.name);
    if (!was) { fail.push(spec.workflow + ': the candidate introduces a node — ' + n.name); continue; }
    if (JSON.stringify(n) !== JSON.stringify(was)) { changed.push(n.name); }
  }
  for (const n of snapshot.nodes) {
    if (!wf.nodes.find((x) => x.name === n.name)) { fail.push(spec.workflow + ': the candidate removes ' + n.name); }
  }
  if (JSON.stringify(wf.connections) !== JSON.stringify(snapshot.connections)) {
    fail.push(spec.workflow + ': the connection graph changed — this pass may not move an edge');
  }

  const expected = touched.concat([spec].concat(spec.also || []).filter((x) => x.telegram).map((x) => x.telegram.node));
  for (const c of changed) {
    if (expected.indexOf(c) === -1) { fail.push(spec.workflow + ': unexpected change to ' + c); }
  }

  writeFileSync(join(CANDIDATE, spec.out), JSON.stringify(wf, null, 2) + '\n', 'utf8');
  report.push({ workflow: spec.workflow, name: wf.name, out: spec.out, nodes: wf.nodes.length, changed });
}

// ── output ─────────────────────────────────────────────────────────────────────────────────────

console.log('');
console.log('FINMENTOR Lead Alerts — presentation candidates');
console.log('='.repeat(78));
console.log('  presenter sha256 : ' + sha(PRESENTER_SRC).slice(0, 32));
console.log('  tz sha256        : ' + sha(TZ_SRC).slice(0, 32));
console.log('');
for (const r of report) {
  console.log('  ' + r.name);
  console.log('      out     : n8n/candidate/' + r.out);
  console.log('      nodes   : ' + r.nodes + '  (changed: ' + (r.changed.length ? r.changed.join(', ') : 'none') + ')');
}
console.log('');
console.log('  DELIBERATELY UNTOUCHED');
for (const [wfId, what, why] of DELIBERATELY_UNTOUCHED) {
  console.log('      ' + what + '  (' + wfId + ')');
  console.log('          ' + why);
}
console.log('');

if (fail.length) {
  console.error('REFUSED TO EMIT:');
  fail.forEach((f) => console.error('  - ' + f));
  process.exitCode = 1;
} else {
  console.log('  LOGIC CHANGED = NO. Only the named builder tails and their Telegram nodes differ.');
  console.log('  NOT DEPLOYED. These are candidates.');
  console.log('');
}
