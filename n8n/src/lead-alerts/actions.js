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
// __CRM_STAGE_RESOLVER__
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
    // OWNER CORRECTION 2026-09-04: the visible label is Russian; callback_data below is unchanged.
    nurture: '🗂 В наблюдение'
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
  var TERMINAL_STAGE = ['nurture', 'won', 'lost', 'closed'];

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
      || TERMINAL_STAGE.indexOf(norm(s.deal_stage)) !== -1
      || (typeof CRM_STAGE_RESOLVER !== 'undefined' && CRM_STAGE_RESOLVER.isTerminalStage(s.deal_stage));
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
    // NARROWED by owner requirement 5: snooze owns the two date fields and NOTHING else.
    // sla_status is deliberately absent — SLA Select already skips a lead whose
    // sla_snooze_until is in the future, so writing 'Snoozed' was cosmetic, and writing a
    // status the action does not need is exactly the drift this pass removes.
    snooze: ['sla_snooze_until', 'next_follow_up_at'],
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

  // Decided against the FRESHLY READ row, never against the state the alert was rendered with.
  //
  // Three distinct refusals, because the owner is told three different things (D10):
  //   TERMINAL         the lead is closed for actions
  //   ALREADY_APPLIED  this exact action is already the current state
  //   STATE_CHANGED    the lead moved on, and this action is no longer one of the valid ones
  function refuseReason(action, row, kind) {
    if (!action) { return 'UNKNOWN_ACTION'; }
    if (isTerminal(row)) { return 'TERMINAL'; }
    if (alreadyApplied(action, row)) { return 'ALREADY_APPLIED'; }
    if (kind && chooseActions(kind, row).indexOf(action) === -1) { return 'STATE_CHANGED'; }
    return '';
  }

  // ── POST-WRITE VERIFICATION ──────────────────────────────────────────────────────────────────
  //
  // The owner is not told an action succeeded because a Sheets node did not throw. The row is read
  // back and every field the action claimed to write is compared to what it intended. A mismatch
  // is a failed action, and it is reported as one.
  function verifyMutation(upd, row) {
    var mismatched = [];
    var r = row || {};
    for (var k in upd) {
      if (!Object.prototype.hasOwnProperty.call(upd, k)) { continue; }
      if (k === 'lead_id') { continue; }
      if (String(r[k] == null ? '' : r[k]) !== String(upd[k] == null ? '' : upd[k])) {
        mismatched.push(k);
      }
    }
    return { ok: mismatched.length === 0, mismatched: mismatched };
  }

  // Which fields an action must leave alone — everything on the row it does not own. Used by the
  // gate to prove preservation against a real pre-image rather than against a short allow-list.
  function untouchedFields(action, row) {
    var owned = (OWNED[action] || []).concat(['lead_id']);
    var out = [];
    for (var k in (row || {})) {
      if (Object.prototype.hasOwnProperty.call(row, k) && owned.indexOf(k) === -1) { out.push(k); }
    }
    return out;
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
    // LA.header() already prefixes «FINMENTOR · ». Passing the prefix again produced
    // «FINMENTOR · FINMENTOR · ACTION UPDATED», which the first live execution of the deployed
    // node body showed before anything was written.
    var head = LA.header(TITLE[action] || 'ACTION UPDATED');
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

  // The refusals, in the same voice. No stack trace, no workflow id, no execution id, and no lead
  // data the owner did not already have in the alert they tapped.
  function refusal(LA, reason, company) {
    var name = LA.tidy(company, 70);
    var ident = name ? '<b>' + LA.esc(name) + '</b>' : '';
    var head = LA.header('ACTION');
    if (reason === 'ALREADY_APPLIED') {
      return LA.join([head, ident, '<b>Действие уже применено.</b>']);
    }
    if (reason === 'STATE_CHANGED') {
      return LA.join([head, ident, '<b>Статус лида уже изменился. Доступные действия обновлены.</b>']);
    }
    if (reason === 'TERMINAL') {
      return LA.join([head, ident, '<b>Статус лида уже изменился. Доступные действия обновлены.</b>',
        LA.esc('Лид закрыт для действий — изменения не внесены.')]);
    }
    if (reason === 'NOT_FOUND') {
      return LA.join([head, '<b>Лид не найден.</b>', LA.esc('Изменения не внесены.')]);
    }
    return LA.join([head, ident, '<b>Не удалось применить действие.</b>',
      LA.esc('Изменения не внесены. Попробуйте ещё раз.')]);
  }

  // ── PRESENTATION FAILURE IS NOT BUSINESS FAILURE ─────────────────────────────────────────────
  //
  // The Pipeline write succeeded and was verified; only the Telegram edit failed. The owner must
  // not be told the action failed, and the mutation must NOT be retried — repeating it would move
  // a timestamp for a presentation problem.
  function presentationFailure(LA, action, company, upd, offsetMinutes) {
    var done = confirm(LA, action, company, upd, offsetMinutes);
    return LA.join([done, '<b>Не удалось обновить кнопки в сообщении.</b>']);
  }

  // ── A NO-OP EDIT IS NOT A FAILURE ────────────────────────────────────────────────────────────
  //
  // Execution 5062: the owner snoozed a PRIORITY alert. The write was correct and verified, and the
  // keyboard the post-write state allows was IDENTICAL to the one already on the message — snooze
  // is deliberately not idempotent-by-state, and `deal_stage` did not move, so nothing about the
  // presentation changed. `editMessageText` was therefore a no-op and Telegram answered
  // «message is not modified». The owner was told the buttons could not be updated, when in truth
  // they were already right.
  //
  // The copy states what is true and nothing more: the action landed, and the presentation was
  // already current. It does NOT claim Telegram changed the message. The authority for the action
  // remains the write, the read-back and the verification — never the edit.
  function presentationNoop(LA, action, company, upd, offsetMinutes) {
    var done = confirm(LA, action, company, upd, offsetMinutes);
    return LA.join([done, LA.esc('Кнопки уже актуальны — обновление не потребовалось.')]);
  }

  // ── CLASSIFYING THE EDIT ─────────────────────────────────────────────────────────────────────
  //
  // Three outcomes, and only three. Two of them may speak success.
  //
  //   EDIT_UPDATED  the edit changed the message
  //   EDIT_NOOP     Telegram answered "message is not modified" — there was nothing to change
  //   EDIT_FAILED   anything else, without exception
  //
  // THE EXCEPTION IS EXACT AND IT FAILS CLOSED. Only Telegram's own «Bad Request: message is not
  // modified» class is a no-op, matched at the START of the message so no other error can carry
  // the phrase in. Everything else stays a failure: «message to edit not found», «can't parse
  // entities», «chat not found», «Unauthorized», «Forbidden: bot was blocked by the user», any
  // other 400, and an error object this cannot read at all. There is no blanket 400 rule and no
  // substring search that could catch a different error by accident.
  //
  // Note what is NOT required here: re-deriving that the keyboards matched. Telegram returns this
  // error ONLY when the new content and reply markup are identical to what is already displayed —
  // that answer IS the proof, from the side that holds the truth. `sameKeyboard` below would
  // re-derive it from data the callback does not carry, which is why it stays unused.
  var EDIT_OUTCOME = { UPDATED: 'EDIT_UPDATED', NOOP: 'EDIT_NOOP', FAILED: 'EDIT_FAILED' };
  var EDIT_NOOP_PREFIX = 'Bad Request: message is not modified';

  // n8n surfaces a failed node's error as a STRING on some versions and as an OBJECT on others —
  // execution 5062 carried a string, the offline fixtures carried `{message}`. Both must classify
  // the same way, so the message is extracted through one chain, and the acknowledgement
  // expression on `Telegram Update Reply` implements this exact chain.
  function editErrorText(item) {
    var it = item || {};
    var e = it.error;
    var m = (e && e.message) || (e && e.description) || e || '';
    return String(m);
  }

  function classifyEdit(item) {
    var it = item || {};
    var e = it.error;
    if (e === undefined || e === null || e === '') { return EDIT_OUTCOME.UPDATED; }
    // indexOf === 0, never a bare search: an error that merely MENTIONS the phrase is still a
    // failure.
    return editErrorText(it).indexOf(EDIT_NOOP_PREFIX) === 0
      ? EDIT_OUTCOME.NOOP : EDIT_OUTCOME.FAILED;
  }

  // Which of the three copies an outcome speaks. EDIT_UPDATED and EDIT_NOOP both acknowledge
  // success, because in both the business result is done and proven; only the sentence about the
  // buttons differs.
  var EDIT_COPY_KEY = {
    EDIT_UPDATED: 'reply_text',
    EDIT_NOOP: 'reply_text_presentation_noop',
    EDIT_FAILED: 'reply_text_presentation_failed'
  };
  function editCopyKey(outcome) { return EDIT_COPY_KEY[outcome] || EDIT_COPY_KEY.EDIT_FAILED; }

  // Telegram answers "message is not modified" when an edit would change nothing. That is only
  // acceptable when the keyboard we computed is provably identical to the one already shown —
  // otherwise an arbitrary edit error would be laundered into success.
  function sameKeyboard(a, b) {
    var norm2 = function (rows) {
      return JSON.stringify((rows || []).map(function (r) {
        return (r || []).map(function (x) { return [String(x.text), String(x.callback_data)]; });
      }));
    };
    return norm2(a) === norm2(b);
  }

  // ── EDITING THE ORIGINAL ALERT — and the constraint that forced this ─────────────────────────
  //
  // The approved design says: after a successful mutation, edit the ORIGINAL alert's keyboard, and
  // do not edit the message text unless structurally necessary.
  //
  // IT IS STRUCTURALLY NECESSARY. Telegram has `editMessageReplyMarkup`, which edits the keyboard
  // and nothing else — but the n8n Telegram node does not expose it. Its only edit operation is
  // `editMessageText`, whose `text` parameter is REQUIRED. Verified against the node's own type
  // definition (v1.2, resource=message): the message operations are send*, editMessageText,
  // deleteChatMessage, pin/unpin. There is no reply-markup-only edit, and reaching the raw Bot API
  // would mean putting the bot token in an HTTP Request URL — a secret in a workflow parameter,
  // which this repository does not do.
  //
  // So the edit must re-send the text. Telegram hands the callback the message as PLAIN text plus
  // an `entities` array; re-sending that plain text would strip every <b> and <code> and visibly
  // downgrade a premium alert. This rebuilds the HTML from text + entities so the edited message is
  // byte-identical to the original, and the gate proves that round-trip on the real rendered
  // alerts rather than on a sample.
  //
  // Offsets are UTF-16 code units, which is exactly how JavaScript indexes strings, so they map
  // directly — no conversion, and no place for an off-by-one to hide.
  var ENTITY_TAG = {
    bold: 'b', italic: 'i', underline: 'u', strikethrough: 's',
    code: 'code', pre: 'pre', spoiler: 'tg-spoiler'
  };

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function openTag(e) {
    if (e.type === 'text_link') { return '<a href="' + escHtml(e.url || '') + '">'; }
    var t = ENTITY_TAG[e.type];
    return t ? '<' + t + '>' : '';
  }
  function closeTag(e) {
    if (e.type === 'text_link') { return '</a>'; }
    var t = ENTITY_TAG[e.type];
    return t ? '</' + t + '>' : '';
  }

  // Rebuild Telegram HTML from the plain text and entities of a message the bot sent.
  // An entity type this does not know is SKIPPED rather than guessed at — the text survives
  // unstyled, which is a visible but harmless degradation, where inventing a tag would not be.
  // Two entities CROSS when they partially overlap without one containing the other. Telegram
  // never emits that, so seeing it means the input is not what it claims to be — and emitting
  // crossed tags would produce markup Telegram rejects, which would fail the edit and strand the
  // owner's keyboard. The fail-safe is the whole message as escaped plain text: visibly unstyled,
  // never corrupt, and never invented.
  function entitiesCross(list) {
    for (var i = 0; i < list.length; i++) {
      for (var j = i + 1; j < list.length; j++) {
        var a = list[i];
        var b = list[j];
        var aEnd = a.offset + a.length;
        var bEnd = b.offset + b.length;
        var overlaps = a.offset < bEnd && b.offset < aEnd;
        var contains = (a.offset <= b.offset && bEnd <= aEnd) || (b.offset <= a.offset && aEnd <= bEnd);
        if (overlaps && !contains) { return true; }
      }
    }
    return false;
  }

  function htmlFromTelegram(text, entities) {
    var s = String(text == null ? '' : text);
    var list = (entities || []).filter(function (e) {
      // Range sanity first: a negative offset, a non-positive length or a range past the end of
      // the string is dropped rather than clamped. Clamping would silently move formatting.
      return e && typeof e.offset === 'number' && typeof e.length === 'number'
        && e.offset >= 0 && e.length > 0 && (e.offset + e.length) <= s.length
        && (ENTITY_TAG[e.type] || e.type === 'text_link');
    });
    if (list.length === 0) { return escHtml(s); }
    if (entitiesCross(list)) { return escHtml(s); }

    var events = [];
    for (var i = 0; i < list.length; i++) {
      events.push({ pos: list[i].offset, kind: 1, len: list[i].length, e: list[i], i: i });
      events.push({ pos: list[i].offset + list[i].length, kind: 0, len: list[i].length, e: list[i], i: i });
    }
    // Closes before opens at the same position; longer opens first and shorter closes first, so
    // nested entities produce correctly nested tags rather than crossed ones.
    events.sort(function (a, b) {
      if (a.pos !== b.pos) { return a.pos - b.pos; }
      if (a.kind !== b.kind) { return a.kind - b.kind; }
      if (a.kind === 1) { return b.len - a.len || a.i - b.i; }
      return a.len - b.len || a.i - b.i;
    });

    var out = '';
    var cursor = 0;
    for (var k = 0; k < events.length; k++) {
      var ev = events[k];
      if (ev.pos > cursor) { out += escHtml(s.slice(cursor, ev.pos)); cursor = ev.pos; }
      out += ev.kind === 1 ? openTag(ev.e) : closeTag(ev.e);
    }
    if (cursor < s.length) { out += escHtml(s.slice(cursor)); }
    return out;
  }

  // Which action set the ORIGINAL alert was rendered with, derived from the keyboard it carried
  // rather than from a new field in callback_data. A NEW LEAD alert never offers «Обработано», so
  // the presence of a `done|` button is the discriminator — and it needs one boolean carried
  // through the callback path, not the whole keyboard.
  function originKind(hadDone) { return hadDone ? 'priority' : 'new_lead'; }

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
    htmlFromTelegram: htmlFromTelegram,
    originKind: originKind,
    ENTITY_TAG: ENTITY_TAG,
    confirm: confirm,
    verifyMutation: verifyMutation,
    untouchedFields: untouchedFields,
    presentationFailure: presentationFailure,
    presentationNoop: presentationNoop,
    EDIT_OUTCOME: EDIT_OUTCOME,
    EDIT_NOOP_PREFIX: EDIT_NOOP_PREFIX,
    EDIT_COPY_KEY: EDIT_COPY_KEY,
    editErrorText: editErrorText,
    classifyEdit: classifyEdit,
    editCopyKey: editCopyKey,
    sameKeyboard: sameKeyboard,
    entitiesCross: entitiesCross,
    refusal: refusal
  };
})();
// =================== END FINMENTOR LEAD ALERT ACTIONS ===================
