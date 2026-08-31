// ===================== FINMENTOR LEAD ALERT ACTIONS — one decision module =====================
//
// Spliced into the alert renderers (which actions, which keyboard shape) and into the Command
// Center (which columns an action owns, what the owner is told). One module, because the button a
// tap came from and the write that tap performs are two halves of one contract, and they drifted
// once already: the deployed keyboard offered «✅ Done» while the mutation only closed an SLA.
//
// It depends on the presenter for escaping and date rendering — `LA` must be in scope. It never
// re-implements `esc`, `card`, `join` or `dateTime`: a second date formatter is a second clock.
//
// ── WHAT THE AUDIT MEASURED, AND WHAT THIS CHANGES ─────────────────────────────────────────────
//
// Nothing here invents a business action. Every mutation below is the one already deployed in
// `Find & Build Update`, narrowed to the columns it actually owns. The labels change, the layout
// changes, the confirmations become truthful, and the writes stop carrying fifteen pre-read
// columns. The callback_data strings are byte-identical to what is already in production, so every
// historical Telegram message keeps working.
const LAA = (function () {
  'use strict';

  // ── D3 — the owner-facing labels, exactly as approved ────────────────────────────────────────
  //
  // Icons are permitted in buttons only; the alert body stays emoji-free. «Обработано», not
  // «Выполнено» (D7): the measured action closes SLA handling, it does not close the deal.
  var LABEL = {
    done: '✅ Обработано',
    snooze: '⏰ На 24 часа',
    discovery: '📞 Discovery',
    docs: '📄 Документы',
    nurture: '🗂 В Nurture'
  };

  // ── callback_data is PRESERVED VERBATIM ──────────────────────────────────────────────────────
  //
  // The handler contract is already correct, so renaming a callback for presentation would break
  // every alert already sitting in the owner's Telegram history for nothing. `won|` is deliberately
  // absent from the emitters and deliberately still routed by the Command Center (D1).
  function callbackData(action, leadId) {
    var id = String(leadId == null ? '' : leadId);
    if (action === 'done') { return 'done|' + id; }
    if (action === 'snooze') { return 'snooze|' + id + '|24'; }
    if (action === 'discovery') { return 'stage|' + id + '|Discovery Scheduled'; }
    if (action === 'docs') { return 'docs|' + id; }
    if (action === 'nurture') { return 'nurture|' + id; }
    return '';
  }

  // ── D2 — the owner-approved action sets, in the owner's order ────────────────────────────────
  //
  // NEW LEAD deliberately omits «Обработано»: a lead that arrived seconds ago has not been
  // handled, and offering the SLA-closing action as a first response invites closing an SLA that
  // never opened. It also omits Won (D1).
  var SET = {
    new_lead: ['discovery', 'docs', 'snooze', 'nurture'],
    priority: ['done', 'snooze', 'discovery', 'docs', 'nurture'],
    followup: ['done', 'snooze', 'discovery', 'docs', 'nurture']
  };

  // Terminal states carry NO keyboard. Only existing Pipeline values are read — no new taxonomy,
  // no new column.
  var TERMINAL_SLA = ['done', 'nurture'];
  var TERMINAL_STAGE = ['nurture', 'won'];

  // The state an action would set. An action whose result is already the current state is hidden
  // from the keyboard and refused harmlessly by the handler (D11) — the two must agree, which is
  // why they read the same table.
  var CURRENT_STATE_OF = {
    discovery: { field: 'deal_stage', value: 'discovery scheduled' },
    docs: { field: 'deal_stage', value: 'documents requested' }
  };

  function norm(v) { return String(v === undefined || v === null ? '' : v).trim().toLowerCase(); }

  function isTerminal(state) {
    var s = state || {};
    return TERMINAL_SLA.indexOf(norm(s.sla_status)) !== -1
      || TERMINAL_STAGE.indexOf(norm(s.deal_stage)) !== -1;
  }

  // The actions this alert should offer, given what the lead already is.
  function chooseActions(kind, state) {
    if (isTerminal(state)) { return []; }
    var set = SET[kind] || [];
    var s = state || {};
    var out = [];
    for (var i = 0; i < set.length; i++) {
      var a = set[i];
      var cur = CURRENT_STATE_OF[a];
      if (cur && norm(s[cur.field]) === cur.value) { continue; }
      out.push(a);
    }
    return out;
  }

  // ── D3 — never more than two buttons in a row ────────────────────────────────────────────────
  //
  // Straight two-packing in the owner's order reproduces every approved layout exactly:
  //   NEW LEAD  discovery, docs, snooze, nurture      -> [2][2]
  //   PRIORITY  done, snooze, discovery, docs, nurture -> [2][2][1]
  // and it degrades correctly when one action is hidden, which the approved layouts do not
  // themselves specify: five minus one is [2][2], four minus one is [2][1]. Both stay within the
  // rule that matters — two per row — which is what stops Telegram truncating labels to «D…».
  function keyboard(kind, state, leadId) {
    var actions = chooseActions(kind, state);
    var rows = [];
    for (var i = 0; i < actions.length; i += 2) {
      var row = [];
      for (var j = i; j < i + 2 && j < actions.length; j++) {
        row.push({ action: actions[j], text: LABEL[actions[j]], callback_data: callbackData(actions[j], leadId) });
      }
      rows.push(row);
    }
    return rows;
  }

  // The renderer picks a node by SHAPE, because an n8n Telegram node has a fixed number of rows
  // and a fixed number of buttons in each. `NONE` means send the alert with no keyboard at all.
  function shape(rows) {
    if (!rows || rows.length === 0) { return 'NONE'; }
    return 'KB' + rows.map(function (r) { return r.length; }).join('');
  }

  // ── D10 — SPARSE, ACTION-OWNED UPDATES ───────────────────────────────────────────────────────
  //
  // The deployed builder carried FIFTEEN pre-read columns into an autoMap update, so two taps
  // seconds apart wrote each other's stale values back over anything that had changed in between.
  // Each action now writes only the columns it owns. `lead_id` is present because it is the match
  // key, not because it is written.
  //
  // This removes the lost update of UNRELATED columns. It does NOT make two taps that both target
  // `deal_stage` atomic — see RESIDUAL_RACE below.
  var OWNED = {
    done: ['sla_status', 'last_contacted_at'],
    snooze: ['sla_status', 'sla_snooze_until', 'next_follow_up_at'],
    discovery: ['deal_stage'],
    docs: ['deal_stage', 'documents_requested_at', 'next_follow_up_at'],
    nurture: ['deal_stage', 'sla_status']
  };

  // The callback verb the handler receives -> the action this module reasons about. `stage` is the
  // deployed verb for Discovery and carries its target stage as an argument.
  function actionOfCommand(command, stageValue) {
    var c = norm(command);
    if (c === 'done') { return 'done'; }
    if (c === 'snooze') { return 'snooze'; }
    if (c === 'docs') { return 'docs'; }
    if (c === 'nurture') { return 'nurture'; }
    if (c === 'stage' && norm(stageValue) === 'discovery scheduled') { return 'discovery'; }
    return '';
  }

  var HOUR = 3600000;

  // Builds the update. `nowIso` is passed in rather than read from the clock so the gate can prove
  // the arithmetic instead of tolerating it.
  function buildUpdate(action, leadId, nowIso) {
    var now = new Date(nowIso);
    var iso = now.toISOString();
    var upd = { lead_id: String(leadId == null ? '' : leadId) };
    if (action === 'done') {
      upd.sla_status = 'Done';
      upd.last_contacted_at = iso;
    } else if (action === 'snooze') {
      // D4 — the measured business action, unchanged: tap time + 24 hours. Storage stays UTC.
      var until = new Date(now.getTime() + 24 * HOUR).toISOString();
      upd.sla_status = 'Snoozed';
      upd.sla_snooze_until = until;
      upd.next_follow_up_at = until;
    } else if (action === 'discovery') {
      // D5 — stage only. No calendar event, no follow-up, no due date, and the confirmation must
      // not pretend otherwise.
      upd.deal_stage = 'Discovery Scheduled';
    } else if (action === 'docs') {
      upd.deal_stage = 'Documents Requested';
      upd.documents_requested_at = iso;
      upd.next_follow_up_at = new Date(now.getTime() + 48 * HOUR).toISOString();
    } else if (action === 'nurture') {
      upd.deal_stage = 'Nurture';
      upd.sla_status = 'Nurture';
    } else {
      return null;
    }
    return upd;
  }

  // ── D11 — is this tap a no-op? ───────────────────────────────────────────────────────────────
  //
  // Read from the freshly-read row, never from the alert the tap came from. An already-applied
  // action is acknowledged harmlessly and performs NO write, which is what stops a duplicate tap
  // moving `documents_requested_at` or re-basing a snooze the owner did not ask to move.
  function alreadyApplied(action, row) {
    var r = row || {};
    if (action === 'done') { return norm(r.sla_status) === 'done'; }
    if (action === 'discovery') { return norm(r.deal_stage) === 'discovery scheduled'; }
    if (action === 'docs') { return norm(r.deal_stage) === 'documents requested'; }
    if (action === 'nurture') { return norm(r.deal_stage) === 'nurture' && norm(r.sla_status) === 'nurture'; }
    // Snooze is deliberately NOT idempotent-by-state: «отложить ещё на 24 часа» is a real
    // instruction, and refusing it because the lead is already Snoozed would be wrong. It is safe
    // to repeat because it re-bases from the tap time rather than compounding.
    return false;
  }

  // A tap on an alert whose lead has since reached a terminal state is refused rather than applied.
  function refuseReason(action, row) {
    if (!action) { return 'UNKNOWN_ACTION'; }
    if (isTerminal(row)) { return 'TERMINAL'; }
    if (alreadyApplied(action, row)) { return 'ALREADY_APPLIED'; }
    return '';
  }

  // ── the owner-facing confirmation ────────────────────────────────────────────────────────────
  //
  // Rendered only AFTER the authoritative Pipeline write succeeds (D8/D9). Every date is shown in
  // Europe/Chisinau via the presenter's own formatter; storage stays UTC (D4).
  var TITLE = {
    done: 'ACTION UPDATED',
    snooze: 'FOLLOW-UP UPDATED',
    discovery: 'STAGE UPDATED',
    docs: 'ACTION UPDATED',
    nurture: 'STAGE UPDATED'
  };

  function confirm(LA, action, company, upd, offsetMinutes) {
    var name = LA.tidy(company, 70) || '—';
    var head = LA.header('FINMENTOR · ' + (TITLE[action] || 'ACTION UPDATED'));
    var ident = '<b>' + LA.esc(name) + '</b>';
    var body = [];

    if (action === 'done') {
      body.push(LA.card('Статус', '<b>Обработано</b>'));
      body.push(LA.card('Что изменилось', LA.esc('SLA закрыт. Лид остаётся в работе.')));
    } else if (action === 'snooze') {
      body.push(LA.card('Статус', '<b>Отложено</b>'));
      body.push(LA.card('Вернуться к контакту',
        '<b>' + LA.esc(LA.dateTime(upd.next_follow_up_at, offsetMinutes)) + '</b>'));
    } else if (action === 'discovery') {
      // D5 — truthful. The action moves a stage; it schedules nothing.
      body.push(LA.card('Стадия', '<b>Discovery</b>'));
      body.push(LA.card('Что изменилось', LA.esc('Лид переведён в стадию Discovery. Встреча не назначена.')));
    } else if (action === 'docs') {
      body.push(LA.card('Стадия', '<b>Запрошены документы</b>'));
      body.push(LA.card('Следующий контакт',
        '<b>' + LA.esc(LA.dateTime(upd.next_follow_up_at, offsetMinutes)) + '</b>'));
    } else if (action === 'nurture') {
      body.push(LA.card('Стадия', '<b>Nurture</b>'));
      body.push(LA.card('Что изменилось', LA.esc('SLA-напоминания по этому лиду отключены.')));
    }

    return LA.join([head, ident].concat(body));
  }

  // The refusals, in the same voice. No stack trace, no lead data the owner did not already have.
  function refusal(LA, reason, company) {
    var name = LA.tidy(company, 70);
    var ident = name ? '<b>' + LA.esc(name) + '</b>' : '';
    if (reason === 'ALREADY_APPLIED') {
      return LA.join([LA.header('FINMENTOR · ACTION'), ident, '<b>Действие уже применено.</b>']);
    }
    if (reason === 'TERMINAL') {
      return LA.join([LA.header('FINMENTOR · ACTION'), ident,
        '<b>Лид закрыт для действий.</b>', LA.esc('Статус уже финальный — изменения не внесены.')]);
    }
    if (reason === 'NOT_FOUND') {
      return LA.join([LA.header('FINMENTOR · ACTION'), '<b>Лид не найден.</b>',
        LA.esc('Изменения не внесены.')]);
    }
    return LA.join([LA.header('FINMENTOR · ACTION'), ident, '<b>Не удалось применить действие.</b>',
      LA.esc('Изменения не внесены. Попробуйте ещё раз.')]);
  }

  // ── D10, stated rather than claimed ──────────────────────────────────────────────────────────
  //
  // The Pipeline is a Google Sheet. `Update Pipeline Row` matches on `lead_id` and writes the keys
  // present on its input item; there is no conditional update, no row version and no
  // compare-and-set anywhere in the stack. So:
  //
  //   * two taps on DIFFERENT columns are now safe — each writes only what it owns;
  //   * two taps racing on the SAME column (Discovery and Documents both writing `deal_stage`)
  //     resolve last-writer-wins, and this design does NOT prevent that.
  //
  // It is reported rather than papered over, because the honest mitigation — a version column and
  // a conditional write — is a Pipeline schema change, and no schema change is authorised here.
  var RESIDUAL_RACE = {
    scope: 'two simultaneous taps whose actions write the SAME field',
    example: 'Discovery and Documents both set deal_stage',
    behaviour: 'last writer wins',
    prevented: false,
    why_not: 'Google Sheets offers no atomic compare-and-set here, and a version column would be a '
      + 'Pipeline schema change, which is not authorised in this pass',
    unrelated_columns: 'NOT affected — sparse updates mean an action never writes a column it does not own'
  };

  return {
    LABEL: LABEL,
    SET: SET,
    OWNED: OWNED,
    TERMINAL_SLA: TERMINAL_SLA,
    TERMINAL_STAGE: TERMINAL_STAGE,
    RESIDUAL_RACE: RESIDUAL_RACE,
    callbackData: callbackData,
    isTerminal: isTerminal,
    chooseActions: chooseActions,
    keyboard: keyboard,
    shape: shape,
    actionOfCommand: actionOfCommand,
    buildUpdate: buildUpdate,
    alreadyApplied: alreadyApplied,
    refuseReason: refuseReason,
    confirm: confirm,
    refusal: refusal
  };
})();
// =================== END FINMENTOR LEAD ALERT ACTIONS ===================
