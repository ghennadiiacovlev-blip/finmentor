#!/usr/bin/env node
// FINMENTOR — build the SYNTHETIC execution that rehearses the confirming-tap verifier.
//
//   node scripts/build-ack-tap-rehearsal.mjs
//   node scripts/build-ack-tap-rehearsal.mjs --source 5055 --out .uat/REHEARSAL-NOT-EVIDENCE-ack-tap.json
//
// READ-ONLY against the tenant. One GET, no write.
//
// ── WHAT THIS IS FOR, AND WHAT IT IS NOT ──────────────────────────────────────────────────────
//
// `scripts/verify-lead-alert-ack-tap-live.mjs` runs once, on a tap the owner has to perform on a
// real lead. A verifier that has never executed its own assertions is not worth the tap. This
// builds the one input that lets it rehearse: execution 5055 — the real, failed docs tap — with
// exactly three changes, each of which is precisely what the fix changed:
//
//   1. `startedAt` moved past the ack fix, so the verifier accepts it as a post-fix run;
//   2. `status` set to success, because the only failing node is the one that is now fixed;
//   3. `Telegram Update Reply` given the DEPLOYED expression, and the run output it would then
//      have produced — the Telegram Message the owner never received.
//
// Everything else is 5055's own data, untouched: the identity, the parse, the pre-image, the
// projection, the write, the read-back, the verification, the Switch branch counts and the edit.
//
// Item 3 is FABRICATED. There is no way around that — the whole finding is that the message was
// never sent — so it is fabricated in the narrowest possible way: the text and entities are
// derived from 5055's own `reply_text` through the same emulator the offline gate uses, and the
// file is stamped `_rehearsal: true`, named so it cannot be misread, and refused by the verifier
// unless that stamp is present.
//
// `--negative` builds the control: execution 5055 with ONLY `startedAt` moved, so the pre-fix
// expression and the real empty-text failure are kept verbatim. The verifier must fail on it, and
// must fail naming this defect — a gate that cannot fail on the graph that actually broke is not
// evidence. Run both, always.
//
// NOTHING THIS PRODUCES IS EVIDENCE. It cannot close the finding and the verifier will not let it
// try: a rehearsal run writes no record and always exits non-zero.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');
const require_ = createRequire(import.meta.url);

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.N8N_API_KEY;

const argv = process.argv.slice(2);
const arg = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const SOURCE = arg('--source', '5055');
// The negative control. Same synthetic run, with the fix NOT applied: the pre-fix expression and
// the empty acknowledgement 5055 actually produced. A verifier that cannot fail on the graph that
// actually broke is not evidence, so the rehearsal is run both ways.
const NEGATIVE = argv.includes('--negative');
const OUT = arg('--out', join(OUT_DIR, 'REHEARSAL-NOT-EVIDENCE-ack-tap'
  + (NEGATIVE ? '-negative' : '') + '.json'));

// The deployed expression, byte for byte as the tenant holds it.
const FIXED_EXPR = "={{ $json.error ? $('Find & Build Update').first().json.reply_text_presentation_failed "
  + ": $('Find & Build Update').first().json.reply_text }}";
const AFTER_FIX = '2026-08-31T15:30:00.000Z';

const { toTelegram } = require_(join(ROOT, 'qa', 'telegram-emulator.js'));

const say = (m) => console.log(m);
const die = (m) => { console.error('STOPPED: ' + m); process.exitCode = 1; };

MAIN: try {
  if (!BASE || !KEY) { die('set N8N_BASE_URL and N8N_API_KEY'); break MAIN; }

  say('');
  say('REHEARSAL INPUT — execution ' + SOURCE + (NEGATIVE ? ', with the fix WITHHELD (negative control)' : ', with the fix applied'));
  say('='.repeat(78));

  const r = await fetch(BASE + '/api/v1/executions/' + SOURCE + '?includeData=true', {
    headers: { 'X-N8N-API-KEY': KEY }
  });
  if (!r.ok) { die('GET /executions/' + SOURCE + ' -> ' + r.status); break MAIN; }
  const EX = await r.json();

  const RD = ((EX.data || {}).resultData || {}).runData || {};
  const outOf = (n) => ((((((RD[n] || [])[0] || {}).data) || {}).main || []).find((b) => (b || []).length) || []).map((x) => x.json);

  const IDENT = outOf('Verify Telegram Identity')[0] || {};
  const DECIDED = outOf('Find & Build Update')[0] || {};
  if (!DECIDED.reply_text) { die('execution ' + SOURCE + ' carries no reply_text to rehearse with'); break MAIN; }

  // 1 + 2 — the two facts the fix changes about the run as a whole. In NEGATIVE mode only the
  // timestamp moves: everything else stays exactly as 5055 was, so the file IS the broken run,
  // merely dated past the fix. That is the strongest negative control available — nothing about
  // the failure is synthesised.
  EX.startedAt = AFTER_FIX;
  if (!NEGATIVE) {
    EX.stoppedAt = AFTER_FIX;
    EX.status = 'success';
    delete (EX.data || {}).resultData?.error;
  }

  // 3a — the node parameter, as deployed.
  const node = (EX.workflowData.nodes || []).find((n) => n.name === 'Telegram Update Reply');
  if (!node) { die('no Telegram Update Reply node on the execution snapshot'); break MAIN; }
  const wasExpr = String(node.parameters.text || '');
  if (!NEGATIVE) { node.parameters.text = FIXED_EXPR; }

  // 3b — the Message Telegram would have returned. Text and entities come from the execution's
  // OWN reply_text through the emulator the offline gate uses, so the rehearsal exercises the
  // entity round-trip against the real copy rather than against a placeholder.
  const { text, entities } = NEGATIVE ? { text: '', entities: [] } : toTelegram(String(DECIDED.reply_text));
  const editRun = Object.keys(RD).find((n) => n.startsWith('Edit Alert ('));
  const editStart = ((RD[editRun] || [])[0] || {}).startTime || Date.now();
  if (!NEGATIVE) RD['Telegram Update Reply'] = [{
    startTime: editStart + 400,
    executionTime: 380,
    executionStatus: 'success',
    source: [{ previousNode: editRun }],
    data: {
      main: [[{
        json: {
          ok: true,
          result: {
            message_id: 146,
            from: { id: 0, is_bot: true },
            chat: { id: IDENT.verified_chat_id, type: 'private' },
            date: Math.floor(new Date(AFTER_FIX).getTime() / 1000),
            text: text,
            entities: entities
          }
        }
      }]]
    }
  }];

  EX._rehearsal = true;
  EX._rehearsal_negative = NEGATIVE;
  EX._rehearsal_note = NEGATIVE
    ? 'SYNTHETIC. Execution ' + SOURCE + ' with ONLY startedAt moved past the ack fix. The '
      + 'failure is real and unmodified. Not evidence — a negative control for the verifier.'
    : 'SYNTHETIC. Built by scripts/build-ack-tap-rehearsal.mjs from execution '
      + SOURCE + '. Not evidence. The Telegram Update Reply run output did not happen.';
  EX._rehearsal_source_execution = SOURCE;
  EX._rehearsal_expression_before = wasExpr;

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(EX, null, 2) + '\n', 'utf8');

  say('');
  say('  mode                  ' + (NEGATIVE ? 'NEGATIVE CONTROL — the fix is NOT applied' : 'the fix applied'));
  say('  source execution      ' + SOURCE);
  say('  expression BEFORE     ' + wasExpr.slice(0, 100));
  say('  expression AFTER      ' + String(node.parameters.text || '').slice(0, 100));
  say('  synthesised reply     ' + (NEGATIVE ? 'NONE — 5055\'s own failed node is kept verbatim'
    : text.length + ' chars, ' + entities.length + ' entities, message_id 146'));
  say('  stamped               _rehearsal: true');
  say('');
  say('  wrote ' + OUT);
  say('');
  say('  Rehearse with:');
  say('    node scripts/verify-lead-alert-ack-tap-live.mjs --rehearse ' + OUT.replace(ROOT + '\\', '').replace(ROOT + '/', ''));
  say('');
} catch (e) {
  console.error('STOPPED: ' + e.message);
  process.exitCode = 1;
}
