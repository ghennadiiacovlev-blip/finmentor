#!/usr/bin/env node
// FINMENTOR — n8n export hygiene and drift gate (INDP3-04).
//
// Two jobs, both offline so they run in CI without n8n credentials:
//   1. no secret or personal identifier may ever enter n8n/production/
//   2. the manifest must stay internally consistent with the exports beside it
//
// Live drift (repo vs tenant) is checked by re-running
// scripts/export-n8n-production.ps1 and diffing; this gate guards the committed state.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, '..', 'n8n', 'production');

let pass = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log('  PASS  ' + name);
  } catch (e) {
    failures.push(name + ': ' + e.message);
    console.log('  FAIL  ' + name + ' -> ' + e.message);
  }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
const exports_ = files.filter((f) => f !== 'manifest.json');
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));

console.log('\nFINMENTOR n8n export hygiene\n');
console.log('NO SECRETS OR IDENTIFIERS IN THE REPOSITORY');

// Canonical sheet gids are configuration and must survive redaction. Everything else of
// that shape inside a quoted literal is treated as a potential Telegram identity.
const CANONICAL_GIDS = new Set(['1871239368', '409890193', '936189533', '1883973304',
  '962064347', '623316892', '1810362432', '1651979710', '532676168', '1289462207',
  '1584265787', '1612014214', '1997367085']);

const SECRET_PATTERNS = [
  ['telegram bot token', /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/],
  ['openai api key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['google api key', /\bAIza[A-Za-z0-9_-]{30,}\b/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['n8n api key (jwt)', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/]
];

for (const f of files) {
  const s = readFileSync(join(DIR, f), 'utf8');
  for (const [label, re] of SECRET_PATTERNS) {
    check(`${f}: no ${label}`, () => {
      assert(!re.test(s), `${label} pattern present`);
    });
  }
  check(`${f}: no unredacted Telegram identity literal`, () => {
    const found = [];
    for (const m of s.match(/\\?["'](\d{6,12})\\?["']/g) || []) {
      const digits = m.replace(/[\\"']/g, '');
      if (!CANONICAL_GIDS.has(digits)) found.push(digits.slice(0, 3) + '***');
    }
    assert(found.length === 0, found.length + ' candidate identity literal(s): ' + [...new Set(found)].join(', '));
  });
}

check('exports actually contain the redaction marker', () => {
  const total = files.reduce((n, f) => n + (readFileSync(join(DIR, f), 'utf8').match(/REDACTED_/g) || []).length, 0);
  assert(total > 0, 'no redaction markers found — redaction may not have run');
});

console.log('\nMANIFEST CONSISTENCY');

check('manifest lists every exported file, and every export is listed', () => {
  const listed = new Set(manifest.workflows.map((w) => w.export));
  const onDisk = new Set(exports_);
  const missing = [...onDisk].filter((f) => !listed.has(f));
  const extra = [...listed].filter((f) => !onDisk.has(f));
  assert(missing.length === 0, 'export not in manifest: ' + missing.join(', '));
  assert(extra.length === 0, 'manifest references a missing export: ' + extra.join(', '));
});

check('every entry records id, name, active, hash and updatedAt', () => {
  for (const w of manifest.workflows) {
    for (const field of ['id', 'name', 'active', 'structuralHash', 'updatedAt', 'nodeCount']) {
      assert(w[field] !== undefined && w[field] !== '', `${w.id || '?'}: missing ${field}`);
    }
    assert(/^[0-9a-f]{64}$/.test(w.structuralHash), `${w.id}: structuralHash is not a sha256`);
  }
});

// THE DRIFT THIS FILE IS NAMED FOR, AND DID NOT CHECK.
//
// Sealing the P7.5R baseline advanced the Concierge export from 33 nodes to 45 and the manifest
// went on saying 33, beside it, silently — every check here was about the manifest's internal
// consistency, none about whether it agreed with the files it describes. `nodeCount` and
// `nodeTypes` are both derivable from the export, so this costs nothing and is the one pair that
// cannot be verified by reading the manifest alone.
check('every entry agrees with the export beside it on nodeCount and nodeTypes', () => {
  for (const w of manifest.workflows) {
    const wf = JSON.parse(readFileSync(join(DIR, w.export), 'utf8'));
    const nodes = wf.nodes || [];
    assert(nodes.length === w.nodeCount,
      `${w.id}: manifest says ${w.nodeCount} nodes, ${w.export} has ${nodes.length}`);
    const onDisk = [...new Set(nodes.map((n) => n.type))].sort();
    const listed = [...(w.nodeTypes || [])].sort();
    assert(JSON.stringify(onDisk) === JSON.stringify(listed),
      `${w.id}: nodeTypes drifted — manifest ${listed.join(',')} vs export ${onDisk.join(',')}`);
  }
});

// structuralHash is deliberately NOT recomputed here, and that is a finding rather than a gap:
// it fingerprints the LIVE workflow as the exporter read it from the API, then the file written
// beside it is REDACTED. So the value can never equal a hash of the tracked artifact — checked,
// and it differs for all nine entries, not only the changed one. It is a live-drift fingerprint,
// refreshable only by scripts/export-n8n-production.ps1 against the tenant.
//
// Which leaves one thing that IS checkable offline: an entry whose workflow was updated after
// the manifest run must say so, rather than presenting a pre-update fingerprint as current.
check('an entry updated after the manifest run declares its structuralHash stale', () => {
  const runAt = Date.parse(manifest.generatedAt);
  assert(!isNaN(runAt), 'the manifest carries no parseable generatedAt');
  for (const w of manifest.workflows) {
    const updated = Date.parse(w.updatedAt);
    if (isNaN(updated) || updated <= runAt) { continue; }
    assert(typeof w.structuralHashStale === 'string' && w.structuralHashStale.length > 40,
      `${w.id}: updated ${w.updatedAt}, after the manifest run at ${manifest.generatedAt}, `
      + 'but its structuralHash is presented as current. Declare structuralHashStale with the reason.');
  }
});

check('structural hashes are unique per workflow', () => {
  const seen = new Map();
  for (const w of manifest.workflows) {
    if (seen.has(w.structuralHash)) {
      throw new Error(`${w.id} and ${seen.get(w.structuralHash)} share a structural hash`);
    }
    seen.set(w.structuralHash, w.id);
  }
});

check('credential references are names only, never values', () => {
  for (const w of manifest.workflows) {
    for (const c of w.credentialNames || []) {
      assert(typeof c === 'string' && c.length < 120, `${w.id}: suspicious credential entry`);
      assert(!/\d{8,}:[A-Za-z0-9_-]{20,}/.test(c), `${w.id}: credential entry looks like a token`);
    }
  }
});

check('every active workflow in the manifest is exported', () => {
  const active = manifest.workflows.filter((w) => w.active);
  assert(active.length > 0, 'no active workflows recorded');
  assert(active.length === manifest.activeWorkflows,
    `manifest records ${manifest.activeWorkflows} active on the tenant but exported ${active.length}`);
});

check('tracked inactive workflows carry a documented reason', () => {
  for (const w of manifest.workflows.filter((x) => !x.active)) {
    assert(w.trackedReason && w.trackedReason.length > 10,
      `${w.id} is inactive but has no trackedReason`);
  }
});

console.log('\nP0 ROLLBACK POINT IS PRESERVED');

check('the unsafe Command Center is exported and recorded inactive', () => {
  const w = manifest.workflows.find((x) => x.id === 'Ukn1cprWiXzBHojl');
  assert(w, 'unsafe Command Center missing from the manifest');
  assert(w.active === false, 'the unsafe Command Center is recorded ACTIVE — containment regressed');
});

check('the secure candidate is exported and has no generic webhook entry', () => {
  const w = manifest.workflows.find((x) => x.id === 'qF9tonlHHIxc8MDd');
  assert(w, 'secure candidate missing from the manifest');
  assert(!w.nodeTypes.includes('n8n-nodes-base.webhook'), 'secure candidate still has a generic webhook entry');
  assert(w.nodeTypes.includes('n8n-nodes-base.telegramTrigger'), 'secure candidate has no Telegram Trigger');
});

check('no exported workflow still uses the stale spreadsheet', () => {
  const bad = [];
  for (const f of exports_) {
    const s = readFileSync(join(DIR, f), 'utf8');
    // The retained P0 rollback copy is deliberately unmodified.
    if (f.startsWith('Ukn1cprWiXzBHojl.')) continue;
    if (s.includes('16Eepil')) bad.push(f);
  }
  assert(bad.length === 0, 'stale spreadsheet reference in: ' + bad.join(', '));
});

console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.error('\nN8N EXPORT GATE: FAIL');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('N8N EXPORT GATE: PASS');
