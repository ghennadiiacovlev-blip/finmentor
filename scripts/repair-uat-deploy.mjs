#!/usr/bin/env node
// FINMENTOR — repair two defects introduced by the UAT deployment.
//
//   node scripts/repair-uat-deploy.mjs --dry-run
//   node scripts/repair-uat-deploy.mjs --confirm
//
// ── 1. THE PRODUCTION WORKFLOWS WERE RENAMED ───────────────────────────────────────────────────
//
// The candidates carry `[CANDIDATE] …` names so a tracked artifact can never be mistaken for a
// deployment. The deploy sent the whole importable body — name included — so the two live
// workflows are now called `[CANDIDATE] …` in the n8n UI. Nothing about their behaviour changed,
// but a production workflow that reads as a candidate is exactly the kind of ambiguity that gets
// something deleted by mistake. The original names are restored from the pre-deploy read.
//
// ── 2. THE ROLLBACK ARTIFACTS HAD EMPTY SETTINGS ───────────────────────────────────────────────
//
// Worse, and the reason this script exists at all. The deploy captured the pre-deploy state as
// `{name, nodes, connections, active}` and then wrote it through a helper that reads `.settings`.
// There was none, so every rollback body was written with `settings: {}`.
//
// Restoring from those artifacts would have SILENTLY WIPED the workflow settings — including
// `errorWorkflow`, the binding to the error monitor. A rollback that breaks error reporting is
// worse than no rollback, because it is trusted.
//
// The live settings are intact (the candidates carried them through), so the artifacts are
// rewritten from the pre-deploy nodes and connections plus the settings that are live now, and each
// is then checked for the fields that must survive a restore.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');

const TARGETS = [
  { id: 'mppzthlkSJFr6Kle', name: 'FINMENTOR Telegram Client Concierge PREMIUM AI GUARDED' },
  { id: 'QmIyEW2ZEqKregmN', name: 'FINMENTOR Lead Intake PREMIUM FINAL' }
];

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const CONFIRM = args.includes('--confirm');
const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY;

const say = (m) => console.log(m);
const ok = (m) => say('  PASS  ' + m);
const bad = (m) => say('  FAIL  ' + m);
function die(m) { console.error('\nSTOPPED: ' + m); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(m, p, b, tries) {
  let last = null;
  for (let i = 0; i < (tries || 4); i++) {
    try {
      const res = await fetch(BASE + '/api/v1' + p, { method: m,
        headers: Object.assign({ 'X-N8N-API-KEY': m === 'GET' ? READ_KEY : WRITE_KEY }, b ? { 'Content-Type': 'application/json' } : {}),
        body: b ? JSON.stringify(b) : undefined });
      const t = await res.text();
      if (!res.ok) { throw new Error(m + ' ' + p + ' -> ' + res.status + ' ' + t.slice(0, 200)); }
      return t ? JSON.parse(t) : null;
    } catch (e) { last = e; await sleep(1200); }
  }
  throw last;
}

if (!BASE || !READ_KEY || !WRITE_KEY) { die('N8N_BASE_URL, N8N_API_KEY and N8N_FIX_API_KEY must be set'); }
if (!DRY && !CONFIRM) { die('re-run with --confirm (or --dry-run first)'); }

say('');
say('Repair the UAT deployment: workflow names, and the rollback artifacts');
say('='.repeat(78));
say(DRY ? '  MODE: DRY RUN' : '  MODE: LIVE');
say('');

let failed = false;
for (const t of TARGETS) {
  const live = await api('GET', '/workflows/' + t.id);
  const artifactPath = join(OUT_DIR, t.id + '.before.json');
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));

  say(t.id);
  say('  name now      : ' + live.name);
  say('  name wanted   : ' + t.name);
  say('  live settings : ' + JSON.stringify(live.settings || {}));
  say('  artifact settings: ' + JSON.stringify(artifact.settings || {}));

  // The settings the artifact SHOULD carry are the ones live now — the deploy preserved them, only
  // the artifact lost them.
  const repairedArtifact = {
    name: t.name,
    nodes: artifact.nodes,
    connections: artifact.connections,
    settings: JSON.parse(JSON.stringify(live.settings || {}))
  };

  if (!repairedArtifact.nodes || !repairedArtifact.nodes.length) { die(t.id + ': the artifact has no nodes — do not overwrite it'); }
  if (!repairedArtifact.settings.errorWorkflow) {
    bad(t.id + ': the live settings carry no errorWorkflow; a restore would still lose error reporting');
    failed = true;
  }

  if (!DRY) {
    writeFileSync(artifactPath, JSON.stringify(repairedArtifact, null, 2) + '\n', 'utf8');
    ok('rollback artifact rewritten with real settings (' + repairedArtifact.nodes.length + ' nodes)');

    if (live.name !== t.name) {
      await api('PUT', '/workflows/' + t.id, {
        name: t.name, nodes: live.nodes, connections: live.connections, settings: live.settings || {}
      }, 3);
      const after = await api('GET', '/workflows/' + t.id);
      if (after.name === t.name) { ok('name restored: ' + after.name); }
      else { bad('name NOT restored, still: ' + after.name); failed = true; }
      if (after.nodes.length !== live.nodes.length) { bad('node count changed during the rename'); failed = true; }
      else { ok('node count unchanged during the rename: ' + after.nodes.length); }
      if (JSON.stringify(after.settings) !== JSON.stringify(live.settings)) { bad('settings changed during the rename'); failed = true; }
      else { ok('settings unchanged during the rename'); }
      if (!after.active) { bad('the workflow is no longer active'); failed = true; }
      else { ok('still active'); }
    } else { ok('name already correct'); }
  }
  say('');
}

if (DRY) { say('DRY RUN — nothing written.'); }
else { say(failed ? '  REPAIR = FAIL' : '  REPAIR = PASS'); }
say('');
if (failed) { process.exitCode = 1; }
