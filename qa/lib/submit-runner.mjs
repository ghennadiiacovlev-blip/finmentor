// FINMENTOR — execute the Mini App submit endpoint, for real, offline.
//
// Walks the RESOLVED candidate graph node by node: Code nodes are executed as written, n8n
// expressions are evaluated as written, and the three side-effecting node types run against an
// in-memory world that behaves like the real one.
//
// ── WHY A RUNNER AND NOT A SET OF UNIT TESTS ───────────────────────────────────────────────────
//
// D3-D7 are not five properties of five nodes. They are one property of the whole path: ONE logical
// submission produces at most one privacy row, one Lead Intake commit and one Pipeline lead, no
// matter how many times it is attempted or where it is interrupted. That is only observable by
// running the path repeatedly against a world that remembers — so the world remembers.
//
// The world models the three things that make idempotency real, and nothing else:
//
//   · MiniApp_App_Sessions   one row per app_session_id, with the state machine on `state`
//   · privacy_acknowledgements   append-only, with a UNIQUE INDEX on submission_key, under a role
//     that holds INSERT and NOT SELECT — so a duplicate raises 23505 exactly as Postgres would
//   · Lead Intake             its own submission-key receipt: the same key returns the same lead

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

export function loadResolvedSubmit(M, opts) {
  const o = opts || {};
  const wf = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'premium-submit-endpoint-candidate.json'), 'utf8'));
  return M.resolveEndpoint(wf, {
    ownerId: o.ownerId || '551662084',
    releaseMode: o.releaseMode || 'OWNER_ONLY',
    leadIntakeId: o.leadIntakeId || 'QmIyEW2ZEqKregmN',
    privacyCredId: o.privacyCredId || 'PRIVACY_CRED'
  });
}

export function makeWorld(seed) {
  const s = seed || {};
  return {
    sessions: s.sessions ? JSON.parse(JSON.stringify(s.sessions)) : [],
    // Append-only, unique on submission_key. The endpoint cannot read it — its role holds INSERT
    // only — so nothing in the runner lets it.
    privacy: [],
    // Submission_Receipts, as it really is: an n8n Data Table with NO unique constraint and no
    // conditional insert. Two inserts of one key both succeed and neither errors, so this is an
    // ARRAY, not a map — a map would quietly enforce the uniqueness the store does not have and
    // the duplicate case could never be tested.
    receipts: s.receipts ? JSON.parse(JSON.stringify(s.receipts)) : [],
    // The Pipeline sheet: one row per committed lead, and never a second for the same key.
    pipeline: [],
    leadSeq: 0,
    calls: { privacyInsert: 0, intake: 0, sessionUpdate: 0, receiptInsert: 0, receiptRead: 0 },
    log: []
  };
}

// `faults` injects a controlled failure at one named node, once or always. This is the approved
// isolated failure mechanism: nothing here can touch a production store.
//   { node: 'Call Lead Intake', mode: 'throw' | 'not_ok', times: 1 }
function shouldFail(faults, name) {
  if (!faults || faults.node !== name) { return false; }
  if (faults.times === undefined) { return true; }
  if (faults.used === undefined) { faults.used = 0; }
  if (faults.used >= faults.times) { return false; }
  faults.used++;
  return true;
}

// n8n expression evaluation, on the real expression text.
function evalExpr(expr, ctx) {
  const body = String(expr).replace(/^=/, '');
  const parts = body.split(/\{\{([\s\S]*?)\}\}/);
  if (parts.length === 1) { return body; }
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) { out += parts[i]; continue; }
    // eslint-disable-next-line no-new-func
    const fn = new Function('$json', '$', '$now', 'return (' + parts[i] + ');');
    const v = fn(ctx.$json, ctx.$, { toISO: () => new Date().toISOString() });
    out += v === undefined || v === null ? '' : String(v);
  }
  return out;
}

// The failure envelope an n8n Postgres node actually produces. Reproduced from a live probe so
// that a classifier which reads only `error` fails here exactly as it failed in production.
function nodeFailure(message, description) {
  return {
    message: message,
    error: {
      level: 'warning', shouldReport: true, description: description,
      tags: {}, timestamp: 0, context: {}, functionality: 'regular',
      name: 'NodeOperationError', messages: []
    }
  };
}

export function runSubmit(wf, world, body, faults) {
  const byName = {};
  wf.nodes.forEach((n) => { byName[n.name] = n; });
  const outputs = {};                       // node name -> array of json items

  const handle = (items) => ({
    first: () => { if (!items.length) { throw new Error('first() on empty'); } return { json: items[0] }; },
    all: () => items.map((j) => ({ json: j })),
    isExecuted: true
  });
  const $ = (name) => {
    if (!Object.prototype.hasOwnProperty.call(outputs, name)) { throw new Error("$('" + name + "') has not executed"); }
    return handle(outputs[name]);
  };

  let cursor = 'Submit Webhook';
  outputs['Submit Webhook'] = [{ body: body, query: {}, headers: { 'content-type': 'application/json', origin: 'https://www.finmentor.md' } }];
  let input = outputs['Submit Webhook'];
  let response = null;
  let guard = 0;

  while (cursor && guard++ < 60) {
    const node = byName[cursor];
    if (!node) { throw new Error('unknown node ' + cursor); }
    const type = node.type.replace('n8n-nodes-base.', '');
    let branch = 0;

    if (type === 'webhook') {
      // seeded above
    } else if (type === 'code') {
      // eslint-disable-next-line no-new-func
      const fn = new Function('$', '$input', 'require', node.parameters.jsCode);
      const out = fn($, handle(input), (m) => {
        if (m === 'crypto') { return { createHash: (a) => nodeCrypto.createHash(a) }; }
        throw new Error('require(' + m + ') in a Code node');
      });
      outputs[cursor] = (out || []).map((i) => i.json);
      input = outputs[cursor];
    } else if (type === 'if') {
      const c = node.parameters.conditions.conditions[0];
      const left = evalExpr(c.leftValue, { $json: input[0], $ });
      branch = Number(left) === Number(c.rightValue) ? 0 : 1;
      outputs[cursor] = input;
    } else if (type === 'dataTable' && node.parameters.operation === 'get') {
      const table = node.parameters.dataTableId.value;
      const key = evalExpr(node.parameters.filters.conditions[0].keyValue, { $json: input[0], $ });
      let rows;
      if (shouldFail(faults, cursor)) {
        outputs[cursor] = [{ error: 'data table unavailable' }];
        input = outputs[cursor];
        rows = null;
      } else if (table === 'Submission_Receipts') {
        world.calls.receiptRead++;
        rows = world.receipts.filter((r) => String(r.submission_key) === String(key));
      } else {
        rows = world.sessions.filter((r) => String(r.app_session_id) === String(key));
      }
      if (rows !== null) {
        // alwaysOutputData is why a zero match arrives as ONE EMPTY ITEM rather than as no
        // item at all. Modelling that is the whole point: a verdict that discriminates by
        // truthiness instead of key count passes here and fails in production.
        outputs[cursor] = rows.length ? JSON.parse(JSON.stringify(rows))
          : (node.alwaysOutputData ? [{}] : []);
        input = outputs[cursor];
      }
    } else if (type === 'dataTable' && node.parameters.operation === 'insert') {
      world.calls.receiptInsert++;
      if (shouldFail(faults, cursor)) {
        outputs[cursor] = [{ error: 'data table unavailable' }];
      } else {
        const row = {};
        for (const [k, v] of Object.entries(node.parameters.columns.value)) {
          row[k] = typeof v === 'string' && v.startsWith('=') ? evalExpr(v, { $json: input[0], $ }) : v;
        }
        // NO UNIQUE CONSTRAINT. The store accepts a second row for the same key without
        // complaint — that is measured behaviour, and the reason the caller must read first.
        world.receipts.push(row);
        world.log.push('receipt.insert ' + row.submission_key + ' ' + row.commit_state);
        outputs[cursor] = [Object.assign({ id: world.receipts.length }, row)];
      }
      input = outputs[cursor];
    } else if (type === 'dataTable' && node.parameters.operation === 'update') {
      world.calls.sessionUpdate++;
      if (shouldFail(faults, cursor)) {
        outputs[cursor] = [{ error: 'data table unavailable' }];
        input = outputs[cursor];
        if (node.onError === 'continueErrorOutput') branch = 1;
      } else {
        const key = evalExpr(node.parameters.filters.conditions[0].keyValue, { $json: input[0], $ });
        const row = world.sessions.find((r) => String(r.app_session_id) === String(key));
        const patch = {};
        for (const [k, v] of Object.entries(node.parameters.columns.value)) {
          patch[k] = typeof v === 'string' && v.startsWith('=') ? evalExpr(v, { $json: input[0], $ }) : v;
        }
        if (row) { Object.assign(row, patch); }
        world.log.push('session.update ' + JSON.stringify(patch));
        outputs[cursor] = [Object.assign({}, row)];
        input = outputs[cursor];
      }
    } else if (type === 'postgres') {
      world.calls.privacyInsert++;
      if (shouldFail(faults, cursor)) {
        outputs[cursor] = [nodeFailure('could not connect to server: Connection refused', 'Connection refused')];
      } else {
        const rec = input[0] || {};
        const key = String(rec.submission_key || '');
        if (world.privacy.some((r) => r.submission_key === key)) {
          // The UNIQUE INDEX is the read. This is the shape the node ACTUALLY emits — the
          // human text on `message`, and an error object that names no code at all.
          outputs[cursor] = [nodeFailure(
            'duplicate key value violates unique constraint "privacy_ack_submission_key_uidx"',
            'Key (submission_key)=(' + key + ') already exists.'
          )];
          world.log.push('privacy.insert 23505 ' + key);
        } else {
          world.privacy.push(JSON.parse(JSON.stringify(rec)));
          outputs[cursor] = [{ success: true }];
          world.log.push('privacy.insert ok ' + key);
        }
      }
      input = outputs[cursor];
    } else if (type === 'executeWorkflow') {
      world.calls.intake++;
      if (shouldFail(faults, cursor)) {
        outputs[cursor] = [{ error: 'sub-workflow failed' }];
      } else {
        const env = input[0] || {};
        const key = String(env.submission_key || '');
        // THE DEPLOYED CONTRACT, modelled: Lead Intake has no insert. It reads the receipt the
        // CALLER preallocated, and absence is RECEIPT_ABSENT_INVARIANT_BROKEN — a refusal, not
        // permission to proceed. This is exactly what refused the second live submit.
        const rs = world.receipts.filter((r) => String(r.submission_key) === key);
        const refuse = (reason) => [{ ok: false, error_code: 'SUBMIT_UNRESOLVED',
          retryable: true, receipt_reason: reason }];
        if (rs.length === 0) { outputs[cursor] = refuse('RECEIPT_ABSENT_INVARIANT_BROKEN'); }
        else if (rs.length > 1) { outputs[cursor] = refuse('DUPLICATE_RECEIPTS'); }
        else {
          const r = rs[0];
          const state = String(r.commit_state || '');
          if (state === 'READY') {
            // claim -> commit -> settle, and exactly one Pipeline row.
            r.commit_state = 'IN_FLIGHT';
            r.claimed_at = new Date().toISOString();
            r.correlation_id = key;
            world.leadSeq++;
            const lead = 'FIN-' + world.leadSeq;
            world.pipeline.push({ lead_id: lead, submission_key: key });
            Object.assign(r, { commit_state: 'COMMITTED', canonical_lead_id: lead,
              lead_mode: 'new', lead_priority: 'HOT', financial_zone: 'ORANGE',
              settled_at: new Date().toISOString() });
            world.log.push('intake.commit ' + key + ' -> ' + lead);
            outputs[cursor] = [{ ok: true, lead_id: lead, priority: 'HOT', financial_zone: 'ORANGE' }];
          } else if (state === 'COMMITTED' && String(r.canonical_lead_id || '') !== '') {
            // COMMITTED REPLAY. Resolving does not write, so no second Pipeline row.
            world.log.push('intake.replay ' + key + ' -> ' + r.canonical_lead_id);
            outputs[cursor] = [{ ok: true, lead_id: r.canonical_lead_id,
              priority: r.lead_priority, financial_zone: r.financial_zone }];
          } else {
            outputs[cursor] = refuse('RECEIPT_NOT_READY_' + (state || 'EMPTY'));
          }
        }
      }
      input = outputs[cursor];
    } else if (type === 'respondToWebhook') {
      const raw = evalExpr(node.parameters.responseBody, { $json: input[0], $ });
      const status = Number(evalExpr(String(node.parameters.options.responseCode), { $json: input[0], $ })) || 200;
      response = { node: cursor, status: status, body: JSON.parse(raw) };
      break;
    } else {
      throw new Error('unhandled node type ' + type + ' on ' + cursor);
    }

    const conn = wf.connections[cursor];
    if (!conn || !conn.main || !conn.main[branch] || !conn.main[branch][0]) { break; }
    cursor = conn.main[branch][0].node;
  }

  return { response, outputs, world };
}

import nodeCrypto from 'node:crypto';
