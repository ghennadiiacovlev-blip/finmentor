// FINMENTOR — the Bot_Sessions write-key guard.
//
// WHY THIS EXISTS, AND WHY IT IS NOT THEORETICAL.
//
// `Save Bot Session` writes with `autoMapInputData` matched on `chat_id`. P7.1 proved (finding
// F16) that this mapping does NOT drop a key with no matching header — it APPENDS A NEW COLUMN
// for it. A single stray property on the object handed to that node permanently widens the live
// CRM sheet, and nothing ever removes it again.
//
// P7.2 knew this and defended against it: the three row builders emit a declared `COLS`
// whitelist and nothing else, and the issuer's decision fields are `__`-prefixed precisely so
// that a reader can see at a glance they were never candidates for that list.
//
// AND THEN P7.4 DID IT ANYWAY. The P7.4 synthetic state tool's `Tool Plan` node returned:
//
//     return [{ json: Object.assign({ __do_write: true, __mode: mode, __before: ... }, row) }];
//
// straight into a node carrying `Save Bot Session`'s parameters. P7.5 measured the live header
// row and found three new trailing columns — BF `__do_write`, BG `__mode`, BH `__before` — on
// top of the six AZ:BE that P7.1b had already catalogued. The instrumentation built to prove the
// system was safe widened the sheet in exactly the way the system was being proven safe against.
//
// The defence was a convention. Conventions are not enforced. This module is the enforcement.
//
// THE RULE, in two parts, both checkable from the artifacts alone:
//
//   1. Every Bot_Sessions write node using `autoMapInputData` must be fed by a node named in
//      DECLARED_ROW_BUILDERS. A writer fed by anything else is emitting an object nobody
//      declared, which is the P7.4 defect exactly.
//
//   2. Every declared row builder must carry an explicit `COLS` whitelist, and that whitelist
//      must contain no `__`-prefixed key. `__` is the project's marker for "decision metadata,
//      never a sheet column", so a `__` key inside COLS is a contradiction in terms.
//
// WHAT THIS DOES NOT CLAIM. It does not prove a Code body cannot construct a stray key by some
// other route — that would need to execute it. It closes the shape that has actually gone wrong
// twice, and it fails loudly on any writer whose feeder was never reviewed.

'use strict';

const SHEETS_TYPE = 'n8n-nodes-base.googleSheets';
const CODE_TYPE = 'n8n-nodes-base.code';
const BOT_SESSIONS = 'Bot_Sessions';
const WRITE_OPERATIONS = ['append', 'update', 'appendOrUpdate'];

// The only nodes permitted to feed a Bot_Sessions autoMapInputData writer. Each emits a declared
// COLS whitelist and nothing else.
const DECLARED_ROW_BUILDERS = [
  'Build Session Row',
  'Build Intake State Row',
  'Build Confirmation State Row'
];

// The intended production tail, measured live by P7.5. Everything after AY is residue.
const INTENDED_TAIL = ['submission_key', 'lead_mode', 'lead_priority', 'financial_zone'];

// The dead trailing columns on the live sheet, in physical order, as measured 2026-08-27.
// Six from P7.1b plus three this project added at P7.4. Recorded so the count cannot quietly
// grow again without someone editing this list.
const KNOWN_DEAD_TRAILING = [
  'key', '__rows_seen', '__advance', '__reason', '__verified_submission_key',
  'p71_absent_column', '__do_write', '__mode', '__before'
];

function nodesOfType(wf, t) { return (wf.nodes || []).filter((n) => n && n.type === t); }

function sheetNameOf(node) {
  const s = (node.parameters || {}).sheetName;
  if (!s) { return ''; }
  return String(s.cachedResultName || s.value || '');
}

// Who feeds `target`? Returns every source node name with an edge into it.
function feedersOf(wf, target) {
  const out = [];
  Object.keys(wf.connections || {}).forEach((src) => {
    ((wf.connections[src] || {}).main || []).forEach((branch) => {
      (branch || []).forEach((l) => { if (l && l.node === target && out.indexOf(src) === -1) { out.push(src); } });
    });
  });
  return out;
}

// Extracts a Code node's declared COLS whitelist, if it has one.
function declaredCols(node) {
  const code = ((node || {}).parameters || {}).jsCode || '';
  const m = code.match(/COLS\s*=\s*\[([^\]]*)\]/);
  if (!m) { return null; }
  return m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

// Evaluates one workflow artifact.
function evaluateBotSessionsWrites(wf, opts) {
  const o = opts || {};
  const label = o.label || '(artifact)';
  const failures = [];
  const notes = [];
  const fail = (m) => failures.push(label + ': ' + m);

  const writers = nodesOfType(wf, SHEETS_TYPE).filter((n) => {
    const p = n.parameters || {};
    return sheetNameOf(n) === BOT_SESSIONS && WRITE_OPERATIONS.indexOf(String(p.operation || '')) !== -1;
  });

  if (writers.length === 0) { notes.push(label + ': no Bot_Sessions writers'); }

  writers.forEach((w) => {
    const mapping = (((w.parameters || {}).columns) || {}).mappingMode;
    if (mapping !== 'autoMapInputData') {
      notes.push(label + ': ' + w.name + ' does not use autoMapInputData (' + mapping + ')');
      return;
    }
    const feeders = feedersOf(wf, w.name);
    if (feeders.length === 0) {
      fail('Bot_Sessions writer ' + JSON.stringify(w.name) + ' has no feeder; its input cannot be reviewed');
      return;
    }
    feeders.forEach((f) => {
      if (DECLARED_ROW_BUILDERS.indexOf(f) === -1) {
        fail('Bot_Sessions writer ' + JSON.stringify(w.name) + ' is fed by ' + JSON.stringify(f)
          + ', which is not a declared row builder. autoMapInputData APPENDS A NEW COLUMN for any '
          + 'unrecognised key (F16), so an undeclared feeder can permanently widen the live sheet.');
      }
    });
  });

  // Every declared row builder present in the artifact must have a clean COLS whitelist.
  DECLARED_ROW_BUILDERS.forEach((name) => {
    const n = (wf.nodes || []).find((x) => x && x.name === name);
    if (!n) { return; }
    if (n.type !== CODE_TYPE) { fail('declared row builder ' + JSON.stringify(name) + ' is not a Code node'); return; }
    const cols = declaredCols(n);
    if (!cols) {
      fail('declared row builder ' + JSON.stringify(name) + ' has no COLS whitelist; it emits an undeclared object');
      return;
    }
    const dunder = cols.filter((c) => c.indexOf('__') === 0);
    if (dunder.length) {
      fail('declared row builder ' + JSON.stringify(name) + ' lists __-prefixed key(s) in COLS: '
        + dunder.join(', ') + ' -- those are decision metadata, never sheet columns');
    }
    const dead = cols.filter((c) => KNOWN_DEAD_TRAILING.indexOf(c) !== -1);
    if (dead.length) {
      fail('declared row builder ' + JSON.stringify(name) + ' would write known-dead column(s): ' + dead.join(', '));
    }
  });

  return { ok: failures.length === 0, failures: failures, notes: notes, writerCount: writers.length };
}

module.exports = {
  SHEETS_TYPE,
  CODE_TYPE,
  BOT_SESSIONS,
  WRITE_OPERATIONS,
  DECLARED_ROW_BUILDERS,
  INTENDED_TAIL,
  KNOWN_DEAD_TRAILING,
  sheetNameOf,
  feedersOf,
  declaredCols,
  evaluateBotSessionsWrites
};
