// FINMENTOR — the auto-assigned credential guard.
//
// WHY THIS EXISTS.
//
// P7.3 step 2 created a disposable, credential-free probe with `create_workflow_from_code`. The
// response contained:
//
//   "autoAssignedCredentials": [
//     { "nodeName": "TG Entry", "credentialName": "FINMENTOR Leads Bot FINAL",
//       "credentialType": "telegramApi", "source": "user" } ]
//
// The tenant had bound a LIVE Telegram bot credential to a trigger node that never asked for
// one. Nothing was activated and `triggerCount` stayed 0, so no registration occurred -- but
// this is the exact hazard class the whole P7.3 line of work exists to prevent, arriving from a
// direction the artifact-side analysis did not model. Every safety property proven about a
// FILE is a property of the file. This one was added by the CREATION SURFACE, after the file
// was already correct.
//
// That finding was recorded in prose and in session memory. Prose does not fail a build. This
// module is the same finding expressed as a check that does.
//
// THE POLICY, and why the default is refusal.
//
// ANY auto-assigned credential is a FAILURE unless an exact, explicitly declared allowlist for
// that specific deployment says otherwise. Not "any Telegram credential" -- ANY credential. The
// Telegram case is what was observed; it is not what makes the behaviour dangerous. What makes
// it dangerous is that the surface attaches things silently, and a guard that only knew about
// Telegram would have to be extended by whoever got surprised next.
//
// For canary and harness creation the allowlist is EMPTY, and `HARNESS_ALLOWLIST` exists so
// that intent is written down rather than passed as a literal at each call site.
//
// WHAT A FAILURE MEANS OPERATIONALLY. Do not activate. Do not execute. Remove or archive the
// created disposable. Report AUTO_ASSIGNED_CREDENTIAL_REFUSED. Those are the caller's actions;
// this module's job is to make the verdict unambiguous and machine-readable.
//
// SECRETS. This module reads credential NAMES, TYPES and IDS only. It never reads, prints or
// returns a credential's contents, and there is nothing in a create response that would let it.

'use strict';

const VERDICT_REFUSED = 'AUTO_ASSIGNED_CREDENTIAL_REFUSED';
const VERDICT_OK = 'AUTO_ASSIGNED_CREDENTIAL_NONE';
const VERDICT_ALLOWED = 'AUTO_ASSIGNED_CREDENTIAL_ALLOWED';

// The allowlist for anything this project creates as a canary, harness, probe or driver. It is
// empty on purpose, and it is a named constant so that emptiness is a stated decision rather
// than an omission at a call site.
const HARNESS_ALLOWLIST = [];

// Normalises one entry of a create response's `autoAssignedCredentials` into the three fields
// worth deciding on. Unknown shapes normalise to empty strings rather than throwing, because a
// malformed entry must still be REFUSED, never skipped.
function describe(entry) {
  const e = (entry && typeof entry === 'object') ? entry : {};
  return {
    nodeName: String(e.nodeName == null ? '' : e.nodeName),
    credentialType: String(e.credentialType == null ? '' : e.credentialType),
    credentialName: String(e.credentialName == null ? '' : e.credentialName),
    credentialId: String(e.credentialId == null ? '' : e.credentialId)
  };
}

// An allowlist entry matches only if every field it declares matches exactly. A `{}` entry would
// therefore match everything, which is a footgun, so it is rejected outright.
function allowlistMatches(rule, actual) {
  if (!rule || typeof rule !== 'object') { return false; }
  const keys = Object.keys(rule);
  if (keys.length === 0) { return false; }
  return keys.every((k) => String(rule[k]) === String(actual[k] == null ? '' : actual[k]));
}

// Evaluates a workflow-create response.
//
//   response   the object returned by create_workflow_from_code (or anything with the same
//              `autoAssignedCredentials` field). A missing field is treated as "none assigned",
//              because surfaces that do not auto-assign do not report the key at all.
//   allowlist  array of exact match rules, e.g. [{ credentialType: 'googleSheetsOAuth2Api',
//              nodeName: 'Read Settings' }]. Defaults to EMPTY -- refuse everything.
//
// Returns { ok, verdict, refused[], allowed[], assigned[], message }.
function evaluateCreateResponse(response, allowlist) {
  const rules = Array.isArray(allowlist) ? allowlist : [];
  const raw = (response && response.autoAssignedCredentials);

  // A present-but-not-an-array field is malformed, and malformed is refused. Reading it as
  // "nothing was assigned" is exactly the failure mode this guard exists to prevent.
  if (raw !== undefined && raw !== null && !Array.isArray(raw)) {
    return {
      ok: false,
      verdict: VERDICT_REFUSED,
      assigned: [],
      allowed: [],
      refused: [],
      message: 'autoAssignedCredentials is present but is not an array; refusing rather than guessing'
    };
  }

  const assigned = (raw || []).map(describe);
  if (assigned.length === 0) {
    return { ok: true, verdict: VERDICT_OK, assigned: [], allowed: [], refused: [], message: 'no credentials were auto-assigned' };
  }

  const allowed = [];
  const refused = [];
  assigned.forEach((a) => {
    if (rules.some((r) => allowlistMatches(r, a))) { allowed.push(a); } else { refused.push(a); }
  });

  if (refused.length) {
    return {
      ok: false,
      verdict: VERDICT_REFUSED,
      assigned: assigned,
      allowed: allowed,
      refused: refused,
      message: 'the creation surface auto-assigned ' + refused.length + ' credential(s) that no '
        + 'allowlist declares: '
        + refused.map((r) => r.credentialType + ' "' + r.credentialName + '" -> node "' + r.nodeName + '"').join('; ')
        + '. DO NOT ACTIVATE, DO NOT EXECUTE, archive the created workflow.'
    };
  }

  return {
    ok: true,
    verdict: VERDICT_ALLOWED,
    assigned: assigned,
    allowed: allowed,
    refused: [],
    message: 'all ' + allowed.length + ' auto-assigned credential(s) are explicitly allowlisted'
  };
}

module.exports = {
  VERDICT_REFUSED,
  VERDICT_OK,
  VERDICT_ALLOWED,
  HARNESS_ALLOWLIST,
  describe,
  allowlistMatches,
  evaluateCreateResponse
};
