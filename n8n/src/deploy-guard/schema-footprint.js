// FINMENTOR — the sheet schema footprint guard.
//
// WHY THIS EXISTS.
//
// P7.4 wrote synthetic rows to the live Bot_Sessions sheet and cleaned up afterwards. The
// cleanup verified that its ROWS were gone — measured, not asserted, with a re-read. It passed,
// and it was wrong: the state tool's `Tool Plan` node had emitted `__do_write`, `__mode` and
// `__before` alongside the row, `Save Bot Session`'s autoMapInputData APPENDED A NEW COLUMN for
// each (finding F16), and three empty columns were left behind on a customer sheet.
//
// Row residue and SCHEMA residue are different things, and only one of them was being checked.
//
// AND THE OBVIOUS WAY TO CHECK IT DOES NOT WORK. The Google Sheets node returns each row as an
// object keyed by header and OMITS keys whose cell is empty. A column that is blank on every row
// is therefore INVISIBLE to any schema inferred from row objects. P7.5's first audit did exactly
// that and reported all six known-dead columns absent — the same class of non-evidence as "the
// node did not error".
//
// THE ONLY RELIABLE READ is the header row AS DATA (`headerRow: 1, firstDataRow: 1`). In that
// row every existing column carries its own NAME as its value, so nothing is empty and nothing
// can hide.
//
// THE RULE. Unless a phase explicitly authorises schema mutation, the footprint captured BEFORE
// live instrumentation runs must equal the footprint captured AFTER its cleanup — exactly. A new
// empty column is residue.

'use strict';

const { createHash } = require('crypto');

// Builds a footprint from the header row returned as data. `headerEcho` is the first item of a
// read configured with headerRow=1, firstDataRow=1; its KEYS are the sheet's real columns.
function footprintFromHeaderEcho(headerEcho) {
  const headers = Object.keys(headerEcho || {}).filter((k) => k !== 'row_number');
  return {
    count: headers.length,
    headers: headers,
    sha256: createHash('sha256').update(JSON.stringify(headers), 'utf8').digest('hex')
  };
}

// Rejects the unsafe shortcut explicitly rather than letting a caller reach for it. Inferring a
// schema from ordinary row objects silently drops every all-empty column, which is precisely the
// residue this guard exists to catch.
function footprintFromRows() {
  throw new Error(
    'REFUSING: a schema footprint cannot be inferred from row objects. The Sheets node omits '
    + 'keys for empty cells, so an all-empty column — exactly the residue this guard looks for — '
    + 'is invisible. Read the header row AS DATA (headerRow: 1, firstDataRow: 1).'
  );
}

// Compares a before/after pair.
//
//   opts.authorisedAdditions  column names this phase is allowed to add
//   opts.authorisedRemovals   column names this phase is allowed to remove
//
// Both default to empty: schema mutation is not authorised unless it is named.
function compareFootprint(before, after, opts) {
  const o = opts || {};
  const allowAdd = o.authorisedAdditions || [];
  const allowRemove = o.authorisedRemovals || [];
  const failures = [];

  if (!before || !after || !Array.isArray(before.headers) || !Array.isArray(after.headers)) {
    return { ok: false, failures: ['a footprint is missing or malformed'], added: [], removed: [] };
  }

  const added = after.headers.filter((h) => before.headers.indexOf(h) === -1);
  const removed = before.headers.filter((h) => after.headers.indexOf(h) === -1);

  added.forEach((h) => {
    if (allowAdd.indexOf(h) === -1) {
      failures.push('SCHEMA RESIDUE: column ' + JSON.stringify(h) + ' was added and not authorised. '
        + 'An empty column is still residue — it is invisible in row objects and permanent on the sheet.');
    }
  });
  removed.forEach((h) => {
    if (allowRemove.indexOf(h) === -1) {
      failures.push('SCHEMA LOSS: column ' + JSON.stringify(h) + ' disappeared and was not authorised.');
    }
  });

  if (added.length === 0 && removed.length === 0 && before.sha256 !== after.sha256) {
    failures.push('the header ORDER changed: same columns, different sequence');
  }

  return { ok: failures.length === 0, failures: failures, added: added, removed: removed };
}

module.exports = { footprintFromHeaderEcho, footprintFromRows, compareFootprint };
