#!/usr/bin/env node
// FINMENTOR — P7.5R §1: classify every tracked workflow artifact.
//
//   node scripts/build-artifact-classification.mjs
//
// REPO-ONLY. Scans every tracked workflow JSON and writes a machine-readable classification to
// n8n/artifact-classification.json. Prose said "not import-safe" in three documents and it did
// not stop a deployment; this file is the same statement in a form a build can act on.
//
// THE POLICY, stated once.
//
//   NO TRACKED ARTIFACT IS PRODUCTION-DEPLOYABLE. Not the redacted ones, and not the clean ones
//   either. A production deploy is materialized ephemerally from the live workflow by
//   n8n/src/deploy-guard/materializer.js and never read off disk.
//
// That is stronger than "redacted artifacts are not deployable", and deliberately so. The P7.5
// defect was not that someone deployed a file marked unsafe — it was that a file nobody had
// marked at all turned out to be unsafe for a reason no gate was looking for. Narrowing the ban
// to "the ones we know are bad" reproduces exactly that failure mode.
//
// CLASSES
//
//   REDACTED_REFERENCE_ONLY  carries at least one redaction marker. Review and audit only. It
//                            describes production; it cannot become production.
//   REVIEW_REFERENCE         no markers, but still a tracked file. Reviewable and diffable;
//                            not a deploy source.
//   INSTRUMENT               a disposable harness/tool created in the tenant for a phase and
//                            archived afterwards. Deployable AS A DISPOSABLE, never over a
//                            production workflow.
//
// Historical evidence is never deleted. A redacted export is exactly the right thing to keep in
// git — it is the audit baseline the materializer compares the live workflow against.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const R = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'redactor.js'));

const OUT = join(ROOT, 'n8n', 'artifact-classification.json');

// Files whose name marks them as a disposable instrument rather than a production reference.
const INSTRUMENT_RE = /(HARNESS|harness|state-tool|cleanup-child|column-audit|p7\d)/;

function collect(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(join(ROOT, dir), { withFileTypes: true }); } catch (e) { return out; }
  entries.forEach((e) => {
    if (e.isFile() && e.name.endsWith('.json') && e.name !== 'manifest.json') {
      out.push(join(dir, e.name).split('\\').join('/'));
    }
  });
  return out;
}

// n8n/history/ is scanned on the same terms as the other two. A frozen phase input is still
// a tracked workflow JSON, and "no tracked artifact is production-deployable" has to mean every
// tracked artifact -- narrowing the scan to the directories we currently worry about is how the
// P7.5 defect happened in the first place.
const files = collect('n8n/production').concat(collect('n8n/candidate')).concat(collect('n8n/history')).sort();

const artifacts = files.map((rel) => {
  const raw = readFileSync(join(ROOT, rel), 'utf8');
  let doc = null;
  try { doc = JSON.parse(raw); } catch (e) { doc = null; }
  const markers = doc ? R.findMarkers(doc) : [];
  const base = rel.split('/').pop();

  let cls;
  if (markers.length) { cls = 'REDACTED_REFERENCE_ONLY'; }
  else if (INSTRUMENT_RE.test(base)) { cls = 'INSTRUMENT'; }
  else { cls = 'REVIEW_REFERENCE'; }

  return {
    path: rel,
    class: cls,
    // The single field a deploy script must read. It is false for every tracked artifact.
    deployable_to_production: false,
    // An instrument may be created in the tenant as a disposable of its own.
    deployable_as_disposable: cls === 'INSTRUMENT',
    redaction_markers: markers.map((m) => ({ marker: m.marker, count: m.count })),
    marker_total: markers.reduce((n, m) => n + m.count, 0),
    marked_nodes: doc && markers.length ? R.markedNodes(doc) : [],
    sha256: createHash('sha256').update(raw, 'utf8').digest('hex'),
    nodes: doc && Array.isArray(doc.nodes) ? doc.nodes.length : null
  };
});

const manifest = {
  _policy: [
    'NO TRACKED ARTIFACT IS PRODUCTION-DEPLOYABLE.',
    'A production deploy is materialized ephemerally from the live workflow by',
    'n8n/src/deploy-guard/materializer.js and is never read off disk.',
    'REDACTED_REFERENCE_ONLY artifacts describe production; they cannot become production.',
    'Historical evidence is kept, never deleted -- the redacted export is the audit baseline',
    'the materializer compares the live workflow against.'
  ],
  generated_by: 'scripts/build-artifact-classification.mjs',
  classes: {
    REDACTED_REFERENCE_ONLY: 'carries a redaction marker; review/audit only',
    REVIEW_REFERENCE: 'no markers, still not a deploy source',
    INSTRUMENT: 'disposable harness/tool; deployable as its own disposable workflow only'
  },
  counts: {
    total: artifacts.length,
    REDACTED_REFERENCE_ONLY: artifacts.filter((a) => a.class === 'REDACTED_REFERENCE_ONLY').length,
    REVIEW_REFERENCE: artifacts.filter((a) => a.class === 'REVIEW_REFERENCE').length,
    INSTRUMENT: artifacts.filter((a) => a.class === 'INSTRUMENT').length,
    production_deployable: artifacts.filter((a) => a.deployable_to_production).length
  },
  artifacts: artifacts
};

writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log('artifact classification: n8n/artifact-classification.json');
console.log('  total artifacts            : ' + manifest.counts.total);
console.log('  REDACTED_REFERENCE_ONLY    : ' + manifest.counts.REDACTED_REFERENCE_ONLY);
console.log('  REVIEW_REFERENCE           : ' + manifest.counts.REVIEW_REFERENCE);
console.log('  INSTRUMENT                 : ' + manifest.counts.INSTRUMENT);
console.log('  production-deployable      : ' + manifest.counts.production_deployable + '  (must be 0)');
console.log('');
artifacts.filter((a) => a.marker_total > 0).forEach((a) => {
  console.log('  ' + String(a.marker_total).padStart(3) + ' markers  ' + a.path);
});
if (manifest.counts.production_deployable !== 0) {
  console.error('REFUSING: an artifact claims to be production-deployable');
  process.exit(1);
}
