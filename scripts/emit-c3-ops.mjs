#!/usr/bin/env node
// FINMENTOR — emit the connector operation list for one C3 deploy, from the dry-run artefacts.
//
//   node scripts/emit-c3-ops.mjs <workflowId> <pre.json> <candidate.json> [out.json]
//
// Pure: reads the rollback artefact and the verified candidate the dry-run wrote, computes the
// delta with scripts/lib/n8n-ops.mjs, proves that applying the delta to the rollback artefact
// reproduces the candidate behaviour, and writes the operation list. Nothing is sent from here.

import { readFileSync, writeFileSync } from 'node:fs';
import { diffToOps, applyOps, sameBehaviour } from './lib/n8n-ops.mjs';

const [id, preFile, candFile, outFile] = process.argv.slice(2);
if (!id || !preFile || !candFile) { console.error('usage: emit-c3-ops.mjs <workflowId> <pre.json> <candidate.json> [out.json]'); process.exitCode = 2; }
else {
  const pre = JSON.parse(readFileSync(preFile, 'utf8'));
  const cand = JSON.parse(readFileSync(candFile, 'utf8'));
  const { ops, refusals } = diffToOps(pre, cand);
  if (refusals.length) { console.error('REFUSED: ' + refusals.join(' | ')); process.exitCode = 1; }
  else {
    const simulated = applyOps(pre, ops);
    const f = sameBehaviour(simulated, cand);
    if (f.length) { console.error('the delta does not reproduce the candidate: ' + f.join(' | ')); process.exitCode = 1; }
    else {
      const counts = {};
      for (const o of ops) { counts[o.type] = (counts[o.type] || 0) + 1; }
      console.log(id + ': ' + ops.length + ' operations — ' + Object.entries(counts).map(([k, v]) => k + ' ' + v).join(', '));
      if (outFile) { writeFileSync(outFile, JSON.stringify({ workflowId: id, operations: ops }, null, 2) + '\n', 'utf8'); console.log('wrote ' + outFile); }
    }
  }
}
