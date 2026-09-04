#!/usr/bin/env node
// FINMENTOR — Premium UX (approved 2026-09-04): the presenter REFRESH onto live, regression-proofed.
//
//   node qa/lead-alerts-presenter-refresh.test.mjs
//
// Offline. Drives the pure functions of scripts/refresh-lead-alerts-presenter.mjs against the tracked
// deployed records (n8n/history/<id>.deployed-lead-alerts.json — the last state the presentation
// deploy wrote, carrying the OLD inlined presenter) and proves: the fresh block equals what the
// builder emits into the candidates; only the declared builder nodes change; the live prefix/tail
// of each node, every other node, every edge, setting, credential and Telegram node are untouched;
// the refreshed node renders the approved headers; idempotence; tampering refused.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sources, splitNode, refreshWorkflow, verifyRefresh, WORKFLOWS } from '../scripts/refresh-lead-alerts-presenter.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a).slice(0, 160) + ', want ' + JSON.stringify(b).slice(0, 160) + ')'); };
const load = (dir, f) => JSON.parse(readFileSync(join(ROOT, 'n8n', dir, f), 'utf8'));
const byName = (w, n) => w.nodes.find((x) => x.name === n);
const codeOf = (w, n) => String((byName(w, n) || { parameters: {} }).parameters.jsCode || '');

const SRC = sources();
const CANDIDATE_OF = { imeJIDeNyaWDyXzh: 'lead-alerts-daily-digest-candidate.json', LZ2mvKXbBikmeVTn: 'lead-alerts-sla-watch-candidate.json', zeLOCuf0K1bkaKl2: 'lead-alerts-followup-candidate.json', RBiFLhVjizMkAzrK: 'lead-alerts-error-monitor-candidate.json', QmIyEW2ZEqKregmN: 'lead-alerts-lead-intake-candidate.json' };

console.log('\nFINMENTOR — presenter refresh onto live, regression gate\n');

check('the fresh inlined block is byte-identical to what the builder emits into every presentation candidate', () => {
  for (const spec of WORKFLOWS.filter((w) => w.kind === 'lead-alerts')) {
    const cand = load('candidate', CANDIDATE_OF[spec.id]);
    for (const n of spec.nodes) {
      const c = codeOf(cand, n).replace(/\r\n/g, '\n');
      assert(c.startsWith(SRC.inlined + '\n'), spec.label + '/' + n + ': candidate prefix differs from the refresh block');
    }
  }
  const sa = load('candidate', 'system-alert-workflow.json');
  const p = splitNode(codeOf(sa, 'Build System Alert'), 'system-alert');
  eq(p.block, SRC.laOnly, 'SYSTEM ALERT candidate presenter block differs from the refresh block');
});

const refreshed = {};
check('on the deployed records (old presenter) the refresh rewrites exactly the declared builder nodes', () => {
  for (const spec of WORKFLOWS.filter((w) => w.kind === 'lead-alerts')) {
    const live = load('history', spec.id + '.deployed-lead-alerts.json');
    const r = refreshWorkflow(live, spec, SRC);
    refreshed[spec.id] = { live, next: r.next };
    eq(JSON.stringify(r.touched), JSON.stringify(spec.nodes), spec.label + ' touched');
    eq(verifyRefresh(live, r.next, spec, SRC).join(' | '), '', spec.label + ' verify');
    const changed = r.next.nodes.filter((n) => JSON.stringify(n) !== JSON.stringify(byName(live, n.name))).map((n) => n.name);
    eq(JSON.stringify(changed), JSON.stringify(spec.nodes), spec.label + ' changed nodes');
  }
});

check('every rewritten node keeps its live code after the block byte-for-byte; the old block was the OLD presenter', () => {
  for (const spec of WORKFLOWS.filter((w) => w.kind === 'lead-alerts')) {
    const { live, next } = refreshed[spec.id];
    for (const n of spec.nodes) {
      const before = splitNode(codeOf(live, n), 'lead-alerts'); const after = splitNode(codeOf(next, n), 'lead-alerts');
      eq(after.rest, before.rest, spec.label + '/' + n + ' rest');
      assert(before.rest.length > 500, spec.label + '/' + n + ' rest suspiciously short');
      assert(before.block !== after.block && after.block === SRC.inlined, spec.label + '/' + n + ' block');
      assert(/FINMENTOR · NEW LEAD|FINMENTOR · PRIORITY|OWNER DAILY BRIEF/.test(before.block) || /header\(/.test(before.block), 'the old block is not a presenter');
    }
  }
});

check('EXECUTED: the refreshed block renders the approved Russian headers and the canonical zone vocabulary', () => {
  const LA = new Function(SRC.inlined + '\n; return LA;')();
  const pr = LA.renderPriority({ company: 'Alfa Grup SRL', reason: 'Запланированный контакт просрочен.', nextAction: 'Позвонить', dueAt: '2026-09-01T09:00:00.000Z', now: '2026-09-04T09:00:00.000Z', offsetMinutes: 180, priority: 'HOT' });
  assert(pr.startsWith('⏳ <b>FINMENTOR · Требует внимания</b>'), 'PRIORITY header: ' + pr.split('\n')[0]);
  const nl = LA.renderNewLead({ company: 'Alfa Grup SRL', objective: 'x', priority: 'HOT', zone: 'ORANGE', situation: 'Retail · 1–5M € · 50–100', source: 'xray_extended', contactChannel: 'telegram', contactValue: '@a', language: 'ru' });
  assert(nl.startsWith('🔔 <b>FINMENTOR · Новый лид</b>') && nl.includes('🟠 Существенные пробелы') && nl.includes('1–5 млн EUR · 50–100 сотрудников'), 'NEW LEAD: ' + nl);
  assert(!/Повышенный риск|FINMENTOR · NEW LEAD|<code>/.test(nl), 'retired copy survives');
  const LATZ = new Function(SRC.inlined + '\n; return LATZ;')();
  assert(typeof LATZ.tzOffsetMinutes === 'function', 'tz block missing');
});

check('Telegram nodes, edges, settings and credentials are untouched on every workflow', () => {
  for (const spec of WORKFLOWS.filter((w) => w.kind === 'lead-alerts')) {
    const { live, next } = refreshed[spec.id];
    for (const n of live.nodes) {
      if (spec.nodes.includes(n.name)) { continue; }
      eq(JSON.stringify(byName(next, n.name)), JSON.stringify(n), spec.label + '/' + n.name + ' changed');
    }
    eq(JSON.stringify(next.connections), JSON.stringify(live.connections), spec.label + ' connections');
    eq(JSON.stringify(next.settings), JSON.stringify(live.settings || {}), spec.label + ' settings');
  }
});

check('SYSTEM ALERT: the presenter block is replaced between its header and END marker; idempotent on the tracked candidate', () => {
  const spec = WORKFLOWS.find((w) => w.kind === 'system-alert');
  const cand = load('candidate', 'system-alert-workflow.json');
  const r = refreshWorkflow(cand, spec, SRC);
  eq(JSON.stringify(r.touched), '[]', 'candidate already current');
  eq(verifyRefresh(cand, r.next, spec, SRC).join(' | '), '', 'verify');
  // and a stand-in carrying an older presenter is rewritten with the tail kept
  const old = JSON.parse(JSON.stringify(cand));
  const p = splitNode(codeOf(old, 'Build System Alert'), 'system-alert');
  byName(old, 'Build System Alert').parameters.jsCode = p.head + p.block.replace('const LA = (function () {', 'const LA = (function () {\n// older presenter marker') + p.rest;
  const r2 = refreshWorkflow(old, spec, SRC);
  eq(JSON.stringify(r2.touched), JSON.stringify(['Build System Alert']), 'old stand-in touched');
  eq(verifyRefresh(old, r2.next, spec, SRC).join(' | '), '', 'old stand-in verify');
  eq(splitNode(codeOf(r2.next, 'Build System Alert'), 'system-alert').rest, p.rest, 'SYSTEM ALERT tail');
});

check('idempotent: refreshing the refreshed output changes nothing', () => {
  for (const spec of WORKFLOWS.filter((w) => w.kind === 'lead-alerts')) {
    const { next } = refreshed[spec.id];
    eq(JSON.stringify(refreshWorkflow(next, spec, SRC).touched), '[]', spec.label);
  }
});

check('tampering is refused: an edited tail, an edited Telegram node, a moved edge, a changed credential', () => {
  const spec = WORKFLOWS.find((w) => w.id === 'QmIyEW2ZEqKregmN');
  const { live, next } = refreshed[spec.id];
  const t1 = JSON.parse(JSON.stringify(next)); byName(t1, 'Build Premium Telegram Brief').parameters.jsCode += '\n// tampered';
  assert(verifyRefresh(live, t1, spec, SRC).length > 0, 'a tail edit was accepted');
  const t2 = JSON.parse(JSON.stringify(next)); byName(t2, 'Telegram Lead Alert').parameters.text = '={{ $json.other }}';
  assert(verifyRefresh(live, t2, spec, SRC).length > 0, 'a Telegram node edit was accepted');
  const t3 = JSON.parse(JSON.stringify(next)); delete t3.connections[Object.keys(t3.connections)[0]];
  assert(verifyRefresh(live, t3, spec, SRC).length > 0, 'a removed edge was accepted');
  const t4 = JSON.parse(JSON.stringify(next)); byName(t4, 'Build Premium Telegram Brief').credentials = { x: { id: '1', name: 'x' } };
  assert(verifyRefresh(live, t4, spec, SRC).length > 0, 'a credential change was accepted');
});

check('splitNode refuses layouts it does not recognise', () => {
  for (const [bad, kind] of [['', 'lead-alerts'], ['const x = 1;', 'lead-alerts'], ['const LA = (function () {\nreturn 1;\n})();\n// tail', 'lead-alerts'], ['// no header\nconst LA = (function () {\nreturn 1;\n})();\n// ─── END INLINED MODULE', 'system-alert']]) {
    let threw = false; try { splitNode(bad, kind); } catch (e) { threw = true; }
    assert(threw, 'accepted: ' + JSON.stringify(bad).slice(0, 40));
  }
});

console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) { console.log(failures.map((f) => '  ' + f).join('\n')); process.exit(1); }
