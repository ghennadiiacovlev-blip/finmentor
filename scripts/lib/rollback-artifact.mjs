// FINMENTOR — the rollback artefact is written ONCE.
//
// A deploy script captures the live workflow before it changes anything. Re-running the same
// script after the deploy (a second --confirm, a --dry-run for the record) must NOT overwrite
// that capture with the already-changed state, or the only rollback becomes a copy of what is
// live. Verified the hard way on 2026-09-03: a repeated Concierge confirm refused correctly but
// had already replaced the 57-node pre-upgrade capture with the 58-node upgraded one.
//
// Rule: if the artefact exists and differs from the fresh read, keep it and write the fresh
// read next to it under a timestamped name. Pure file logic; the caller reports.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export function keepRollback(path, body) {
  if (existsSync(path)) {
    const prior = readFileSync(path, 'utf8');
    if (prior !== body) {
      const aside = path.replace(/\.json$/, '') + '.live-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
      writeFileSync(aside, body, 'utf8');
      return { path, written: false, aside };
    }
    return { path, written: false, aside: null };
  }
  writeFileSync(path, body, 'utf8');
  return { path, written: true, aside: null };
}
