#!/usr/bin/env node
// FINMENTOR — P9-R2 isolated store-failure harness for the Mini App Gateway.
//
//   node scripts/build-gateway-store-failure-harness.mjs
//
// REPO-ONLY. Emits two disposable harness candidates and never contacts n8n:
//
//   n8n/candidate/gw-store-failure-h1-candidate.json   response-adapter battery, CREDENTIAL-FREE
//   n8n/candidate/gw-store-failure-h2-candidate.json   real Postgres node against a dead store
//
// ============================== WHAT IS BEING PROVEN ==============================
//
// Store Failure = 503 is the last live-unproven Gateway gate. P9 proved it structurally and
// offline; what was missing is an actual HTTP response carrying the CORRECTED NUMERIC 503,
// because P9-R1 showed that a respond node can look correctly configured and still emit a bare
// 500. Configuration inspection is precisely what failed to catch that defect, so this harness
// puts a real request on the wire.
//
// The deployed Gateway routes store failure like this:
//
//     G5 Replay Claim  (onError: continueErrorOutput; NO alwaysOutputData — see P9-R2)
//        main[0] -> Claim Verdict -> IF Claim Won -> ... -> Respond Bootstrap OK   (200)
//        main[1] -> Respond Store Unavailable                                      (503)
//
// The error output goes STRAIGHT to the respond node. Claim Verdict, IF Claim Won, Build App
// Session and Create App Session are not on that path at all, so a store outage cannot mint a
// session, cannot fall through to ACCEPT and cannot weaken the replay decision. This harness
// exists to show that on the wire rather than on the page.
//
// ============================== WHY PRODUCTION IS NEVER TOUCHED ==============================
//
// Deliberately breaking production Supabase is refused. Instead the harness is a COPY of the
// deployed graph with a declared, gated allowlist of differences:
//
//   1. workflow name and webhook path        - a disposable route, never the Gateway route
//   2. Verify InitData trust anchor          - ONE constant: the Telegram production Ed25519
//                                              public key is replaced by a throwaway key
//                                              generated at deploy time
//   3. G5 Replay Claim                       - H1: a credential-free stand-in that can throw
//                                              (store down), return a row (claim won) or return
//                                              none (claim lost)
//                                            - H2: the REAL postgres node with the REAL query,
//                                              pointed at a disposable dead-address credential
//   4. Create App Session                    - a pass-through, so no row can ever reach the
//                                              production MiniApp_App_Sessions data table
//
// EVERY OTHER NODE, and the entire connection map, must be byte-identical to the Gateway
// candidate - the gate below asserts that node by node and refuses to emit otherwise. In
// particular all four respond nodes are copied verbatim, so the 503 that comes back is produced
// by the same node, with the same typed numeric code, as the production one.
//
// The trust-anchor swap is what lets a synthetic context reach the claim node without any
// Telegram material, any bot token or any production credential. It also cuts the other way: a
// context signed with the harness key is rejected 401 TG_INITDATA_INVALID by the production
// Gateway, so the harness key can never be turned against the real endpoint.
//
// No secret is ever written to an artifact. The public key and the disposable credential id are
// PLACEHOLDERS here, and are injected at deploy time.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const GATEWAY_SRC = join(ROOT, 'n8n', 'candidate', 'miniapp-gateway-candidate.json');
const OUT_H1 = join(ROOT, 'n8n', 'candidate', 'gw-store-failure-h1-candidate.json');
const OUT_H2 = join(ROOT, 'n8n', 'candidate', 'gw-store-failure-h2-candidate.json');

// ---------------------------------------------------------------- configuration (non-secret)

export const GATEWAY_PATH = 'finmentor-miniapp-gateway';
export const H1_PATH = 'p9r2/store-failure-h1';
export const H2_PATH = 'p9r2/store-failure-h2';
export const H1_NAME = '[TEMP] P9-R2 Gateway store-failure H1 (credential-free)';
export const H2_NAME = '[TEMP] P9-R2 Gateway store-failure H2 (dead store)';

export const PUBKEY_PLACEHOLDER = '__HARNESS_ED25519_PUBKEY_HEX__';
export const CREDENTIAL_PLACEHOLDER = '__HARNESS_DEAD_STORE_CREDENTIAL_ID__';

// The production G5 credential. It must appear in NEITHER harness.
export const PRODUCTION_G5_CREDENTIAL_ID = 'B6wRirWfjqoASXU3';
// The production app-session store. It must appear in NEITHER harness.
export const PRODUCTION_SESSION_TABLE = 'MiniApp_App_Sessions';

export const CLAIM_NODE = 'G5 Replay Claim';
export const SESSION_NODE = 'Create App Session';

// EVERY data-table node is replaced, not one named one. The Gateway gained a read/resolve/
// re-read path for cross-reload resume, and a harness that neutralised only the INSERT would
// have shipped two live reads against the production app-session table — which is exactly what
// this harness exists to make structurally impossible. The list is DERIVED from the Gateway,
// so the next node added there is neutralised without anyone remembering to add it here.
export const dataTableNodes = (gateway) =>
  gateway.nodes.filter((n) => n.type === 'n8n-nodes-base.dataTable').map((n) => n.name);
export const VERIFY_NODE = 'Verify InitData';
export const WEBHOOK_NODE = 'Gateway Webhook';

// The only nodes this harness may differ from the Gateway in. Anything else must match.
export const allowedDivergence = (gateway) =>
  [VERIFY_NODE, CLAIM_NODE, WEBHOOK_NODE].concat(dataTableNodes(gateway));

const SETTINGS = {
  executionOrder: 'v1',
  availableInMCP: false,
  saveExecutionProgress: false,
  saveManualExecutions: false,
  saveDataErrorExecution: 'none',
  saveDataSuccessExecution: 'none'
};

// ---------------------------------------------------------------- the stand-ins

// H1 claim node. Same name, same error wiring, and it emits exactly the shape the production
// query emits, so nothing downstream can tell the difference. It holds no credential and inserts
// nothing.
//
// P9-R2. The production claim is now a data-modifying CTE that ALWAYS returns one row carrying
// `claimed`, so the stand-in returns one row too — for a lost claim as much as a won one. A
// stand-in that still returned zero rows on "lost" would be mirroring a query that no longer
// exists, and the outage and conflict paths would look identical here and only here.
const H1_CLAIM_CODE = [
  '// HARNESS ONLY - stands in for the Postgres replay claim so the response adapter can be',
  '// exercised without a store. It reads nothing, writes nothing and holds no credential.',
  '//',
  '//   down -> throw, exactly as an unreachable store does; n8n routes to the ERROR output',
  '//   won  -> one row, claimed = 1, as the CTE returns when the INSERT took the key',
  '//   lost -> one row, claimed = 0, as the CTE returns when ON CONFLICT DO NOTHING found it held',
  '//',
  '// An unrecognised or absent mode THROWS rather than defaulting to anything, because a',
  '// harness that quietly picks a happy path proves nothing.',
  'const src = $("Gateway Webhook").first().json.body || {};',
  'const mode = String(src.harness_store || "");',
  'if (mode === "down") { throw new Error("HARNESS: simulated replay-store outage"); }',
  'if (mode === "won")  { return [{ json: { claimed: 1 } }]; }',
  'if (mode === "lost") { return [{ json: { claimed: 0 } }]; }',
  'throw new Error("HARNESS: harness_store must be one of down|won|lost");'
].join('\n');

// Both harnesses use this in place of the app-session INSERT, so no row can reach the production
// data table while Respond Bootstrap OK is still exercised end to end.
const SESSION_PASSTHROUGH_CODE = [
  '// HARNESS ONLY - stands in for an app-session Data Table node. It passes its input through',
  '// untouched so the responders run exactly as in production, and it is structurally incapable',
  '// of reading or writing: there is no dataTable node anywhere in this workflow.',
  '//',
  '// Nothing downstream of the claim is reached in this harness anyway — the claim is the thing',
  '// under test and it always fails — but a node that COULD touch the production table would',
  '// defeat the point of the harness whether or not it is reachable.',
  'return $input.all();'
].join('\n');

function codeNode(src, name, jsCode, extra) {
  return Object.assign({
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: jsCode },
    id: src.id,
    name: name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: src.position
  }, extra || {});
}

// ---------------------------------------------------------------- builder

function clone(x) { return JSON.parse(JSON.stringify(x)); }

export function buildHarness(gateway, variant) {
  const wf = clone(gateway);
  delete wf.active;
  wf.name = variant === 'h1' ? H1_NAME : H2_NAME;
  wf.settings = clone(SETTINGS);

  wf.nodes = wf.nodes.map((n) => {
    if (n.name === WEBHOOK_NODE) {
      const w = clone(n);
      w.parameters.path = variant === 'h1' ? H1_PATH : H2_PATH;
      delete w.webhookId;
      return w;
    }

    if (n.name === VERIFY_NODE) {
      const v = clone(n);
      const m = /const TG_PROD_PUBKEY_HEX = '([0-9a-f]{64})'/.exec(v.parameters.jsCode);
      if (!m) { throw new Error('cannot find the trust anchor in the verifier'); }
      v.parameters.jsCode = v.parameters.jsCode.split(m[1]).join(PUBKEY_PLACEHOLDER);
      return v;
    }

    if (n.type === 'n8n-nodes-base.dataTable') {
      return codeNode(n, n.name, SESSION_PASSTHROUGH_CODE);
    }

    if (n.name === CLAIM_NODE) {
      if (variant === 'h1') {
        // Mirror the flag by COPYING it, in whichever state production holds it. Since P9-R2 it
        // is absent there, and an absent flag must stay absent rather than becoming an explicit
        // undefined that a later reader could mistake for "not considered".
        const extra = { onError: n.onError };
        if (n.alwaysOutputData !== undefined) { extra.alwaysOutputData = n.alwaysOutputData; }
        return codeNode(n, CLAIM_NODE, H1_CLAIM_CODE, extra);
      }
      // H2 keeps the REAL postgres node and the REAL query. Only the credential moves, to a
      // disposable one pointing at an address nothing listens on.
      const p = clone(n);
      p.credentials = { postgres: { id: CREDENTIAL_PLACEHOLDER, name: 'P9-R2 dead store (disposable)' } };
      return p;
    }

    return clone(n);
  });

  return wf;
}

// ---------------------------------------------------------------- gate

function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

export function verifyHarness(gateway, wf, variant) {
  const f = [];
  const path = variant === 'h1' ? H1_PATH : H2_PATH;
  const json = JSON.stringify(wf);
  const byName = (w, n) => w.nodes.find((x) => x.name === n);

  // --- the graph is the Gateway graph, except where declared ---------------
  if (wf.nodes.length !== gateway.nodes.length) { f.push('node count differs from the Gateway'); }
  if (!deepEqual(wf.connections, gateway.connections)) { f.push('the connection map differs from the Gateway'); }
  for (const g of gateway.nodes) {
    const h = byName(wf, g.name);
    if (!h) { f.push('the harness is missing Gateway node: ' + g.name); continue; }
    if (allowedDivergence(gateway).indexOf(g.name) !== -1) { continue; }
    if (!deepEqual(h.parameters, g.parameters)) { f.push('undeclared divergence in node parameters: ' + g.name); }
    if (h.type !== g.type || h.typeVersion !== g.typeVersion) { f.push('undeclared divergence in node type: ' + g.name); }
    if (!deepEqual(h.onError || null, g.onError || null)) { f.push('undeclared divergence in onError: ' + g.name); }
  }

  // --- the four respond nodes are the thing under test ---------------------
  // Copied verbatim, so the 503 that comes back is emitted by the same node, with the same TYPED
  // code, as the production one. P9-R1: a substring test cannot tell '=503' from 503.
  const respond = gateway.nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook');
  if (respond.length !== 4) { f.push('the Gateway does not have the expected four respond nodes'); }
  for (const g of respond) {
    const h = byName(wf, g.name);
    if (!h) { f.push('missing respond node: ' + g.name); continue; }
    if (!deepEqual(h.parameters, g.parameters)) { f.push('respond node was modified: ' + g.name); }
    const rc = h.parameters.options.responseCode;
    const numeric = typeof rc === 'number';
    const expr = typeof rc === 'string' && /\{\{[\s\S]*\}\}/.test(rc);
    if (!numeric && !expr) { f.push('respond node code is neither a number nor an expression: ' + g.name); }
  }
  const su = byName(wf, 'Respond Store Unavailable');
  if (!su || su.parameters.options.responseCode !== 503) { f.push('the store-unavailable code is not the number 503'); }
  const ok = byName(wf, 'Respond Bootstrap OK');
  if (!ok || ok.parameters.options.responseCode !== 200) { f.push('the accept code is not the number 200'); }
  const rr = byName(wf, 'Respond Replay Refused');
  if (!rr || rr.parameters.options.responseCode !== 409) { f.push('the replay code is not the number 409'); }

  // --- the store-failure wiring is the Gateway wiring -----------------------
  const claimOut = wf.connections[CLAIM_NODE];
  if (!claimOut || !claimOut.main || claimOut.main.length !== 2) {
    f.push('the claim node does not have both a success and an error output');
  } else {
    if ((claimOut.main[0][0] || {}).node !== 'Claim Verdict') { f.push('the claim success output is not wired to Claim Verdict'); }
    if ((claimOut.main[1][0] || {}).node !== 'Respond Store Unavailable') { f.push('the claim ERROR output is not wired to Respond Store Unavailable'); }
  }
  const claim = byName(wf, CLAIM_NODE);
  if (!claim || claim.onError !== 'continueErrorOutput') { f.push('the claim node does not route its error output'); }
  // P9-R2. Mirror production in BOTH directions. The flag is absent there now, and a harness that
  // re-added it would reproduce the very defect this harness was built to find — an error firing
  // the success output too — while still calling itself a copy of production.
  const gwFlag = (byName(gateway, CLAIM_NODE) || {}).alwaysOutputData;
  if (!claim || claim.alwaysOutputData !== gwFlag) {
    f.push('the claim node does not mirror the Gateway alwaysOutputData (production: ' + JSON.stringify(gwFlag) + ', harness: ' + JSON.stringify((claim || {}).alwaysOutputData) + ')');
  }

  // --- nothing production-owned may be reachable ---------------------------
  if (json.indexOf(PRODUCTION_G5_CREDENTIAL_ID) !== -1) { f.push('the harness references the PRODUCTION G5 credential'); }
  if (json.indexOf(PRODUCTION_SESSION_TABLE) !== -1) { f.push('the harness references the PRODUCTION app-session table'); }
  if (wf.nodes.some((n) => n.type === 'n8n-nodes-base.dataTable')) { f.push('the harness can write to a data table'); }
  if (wf.nodes.some((n) => ['n8n-nodes-base.googleSheets', 'n8n-nodes-base.httpRequest', 'n8n-nodes-base.executeWorkflow', 'n8n-nodes-base.telegram'].indexOf(n.type) !== -1)) {
    f.push('the harness carries a side-effecting node type');
  }
  const wh = byName(wf, WEBHOOK_NODE);
  if (!wh || wh.parameters.path !== path) { f.push('the harness webhook path is not the disposable path'); }
  if (wh && wh.parameters.path === GATEWAY_PATH) { f.push('the harness would seize the PRODUCTION Gateway route'); }

  // --- no Telegram trust anchor, no secret ---------------------------------
  const verify = byName(wf, VERIFY_NODE);
  if (!verify || verify.parameters.jsCode.indexOf(PUBKEY_PLACEHOLDER) === -1) { f.push('the trust anchor was not replaced by a placeholder'); }
  if (/const TG_PROD_PUBKEY_HEX = '[0-9a-f]{64}'/.test(json)) { f.push('a real 64-hex trust anchor is baked into the artifact'); }
  if (/\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/.test(json)) { f.push('a bot token shape appears in the artifact'); }
  // The verifier must otherwise be untouched: same freshness window, same bot id, same codes.
  const gv = byName(gateway, VERIFY_NODE);
  const zero = '0'.repeat(64);
  const rebuilt = verify ? verify.parameters.jsCode.split(PUBKEY_PLACEHOLDER).join(zero) : '';
  const original = gv ? gv.parameters.jsCode.replace(/const TG_PROD_PUBKEY_HEX = '[0-9a-f]{64}'/, "const TG_PROD_PUBKEY_HEX = '" + zero + "'") : 'x';
  if (rebuilt !== original) { f.push('the verifier differs from production by more than its trust anchor'); }

  // --- credentials ---------------------------------------------------------
  const credNodes = wf.nodes.filter((n) => n.credentials);
  if (variant === 'h1') {
    if (credNodes.length !== 0) { f.push('H1 must be credential-free, found ' + credNodes.length + ' credential-bearing node(s)'); }
    if (byName(wf, CLAIM_NODE).type !== 'n8n-nodes-base.code') { f.push('H1 claim stand-in is not a code node'); }
    // P9-R2. The stand-in is only evidence if it answers in the shape the real statement answers.
    // The production CTE always returns ONE row carrying `claimed`, so a stand-in that returns
    // an empty array for a lost claim is mirroring a query that no longer exists — and inside
    // this harness, and nowhere else, the conflict and outage paths would look alike again.
    const h1code = ((byName(wf, CLAIM_NODE).parameters || {}).jsCode || '');
    if (!/claimed:\s*1\b/.test(h1code)) { f.push('the H1 stand-in never states claimed = 1, so a won claim cannot be simulated'); }
    if (!/claimed:\s*0\b/.test(h1code)) { f.push('the H1 stand-in never states claimed = 0; a lost claim must return a ROW, as the CTE does'); }
    if (/return\s*\[\s*\]/.test(h1code)) { f.push('the H1 stand-in returns an empty array; the production claim query cannot do that'); }
  } else {
    if (credNodes.length !== 1) { f.push('H2 must carry exactly one credential, found ' + credNodes.length); }
    if (credNodes.length === 1 && credNodes[0].name !== CLAIM_NODE) { f.push('H2 credential is not on the claim node'); }
    if (credNodes.length === 1 && credNodes[0].credentials.postgres.id !== CREDENTIAL_PLACEHOLDER) { f.push('H2 credential is not the placeholder'); }
    const h2claim = byName(wf, CLAIM_NODE);
    const gclaim = byName(gateway, CLAIM_NODE);
    if (h2claim.type !== 'n8n-nodes-base.postgres') { f.push('H2 claim node is not the real postgres node'); }
    if (!deepEqual(h2claim.parameters, gclaim.parameters)) { f.push('H2 claim node query differs from production'); }
  }

  // --- disposability -------------------------------------------------------
  if (wf.settings.saveDataSuccessExecution !== 'none' || wf.settings.saveDataErrorExecution !== 'none') { f.push('the harness retains execution data'); }
  if (wf.settings.availableInMCP !== false) { f.push('the harness is exposed to MCP'); }
  if (Object.prototype.hasOwnProperty.call(wf, 'active')) { f.push('the harness ships an active flag'); }
  if (wf.name.indexOf('[TEMP]') !== 0) { f.push('the harness is not named as disposable'); }

  return { ok: f.length === 0, failures: f };
}

function serialize(wf) { return JSON.stringify(wf, null, 2) + '\n'; }

const isMain = process.argv[1] && process.argv[1].endsWith('build-gateway-store-failure-harness.mjs');
if (isMain) {
  const gateway = JSON.parse(readFileSync(GATEWAY_SRC, 'utf8'));
  for (const [variant, out] of [['h1', OUT_H1], ['h2', OUT_H2]]) {
    const wf = buildHarness(gateway, variant);
    const v = verifyHarness(gateway, wf, variant);
    if (!v.ok) {
      console.error('REFUSING TO WRITE: ' + variant.toUpperCase() + ' failed verification.');
      v.failures.forEach((x) => console.error('  - ' + x));
      process.exit(1);
    }
    writeFileSync(out, serialize(wf), 'utf8');
  }
  console.log('P9-R2 isolated store-failure harness');
  console.log('  H1 (credential-free) : n8n/candidate/gw-store-failure-h1-candidate.json  /webhook/' + H1_PATH);
  console.log('  H2 (dead store)      : n8n/candidate/gw-store-failure-h2-candidate.json  /webhook/' + H2_PATH);
  console.log('  divergence allowlist : ' + allowedDivergence(gateway).join(', '));
  console.log('  respond nodes        : all four copied verbatim, codes typed');
  console.log('  production creds     : absent');
  console.log('  production table     : absent');
  console.log('  trust anchor         : placeholder, injected at deploy');
  console.log('  verification         : PASS');
}
