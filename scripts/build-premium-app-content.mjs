#!/usr/bin/env node
// FINMENTOR — generate the Premium Mini App's content bundle from the gated contract.
//
//   node scripts/build-premium-app-content.mjs
//
// REPO-ONLY. Reads n8n/src/premium-ux/branches.js and writes app-premium/content.js.
//
// WHY GENERATE RATHER THAN TYPE. branches.js is the single source of truth and is held against
// docs/PREMIUM_UX_FINAL_RU_SPEC.md by qa/premium-ux-content.test.mjs, string by string. A browser
// bundle typed by hand would be a second copy of the same copy, and the gate would not be watching
// it — which is exactly how a client ends up seeing a label nobody approved. Generating it means
// there is still only one place the strings live.
//
// qa/premium-ux-content.test.mjs asserts the emitted file matches a fresh build, so a stale bundle
// fails the suite rather than shipping.

import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
const B = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'branches.js'));

export const OUT = join(ROOT, 'app-premium', 'content.js');

// Only the client-visible content crosses. The skip predicate, the validators and the projections
// stay server-side: a browser copy of a rule is a suggestion, not a rule.
export function buildContent() {
  const payload = {
    OBJECTIVES: B.OBJECTIVES,
    OBJECTIVE_SCREEN: B.OBJECTIVE_SCREEN,
    PROBLEMS: B.PROBLEMS,
    PROBLEM_FREE_TEXT_OPTION: B.PROBLEM_FREE_TEXT_OPTION,
    OUTCOMES: B.OUTCOMES,
    OUTCOME_FREE_TEXT_OPTION: B.OUTCOME_FREE_TEXT_OPTION,
    COMPANY_SCREEN: B.COMPANY_SCREEN,
    SCALE_OPTIONS: B.SCALE_OPTIONS,
    CURRENT_SETUP: B.CURRENT_SETUP,
    DECISION_HORIZON: B.DECISION_HORIZON,
    DOCUMENTS: B.DOCUMENTS,
    CONTACT: B.CONTACT,
    IMPORTANT_CONTEXT: B.IMPORTANT_CONTEXT,
    REVIEW: B.REVIEW,
    FOCUS_MAP: B.FOCUS_MAP,
    FOCUS_DISCLAIMER: B.FOCUS_DISCLAIMER,
    PRIVACY: B.PRIVACY,
    EDIT: B.EDIT,
    SUCCESS: B.SUCCESS,
    FAILURE: B.FAILURE,
    STAGES: B.STAGES
  };
  return [
    '/* GENERATED — do not edit.',
    ' * Source: n8n/src/premium-ux/branches.js',
    ' * Rebuild: node scripts/build-premium-app-content.mjs',
    ' * Held against docs/PREMIUM_UX_FINAL_RU_SPEC.md by qa/premium-ux-content.test.mjs. */',
    'window.FM_CONTENT = ' + JSON.stringify(payload, null, 2) + ';',
    ''
  ].join('\n');
}

const isMain = process.argv[1] && process.argv[1].endsWith('build-premium-app-content.mjs');
if (isMain) {
  const out = buildContent();
  writeFileSync(OUT, out, 'utf8');
  const objectives = B.OBJECTIVES.length;
  const problems = Object.keys(B.PROBLEMS).length;
  const outcomes = Object.keys(B.OUTCOMES).length;
  console.log('app-premium/content.js written');
  console.log('  objectives     : ' + objectives);
  console.log('  problem sets   : ' + problems + '  (free text: ' + B.OBJECTIVES.filter((o) => B.isFreeTextProblem(o.id)).length + ')');
  console.log('  outcome sets   : ' + outcomes);
  console.log('  focus map keys : ' + Object.keys(B.FOCUS_MAP).length);
  console.log('  bytes          : ' + Buffer.byteLength(out, 'utf8'));
  if (objectives !== 8 || problems !== 8 || outcomes !== 8) {
    console.error('REFUSING: the content bundle does not carry all eight branches.');
    process.exit(1);
  }
  // The bundle is client-visible. Nothing that decides anything may cross into it.
  const forbidden = ['canSkip', 'APPROVED_CARRIED', 'validateDraft', 'buildLeadIntakePayload', 'submission_key'];
  for (const f of forbidden) {
    if (out.indexOf(f) !== -1) { console.error('REFUSING: server-side logic leaked into the bundle: ' + f); process.exit(1); }
  }
  const src = readFileSync(join(ROOT, 'n8n', 'src', 'premium-ux', 'branches.js'), 'utf8');
  if (src.indexOf('TG_COPY') === -1) { console.error('REFUSING: branches.js lost its Telegram copy'); process.exit(1); }
  if (out.indexOf('TG_COPY') !== -1) { console.error('REFUSING: Telegram copy must not ship in the browser bundle'); process.exit(1); }
  console.log('  verification   : PASS');
}
