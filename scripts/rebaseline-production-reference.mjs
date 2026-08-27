#!/usr/bin/env node
// FINMENTOR — P7.5R: re-baseline a tracked redacted production reference onto the corrected
// redactor.
//
//   node scripts/rebaseline-production-reference.mjs <ephemeral-live.json> <tracked-reference.json>
//
// WHY A RE-BASELINE IS NEEDED AT ALL.
//
// The tracked references were produced by the OLD redactor, which replaced the value of any
// chat-id-named field regardless of what the value was — so `={{ $json.chat_id }}` became
// `<REDACTED_CHAT_ID>`. The corrected redactor preserves expressions. Every tracked reference is
// therefore stale with respect to R, and `R(L) == A` cannot hold until they are rebuilt.
//
// WHY THIS IS NOT A SILENT REBASELINE, which §4 forbids.
//
// The script does not simply overwrite A with R(L). It diffs old-A against R(L) on the
// safety-relevant surface and requires EVERY difference to be one of exactly two kinds:
//
//   EXPRESSION_RESTORED  old-A held a redaction marker; R(L) holds an n8n expression. This is
//                        the redactor fix landing, and nothing else.
//   METADATA             a declared non-executable field: version ids, timestamps, counters.
//
// Anything else is OTHER, and OTHER means production has genuinely drifted from what was
// reviewed. The script refuses and writes nothing.
//
// SECRETS. The live document is read from an ephemeral path outside the repository and is never
// written back out. Only its redaction is written. Nothing here prints a value from L.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const R = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'redactor.js'));
const M = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'materializer.js'));

const livePath = process.argv[2];
const refPath = process.argv[3];
const apply = process.argv.indexOf('--apply') !== -1;
if (!livePath || !refPath) {
  console.error('usage: node scripts/rebaseline-production-reference.mjs <live.json> <reference.json> [--apply]');
  process.exit(2);
}
if (livePath.replace(/\\/g, '/').indexOf(ROOT.replace(/\\/g, '/')) === 0) {
  console.error('REFUSING: the live export path is inside the repository. It must be ephemeral and outside.');
  process.exit(1);
}

const L = JSON.parse(readFileSync(livePath, 'utf8'));
const A = JSON.parse(readFileSync(refPath, 'utf8'));

if (R.hasMarkers(L)) {
  console.error('REFUSING: the supplied live export already contains redaction markers; it is not a live export.');
  process.exit(1);
}

const RL = R.redactWorkflow(L);

// --- classify every safety-relevant difference -------------------------------------------
const an = {}; (A.nodes || []).forEach((n) => { an[n.name] = n; });
const rn = {}; (RL.nodes || []).forEach((n) => { rn[n.name] = n; });

const restored = [];
const other = [];

// Walks two values in parallel and records every differing LEAF as either a sanctioned
// expression restoration or as drift.
//
// A sanctioned restoration is narrow on purpose: the OLD value must be exactly a redaction
// marker, and the NEW value must be an n8n expression. Marker -> concrete value, or
// expression -> different expression, are both drift.
function classifyLeaves(a, r, path) {
  if (JSON.stringify(a) === JSON.stringify(r)) { return; }

  const aObj = a !== null && typeof a === 'object';
  const rObj = r !== null && typeof r === 'object';

  if (aObj && rObj && Array.isArray(a) === Array.isArray(r)) {
    const keys = [...new Set(Object.keys(a).concat(Object.keys(r)))];
    keys.forEach((k) => classifyLeaves(a[k], r[k], path + '.' + k));
    return;
  }

  if (a === R.MARKER_CHAT && R.isExpression(r)) { restored.push(path); return; }
  other.push(path);
}

const names = [...new Set(Object.keys(an).concat(Object.keys(rn)))].sort();
names.forEach((name) => {
  const a = an[name];
  const r = rn[name];
  if (!a) { other.push('node live but not in the reference: ' + name); return; }
  if (!r) { other.push('node in the reference but not live: ' + name); return; }
  M.EXECUTABLE_FIELDS.forEach((k) => {
    if (JSON.stringify(a[k]) === JSON.stringify(r[k])) { return; }
    // Walk to the LEAVES rather than masking the serialized field. A whole-field mask replaced
    // every expression on both sides and made unrelated values look equal -- the first version
    // of this did exactly that and reported three parameter blocks as drift when only one leaf
    // differed. A leaf comparison says precisely which value changed and why.
    classifyLeaves(a[k], r[k], 'nodes[' + name + '].' + k);
  });
});

if (JSON.stringify(A.connections) !== JSON.stringify(RL.connections)) { other.push('connections'); }
if (JSON.stringify(A.settings) !== JSON.stringify(RL.settings)) { other.push('settings'); }
if (A.name !== RL.name) { other.push('name'); }

const sha = (v) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v), 'utf8').digest('hex');

console.log('re-baseline: ' + refPath.split(/[\\/]/).pop());
console.log('  live sha256            : ' + sha(L));
console.log('  live redacted sha256   : ' + sha(RL));
console.log('  tracked reference sha  : ' + sha(A));
console.log('  markers in old ref     : ' + R.findMarkers(A).map((m) => m.marker + ' x' + m.count).join(', '));
console.log('  markers in R(L)        : ' + (R.findMarkers(RL).map((m) => m.marker + ' x' + m.count).join(', ') || 'none'));
console.log('');
console.log('  EXPRESSION_RESTORED    : ' + restored.length);
restored.forEach((p) => console.log('     + ' + p));
console.log('  OTHER (drift)          : ' + other.length);
other.forEach((p) => console.log('     ! ' + p));

if (other.length) {
  console.error('\nREFUSING: production differs from the tracked reference by something other than the');
  console.error('redactor fix. That is genuine drift and must be reviewed, not rebaselined.');
  process.exit(1);
}
if (restored.length === 0) {
  console.log('\nNothing to do: the tracked reference already matches the corrected redactor.');
  process.exit(0);
}

if (!apply) {
  console.log('\nDRY RUN. Re-run with --apply to write the corrected reference.');
  process.exit(0);
}

writeFileSync(refPath, JSON.stringify(RL, null, 2) + '\n', 'utf8');
console.log('\n  written: ' + refPath.split(/[\\/]/).pop());
console.log('  new reference sha256   : ' + sha(RL));
console.log('  markers remaining      : ' + (R.findMarkers(RL).length || 0) + '  (concrete ids still redacted)');
