/* FINMENTOR Premium Mini App — offline candidate (b3.0.0).
 *
 * Implements the 19 Mini App states over the 14 approved screens. Every string comes from
 * window.FM_CONTENT, generated from n8n/src/premium-ux/branches.js, so the copy cannot drift from
 * the gated contract.
 *
 * WHAT THIS BUILD DOES NOT DO, deliberately:
 *   · no network write of any kind — the session and submit endpoints are not deployed;
 *   · no file upload — v1 records document AVAILABILITY only (owner decision A), so there is no
 *     attach control anywhere and the UI never implies a file was sent;
 *   · no client-side skip decision — provenance is recorded, but the authority on whether a
 *     question may be skipped is the server's draft contract. This build mirrors the rule for
 *     navigation only, and a mirrored rule is a convenience, never a guarantee.
 */
(function () {
  'use strict';

  var C = window.FM_CONTENT;
  var tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
  var main = document.getElementById('main');
  var stagesEl = document.getElementById('stages');
  var backBtn = document.getElementById('back');

  function safe(fn) { try { fn(); } catch (e) { if (window.console) { console.warn('[premium]', e); } } }
  safe(function () {
    if (!tg) { return; }
    tg.ready(); tg.expand();
    if (tg.setHeaderColor) { tg.setHeaderColor('#08111F'); }
    if (tg.setBackgroundColor) { tg.setBackgroundColor('#08111F'); }
  });
  function tgUser() { return (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) ? tg.initDataUnsafe.user : null; }

  // THE ONLY WAY OUT OF THE APP, AND THE ONLY TELEGRAM CLOSE IN THE CLIENT.
  //
  // Every terminal screen routes its CTA through here, so there is one integration point rather
  // than one per screen: one place a client quirk can be handled, and one thing for the gate to
  // count. It performs no request, touches no draft and changes no state — leaving is not a
  // business event.
  //
  // If the Telegram client does not act on the close — some builds ignore it — the screen says
  // how to leave instead of presenting a control that looks dead. The hint is presentation only
  // and appears solely on that path; a successful close takes the page with it first.
  function closeApp(hintHost) {
    safe(function () {
      if (tg && typeof tg.close === 'function') { tg.close(); }
    });
    if (!hintHost || hintHost.__fmCloseHinted) { return; }
    safe(function () {
      setTimeout(function () {
        safe(function () {
          if (hintHost.__fmCloseHinted) { return; }
          // A screen that has already been replaced must not sprout a hint. Where the host gives
          // us no body to ask — the offline harness — there is nothing to have replaced it.
          if (document.body && !document.body.contains(hintHost)) { return; }
          hintHost.__fmCloseHinted = 1;
          hintHost.appendChild(el('div', 'quiet-hint', C.CLOSE_HINT));
        });
      }, 900);
    });
  }

  // ---------------------------------------------------------------- draft + provenance
  // Mirrors n8n/src/premium-ux/draft-contract.js. The server re-validates everything.
  var APPROVED_CARRIED = ['contact_name', 'locale', 'contact_channel'];
  var FIELDS = ['company_name', 'business_activity', 'role', 'turnover_band', 'objective',
    'problem', 'problem_free_text', 'desired_outcome', 'desired_outcome_free_text',
    'current_setup', 'decision_horizon', 'documents', 'contact_channel', 'contact_value',
    'important_context', 'locale', 'contact_name'];

  var draft = { v: 1, step: 'APP_BOOTSTRAP', fields: {} };
  FIELDS.forEach(function (n) { draft.fields[n] = { value: null, source: null, confirmed: false, at: null }; });

  function nowIso() { return new Date().toISOString(); }

  // Every mutation marks the draft dirty. It is FLUSHED on a screen transition rather than on
  // every keystroke: a PUT per character would be a hundred writes for one company name, and the
  // draft is cumulative, so the next flush carries everything an earlier one would have.
  var dirty = false;
  function set(name, value, source, confirmed) {
    draft.fields[name] = { value: value, source: source, confirmed: confirmed !== false, at: confirmed !== false ? nowIso() : null };
    dirty = true;
  }
  function clearField(name) {
    draft.fields[name] = { value: null, source: null, confirmed: false, at: null };
    dirty = true;
  }

  // Empty the brief and write the empty draft through, so the server forgets it too. The
  // SESSION is untouched: the same app_session_id, the same TTL, the same G5 claim behind it.
  function restartBrief() {
    FIELDS.forEach(function (n) { clearField(n); });
    editingField = null;
    history = [];
    carryFromTelegram();
    draft.step = 'APP_BOOTSTRAP';
    go('APP_BOOTSTRAP');
  }
  function get(name) { var f = draft.fields[name]; return f ? f.value : null; }
  // ai_inferred NEVER satisfies this, whatever the confirmed flag says.
  function settled(name) {
    var f = draft.fields[name];
    if (!f || f.confirmed !== true) { return false; }
    if (f.value === null || f.value === '' || (Array.isArray(f.value) && !f.value.length)) { return false; }
    if (f.source === 'user_explicit' || f.source === 'user_confirmed') { return true; }
    if (f.source === 'telegram_carried') { return APPROVED_CARRIED.indexOf(name) !== -1; }
    return false;
  }
  function objective() {
    var label = get('objective');
    if (!label) { return null; }
    for (var i = 0; i < C.OBJECTIVES.length; i++) { if (C.OBJECTIVES[i].label === label) { return C.OBJECTIVES[i]; } }
    return null;
  }
  function isFreeTextBranch() { var o = objective(); return !!o && C.PROBLEMS[o.id].mode === 'free_text'; }

  // The one identity the client carries from Telegram. `locale` is NOT set here: startup()
  // records what the Gateway stored, and the browser's language_code is a hint offered at
  // bootstrap, never the authority.
  function carryFromTelegram() {
    var u = tgUser();
    if (u && u.first_name) { set('contact_name', u.first_name, 'telegram_carried', true); }
  }

  // ---------------------------------------------------------------- flow
  var FLOW = ['APP_COMPANY', 'APP_ROLE', 'APP_SCALE', 'APP_OBJECTIVE', 'APP_PROBLEM',
    'APP_DESIRED_OUTCOME', 'APP_CURRENT_SETUP', 'APP_DECISION_HORIZON', 'APP_DOCUMENTS',
    'APP_CONTACT', 'APP_IMPORTANT_CONTEXT', 'APP_REVIEW'];
  var STAGE_OF = {
    // Three states outside the ladder, and outside the stage strip.
    APP_STARTING: -1, APP_BOOT_FAILURE: -1, APP_SESSION_EXPIRED: -1, APP_RESUME: -1,
    APP_BOOTSTRAP: -1, APP_COMPANY: 0, APP_ROLE: 0, APP_SCALE: 0,
    APP_OBJECTIVE: 1, APP_PROBLEM: 1, APP_DESIRED_OUTCOME: 1,
    APP_CURRENT_SETUP: 2, APP_DECISION_HORIZON: 2, APP_DOCUMENTS: 2, APP_CONTACT: 2, APP_IMPORTANT_CONTEXT: 2,
    APP_REVIEW: 3, APP_EDIT_SELECTOR: 3, APP_EDIT_FIELD: 3, APP_PRIVACY: 3, APP_SUBMITTING: 3,
    APP_SUCCESS: -1, APP_FAILURE: -1
  };
  function requiredFor(state) {
    if (state === 'APP_COMPANY') { return ['company_name', 'business_activity']; }
    if (state === 'APP_ROLE') { return ['role']; }
    if (state === 'APP_SCALE') { return ['turnover_band']; }
    if (state === 'APP_OBJECTIVE') { return ['objective']; }
    if (state === 'APP_PROBLEM') {
      if (!objective()) { return ['objective']; }
      if (isFreeTextBranch()) { return ['problem_free_text']; }
      if (get('problem') === C.PROBLEM_FREE_TEXT_OPTION) { return ['problem', 'problem_free_text']; }
      return ['problem'];
    }
    if (state === 'APP_DESIRED_OUTCOME') {
      return get('desired_outcome') === C.OUTCOME_FREE_TEXT_OPTION
        ? ['desired_outcome', 'desired_outcome_free_text'] : ['desired_outcome'];
    }
    if (state === 'APP_CURRENT_SETUP') { return ['current_setup']; }
    if (state === 'APP_DECISION_HORIZON') { return ['decision_horizon']; }
    if (state === 'APP_CONTACT') { return ['contact_channel']; }
    return []; // documents and important context are optional and never block
  }
  function firstUnsettled() {
    for (var i = 0; i < FLOW.length; i++) {
      var req = requiredFor(FLOW[i]);
      for (var j = 0; j < req.length; j++) { if (!settled(req[j])) { return FLOW[i]; } }
    }
    return 'APP_REVIEW';
  }
  function reviewReady() { return firstUnsettled() === 'APP_REVIEW'; }

  var state = 'APP_STARTING';
  var editingField = null;   // set while APP_EDIT_FIELD is active → return straight to review
  var history = [];

  // ── THREE FAILURES, THREE SCREENS ───────────────────────────────────────────────────────────
  //
  // The deployed build had one. A session that never existed produced «Заявка пока не отправлена
  // … Повторно проходить вопросы не нужно» — a submission-failure screen for a client who had not
  // submitted anything, offering a retry that could only refuse again.
  //
  //   bootFailure     the Mini App could not start. No session, no answers, nothing sent.
  //   sessionFailure  the session is gone or was refused. Answers exist; none were delivered.
  //   lastFailure     a real submission was attempted and did not complete.
  //
  // They are distinct internally and each has its own calm screen. Only the third offers a retry.
  var bootFailure = null;
  var sessionFailure = null;

  // ── the draft, persisted server-side ────────────────────────────────────────────────────────
  //
  // One PUT in flight at a time, newest state wins. A failed save is NOT retried on a timer: the
  // next transition writes the same cumulative draft again, so a transient failure heals itself
  // without a second scheduler. What a failure must never do is pass silently into submit, which
  // is why submit flushes and waits.
  var saveInFlight = false;
  var savePending = false;
  var saveWaiters = [];

  function sessionGone(r) {
    return !!r && (r.error_code === 'SESSION_EXPIRED' || r.error_code === 'SESSION_INVALID' ||
      r.error_code === 'NOT_AUTHORISED' || r.error_code === 'SUBMIT_IN_PROGRESS');
  }

  function settleWaiters(ok) {
    var w = saveWaiters; saveWaiters = [];
    w.forEach(function (fn) { fn(ok); });
  }

  function flushDraft() {
    if (!window.FM_NET || !window.FM_NET.ready()) { return; }
    if (!dirty && !savePending) { settleWaiters(true); return; }
    if (saveInFlight) { savePending = true; return; }
    saveInFlight = true;
    dirty = false;
    var step = draft.step;
    window.FM_NET.saveDraft(step, draft.fields).then(function (r) {
      saveInFlight = false;
      if (r.ok !== true) {
        // The server refusing the SESSION is terminal and must be shown. Anything else — a
        // dropped connection, a 503 — is transient, and the draft stays dirty so the next
        // transition rewrites it.
        if (sessionGone(r)) { sessionFailure = r; settleWaiters(false); go('APP_SESSION_EXPIRED'); return; }
        dirty = true;
        settleWaiters(false);
        return;
      }
      if (savePending) { savePending = false; flushDraft(); return; }
      settleWaiters(true);
    });
  }

  // Resolves once the server holds the CURRENT draft. Submit waits on this so it can never read
  // a draft the server has not yet been told about.
  function draftSettled() {
    return new Promise(function (resolve) {
      if (!window.FM_NET || !window.FM_NET.ready()) { resolve(false); return; }
      if (!dirty && !saveInFlight && !savePending) { resolve(true); return; }
      saveWaiters.push(resolve);
      flushDraft();
    });
  }

  function go(next, opts) {
    if (!(opts && opts.back)) { history.push(state); }
    state = next;
    render();
    // After the render, so a slow network never delays the screen the client asked for.
    flushDraft();
  }
  function advance() {
    if (editingField) { editingField = null; go('APP_REVIEW'); return; }
    var i = FLOW.indexOf(state);
    go(i === -1 || i === FLOW.length - 1 ? 'APP_REVIEW' : FLOW[i + 1]);
  }

  // ---------------------------------------------------------------- dom helpers
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) { n.className = cls; }
    if (text !== undefined && text !== null) { n.textContent = text; }
    return n;
  }
  var ICON = {
    tick: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    tickLg: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    chev: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    lock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
    info: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></svg>',
    refresh: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 01-13.7 5.7"/><path d="M4 12a8 8 0 0113.7-5.7"/><path d="M18 3v4h-4"/><path d="M6 21v-4h4"/></svg>'
  };
  // NO INLINE STYLE HERE. An inline `display:flex` outranks every stylesheet rule, which is how
  // `.row .tick { display: none }` stopped hiding the check on unselected rows — and why every
  // option on the contact screen rendered a check and the selection read as ambiguous. Display is
  // a `.ic` class rule now, so the more specific `.row .tick` / `.card .tick` rules win again.
  function icon(name, cls) { var s = el('span', 'ic' + (cls ? ' ' + cls : '')); s.innerHTML = ICON[name]; return s; }

  function screen(cls) { return el('section', 'screen' + (cls ? ' ' + cls : '')); }
  function title(text, cls) { var h = el('h1', cls || null, text); return h; }
  function lead(text) { return el('p', 'lead', text); }
  function quiet(text) { return el('p', 'quiet', text); }
  function grow() { return el('div', 'grow'); }

  function rowBtn(label, isSel, onClick) {
    var b = el('button', 'row' + (isSel ? ' is-selected' : ''));
    b.type = 'button';
    b.setAttribute('aria-pressed', isSel ? 'true' : 'false');
    b.appendChild(el('span', null, label));
    b.appendChild(icon('tick', 'tick'));
    b.addEventListener('click', onClick);
    return b;
  }
  function cardBtn(titleText, lineText, isSel, onClick) {
    var b = el('button', 'card' + (lineText ? '' : ' card--bare') + (isSel ? ' is-selected' : ''));
    b.type = 'button';
    b.setAttribute('aria-pressed', isSel ? 'true' : 'false');
    var body = el('div', 'body');
    body.appendChild(el('b', null, titleText));
    if (lineText) { body.appendChild(el('i', null, lineText)); }
    b.appendChild(body);
    b.appendChild(icon('tick', 'tick'));
    b.addEventListener('click', onClick);
    return b;
  }
  function actions() {
    var d = el('div', 'actions');
    for (var i = 0; i < arguments.length; i++) { if (arguments[i]) { d.appendChild(arguments[i]); } }
    return d;
  }
  function btn(label, onClick, variant, disabled) {
    var b = el('button', 'btn' + (variant ? ' btn--' + variant : ''), label);
    b.type = 'button';
    if (disabled) { b.disabled = true; }
    if (onClick) { b.addEventListener('click', onClick); }
    return b;
  }

  // The smart context strip: what is understood, and only what is left.
  function strip() {
    var lines = [];
    var scale = get('turnover_band');
    var head = [get('business_activity'), scale, get('role')].filter(Boolean).join(' · ');
    if (head) { lines.push(head); }
    if (get('objective')) { lines.push(get('objective')); }
    var setup = get('current_setup');
    if (setup && setup.length) { lines.push(setup.slice(0, 2).join(' + ')); }
    if (!lines.length) { return null; }

    var left = [];
    if (!settled('decision_horizon')) { left.push('срок'); }
    if (!settled('documents')) { left.push('материалы'); }
    var d = el('div', 'strip');
    d.appendChild(el('div', 'kicker', 'Уже понятно'));
    var ls = el('div', 'lines');
    lines.forEach(function (l) { ls.appendChild(el('span', null, l)); });
    d.appendChild(ls);
    d.appendChild(el('div', 'left', left.length ? 'Осталось уточнить ' + left.join(' и ') + '.' : 'Осталось проверить бриф.'));
    return d;
  }

  function knownRow(labelText, valueText, note, onEdit) {
    var d = el('div', 'known');
    d.appendChild(icon('tick', 'tick'));
    var body = el('div', 'body');
    body.appendChild(el('b', null, valueText));
    body.appendChild(el('i', null, note ? labelText + ' · ' + note : labelText));
    d.appendChild(body);
    if (onEdit) { var u = el('u', null, 'Изменить'); u.addEventListener('click', onEdit); d.appendChild(u); }
    return d;
  }

  // ---------------------------------------------------------------- screens

  // The Mini App is talking to the Gateway. Deliberately plain: it is on screen for a few hundred
  // milliseconds and must not look like a step the client has to complete.
  function scrStarting() {
    var s = screen('screen--center');
    var sp = el('div'); sp.style.height = '60px'; s.appendChild(sp);
    s.appendChild(title('Открываем форму…', 'sm'));
    s.appendChild(grow());
    return s;
  }

  // A terminal screen, and NOT the submission-failure screen. Nothing was answered, so nothing
  // can be resubmitted; the only real recovery is a fresh signed context, which only reopening
  // from the chat produces. Offering «Повторить отправку» here would be a lie twice over.
  function scrBootFailure() {
    var s = screen('screen--center');
    var sp = el('div'); sp.style.height = '12px'; s.appendChild(sp);
    var orb = el('div', 'orb orb--fail'); orb.appendChild(icon('info')); s.appendChild(orb);
    var sp2 = el('div'); sp2.style.height = '26px'; s.appendChild(sp2);
    s.appendChild(title(C.BOOTSTRAP_FAILURE.title, 'sm'));
    C.BOOTSTRAP_FAILURE.lines.forEach(function (l) { s.appendChild(lead(l)); });
    s.appendChild(grow());
    s.appendChild(actions(btn(C.BOOTSTRAP_FAILURE.primary, function () { closeApp(s); })));
    return s;
  }

  // The 72 h TTL, or a session the server refused. Answers may exist; none of them reached a
  // consultant, and the screen says so rather than leaving the client to assume either way.
  function scrSessionExpired() {
    var s = screen('screen--center');
    var sp = el('div'); sp.style.height = '12px'; s.appendChild(sp);
    var orb = el('div', 'orb orb--fail'); orb.appendChild(icon('info')); s.appendChild(orb);
    var sp2 = el('div'); sp2.style.height = '26px'; s.appendChild(sp2);
    s.appendChild(title(C.SESSION_EXPIRED.title, 'sm'));
    C.SESSION_EXPIRED.lines.forEach(function (l) { s.appendChild(lead(l)); });
    s.appendChild(grow());
    s.appendChild(actions(btn(C.SESSION_EXPIRED.primary, function () { closeApp(s); })));
    return s;
  }

  // ── RESUME ──────────────────────────────────────────────────────────────────────────────────
  //
  // Shown when the Gateway resolved an existing draft that already holds answers. The copy is
  // the approved Telegram wording, derived from TG_RESUME_DRAFT so the two surfaces cannot
  // promise different things.
  //
  // «Начать заново» does NOT mint a session — a new session needs a new signed Telegram context
  // and the client cannot produce one. It clears the DRAFT in place, server-side, through the
  // write the app already makes on every transition. Same session, empty brief.
  function scrResume() {
    var s = screen();
    var sp0 = el('div'); sp0.style.height = '20px'; s.appendChild(sp0);
    s.appendChild(el('div', 'kicker', 'Подготовка к встрече'));
    var sp = el('div'); sp.style.height = '20px'; s.appendChild(sp);
    s.appendChild(title(C.RESUME.title, 'lg'));
    C.RESUME.lines.forEach(function (l) { s.appendChild(lead(l)); });

    // What is already known, in the same strip the ladder uses, so the promise is visible
    // rather than merely stated.
    var st = strip(); if (st) { var sp2 = el('div'); sp2.style.height = '28px'; s.appendChild(sp2); s.appendChild(st); }

    s.appendChild(grow());
    s.appendChild(actions(
      btn(C.RESUME.primary, function () { go(firstUnsettled()); }),
      btn(C.RESUME.secondary, function () { restartBrief(); }, 'secondary')
    ));
    return s;
  }

  function scrEntry() {
    var s = screen();
    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:14px';
    head.appendChild(el('div', 'kicker', 'Подготовка к встрече'));
    s.appendChild(head);
    s.appendChild(el('div', null, '')).style.height = '20px';
    s.appendChild(title('Подготовим бриф для консультанта.', 'lg'));
    s.appendChild(lead('Несколько уточнений — и консультант FINMENTOR войдёт в первый разговор уже подготовленным. Около трёх минут.'));

    var u = tgUser();
    if (u && u.first_name) {
      carryFromTelegram();
      var sp = el('div'); sp.style.height = '34px'; s.appendChild(sp);
      s.appendChild(knownRow('Из Telegram', u.first_name, 'спрашивать не будем', null));
    }
    s.appendChild(grow());
    // «Начать» is reachable only with an authoritative session behind it. There is no UI path
    // where the client can answer questions that cannot be saved, or reach a Submit that has
    // nothing to submit against.
    s.appendChild(actions(btn('Начать', function () { go(firstUnsettled()); }, null,
      !(window.FM_NET && window.FM_NET.ready()))));
    var link = el('div', 'entry-link');
    link.appendChild(icon('lock'));
    link.appendChild(el('span', null, C.PRIVACY.entryLink));
    s.appendChild(link);
    return s;
  }

  function scrCompany() {
    var s = screen();
    s.appendChild(title(C.COMPANY_SCREEN.title));
    s.appendChild(lead(C.COMPANY_SCREEN.lead));
    var sp = el('div'); sp.style.height = '32px'; s.appendChild(sp);

    if (settled('role')) {
      s.appendChild(knownRow('Роль', get('role'), 'подтверждено', function () { editingField = 'role'; go('APP_ROLE'); }));
      var sp2 = el('div'); sp2.style.height = '24px'; s.appendChild(sp2);
    }

    var wrap = el('div');
    wrap.appendChild(fieldInput('Название', 'company_name', ''));
    wrap.appendChild(fieldInput('Чем занимается', 'business_activity', 'Например: сеть продуктовых магазинов'));
    s.appendChild(wrap);

    s.appendChild(grow());
    var next = btn('Продолжить', function () { advance(); }, null, !(settled('company_name') && settled('business_activity')));
    s.appendChild(actions(next));
    wrap.addEventListener('input', function () {
      next.disabled = !(settled('company_name') && settled('business_activity'));
    });
    return s;
  }

  // `kind` is 'phone' | 'email' | undefined. It picks the on-screen keyboard only. The authority on
  // whether a value is acceptable is contactValid(), never the input type — a browser that ignores
  // type="email" must not thereby widen what the app accepts.
  function fieldInput(labelText, name, placeholder, kind) {
    var f = el('div', 'field');
    var lab = el('label', null, labelText);
    var inp = el('input');
    inp.type = kind === 'phone' ? 'tel' : (kind === 'email' ? 'email' : 'text');
    if (kind === 'phone') { inp.setAttribute('inputmode', 'tel'); }
    if (kind === 'email') {
      inp.setAttribute('inputmode', 'email');
      inp.setAttribute('autocapitalize', 'off');
      inp.setAttribute('autocorrect', 'off');
    }
    inp.value = get(name) || '';
    if (placeholder) { inp.placeholder = placeholder; }
    inp.addEventListener('input', function () {
      var v = inp.value.trim();
      set(name, v || null, 'user_explicit', !!v);
    });
    f.appendChild(lab); f.appendChild(inp);
    return f;
  }

  function scrRole() {
    var s = screen();
    s.appendChild(title('Ваша роль в компании'));
    s.appendChild(lead('Это меняет то, с чего консультант начнёт разговор.'));
    var sp = el('div'); sp.style.height = '30px'; s.appendChild(sp);
    var stack = el('div', 'stack');
    ['Собственник', 'Генеральный директор', 'Финансовый директор', 'Руководитель направления', 'Другая роль'].forEach(function (r) {
      stack.appendChild(rowBtn(r, get('role') === r, function () { set('role', r, 'user_explicit', true); advance(); }));
    });
    s.appendChild(stack);
    s.appendChild(grow());
    return s;
  }

  function scrScale() {
    var s = screen();
    s.appendChild(title('Масштаб компании'));
    s.appendChild(lead('Ориентировочный годовой оборот.'));
    var sp = el('div'); sp.style.height = '30px'; s.appendChild(sp);
    var stack = el('div', 'stack');
    C.SCALE_OPTIONS.forEach(function (o) {
      stack.appendChild(rowBtn(o, get('turnover_band') === o, function () { set('turnover_band', o, 'user_explicit', true); advance(); }));
    });
    s.appendChild(stack);
    s.appendChild(grow());
    return s;
  }

  function scrObjective() {
    var s = screen();
    s.appendChild(title(C.OBJECTIVE_SCREEN.title));
    s.appendChild(lead(C.OBJECTIVE_SCREEN.lead));
    var sp = el('div'); sp.style.height = '32px'; s.appendChild(sp);
    var stack = el('div', 'stack stack--cards');
    C.OBJECTIVES.forEach(function (o) {
      stack.appendChild(cardBtn(o.label, o.line, get('objective') === o.label, function () {
        if (get('objective') !== o.label) {
          // Changing the objective invalidates the branch-specific answers rather than carrying
          // a problem from another branch into the brief.
          set('objective', o.label, 'user_explicit', true);
          ['problem', 'problem_free_text', 'desired_outcome', 'desired_outcome_free_text'].forEach(function (n) {
            clearField(n);
          });
        }
        advance();
      }));
    });
    s.appendChild(stack);
    s.appendChild(grow());
    return s;
  }

  function scrProblem() {
    var o = objective();
    var p = C.PROBLEMS[o.id];
    var s = screen();
    s.appendChild(el('div', 'kicker', o.label));
    var sp0 = el('div'); sp0.style.height = '12px'; s.appendChild(sp0);
    s.appendChild(title(p.title));

    if (p.mode === 'free_text') {
      p.copy.forEach(function (c, i) { s.appendChild(i ? quiet(c) : lead(c)); });
      var sp = el('div'); sp.style.height = '28px'; s.appendChild(sp);
      s.appendChild(fieldTextarea(null, 'problem_free_text', p.placeholder));
      s.appendChild(grow());
      var next = btn('Продолжить', function () { advance(); }, null, !settled('problem_free_text'));
      s.appendChild(actions(next));
      s.addEventListener('input', function () { next.disabled = !settled('problem_free_text'); });
      return s;
    }

    var sp1 = el('div'); sp1.style.height = '30px'; s.appendChild(sp1);
    var stack = el('div', 'stack stack--cards');
    p.options.forEach(function (opt) {
      stack.appendChild(cardBtn(opt[0], opt[1], get('problem') === opt[0], function () {
        set('problem', opt[0], 'user_explicit', true);
        clearField('problem_free_text');
        advance();
      }));
    });
    var freeSel = get('problem') === C.PROBLEM_FREE_TEXT_OPTION;
    stack.appendChild(cardBtn(C.PROBLEM_FREE_TEXT_OPTION, '', freeSel, function () {
      set('problem', C.PROBLEM_FREE_TEXT_OPTION, 'user_explicit', true);
      render();
    }));
    s.appendChild(stack);

    if (freeSel) {
      var sp2 = el('div'); sp2.style.height = '20px'; s.appendChild(sp2);
      s.appendChild(fieldTextarea(null, 'problem_free_text', 'Опишите ситуацию своими словами.'));
      s.appendChild(grow());
      var n2 = btn('Продолжить', function () { advance(); }, null, !settled('problem_free_text'));
      s.appendChild(actions(n2));
      s.addEventListener('input', function () { n2.disabled = !settled('problem_free_text'); });
    } else {
      s.appendChild(grow());
    }
    return s;
  }

  function fieldTextarea(labelText, name, placeholder) {
    var f = el('div', 'field');
    if (labelText) { f.appendChild(el('label', null, labelText)); }
    var ta = el('textarea');
    ta.value = get(name) || '';
    ta.maxLength = 500;
    if (placeholder) { ta.placeholder = placeholder; }
    ta.addEventListener('input', function () {
      var v = ta.value.trim();
      set(name, v || null, 'user_explicit', !!v);
    });
    f.appendChild(ta);
    return f;
  }

  function scrOutcome() {
    var o = objective();
    var set_ = C.OUTCOMES[o.id];
    var s = screen();
    s.appendChild(el('div', 'kicker', o.label));
    var sp0 = el('div'); sp0.style.height = '12px'; s.appendChild(sp0);
    s.appendChild(title(set_.title));
    var sp = el('div'); sp.style.height = '30px'; s.appendChild(sp);
    var stack = el('div', 'stack stack--cards');
    set_.options.forEach(function (opt) {
      stack.appendChild(cardBtn(opt[0], opt[1], get('desired_outcome') === opt[0], function () {
        set('desired_outcome', opt[0], 'user_explicit', true);
        if (opt[0] !== C.OUTCOME_FREE_TEXT_OPTION) {
          clearField('desired_outcome_free_text');
          advance();
        } else { render(); }
      }));
    });
    s.appendChild(stack);
    if (get('desired_outcome') === C.OUTCOME_FREE_TEXT_OPTION) {
      var sp2 = el('div'); sp2.style.height = '20px'; s.appendChild(sp2);
      s.appendChild(fieldTextarea(null, 'desired_outcome_free_text', 'Опишите ожидаемый результат.'));
      s.appendChild(grow());
      var n = btn('Продолжить', function () { advance(); }, null, !settled('desired_outcome_free_text'));
      s.appendChild(actions(n));
      s.addEventListener('input', function () { n.disabled = !settled('desired_outcome_free_text'); });
    } else { s.appendChild(grow()); }
    return s;
  }

  function scrSetup() {
    var s = screen();
    s.appendChild(title(C.CURRENT_SETUP.title));
    s.appendChild(lead(C.CURRENT_SETUP.copy));
    var sp = el('div'); sp.style.height = '30px'; s.appendChild(sp);
    var chosen = get('current_setup') || [];
    var stack = el('div', 'stack');
    C.CURRENT_SETUP.options.forEach(function (o) {
      var b = rowBtn(o, chosen.indexOf(o) !== -1, function () {
        var cur = (get('current_setup') || []).slice();
        var i = cur.indexOf(o);
        if (i === -1) { cur.push(o); } else { cur.splice(i, 1); }
        // canonical order, so two clients ticking the same boxes produce the same value
        var canon = C.CURRENT_SETUP.options.filter(function (x) { return cur.indexOf(x) !== -1; });
        set('current_setup', canon.length ? canon : null, 'user_explicit', !!canon.length);
        render();
      });
      stack.appendChild(b);
    });
    s.appendChild(stack);
    s.appendChild(grow());
    s.appendChild(actions(btn('Продолжить', function () { advance(); }, null, !settled('current_setup'))));
    return s;
  }

  function scrHorizon() {
    var s = screen();
    var st = strip(); if (st) { s.appendChild(st); }
    s.appendChild(title(C.DECISION_HORIZON.title));
    var sp = el('div'); sp.style.height = '28px'; s.appendChild(sp);
    var stack = el('div', 'stack stack--cards');
    C.DECISION_HORIZON.options.forEach(function (o) {
      stack.appendChild(cardBtn(o[0], o[1], get('decision_horizon') === o[0], function () {
        set('decision_horizon', o[0], 'user_explicit', true); advance();
      }));
    });
    s.appendChild(stack);
    s.appendChild(grow());
    return s;
  }

  function scrDocuments() {
    var s = screen();
    var st = strip(); if (st) { s.appendChild(st); }
    s.appendChild(title(C.DOCUMENTS.title));
    C.DOCUMENTS.copy.forEach(function (c, i) { s.appendChild(i ? quiet(c) : lead(c)); });
    var sp = el('div'); sp.style.height = '28px'; s.appendChild(sp);
    var chosen = get('documents') || [];
    var stack = el('div', 'stack');
    C.DOCUMENTS.options.forEach(function (o) {
      stack.appendChild(rowBtn(o, chosen.indexOf(o) !== -1, function () {
        var cur = (get('documents') || []).slice();
        var i = cur.indexOf(o);
        if (i === -1) { cur.push(o); } else { cur.splice(i, 1); }
        var canon = C.DOCUMENTS.options.filter(function (x) { return cur.indexOf(x) !== -1; });
        set('documents', canon.length ? canon : null, 'user_explicit', !!canon.length);
        render();
      }));
    });
    s.appendChild(stack);
    var sp2 = el('div'); sp2.style.height = '24px'; s.appendChild(sp2);
    C.DOCUMENTS.minimisation.forEach(function (m) { s.appendChild(quiet(m)); });
    s.appendChild(grow());
    s.appendChild(actions(
      btn('Продолжить', function () { advance(); }),
      btn(C.DOCUMENTS.continueWithout, function () {
        clearField('documents');
        advance();
      }, 'tertiary')
    ));
    return s;
  }

  // ONE preferred channel. `contact_channel` holds a single value, never a set, and `contact_value`
  // is meaningful only against the channel currently selected — so switching channels DISCARDS it.
  // Carrying it over is how a number typed under «По телефону» survived a switch to «По email» and
  // stood as the authoritative preferred email.
  function clearContactValue() {
    clearField('contact_value');
  }

  // Format validation, and nothing more. It says the value is SHAPED like a reachable phone or
  // email; it cannot say the line answers or the mailbox exists, and it does not claim to.
  //
  // Phone accepts two forms and no others:
  //   · Moldovan national — 0 followed by 8 digits (069 123 456), the form a local client types;
  //   · E.164 international — + followed by 8 to 15 digits, which covers +373 and everywhere else.
  // Separators (spaces, dashes, dots, brackets) are ignored for the test, but what the client typed
  // is stored verbatim: silently normalising a contact is a data decision, not a validation one.
  function contactValid(channel, raw) {
    var v = String(raw === null || raw === undefined ? '' : raw).trim();
    if (channel === 'telegram') { return true; }   // the reply channel needs no typed contact
    if (!v) { return false; }
    if (channel === 'phone') {
      var d = v.replace(/[\s().\-]/g, '');
      if (/^0\d{8}$/.test(d)) { return true; }
      return /^\+\d{8,15}$/.test(d);
    }
    if (channel === 'email') {
      if (v.length > 254) { return false; }
      return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(v);
    }
    return false;
  }

  // Settled AND well-formed. `settled` on its own would let "abc" stand as an email.
  function contactReady() {
    var ch = get('contact_channel');
    if (!settled('contact_channel')) { return false; }
    if (ch === 'telegram') { return true; }
    return settled('contact_value') && contactValid(ch, get('contact_value'));
  }

  function scrContact() {
    var s = screen();
    s.appendChild(title(C.CONTACT.title));
    var sp = el('div'); sp.style.height = '30px'; s.appendChild(sp);
    var stack = el('div', 'stack');
    C.CONTACT.options.forEach(function (o) {
      stack.appendChild(rowBtn(o.label, get('contact_channel') === o.id, function () {
        // ANY change of channel invalidates the previous contact — including phone → email, the
        // transition that used to keep a phone number standing as the authoritative email.
        if (get('contact_channel') !== o.id) { clearContactValue(); }
        set('contact_channel', o.id, 'user_explicit', true);
        render();
      }));
    });
    s.appendChild(stack);
    var ch = get('contact_channel');
    if (ch === 'telegram') { s.appendChild(quiet(C.CONTACT.telegramNote)); }
    var next = btn('Продолжить', function () { advance(); }, null, !contactReady());
    if (ch === 'phone' || ch === 'email') {
      var sp2 = el('div'); sp2.style.height = '20px'; s.appendChild(sp2);
      var field = fieldInput(ch === 'phone' ? 'Телефон' : 'Email', 'contact_value',
        ch === 'phone' ? '+373 60 000 000' : 'name@company.md', ch);
      s.appendChild(field);
      // Without this the button was evaluated once at render and never again, so on the phone and
      // email branches «Продолжить» could not be reached at all: typing does not re-render.
      field.addEventListener('input', function () { next.disabled = !contactReady(); });
    }
    s.appendChild(grow());
    s.appendChild(actions(next));
    return s;
  }

  function scrImportant() {
    var s = screen();
    s.appendChild(title('Что важно знать до разговора?'));
    var sp = el('div'); sp.style.height = '28px'; s.appendChild(sp);
    s.appendChild(fieldTextarea(C.IMPORTANT_CONTEXT.label, 'important_context', C.IMPORTANT_CONTEXT.placeholder));
    s.appendChild(quiet('Необязательно.'));
    s.appendChild(grow());
    s.appendChild(actions(btn('Сформировать бриф', function () { go('APP_REVIEW'); })));
    return s;
  }

  // ---------------------------------------------------------------- review
  function memo(label, lines, cls) {
    var vals = (Array.isArray(lines) ? lines : [lines]).filter(function (x) { return x && String(x).trim(); });
    if (!vals.length) { return null; }   // an empty section is OMITTED entirely
    var d = el('div', 'memo');
    d.appendChild(el('div', 'kicker', label));
    vals.forEach(function (v) { d.appendChild(el('div', cls || 'val', v)); });
    return d;
  }

  function scrReview() {
    var o = objective();
    var s = screen();
    var head = el('div', 'memo-head');
    head.appendChild(el('div', 'kicker muted', 'FINMENTOR'));
    head.appendChild(el('div', 'kicker', 'Confidential brief'));
    s.appendChild(head);
    var sp = el('div'); sp.style.height = '26px'; s.appendChild(sp);
    s.appendChild(title(C.REVIEW.title));
    s.appendChild(lead(C.REVIEW.lead));

    var d = el('div', 'dossier');
    var id = el('div');
    id.appendChild(el('div', 'company', get('company_name') || ''));
    id.appendChild(el('div', 'activity', get('business_activity') || ''));
    id.appendChild(el('div', 'meta', [get('role'), get('turnover_band')].filter(Boolean).join(' · ')));
    d.appendChild(id);

    // ЗАДАЧА is the objective LABEL, never derived and never the problem.
    [memo('Задача', o ? o.label : ''),
      memo('Проблема', isFreeTextBranch() || get('problem') === C.PROBLEM_FREE_TEXT_OPTION
        ? '«' + (get('problem_free_text') || '') + '»' : get('problem'),
      (isFreeTextBranch() || get('problem') === C.PROBLEM_FREE_TEXT_OPTION) ? 'quote' : 'val'),
      memo('Ожидаемый результат', get('desired_outcome') === C.OUTCOME_FREE_TEXT_OPTION
        ? get('desired_outcome_free_text') : get('desired_outcome')),
      memo('Текущая система', get('current_setup') || []),
      memo('Горизонт', get('decision_horizon')),
      memo('Материалы', get('documents') || [], 'mono'),
      memo('Важно до встречи', get('important_context'))
    ].forEach(function (m) { if (m) { d.appendChild(m); } });
    s.appendChild(d);

    // FINMENTOR PREPARATION — controlled map only, never generated.
    if (o && C.FOCUS_MAP[o.id]) {
      var f = el('div', 'focus');
      f.appendChild(el('div', 'kicker', 'Фокус первой встречи'));
      var ul = el('ul');
      C.FOCUS_MAP[o.id].forEach(function (line) { ul.appendChild(el('li', null, line)); });
      f.appendChild(ul);
      f.appendChild(el('div', 'disclaimer', C.FOCUS_DISCLAIMER));
      s.appendChild(f);
    }

    var r = el('div', 'readiness');
    r.appendChild(el('div', 'kicker', 'Подготовка к встрече'));
    var hasDocs = !!(get('documents') && get('documents').length);
    [['Контекст компании', 'готов', false],
      ['Задача', 'готова', false],
      ['Материалы', hasDocs ? C.REVIEW.materialsStatus.present : C.REVIEW.materialsStatus.absent, !hasDocs]
    ].forEach(function (x) {
      var item = el('div', 'item');
      item.appendChild(el('span', null, x[0]));
      var b = el('b', x[2] ? 'part' : null);
      b.appendChild(icon('tick'));
      b.appendChild(el('span', null, x[1]));
      item.appendChild(b);
      r.appendChild(item);
    });
    s.appendChild(r);
    s.appendChild(quiet(C.REVIEW.enough));

    s.appendChild(actions(
      btn(C.REVIEW.primary, function () { go('APP_PRIVACY'); }),
      btn(C.REVIEW.secondary, function () { go('APP_EDIT_SELECTOR'); }, 'secondary'),
      btn(C.REVIEW.tertiary, function () { editingField = 'important_context'; go('APP_IMPORTANT_CONTEXT'); }, 'tertiary')
    ));
    return s;
  }

  var EDIT_TARGET = {
    company_name: 'APP_COMPANY', role: 'APP_ROLE', turnover_band: 'APP_SCALE',
    objective: 'APP_OBJECTIVE', problem: 'APP_PROBLEM', desired_outcome: 'APP_DESIRED_OUTCOME',
    current_setup: 'APP_CURRENT_SETUP', decision_horizon: 'APP_DECISION_HORIZON',
    documents: 'APP_DOCUMENTS', contact_channel: 'APP_CONTACT', important_context: 'APP_IMPORTANT_CONTEXT'
  };
  function editValue(field) {
    var v = get(field);
    if (field === 'contact_channel') {
      for (var i = 0; i < C.CONTACT.options.length; i++) { if (C.CONTACT.options[i].id === v) { return C.CONTACT.options[i].label; } }
      return '';
    }
    if (Array.isArray(v)) { return v.length ? v.join(', ') : '—'; }
    return v || '—';
  }
  function scrEditSelector() {
    var s = screen();
    s.appendChild(title(C.EDIT.title));
    s.appendChild(lead(C.EDIT.lead));
    var sp = el('div'); sp.style.height = '30px'; s.appendChild(sp);
    var stack = el('div', 'stack');
    C.EDIT.rows.forEach(function (r) {
      var b = el('button', 'edit-row'); b.type = 'button';
      var body = el('div', 'body');
      body.appendChild(el('i', null, r.label));
      body.appendChild(el('b', null, editValue(r.field)));
      b.appendChild(body);
      b.appendChild(icon('chev', 'chev'));
      b.addEventListener('click', function () {
        // APP_EDIT_FIELD: change one thing, then straight back to review. Never the ladder.
        editingField = r.field;
        go(EDIT_TARGET[r.field] || 'APP_REVIEW');
      });
      stack.appendChild(b);
    });
    s.appendChild(stack);
    s.appendChild(grow());
    s.appendChild(actions(btn(C.EDIT.back, function () { go('APP_REVIEW'); }, 'secondary')));
    return s;
  }

  // ---------------------------------------------------------------- submit + privacy
  var privacyShownAt = null;

  function scrPrivacy() {
    privacyShownAt = privacyShownAt || nowIso();
    var o = objective();
    var s = screen();
    s.appendChild(title('Передать бриф консультанту?'));
    var sp = el('div'); sp.style.height = '30px'; s.appendChild(sp);

    var sum = el('div', 'summary');
    sum.appendChild(el('div', 'kicker', 'Confidential brief'));
    sum.appendChild(el('div', 'name', get('company_name') || ''));
    sum.appendChild(el('div', 'l1', [o ? o.label : '', get('decision_horizon')].filter(Boolean).join(' · ')));
    var docs = get('documents') || [];
    sum.appendChild(el('div', 'l2', [
      docs.length ? docs.length + ' категорий материалов' : 'без материалов',
      get('contact_channel') === 'telegram' ? 'ответ в Telegram' : 'ответ по контакту'
    ].join(' · ')));
    s.appendChild(sum);

    var p = el('div', 'privacy');
    C.PRIVACY.lines.forEach(function (l) { p.appendChild(quiet(l)); });
    var links = el('div', 'privacy-links');
    C.PRIVACY.links.forEach(function (l) { var a = el('a', null, l); a.href = '#'; links.appendChild(a); });
    p.appendChild(links);
    s.appendChild(p);

    s.appendChild(grow());
    s.appendChild(actions(
      btn(C.PRIVACY.primary, function () { submit(); }, null, !submitReady()),
      btn('Вернуться к брифу', function () { go('APP_REVIEW'); }, 'tertiary')
    ));
    return s;
  }

  function scrSubmitting() {
    var s = screen('screen--center');
    var sp = el('div'); sp.style.height = '60px'; s.appendChild(sp);
    s.appendChild(title('Передаём бриф…', 'sm'));
    s.appendChild(lead('Не закрывайте окно.'));
    s.appendChild(grow());
    return s;
  }

  // ---------------------------------------------------------------- submission
  //
  // THE ACKNOWLEDGEMENT IS CAPTURED ONCE. `submitAck` is stamped the first time the client taps
  // «Передать консультанту» and is reused UNCHANGED on every retry. Re-stamping
  // `acknowledged_at` on a retry would record a second, contradictory moment of consent and would
  // read as a fresh acknowledgement the client never gave.
  //
  // SUCCESS IS ok === true AND NOTHING ELSE. Not a 2xx, not "the request did not throw". Showing
  // «Обращение передано» over a failed write is the same class of defect as the Gateway answering
  // 409 to an outage; the failure screen exists precisely so this path never has to guess.
  var submitAck = null;
  var lastFailure = null;

  // THE IN-FLIGHT LOCK. Until now the lock was incidental: submit() replaces the screen with
  // scrSubmitting, which carries no button and hides Back, so a second tap had nothing to hit.
  // That is a property of the current rendering, not a guarantee — and what a duplicate tap
  // would buy is a second POST carrying the SAME derived submission key into an irreversible
  // privacy write. Backend idempotency is not the answer to a client that asks twice. Every
  // exit below clears the flag; one that did not would lock the app out of its own retry.
  var submitting = false;

  // THE PRECONDITION, IN ONE PLACE. Submit is reachable only with a session, a complete review
  // and an acknowledgement. `scrPrivacy` disables its primary button on the same predicate, so
  // the check here is a backstop rather than the only guard — but it is the one that decides.
  function submitReady() {
    return !!(window.FM_NET && window.FM_NET.configured() && window.FM_NET.ready()) &&
      reviewReady() && !submitted;
  }

  function submit() {
    // One tap is one request. A tap arriving while a submission is in flight is ignored
    // outright rather than queued: the answer to the first is the answer to both.
    if (submitting) { return; }
    // Terminal is terminal. The success screen has no submit affordance, so this is
    // unreachable by tapping today — but the guarantee should not depend on which screen
    // happens to be rendered. The server would refuse a committed replay anyway; asking is
    // worse than not asking.
    if (submitted) { return; }
    // No session: this is a SESSION failure, not a submission failure. Saying «Заявка пока не
    // отправлена … Повторно проходить вопросы не нужно» over a session that never existed is
    // exactly what the deployed build did.
    if (!window.FM_NET || !window.FM_NET.configured()) {
      bootFailure = { error_code: 'NOT_CONFIGURED', retryable: false };
      go('APP_BOOT_FAILURE');
      return;
    }
    if (!window.FM_NET.ready()) {
      sessionFailure = { error_code: 'SESSION_INVALID', retryable: false };
      go('APP_SESSION_EXPIRED');
      return;
    }

    if (!submitAck) {
      submitAck = {
        notice_version: (window.FM_NOTICE_VERSION || 'pn-2026-08'),
        locale: get('locale') || 'ru',
        shown_at: privacyShownAt || nowIso(),
        acknowledged_at: nowIso()
      };
      window.FM_LAST_ACK = submitAck;
    }
    submitting = true;
    go('APP_SUBMITTING');

    // The answers live SERVER-SIDE. Submitting before the last screen's write has landed would
    // ask the server to project a draft it has not been told about, so the flush is awaited and a
    // failed flush is a retryable submission failure rather than a silent partial brief.
    draftSettled().then(function (saved) {
      if (!saved) {
        submitting = false;
        if (state === 'APP_SESSION_EXPIRED') { return null; }   // flushDraft already routed
        lastFailure = { ok: false, error_code: 'SUBMIT_UNRESOLVED', retryable: true };
        go('APP_FAILURE');
        return null;
      }
      return window.FM_NET.submit(submitAck).then(function (r) {
        submitting = false;
        // SUCCESS IS ok === true AND NOTHING ELSE — including a replay of a submission the server
        // has already committed, which answers { ok:true, already:true, lead_id }. That IS the
        // truth: the brief was accepted. Rendering the failure screen over it was D7.
        if (window.FM_NET.isCommitted(r)) {
          lastFailure = null;
          submitted = true;
          lastLeadId = String((r.body && r.body.lead_id) || '');
          go('APP_SUCCESS');
          return;
        }
        if (sessionGone(r)) { sessionFailure = r; go('APP_SESSION_EXPIRED'); return; }
        lastFailure = r;
        go('APP_FAILURE');
      });
    })['catch'](function () {
      // net.js resolves its failures rather than rejecting, so this is a backstop. It exists
      // because a throw that skipped the release would leave the retry button inert forever.
      submitting = false;
      lastFailure = { ok: false, error_code: 'SUBMIT_UNRESOLVED', retryable: true };
      go('APP_FAILURE');
    });
  }

  // Terminal on the client too. Once the server has committed, a second tap must not re-enter the
  // flow — the server would refuse it as SUBMIT_IN_PROGRESS, and asking is worse than not asking.
  var submitted = false;
  var lastLeadId = '';

  function scrSuccess() {
    var o = objective();
    var s = screen('screen--center');
    var sp = el('div'); sp.style.height = '12px'; s.appendChild(sp);
    var orb = el('div', 'orb'); orb.appendChild(icon('tickLg')); s.appendChild(orb);
    var sp2 = el('div'); sp2.style.height = '26px'; s.appendChild(sp2);
    s.appendChild(title(C.SUCCESS.title, 'lg'));
    s.appendChild(el('div', 'headline', [get('company_name'), o ? o.label : ''].filter(Boolean).join(' · ')));
    var st = el('div', 'status-line');
    st.appendChild(el('span', null, 'Статус:'));
    st.appendChild(el('b', null, C.SUCCESS.status));
    s.appendChild(st);
    s.appendChild(lead(C.SUCCESS.lead));
    // §21.1. The client DECLARED which materials exist; nothing was uploaded, and no upload
    // control exists anywhere in this build. So the sentence names what the consultant will see,
    // and the draft decides which of the two is true. An empty materials concept is never shown —
    // the sentence is replaced, not emptied.
    var declared = get('documents');
    s.appendChild(lead(declared && declared.length ? C.SUCCESS.materials.declared : C.SUCCESS.materials.none));
    s.appendChild(lead(C.SUCCESS.tail));
    var sp3 = el('div'); sp3.style.height = '34px'; s.appendChild(sp3);
    s.appendChild(el('div', 'kicker', C.SUCCESS.nextTitle));
    var steps = el('div', 'steps');
    C.SUCCESS.next.forEach(function (t, i) {
      var d = el('div', 'step');
      d.appendChild(el('span', 'n', String(i + 1)));
      d.appendChild(el('span', 't', t));
      steps.appendChild(d);
    });
    s.appendChild(steps);
    s.appendChild(grow());
    // Terminal: the only action is leaving. No new questionnaire is offered here.
    s.appendChild(actions(btn(C.SUCCESS.primary, function () { closeApp(s); })));
    return s;
  }

  function scrFailure() {
    var s = screen('screen--center');
    var sp = el('div'); sp.style.height = '12px'; s.appendChild(sp);
    var orb = el('div', 'orb orb--fail'); orb.appendChild(icon('info')); s.appendChild(orb);
    var sp2 = el('div'); sp2.style.height = '26px'; s.appendChild(sp2);
    s.appendChild(title(C.FAILURE.title, 'sm'));
    C.FAILURE.lines.forEach(function (l) { s.appendChild(lead(l)); });
    s.appendChild(grow());

    // A non-retryable refusal must not offer a retry button that will refuse again. The server
    // states retryability; the client does not infer it from a status code. The two codes the
    // client produces itself — NETWORK and TIMEOUT — are classified once, in net.js.
    var canRetry = !!lastFailure && window.FM_NET && window.FM_NET.retryable(lastFailure);
    var back = btn(C.FAILURE.secondary, function () { go('APP_REVIEW'); }, 'secondary');
    if (canRetry) {
      var retry = btn(C.FAILURE.primary, function () { submit(); });
      retry.insertBefore(icon('refresh'), retry.firstChild);
      s.appendChild(actions(retry, back));
    } else {
      s.appendChild(actions(back));
    }
    return s;
  }

  // ---------------------------------------------------------------- render
  var SCREENS = {
    APP_STARTING: scrStarting, APP_BOOT_FAILURE: scrBootFailure, APP_SESSION_EXPIRED: scrSessionExpired,
    APP_RESUME: scrResume,
    APP_BOOTSTRAP: scrEntry, APP_COMPANY: scrCompany, APP_ROLE: scrRole, APP_SCALE: scrScale,
    APP_OBJECTIVE: scrObjective, APP_PROBLEM: scrProblem, APP_DESIRED_OUTCOME: scrOutcome,
    APP_CURRENT_SETUP: scrSetup, APP_DECISION_HORIZON: scrHorizon, APP_DOCUMENTS: scrDocuments,
    APP_CONTACT: scrContact, APP_IMPORTANT_CONTEXT: scrImportant, APP_REVIEW: scrReview,
    APP_EDIT_SELECTOR: scrEditSelector, APP_PRIVACY: scrPrivacy, APP_SUBMITTING: scrSubmitting,
    APP_SUCCESS: scrSuccess, APP_FAILURE: scrFailure
  };

  function renderStages() {
    stagesEl.innerHTML = '';
    var active = STAGE_OF[state];
    if (active < 0) { stagesEl.hidden = true; return; }
    stagesEl.hidden = false;
    C.STAGES.forEach(function (name, i) {
      var cls = 'stage' + (i === active ? ' is-active' : (i < active ? ' is-done' : ''));
      stagesEl.appendChild(el('div', cls, name));
    });
  }

  function render() {
    draft.step = state;
    var fn = SCREENS[state] || scrEntry;
    main.innerHTML = '';
    main.appendChild(fn());
    renderStages();
    // Terminal states have no back affordance; submitting is not interruptible.
    // Terminal states have no back affordance; submitting is not interruptible; and the three
    // states outside the ladder have nowhere to go back to.
    backBtn.hidden = (state === 'APP_BOOTSTRAP' || state === 'APP_SUCCESS' || state === 'APP_SUBMITTING' ||
      state === 'APP_STARTING' || state === 'APP_BOOT_FAILURE' || state === 'APP_SESSION_EXPIRED' ||
      state === 'APP_RESUME');
    window.scrollTo({ top: 0, behavior: (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ? 'auto' : 'smooth' });
  }

  backBtn.addEventListener('click', function () {
    if (state === 'APP_FAILURE') { go('APP_REVIEW'); return; }
    if (editingField) { editingField = null; go('APP_REVIEW', { back: true }); return; }
    var prev = history.pop();
    state = prev || 'APP_BOOTSTRAP';
    render();
  });

  // ---------------------------------------------------------------- startup
  //
  // THE SEQUENCE THE DEPLOYED BUILD DID NOT HAVE.
  //
  //   1. Telegram is told the app is ready (already done at module load).
  //   2. The app renders APP_STARTING, so nothing is interactive before there is a session.
  //   3. ONE bootstrap. net.js memoises it, so this cannot fire twice however it is called.
  //   4. On success the entry screen appears with «Начать» enabled and a session behind it.
  //   5. On failure the BOOTSTRAP failure screen appears — not the submission failure screen.
  //
  // The old build skipped 2–5 entirely: it rendered the entry screen immediately and never made a
  // network call until submit, which then failed its own SESSION_INVALID guard locally.
  function startup() {
    render();

    if (!window.FM_NET || !window.FM_NET.configured()) {
      bootFailure = { error_code: 'NOT_CONFIGURED', retryable: false };
      state = 'APP_BOOT_FAILURE';
      render();
      return;
    }

    // The locale the Gateway is asked to record. `initDataUnsafe` is used for this and for the
    // greeting only — never for trust — and the Gateway returns the locale it actually stored.
    var u = tgUser();
    var locale = (u && u.language_code === 'ro') ? 'ro' : 'ru';

    window.FM_NET.bootstrap(locale).then(function (r) {
      if (r.ok !== true) {
        bootFailure = r;
        state = 'APP_BOOT_FAILURE';
        render();
        return;
      }
      // The SERVER decides the locale; the client records what it was told.
      set('locale', String((r.body && r.body.locale) || locale), 'telegram_carried', true);

      // ── HYDRATION ─────────────────────────────────────────────────────────────────────────
      //
      // The Gateway resolves which session this Telegram user and cycle already own and returns
      // its stored draft. A new signed context is not a new business request, so a reload, a
      // close-and-reopen, or a second device all land back on the same brief.
      //
      // Provenance is copied VERBATIM. Rewriting `source` here would turn a value the client
      // gave into one the system guessed, or the reverse — and the skip rule reads exactly that
      // field, so the draft would come back subtly more or less trusted than it was saved.
      var restored = 0;
      var stored = window.FM_NET.resumedDraft();
      if (stored) {
        FIELDS.forEach(function (n) {
          var f = stored.fields[n];
          if (!f || typeof f !== 'object') { return; }
          draft.fields[n] = {
            value: f.value === undefined ? null : f.value,
            source: f.source === undefined ? null : f.source,
            confirmed: f.confirmed === true,
            at: f.at === undefined ? null : f.at
          };
          if (settled(n)) { restored++; }
        });
        // Hydration is not an edit. The draft that came back IS what the server holds, so
        // marking it dirty would write it straight back for no reason.
        dirty = false;
      }
      carryFromTelegram();

      // A COMMITTED session never returns to qualification. It shows what it produced.
      if (window.FM_NET.sessionState() === 'submitted') {
        submitted = true;
        lastLeadId = '';
        state = 'APP_SUCCESS';
        render();
        return;
      }

      // A resumed draft with answers in it is announced rather than silently continued: the
      // client is told what was kept, and offered the way out.
      state = restored > 0 ? 'APP_RESUME' : 'APP_BOOTSTRAP';
      render();
    });
  }

  // Exposed for the offline QA harness only. Not used by the UI.
  window.FM_APP = {
    draft: draft, get: get, set: set, settled: settled,
    contactValid: contactValid, contactReady: contactReady,
    firstUnsettled: firstUnsettled, reviewReady: reviewReady,
    // Deliberately go(), not a raw assignment: a harness that skipped the transition would
    // never exercise the draft flush, and the flush is what makes the answers reach the server.
    goto: function (s) { go(s); },
    current: function () { return state; },
    submitReady: submitReady,
    submit: submit,
    submitting: function () { return submitting; },
    flushDraft: flushDraft,
    draftSettled: draftSettled,
    failures: function () { return { boot: bootFailure, session: sessionFailure, submit: lastFailure }; }
  };

  startup();
})();
