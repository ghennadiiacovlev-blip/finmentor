#!/usr/bin/env node
// FINMENTOR — POST-DEPLOY verification of the acknowledgement fix.
//
//   node scripts/verify-ack-fix-postdeploy.mjs
//
// READ-ONLY. One GET. Nothing is written, nothing is deployed, no action is replayed and no
// Pipeline row is touched.
//
// This does not read the deploy script's own report. It fresh-reads the live Command Center from
// the tenant and diffs it against the frozen pre-image `.uat/qF9tonlHHIxc8MDd.pre-ack-fix.json`,
// so every statement below is about the bytes n8n will actually run.
//
// The claim under test is narrow and total: ONE parameter, on ONE node, and nothing else moved.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.N8N_API_KEY;

const CC = 'qF9tonlHHIxc8MDd';
const NODE = 'Telegram Update Reply';
const PRE_FILE = join(OUT_DIR, CC + '.pre-ack-fix.json');

const EXPECT_EXPR = "={{ $json.error ? $('Find & Build Update').first().json.reply_text_presentation_failed "
  + ": $('Find & Build Update').first().json.reply_text }}";

let pass = 0;
const failures = [];
const ok = (m) => { pass++; console.log('  PASS  ' + m); };
const bad = (m) => { failures.push(m); console.log('  FAIL  ' + m); };
const want = (c, m) => (c ? ok(m) : bad(m));
const eqw = (a, b, m) => want(a === b, m + (a === b ? '' : '\n            got  ' + JSON.stringify(a) + '\n            want ' + JSON.stringify(b)));
const say = (m) => console.log(m);

class Stop extends Error {}
const die = (m) => { throw new Stop(m); };

const j = (v) => JSON.stringify(v);

say('');
say('POST-DEPLOY — the acknowledgement fix, read back from the tenant');
say('='.repeat(78));

MAIN: try {
  if (!BASE || !KEY) { die('set N8N_BASE_URL and N8N_API_KEY'); }
  if (!existsSync(PRE_FILE)) { die('the frozen pre-image is missing: ' + PRE_FILE); }

  // ── 1. fresh read ───────────────────────────────────────────────────────────────────────────
  say('');
  say('1. the live Command Center, fresh from the tenant');

  const r = await fetch(BASE + '/api/v1/workflows/' + CC, { headers: { 'X-N8N-API-KEY': KEY } });
  if (!r.ok) { die('GET /workflows/' + CC + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 200)); }
  const LIVE = await r.json();
  const PRE = JSON.parse(readFileSync(PRE_FILE, 'utf8'));

  say('        ' + LIVE.name);
  say('        id ' + LIVE.id + '   active ' + LIVE.active + '   nodes ' + (LIVE.nodes || []).length
    + '   updatedAt ' + LIVE.updatedAt);
  eqw(LIVE.name, PRE.name, 'the workflow NAME is unchanged — the identity deploy defect did not recur');
  eqw((LIVE.nodes || []).length, (PRE.nodes || []).length, 'node count unchanged: ' + (LIVE.nodes || []).length);
  want(LIVE.active === true, 'the workflow is ACTIVE');

  // ── 2. the expression ───────────────────────────────────────────────────────────────────────
  say('');
  say('2. the deployed acknowledgement expression');

  const liveNode = (LIVE.nodes || []).find((n) => n.name === NODE);
  const preNode = (PRE.nodes || []).find((n) => n.name === NODE);
  if (!liveNode) { die('the live graph has no node named ' + j(NODE)); }
  if (!preNode) { die('the pre-image has no node named ' + j(NODE)); }

  say('');
  say('        BEFORE  ' + String(preNode.parameters.text));
  say('        NOW     ' + String(liveNode.parameters.text));
  say('');
  eqw(String(liveNode.parameters.text), EXPECT_EXPR, 'the live text expression is the corrected one, byte for byte');
  want(/\$\('Find & Build Update'\)/.test(String(liveNode.parameters.text)),
    "it sources from $('Find & Build Update') — a SINGLE-output Code node, where .first() is unambiguous");
  want(!/\$\('Route Edit Shape'\)/.test(String(liveNode.parameters.text)),
    'it no longer addresses the four-output Switch');
  want(String(preNode.parameters.text) !== String(liveNode.parameters.text),
    'and it differs from the pre-image, so the deploy actually landed');

  // ── 3. the production diff ──────────────────────────────────────────────────────────────────
  say('');
  say('3. the production diff — one parameter, one node, nothing else');

  const liveByName = new Map((LIVE.nodes || []).map((n) => [n.name, n]));
  const preByName = new Map((PRE.nodes || []).map((n) => [n.name, n]));

  // 3a — the node set itself
  const added = [...liveByName.keys()].filter((n) => !preByName.has(n));
  const removed = [...preByName.keys()].filter((n) => !liveByName.has(n));
  want(added.length === 0, 'no node was ADDED' + (added.length ? ': ' + added.join(', ') : ''));
  want(removed.length === 0, 'no node was REMOVED' + (removed.length ? ': ' + removed.join(', ') : ''));

  // 3b — connections, byte for byte
  eqw(j(LIVE.connections), j(PRE.connections), 'CONNECTIONS are byte-identical — no rewiring');

  // 3c — exactly one node differs, and it is the one named
  const differing = [];
  for (const [name, pn] of preByName) {
    const ln = liveByName.get(name);
    if (!ln) { continue; }
    if (j(pn) !== j(ln)) { differing.push(name); }
  }
  eqw(j(differing), j([NODE]), 'exactly ONE node differs from the pre-image, and it is ' + NODE);

  // 3d — and within that node, exactly one parameter
  const changedTop = Object.keys({ ...preNode, ...liveNode })
    .filter((k) => j(preNode[k]) !== j(liveNode[k]));
  eqw(j(changedTop), j(['parameters']), 'within that node only `parameters` differs — type, id, name, position, credentials and onError untouched');

  const changedParams = Object.keys({ ...preNode.parameters, ...liveNode.parameters })
    .filter((k) => j(preNode.parameters[k]) !== j(liveNode.parameters[k]));
  eqw(j(changedParams), j(['text']), 'and within `parameters` exactly ONE key differs: text');
  say('');
  say('        the whole production diff:  ' + NODE + '.parameters.text');
  say('');

  // 3e — Google Sheets nodes
  const sheetsPre = (PRE.nodes || []).filter((n) => String(n.type).includes('googleSheets'));
  const sheetsLive = (LIVE.nodes || []).filter((n) => String(n.type).includes('googleSheets'));
  eqw(sheetsLive.length, sheetsPre.length, sheetsPre.length + ' Google Sheets nodes, same count');
  const sheetsMoved = sheetsPre.filter((n) => j(n) !== j(liveByName.get(n.name)));
  want(sheetsMoved.length === 0, 'every Google Sheets node is byte-identical'
    + (sheetsMoved.length ? ' EXCEPT: ' + sheetsMoved.map((n) => n.name).join(', ') : '')
    + ' (' + sheetsPre.map((n) => n.name).join(', ') + ')');

  // 3f — credentials, everywhere
  const credOf = (nodes) => nodes.filter((n) => n.credentials)
    .map((n) => n.name + ' -> ' + j(n.credentials)).sort();
  eqw(j(credOf(LIVE.nodes || [])), j(credOf(PRE.nodes || [])), 'CREDENTIALS are identical on every node that carries one');
  const credCount = (LIVE.nodes || []).filter((n) => n.credentials).length;
  ok(credCount + ' credential-bearing nodes, none rebound');

  // 3g — every unrelated node, byte for byte
  const unrelated = [...preByName.keys()].filter((n) => n !== NODE);
  const unrelatedMoved = unrelated.filter((n) => j(preByName.get(n)) !== j(liveByName.get(n)));
  want(unrelatedMoved.length === 0, 'all ' + unrelated.length + ' UNRELATED nodes are byte-identical to the pre-image'
    + (unrelatedMoved.length ? ' EXCEPT: ' + unrelatedMoved.join(', ') : ''));

  // 3h — settings
  eqw(j(LIVE.settings || {}), j(PRE.settings || {}), 'workflow settings unchanged');

  say('');
  say('='.repeat(78));
  say('  ' + pass + ' passed, ' + failures.length + ' failed');
  if (failures.length) {
    say('');
    for (const f of failures) { say('  FAILED: ' + f); }
    process.exitCode = 1;
  }
  say('');
  say('  Read-only: one GET. No PUT, no POST, no replay, no restore.');
  say('  Rollback remains: PUT /api/v1/workflows/' + CC + ' with ' + PRE_FILE);
  say('');
} catch (e) {
  if (!(e instanceof Stop)) { throw e; }
  console.error('\nSTOPPED: ' + e.message);
  process.exitCode = 1;
}
