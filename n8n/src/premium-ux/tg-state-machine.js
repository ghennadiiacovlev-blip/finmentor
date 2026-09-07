// FINMENTOR Premium UX — the Telegram entry state machine.
//
// Pure decision logic for the nine approved Telegram states. No I/O: it takes a resolved
// authority snapshot and one input, and returns the next state, the copy to render and the writes
// to perform. qa/premium-ux-state.test.mjs drives it, including the mutations that must fail.
//
// THE DEFECT THIS REPLACES. `Get Bot Session` in the deployed Concierge does, unconditionally:
//
//     const isStart = text === '/start';
//     if (isStart) reset = 'start';
//
// so a `/start` after a committed lead archives lead_id, clears consent, wipes every qualification
// answer and shows the menu — silently. Phase 1 proved it; owner decision 3 forbids it.
//
// THE RULE, stated once and enforced by `decide()` alone:
//
//     After a successful committed submission, NO input may return the user to qualification
//     without an explicit new-request action.
//
// Exactly TWO branches in this file rotate the cycle, and both require an explicit confirmed
// action:
//
//   ACTIONS.NEW_CONFIRM      «Начать новый вопрос», confirmed, on a COMMITTED cycle
//                            → archives the lead and mints a new cycle
//   ACTIONS.RESTART_CONFIRM  «Начать новое», confirmed, on an UNCOMMITTED draft
//                            → mints a new cycle and archives nothing, because there is no lead
//
// Neither is reachable from a single tap: each is preceded by its own confirmation screen. The QA
// gate counts the rotate branches, so adding a third fails the build rather than a review.

'use strict';

const B = require('./branches.js');

const STATES = [
  'TG_ENTRY', 'TG_FREEFORM_PROBLEM', 'TG_CONFIRM_CONTEXT', 'TG_OPEN_BRIEF',
  'TG_RESUME_DRAFT', 'TG_SUBMITTED', 'TG_APPEND_MESSAGE', 'TG_NEW_REQUEST_CONFIRM',
  'TG_INFRA_FAILURE'
];

// Callback vocabulary. Short, because Telegram caps callback_data at 64 bytes.
const ACTIONS = {
  DESCRIBE: 'p|describe',        // Описать задачу
  BRIEF: 'p|brief',              // Подготовить бриф
  CONFIRM_OK: 'p|ctx_ok',        // Всё верно
  CONFIRM_FIX: 'p|ctx_fix',      // Исправить
  OPEN: 'p|open',                // Открыть бриф (web_app)
  RESUME: 'p|resume',            // Продолжить
  RESTART: 'p|restart',          // Начать заново  → confirm, never rotates directly
  RESTART_CONFIRM: 'p|restart_y',// Начать новое   → the confirmed discard
  APPEND: 'p|append',            // Добавить к обращению
  NEW: 'p|new',                  // Начать новый вопрос → confirm, never rotates directly
  NEW_CONFIRM: 'p|new_y',        // Начать новый вопрос (confirmed) → THE ONLY ROTATE
  BACK: 'p|back',                // Вернуться
  RETRY: 'p|retry'               // Повторить
};

// Authority snapshot shape, resolved server-side from Bot_Sessions before `decide` is called:
//   { cycle_id, lead_id, lead_cycle_id, has_draft, draft_step, context_extracted }
// `committed` is derived, never trusted from a caller.
function isCommitted(auth) {
  const a = auth || {};
  const lead = String(a.lead_id || '').trim();
  if (!lead) { return false; }
  // A lead from another cycle does not make THIS cycle committed — the existing cycle-semantics
  // gate already invalidates it, and this mirrors that rule rather than re-deriving it.
  return String(a.lead_cycle_id || '').trim() === String(a.cycle_id || '').trim();
}

function hasDraft(auth) {
  const a = auth || {};
  return a.has_draft === true && !isCommitted(a);
}

const screen = (state, copy, extra) => Object.assign({ state: state, copy: copy, rotate: false, writes: [] }, extra || {});

// ---------------------------------------------------------------- the decision

// `input` is { kind: 'command'|'callback'|'text', value }.
function decide(auth, input) {
  const a = auth || {};
  const i = input || {};
  const kind = i.kind;
  const value = String(i.value || '');
  const committed = isCommitted(a);
  const draft = hasDraft(a);

  // ---- /start: the three-way branch. Never rotates. -------------------------
  if (kind === 'command' && (value === '/start' || value === '/menu')) {
    if (committed) { return screen('TG_SUBMITTED', B.TG_COPY.TG_SUBMITTED); }
    if (draft) { return screen('TG_RESUME_DRAFT', B.TG_COPY.TG_RESUME_DRAFT); }
    return screen('TG_ENTRY', B.TG_COPY.TG_ENTRY);
  }

  // ---- committed cycle: only three destinations exist ----------------------
  // This block is the terminal guarantee. It runs BEFORE any qualification branch, so no callback
  // and no free text can reach a qualification state while a committed lead owns the cycle.
  if (committed) {
    if (kind === 'callback' && value === ACTIONS.APPEND) { return screen('TG_APPEND_MESSAGE', B.TG_COPY.TG_APPEND_MESSAGE); }
    if (kind === 'callback' && value === ACTIONS.NEW) { return screen('TG_NEW_REQUEST_CONFIRM', B.TG_COPY.TG_NEW_REQUEST_CONFIRM); }
    if (kind === 'callback' && value === ACTIONS.NEW_CONFIRM) {
      // THE ONLY ROTATE IN THIS FILE.
      return screen('TG_ENTRY', B.TG_COPY.TG_ENTRY, { rotate: true, writes: ['archive_lead', 'new_cycle'] });
    }
    if (kind === 'callback' && value === ACTIONS.BACK) { return screen('TG_SUBMITTED', B.TG_COPY.TG_SUBMITTED); }
    if (kind === 'text' && a.awaiting_append === true) {
      return screen('TG_APPEND_MESSAGE', B.TG_COPY.TG_APPEND_MESSAGE.done, {
        writes: ['activity_append'],
        append_text: value.slice(0, 500)
      });
    }
    // Anything else — a stray tap, a message, an old inline button — lands on the terminal screen.
    return screen('TG_SUBMITTED', B.TG_COPY.TG_SUBMITTED);
  }

  // ---- unfinished draft ----------------------------------------------------
  if (kind === 'callback' && value === ACTIONS.RESUME) {
    return screen('TG_OPEN_BRIEF', B.TG_COPY.TG_OPEN_BRIEF, { resume_step: String(a.draft_step || '') });
  }
  if (kind === 'callback' && value === ACTIONS.RESTART) {
    return screen('TG_NEW_REQUEST_CONFIRM', B.TG_COPY.TG_RESUME_DISCARD_CONFIRM);
  }
  if (kind === 'callback' && value === ACTIONS.RESTART_CONFIRM) {
    // A confirmed discard of an UNCOMMITTED draft. It rotates the cycle for cleanliness but
    // archives no lead, because there is none.
    return screen('TG_ENTRY', B.TG_COPY.TG_ENTRY, { rotate: true, writes: ['new_cycle'] });
  }

  // ---- entry / qualification ----------------------------------------------
  if (kind === 'callback' && value === ACTIONS.DESCRIBE) { return screen('TG_FREEFORM_PROBLEM', B.TG_COPY.TG_FREEFORM_PROBLEM); }
  if (kind === 'callback' && value === ACTIONS.BRIEF) { return screen('TG_OPEN_BRIEF', B.TG_COPY.TG_OPEN_BRIEF); }

  if (kind === 'text' && a.awaiting_problem === true) {
    // The free text is stored as the client's own words. Extraction may propose structure, but
    // everything it proposes is `ai_inferred` and cannot skip a question — see draft-contract.js.
    return screen('TG_CONFIRM_CONTEXT', B.TG_COPY.TG_CONFIRM_CONTEXT, {
      writes: ['free_text'],
      free_text: value.slice(0, 500)
    });
  }

  if (kind === 'callback' && value === ACTIONS.CONFIRM_OK) {
    // «Всё верно» is the only promotion of ai_inferred → user_confirmed, and it is explicit.
    return screen('TG_OPEN_BRIEF', B.TG_COPY.TG_OPEN_BRIEF, { writes: ['confirm_context'] });
  }
  if (kind === 'callback' && value === ACTIONS.CONFIRM_FIX) { return screen('TG_FREEFORM_PROBLEM', B.TG_COPY.TG_FREEFORM_PROBLEM); }

  if (kind === 'callback' && value === ACTIONS.RETRY) { return screen('TG_INFRA_FAILURE', B.TG_COPY.TG_INFRA_FAILURE, { retry: true }); }
  if (kind === 'callback' && value === ACTIONS.BACK) { return screen('TG_ENTRY', B.TG_COPY.TG_ENTRY); }

  return screen('TG_ENTRY', B.TG_COPY.TG_ENTRY);
}

// Which fields TG_CONFIRM_CONTEXT may render. A value with no content renders NO label — never
// «Компания: —» (owner decision C).
function confirmContextSections(extracted) {
  const e = extracted || {};
  const labels = B.TG_COPY.TG_CONFIRM_CONTEXT.labels;
  const out = [];
  for (const key of ['company_name', 'role', 'turnover_band', 'objective', 'problem_summary']) {
    const v = String(e[key] === null || e[key] === undefined ? '' : e[key]).trim();
    if (v) { out.push({ key: key, label: labels[key], value: v }); }
  }
  return out;
}

// The invariant, expressed so a test can call it rather than re-implement it.
function violatesTerminalRule(auth, input, outcome) {
  if (!isCommitted(auth)) { return false; }
  const qualification = ['TG_ENTRY', 'TG_FREEFORM_PROBLEM', 'TG_CONFIRM_CONTEXT', 'TG_OPEN_BRIEF', 'TG_RESUME_DRAFT'];
  const explicitNewRequest = input && input.kind === 'callback' && input.value === ACTIONS.NEW_CONFIRM;
  if (explicitNewRequest) { return false; }
  if (outcome.rotate === true) { return true; }
  return qualification.indexOf(outcome.state) !== -1;
}

module.exports = { STATES, ACTIONS, decide, isCommitted, hasDraft, confirmContextSections, violatesTerminalRule };
