// FINMENTOR — the Telegram trigger safety contract, as a check rather than a paragraph.
//
// WHY THIS EXISTS.
//
// The Concierge's public surface is a `telegramTrigger` bound to credential 2JnVm0BIX0Z8tvBf,
// the SAME credential the live bot uses. Telegram permits one webhook per bot token and a
// second registration silently REPLACES the first, so an activatable copy is one click from
// taking every client message while production keeps running and receives nothing. No error is
// raised anywhere, and the error monitor cannot see an absence of updates.
//
// That hazard has been described in three documents. Descriptions do not fail builds. P7.4 §9
// asked for it pinned permanently, so here it is as two roles with different, exact rules.
//
// ROLE `canary` -- any Concierge import / deployment artifact.
//
//   A telegramTrigger carrying the production bot credential is permitted ONLY when it is
//   disabled AND the workflow is inactive. Anything else is a refusal. Both halves are
//   required: `active: false` alone is a lifecycle flag someone can flip in the UI, and
//   `disabled: true` alone on an active workflow is a state n8n should not produce but this
//   contract will not assume away.
//
//   The stronger property the artifact should also satisfy -- ZERO ENABLED TRIGGERS OF ANY
//   TYPE -- is checked too, because a second entry point added later would make the Telegram
//   trigger's disabled flag irrelevant.
//
// ROLE `harness` -- any test harness.
//
//   telegramTrigger count must be ZERO. Not disabled: absent. A harness has no reason to carry
//   one, and "disabled" is a property someone can toggle.
//
//   A Code node NAMED `Telegram Client Trigger` is expected and permitted, because the audited
//   body of `Parse Telegram Update` resolves that name and renaming it would mean running a
//   different program. It is permitted ONLY when it is a Code node with no Telegram credential
//   -- a node that cannot register transport no matter what is done to the workflow.
//
// WHAT THIS MODULE READS. Node types, names, `disabled` flags, credential TYPES and IDS, and
// the workflow's `active` flag. Never a credential's contents.

'use strict';

const PRODUCTION_BOT_CREDENTIAL_ID = '2JnVm0BIX0Z8tvBf';
const TELEGRAM_TRIGGER_TYPE = 'n8n-nodes-base.telegramTrigger';
const CODE_TYPE = 'n8n-nodes-base.code';
const SUBSTITUTE_NODE_NAME = 'Telegram Client Trigger';

const ROLE_CANARY = 'canary';
const ROLE_HARNESS = 'harness';

function nodes(wf) { return (wf && Array.isArray(wf.nodes)) ? wf.nodes : []; }

function isTriggerType(type) {
  const t = String(type || '');
  return /trigger$/i.test(t)
    || ['n8n-nodes-base.webhook', 'n8n-nodes-base.cron', 'n8n-nodes-base.interval',
      'n8n-nodes-base.start', 'n8n-nodes-base.emailReadImap',
      '@n8n/n8n-nodes-langchain.chatTrigger'].indexOf(t) !== -1;
}

function telegramCredentialId(node) {
  const c = (node && node.credentials && node.credentials.telegramApi) || null;
  return c ? String(c.id == null ? '' : c.id) : '';
}

// Evaluates one artifact against its role's rules.
//
//   wf    the workflow object (four-field create body or a full export)
//   opts  { role: 'canary' | 'harness', active: <boolean|undefined> }
//         `active` overrides wf.active, for checking a LIVE readback whose lifecycle state is
//         reported separately from the definition.
//
// Returns { ok, role, failures[], notes[] }.
function evaluateTriggerSafety(wf, opts) {
  const o = opts || {};
  const role = o.role;
  const failures = [];
  const notes = [];
  const fail = (m) => failures.push(m);

  if (role !== ROLE_CANARY && role !== ROLE_HARNESS) {
    return { ok: false, role: role, failures: ['unknown role ' + JSON.stringify(role) + '; expected "canary" or "harness"'], notes: notes };
  }

  const list = nodes(wf);
  const active = (o.active === undefined) ? wf.active : o.active;
  const tgTriggers = list.filter((n) => n && n.type === TELEGRAM_TRIGGER_TYPE);

  if (role === ROLE_HARNESS) {
    if (tgTriggers.length !== 0) {
      fail('a harness must contain ZERO telegramTrigger nodes, found ' + tgTriggers.length
        + ': ' + tgTriggers.map((n) => n.name).join(', '));
    }
    // Any Telegram credential at all, on any node, is a refusal for a harness.
    list.forEach((n) => {
      if (telegramCredentialId(n)) {
        fail('harness node ' + JSON.stringify(n.name) + ' carries a Telegram credential');
      }
    });

    // The substitute, if present, must be the safe shape.
    const sub = list.find((n) => n && n.name === SUBSTITUTE_NODE_NAME);
    if (sub) {
      if (sub.type !== CODE_TYPE) {
        fail('the node named ' + JSON.stringify(SUBSTITUTE_NODE_NAME) + ' must be a Code node in a '
          + 'harness, found ' + sub.type + ' -- this is the exact substitution the contract permits, '
          + 'and only as a Code node');
      }
      if (sub.credentials) {
        fail('the ' + JSON.stringify(SUBSTITUTE_NODE_NAME) + ' substitute carries credentials');
      }
      if (isTriggerType(sub.type)) {
        fail('the ' + JSON.stringify(SUBSTITUTE_NODE_NAME) + ' substitute is a trigger type');
      }
    } else {
      notes.push('no ' + SUBSTITUTE_NODE_NAME + ' substitute present');
    }
    return { ok: failures.length === 0, role: role, failures: failures, notes: notes };
  }

  // ---- role: canary -------------------------------------------------------------------
  tgTriggers.forEach((n) => {
    const cred = telegramCredentialId(n);
    if (cred !== PRODUCTION_BOT_CREDENTIAL_ID) {
      notes.push('telegramTrigger ' + JSON.stringify(n.name) + ' does not carry the production bot credential');
      return;
    }
    // Option A: disabled AND inactive. Otherwise: refused.
    if (n.disabled !== true) {
      fail('telegramTrigger ' + JSON.stringify(n.name) + ' carries the PRODUCTION bot credential '
        + PRODUCTION_BOT_CREDENTIAL_ID + ' and is NOT disabled -- deployment refused. Activating '
        + 'this would silently take every client message from the live bot.');
    }
    if (active !== false) {
      fail('the artifact carrying the production-credentialed telegramTrigger has active='
        + JSON.stringify(active) + '; it must be exactly false');
    }
    if (Object.prototype.hasOwnProperty.call(n, 'webhookId')) {
      fail('telegramTrigger ' + JSON.stringify(n.name) + ' still carries an inherited webhookId');
    }
  });

  // The stronger artifact-level property.
  const enabledTriggers = list.filter((n) => n && isTriggerType(n.type) && n.disabled !== true);
  if (enabledTriggers.length !== 0) {
    fail('the canary artifact has ' + enabledTriggers.length + ' ENABLED trigger node(s): '
      + enabledTriggers.map((n) => n.name + ' [' + n.type + ']').join(', ')
      + ' -- a disabled Telegram trigger is no guard if another entry point can start the workflow');
  }

  return { ok: failures.length === 0, role: role, failures: failures, notes: notes };
}

module.exports = {
  PRODUCTION_BOT_CREDENTIAL_ID,
  TELEGRAM_TRIGGER_TYPE,
  CODE_TYPE,
  SUBSTITUTE_NODE_NAME,
  ROLE_CANARY,
  ROLE_HARNESS,
  isTriggerType,
  telegramCredentialId,
  evaluateTriggerSafety
};
