#!/usr/bin/env node
// FINMENTOR — run every offline regression gate.
//
// Offline by design: no n8n credentials, no network, no browser. Resolves paths from this
// file so it behaves identically from any working directory, and exits non-zero if any
// gate fails.
//
//   node qa/run-all.mjs

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { evaluateFloors, baselineIsSelfConsistent } = require(join(HERE, 'assertion-floor.js'));

const GATES = [
  ['Command Center authorisation', 'command-center-auth.test.mjs'],
  ['Lead Intake trust boundary', 'lead-intake-trust.test.mjs'],
  ['AI safe projection', 'ai-safe-projection.test.mjs'],
  ['Error Monitor alert', 'error-alert.test.mjs'],
  ['Website contract', 'website-contract.test.mjs'],
  ['n8n export hygiene', 'n8n-manifest-drift.test.mjs'],
  ['Mini App read-model consistency', 'miniapp-readmodel.test.mjs'],
  ['Mini App consent and submit', 'miniapp-submit.test.mjs'],
  ['G1 durable idempotency receipt', 'idempotency-receipt.test.mjs'],
  ['G1 P5 production integration', 'receipt-integration.test.mjs'],
  ['Bot_Sessions legacy cycle contract', 'bot-sessions-legacy-cycle.test.mjs'],
  ['P6.1 safe manual-import artifact', 'import-safe.test.mjs'],
  ['P6.2 REST-API import projection', 'api-import.test.mjs'],
  ['F10/F11 internal-route data contract', 'internal-route-contract.test.mjs'],
  ['P7.0-P7.1 Concierge issuer half', 'concierge-issuer.test.mjs'],
  ['P7.2 Concierge issuer candidate', 'concierge-issuer-candidate.test.mjs'],
  ['P7.3 Concierge import-safe wrapper', 'concierge-import-safe.test.mjs'],
  ['P7.3 step-2 issuer harness fidelity', 'concierge-issuer-harness.test.mjs'],
  ['P7.4 deployment guards', 'deploy-guard.test.mjs'],
  ['P7.5 cutover + Bot_Sessions writes', 'cutover.test.mjs'],
  ['P7.5R redactor + materializer', 'materializer.test.mjs'],
  ['Telegram initData validator', 'gateway/telegram-initdata.test.mjs'],
  ['P8.2 Concierge hot path', 'hot-path.test.mjs'],
  ['P8.3A cutover policy', 'p83a-cutover-policy.test.mjs'],
  ['Lead Intake internal-route cutover policy', 'lead-intake-cutover-policy.test.mjs'],
  ['Lead Intake COMMITTED replay', 'lead-intake-committed-replay.test.mjs'],
  ['P8.4B Concierge internal handoff', 'concierge-internal-handoff.test.mjs'],
  ['G5 initData replay claim', 'g5-replay-claim.test.mjs'],
  ['C3 immutable cycle projection', 'c3-cycle-projection.test.mjs'],
  ['P9 Mini App Gateway pre-deploy', 'miniapp-gateway.test.mjs'],
  ['P9-R2 Gateway store-failure harness', 'gateway-store-failure-harness.test.mjs'],
  ['P9-R3 Lead Intake dedup-outage harness', 'lead-intake-dedup-harness.test.mjs'],
  ['P9-R4 Lead Intake dedup remediation', 'lead-intake-dedup-remediation.test.mjs'],
  ['Premium UX content contract', 'premium-ux-content.test.mjs'],
  ['Premium UX draft + provenance', 'premium-ux-draft.test.mjs'],
  ['Premium UX submit projection', 'premium-ux-submit.test.mjs'],
  ['Premium UX Telegram state machine', 'premium-ux-state.test.mjs'],
  ['Premium UX brief + privacy record', 'premium-ux-brief.test.mjs'],
  ['Premium UX privacy notice (RU/RO, templated)', 'premium-ux-privacy-notice.test.mjs'],
  ['Premium UX app-session TTL (72h)', 'premium-ux-ttl.test.mjs'],
  ['Premium UX context extraction', 'premium-ux-extraction.test.mjs'],
  ['Premium UX Mini App network layer', 'premium-ux-net.test.mjs'],
  ['Premium UX Mini App bootstrap + session', 'premium-ux-bootstrap.test.mjs'],
  ['Premium UX cross-reload resume', 'premium-ux-resume.test.mjs'],
  ['Premium UX submit idempotency (executed)', 'premium-ux-submit-idempotency.test.mjs'],
  ['Premium UX submit in-flight lock', 'premium-ux-submit-lock.test.mjs'],
  ['Premium UX receipt contract (executed)', 'premium-ux-receipt-contract.test.mjs'],
  ['Premium UX success screen', 'premium-ux-success-screen.test.mjs'],
  ['Premium UX extraction quality', 'premium-ux-extraction-quality.test.mjs'],
  ['Premium UX new-request path', 'premium-ux-new-request.test.mjs'],
  ['Premium Telegram presentation', 'premium-ux-tg-presentation.test.mjs'],
  ['Premium UX contact channel', 'premium-ux-contact-channel.test.mjs'],
  ['Lead Alerts owner presentation', 'lead-alerts-presentation.test.mjs'],
  ['CRM stage compatibility map', 'crm-stage-map.test.mjs'],
  ['Lead Alert action UX (D1-D11)', 'lead-alerts-actions.test.mjs'],
  ['Lead Alert ack expression (evaluated)', 'lead-alerts-ack-expression.test.mjs'],
  ['Lead Alert edit no-op classification', 'lead-alerts-edit-noop.test.mjs'],
  ['SYSTEM ALERT coverage', 'system-alert.test.mjs'],
  ['Lead Alerts candidates (executed)', 'lead-alerts-candidates.test.mjs'],
  ['Premium Concierge candidate (executed)', 'premium-ux-concierge-candidate.test.mjs'],
  ['Lead Intake projection candidate (executed)', 'premium-ux-projection-candidate.test.mjs'],
  ['Lead Intake premium projection SOURCE (executed)', 'lead-intake-premium-source.test.mjs'],
  ['Lead Intake NEW LEAD alert routing', 'lead-intake-new-lead-alert-routing.test.mjs'],
  ['GLOBAL NEW-EVENT identity (candidate)', 'lead-intake-request-identity.test.mjs'],
  ['Financial X-Ray authority and review', 'xray-analysis.test.mjs'],
  ['MCP project-scope config', 'mcp-config.test.mjs'],
  ['Assertion floor mechanism', 'assertion-floor.test.mjs']
];

// Each gate prints its own tally, in one of two shapes: "N passed, 0 failed" or
// "PASS  N checks passed, 0 failed". Read the last such line rather than counting PASS
// lines, so a gate that prints the word elsewhere cannot inflate the total.
function assertionsFrom(output) {
  const m = [...output.matchAll(/(\d+)\s+(?:checks\s+)?passed\b/g)];
  if (m.length) { return Number(m[m.length - 1][1]); }
  // node:test reports "pass N" rather than "N passed". gateway/telegram-initdata.test.mjs uses
  // it, and P8 found that gate had never been in this runner at all -- a security-critical
  // validator whose tests nobody ran. Reading its format here was cheaper and safer than
  // rewriting a passing test to satisfy a regex.
  const t = [...output.matchAll(/^\D*pass\s+(\d+)\s*$/gm)];
  return t.length ? Number(t[t.length - 1][1]) : null;
}

const results = [];
for (const [label, file] of GATES) {
  // A gate path may be repo-relative when it lives outside qa/ (the gateway validator does).
  const target = file.indexOf('/') === -1 ? join(HERE, file) : join(HERE, '..', file);
  const r = spawnSync(process.execPath, [target], { encoding: 'utf8' });
  const ok = r.status === 0;
  const output = (r.stdout || '') + (r.stderr || '');
  const assertions = assertionsFrom(output);
  results.push({ label, file, ok, output, assertions });
  const n = assertions === null ? '  ?' : String(assertions).padStart(3);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${label}`);
}

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.error('\n--- failing gate output ---');
  for (const f of failed) {
    console.error(`\n### ${f.label} (${f.file})`);
    console.error(f.output.split('\n').filter((l) => /FAIL|Error/.test(l)).join('\n'));
  }
  console.error(`\n${results.length - failed.length}/${results.length} gates passed`);
  process.exit(1);
}

// The two lines CI greps for. Printed before the floor check so a floor breach still shows the
// numbers that caused it.
const total = results.reduce((n, r) => n + (r.assertions || 0), 0);
console.log(`\n${results.length}/${results.length} gates passed`);
console.log(`TOTAL ASSERTIONS: ${total}`);

// ---------------------------------------------------------------- assertion floors
//
// The decision procedure lives in qa/assertion-floor.js so it can be mutation-tested; see
// qa/assertion-floor.test.mjs and docs/FINMENTOR_CI_ASSERTION_FLOOR_POLICY.md. This file only
// gathers the run and reports the verdict.
//
// FINMENTOR_ASSERTION_BASELINE is a TEST SEAM, not a configuration knob. It exists so the
// mutation test can point this runner at a deliberately-raised baseline and prove the build
// actually goes red when coverage falls. CI never sets it, and setting it in CI to dodge a
// red build would be the one edit the whole mechanism exists to prevent.
const baselinePath = process.env.FINMENTOR_ASSERTION_BASELINE || join(HERE, 'assertion-baseline.json');

let baseline = null;
try {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
} catch (e) {
  console.error('\nassertion baseline missing or unparseable at ' + baselinePath);
  process.exit(1);
}

const consistent = baselineIsSelfConsistent(baseline);
if (!consistent.ok) {
  console.error('\nFAIL: the assertion baseline is not self-consistent — ' + consistent.reason);
  process.exit(1);
}

const verdict = evaluateFloors(results, baseline);
if (!verdict.ok) {
  console.error('\nFAIL: assertion floor breached — coverage was removed');
  verdict.failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
if (verdict.notes.length) {
  console.log('\nNOTE: assertions grew; raise qa/assertion-baseline.json');
  verdict.notes.forEach((n) => console.log('  - ' + n));
}
console.log('assertion floors: PASS');
