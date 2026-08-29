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
  function set(name, value, source, confirmed) {
    draft.fields[name] = { value: value, source: source, confirmed: confirmed !== false, at: confirmed !== false ? nowIso() : null };
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

  // ---------------------------------------------------------------- flow
  var FLOW = ['APP_COMPANY', 'APP_ROLE', 'APP_SCALE', 'APP_OBJECTIVE', 'APP_PROBLEM',
    'APP_DESIRED_OUTCOME', 'APP_CURRENT_SETUP', 'APP_DECISION_HORIZON', 'APP_DOCUMENTS',
    'APP_CONTACT', 'APP_IMPORTANT_CONTEXT', 'APP_REVIEW'];
  var STAGE_OF = {
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

  var state = 'APP_BOOTSTRAP';
  var editingField = null;   // set while APP_EDIT_FIELD is active → return straight to review
  var history = [];

  function go(next, opts) {
    if (!(opts && opts.back)) { history.push(state); }
    state = next;
    render();
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
  function icon(name) { var s = el('span'); s.innerHTML = ICON[name]; s.style.display = 'flex'; return s; }

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
    var t = icon('tick'); t.className = 'tick'; b.appendChild(t);
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
    var t = icon('tick'); t.className = 'tick'; b.appendChild(t);
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
    var t = icon('tick'); t.className = 'tick'; d.appendChild(t);
    var body = el('div', 'body');
    body.appendChild(el('b', null, valueText));
    body.appendChild(el('i', null, note ? labelText + ' · ' + note : labelText));
    d.appendChild(body);
    if (onEdit) { var u = el('u', null, 'Изменить'); u.addEventListener('click', onEdit); d.appendChild(u); }
    return d;
  }

  // ---------------------------------------------------------------- screens

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
      set('contact_name', u.first_name, 'telegram_carried', true);
      set('locale', (u.language_code === 'ro' ? 'ro' : 'ru'), 'telegram_carried', true);
      var sp = el('div'); sp.style.height = '34px'; s.appendChild(sp);
      s.appendChild(knownRow('Из Telegram', u.first_name, 'спрашивать не будем', null));
    }
    s.appendChild(grow());
    s.appendChild(actions(btn('Начать', function () { go(firstUnsettled()); })));
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

  function fieldInput(labelText, name, placeholder) {
    var f = el('div', 'field');
    var lab = el('label', null, labelText);
    var inp = el('input');
    inp.type = 'text';
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
            draft.fields[n] = { value: null, source: null, confirmed: false, at: null };
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
        draft.fields.problem_free_text = { value: null, source: null, confirmed: false, at: null };
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
          draft.fields.desired_outcome_free_text = { value: null, source: null, confirmed: false, at: null };
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
        draft.fields.documents = { value: null, source: null, confirmed: false, at: null };
        advance();
      }, 'tertiary')
    ));
    return s;
  }

  function scrContact() {
    var s = screen();
    s.appendChild(title(C.CONTACT.title));
    var sp = el('div'); sp.style.height = '30px'; s.appendChild(sp);
    var stack = el('div', 'stack');
    C.CONTACT.options.forEach(function (o) {
      stack.appendChild(rowBtn(o.label, get('contact_channel') === o.id, function () {
        set('contact_channel', o.id, 'user_explicit', true);
        // Telegram is the reply channel: no phone, no email is requested.
        if (o.id === 'telegram') { draft.fields.contact_value = { value: null, source: null, confirmed: false, at: null }; }
        render();
      }));
    });
    s.appendChild(stack);
    var ch = get('contact_channel');
    if (ch === 'telegram') { s.appendChild(quiet(C.CONTACT.telegramNote)); }
    if (ch === 'phone' || ch === 'email') {
      var sp2 = el('div'); sp2.style.height = '20px'; s.appendChild(sp2);
      s.appendChild(fieldInput(ch === 'phone' ? 'Телефон' : 'Email', 'contact_value', ''));
    }
    s.appendChild(grow());
    var ready = settled('contact_channel') && (ch === 'telegram' || settled('contact_value'));
    s.appendChild(actions(btn('Продолжить', function () { advance(); }, null, !ready)));
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
      var c = icon('chev'); c.className = 'chev'; b.appendChild(c);
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
      btn(C.PRIVACY.primary, function () { submit(); }),
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

  function submit() {
    if (!submitAck) {
      submitAck = {
        notice_version: (window.FM_NOTICE_VERSION || 'pn-2026-08'),
        locale: get('locale') || 'ru',
        shown_at: privacyShownAt || nowIso(),
        acknowledged_at: nowIso()
      };
      window.FM_LAST_ACK = submitAck;
    }
    go('APP_SUBMITTING');

    // Offline candidate: no endpoints injected. It must NOT look like a failed submission of a
    // real request, and it must never look like a success.
    if (!window.FM_NET || !window.FM_NET.configured()) {
      lastFailure = { error_code: 'NOT_CONFIGURED', retryable: false };
      setTimeout(function () { go('APP_FAILURE'); }, 400);
      return;
    }

    window.FM_NET.submit(submitAck).then(function (r) {
      if (r.ok === true) {
        lastFailure = null;
        submitted = true;
        lastLeadId = String((r.body && r.body.lead_id) || '');
        go('APP_SUCCESS');
        return;
      }
      lastFailure = r;
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
    C.SUCCESS.lines.forEach(function (l) { s.appendChild(lead(l)); });
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
    s.appendChild(actions(btn(C.SUCCESS.primary, function () { if (tg && tg.close) { tg.close(); } })));
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
    // states retryability; the client does not infer it from a status code.
    var canRetry = !lastFailure || lastFailure.retryable !== false;
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
    backBtn.hidden = (state === 'APP_BOOTSTRAP' || state === 'APP_SUCCESS' || state === 'APP_SUBMITTING');
    window.scrollTo({ top: 0, behavior: (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ? 'auto' : 'smooth' });
  }

  backBtn.addEventListener('click', function () {
    if (state === 'APP_FAILURE') { go('APP_REVIEW'); return; }
    if (editingField) { editingField = null; go('APP_REVIEW', { back: true }); return; }
    var prev = history.pop();
    state = prev || 'APP_BOOTSTRAP';
    render();
  });

  // Exposed for the offline QA harness only. Not used by the UI.
  window.FM_APP = {
    draft: draft, get: get, set: set, settled: settled,
    firstUnsettled: firstUnsettled, reviewReady: reviewReady,
    goto: function (s) { state = s; render(); },
    current: function () { return state; }
  };

  render();
})();
