/* FINMENTOR B.2 Mini App prototype — mock-only, zero backend writes */
(function () {
  'use strict';

  var tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  var main = document.getElementById('main');
  var progressBar = document.getElementById('progressBar');
  var backBtn = document.getElementById('backBtn');
  var brandHome = document.getElementById('brandHome');

  var screens = ['entry','profile','control','priority','preview','contact','consent','submitted'];
  var stepIndex = 0;
  var state = {
    sector: '',
    turnover: '',
    cash: '',
    profit: '',
    treasury: '',
    kpi: '',
    pain: '',
    urgency: '',
    context: '',
    contact_name: '',
    company: '',
    direct: '',
    consent: ''
  };

  function safe(fn) { try { fn(); } catch (e) { if (window.console) console.warn('[FINMENTOR miniapp]', e); } }

  safe(function () {
    if (tg) {
      tg.ready();
      tg.expand();
      if (tg.setHeaderColor) tg.setHeaderColor('#08111F');
      if (tg.setBackgroundColor) tg.setBackgroundColor('#08111F');
    }
  });

  function template(name) {
    var tpl = document.getElementById('tpl-' + name);
    return tpl ? tpl.content.cloneNode(true) : document.createTextNode('');
  }

  function render(name) {
    stepIndex = Math.max(0, screens.indexOf(name));
    main.replaceChildren(template(name));
    updateProgress();
    backBtn.hidden = name === 'entry' || name === 'submitted';
    wire(name);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateProgress() {
    var pct = stepIndex === 0 ? 0 : Math.min(100, Math.round((stepIndex / (screens.length - 2)) * 100));
    progressBar.style.width = pct + '%';
  }

  function selectSingle(container, value) {
    Array.prototype.forEach.call(container.querySelectorAll('[data-value]'), function (el) {
      el.classList.toggle('is-selected', el.getAttribute('data-value') === value);
    });
  }

  function bindChoiceGroups(root, onChange) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-field]'), function (group) {
      var field = group.getAttribute('data-field');
      Array.prototype.forEach.call(group.querySelectorAll('[data-value]'), function (btn) {
        btn.addEventListener('click', function () {
          state[field] = btn.getAttribute('data-value');
          selectSingle(group, state[field]);
          if (onChange) onChange();
        });
      });
      if (state[field]) selectSingle(group, state[field]);
    });
  }

  function wire(name) {
    var root = main;
    var nextBtn;

    if (name === 'entry') {
      renderTelegramContext();
      root.querySelector('[data-action="start"]').addEventListener('click', function () { render('profile'); });
      root.querySelector('[data-action="website"]').addEventListener('click', function () {
        var url = 'https://www.finmentor.md/';
        if (tg && tg.openLink) tg.openLink(url); else window.open(url, '_blank', 'noopener');
      });
      return;
    }

    if (name === 'profile') {
      nextBtn = root.querySelector('[data-action="next"]');
      function validate() { nextBtn.disabled = !(state.sector && state.turnover); }
      bindChoiceGroups(root, validate); validate();
      nextBtn.addEventListener('click', function () { render('control'); });
      return;
    }

    if (name === 'control') {
      nextBtn = root.querySelector('[data-action="next"]');
      function validate() { nextBtn.disabled = !(state.cash && state.profit && state.treasury && state.kpi); }
      bindChoiceGroups(root, validate); validate();
      nextBtn.addEventListener('click', function () { render('priority'); });
      return;
    }

    if (name === 'priority') {
      var previewBtn = root.querySelector('[data-action="preview"]');
      var contextText = root.querySelector('#contextText');
      contextText.value = state.context || '';
      contextText.addEventListener('input', function () { state.context = contextText.value.trim(); });
      function validate() { previewBtn.disabled = !(state.pain && state.urgency); }
      bindChoiceGroups(root, validate); validate();
      previewBtn.addEventListener('click', function () { render('preview'); });
      return;
    }

    if (name === 'preview') {
      paintResult(root);
      root.querySelector('[data-action="contact"]').addEventListener('click', function () { render('contact'); });
      root.querySelector('[data-action="restart"]').addEventListener('click', function () { resetState(); render('entry'); });
      return;
    }

    if (name === 'contact') {
      var nameInput = root.querySelector('#contactName');
      var companyInput = root.querySelector('#contactCompany');
      var directInput = root.querySelector('#contactDirect');
      var consentBtn = root.querySelector('[data-action="consent"]');
      var tgUser = tg && tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user : null;
      if (!state.contact_name && tgUser && tgUser.first_name) state.contact_name = tgUser.first_name;
      nameInput.value = state.contact_name || '';
      companyInput.value = state.company || '';
      directInput.value = state.direct || '';
      function validate() {
        state.contact_name = nameInput.value.trim();
        state.company = companyInput.value.trim();
        state.direct = directInput.value.trim();
        consentBtn.disabled = !(state.contact_name && state.company);
      }
      [nameInput, companyInput, directInput].forEach(function (el) { el.addEventListener('input', validate); });
      validate();
      consentBtn.addEventListener('click', function () { render('consent'); });
      return;
    }

    if (name === 'consent') {
      root.querySelector('[data-action="submit-yes"]').addEventListener('click', function () {
        state.consent = 'yes';
        render('submitted');
        var title = main.querySelector('#submitTitle');
        var text = main.querySelector('#submitText');
        if (title) title.textContent = 'Прототип: запрос готов к передаче';
        if (text) text.textContent = 'B.2.0 не вызывает backend. В рабочей версии этот экран откроется только после canonical ok:true от Lead Intake.';
      });
      root.querySelector('[data-action="submit-no"]').addEventListener('click', function () {
        state.consent = 'no';
        render('submitted');
        var title = main.querySelector('#submitTitle');
        var text = main.querySelector('#submitText');
        if (title) title.textContent = 'Ничего не передано';
        if (text) text.textContent = 'Без вашего согласия FINMENTOR не отправляет диагностический контекст эксперту. Можно вернуться позже.';
      });
      return;
    }

    if (name === 'submitted') {
      var closeBtn = root.querySelector('[data-action="close"]');
      if (closeBtn) closeBtn.addEventListener('click', function () {
        if (tg && tg.close) tg.close(); else render('entry');
      });
    }
  }

  function renderTelegramContext() {
    var el = main.querySelector('#telegramContext');
    if (!el) return;
    var user = tg && tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user : null;
    if (tg && user) {
      el.classList.add('is-ok');
      el.textContent = 'Telegram-контекст доступен · ' + (user.first_name || 'пользователь') + '. В B.2.0 он не отправляется на backend.';
    } else {
      el.textContent = 'Предпросмотр вне Telegram. Интерфейс работает, но защищённая идентификация будет доступна только внутри Mini App.';
    }
  }

  function paintResult(root) {
    var focus = root.querySelector('#resultFocus');
    var summary = root.querySelector('#resultSummary');
    var grid = root.querySelector('#insightGrid');
    var nextTitle = root.querySelector('#nextStepTitle');
    var nextText = root.querySelector('#nextStepText');

    var weak = ['cash','profit','treasury','kpi'].filter(function (k) { return state[k] === 'unclear'; });
    var partial = ['cash','profit','treasury','kpi'].filter(function (k) { return state[k] === 'partial'; });

    var map = {
      cash: 'Деньги / Cash Flow',
      profit: 'Прибыль / P&L',
      treasury: 'Казначейство',
      kpi: 'KPI и контроль'
    };

    var primary = weak[0] || partial[0] || 'kpi';
    focus.textContent = map[primary] || 'Финансовый контроль';

    if (weak.length >= 2) {
      summary.textContent = 'Несколько ключевых контуров управления сейчас требуют ручной проверки. Главный риск — решения принимаются быстрее, чем появляется единая финансовая картина.';
    } else if (weak.length === 1) {
      summary.textContent = 'В целом система уже частично сформирована, но один критический контур остаётся непрозрачным для регулярных управленческих решений.';
    } else {
      summary.textContent = 'Базовый финансовый контроль выглядит зрелее среднего, но предварительная диагностика не подтверждает качество цифр и процессов без проверки данных.';
    }

    var observations = [];
    if (state.cash === 'unclear') observations.push(['Cash visibility','Нет устойчивой видимости движения денег.']);
    if (state.profit === 'unclear') observations.push(['Profit visibility','P&L не даёт собственнику понятной картины прибыли.']);
    if (state.treasury === 'unclear') observations.push(['Treasury','Платёжный процесс воспринимается как несистемный.']);
    if (state.kpi === 'unclear') observations.push(['Management control','KPI и управленческий контроль не собраны в работающий контур.']);
    if (!observations.length) observations.push(['Control maturity','Критического разрыва по ответам не видно; нужна проверка качества данных.']);
    if (state.urgency === 'none') observations.push(['Urgency','Вы указали, что срочности нет — это не повышает приоритет заявки.']);

    grid.innerHTML = observations.slice(0, 3).map(function (x) {
      return '<div class="insight"><span>' + escapeHtml(x[0]) + '</span><b>' + escapeHtml(x[1]) + '</b></div>';
    }).join('');

    if (weak.length >= 2 || state.urgency === 'now') {
      nextTitle.textContent = 'Financial X-Ray';
      nextText.textContent = 'Сначала подтвердить причины разрывов на фактических данных и определить 3–5 управленческих приоритетов.';
    } else {
      nextTitle.textContent = 'Discovery Call';
      nextText.textContent = 'Коротко сверить контекст и решить, нужна ли глубокая диагностика или достаточно точечной настройки процесса.';
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[c];
    });
  }

  function resetState() {
    Object.keys(state).forEach(function (k) { state[k] = ''; });
  }

  backBtn.addEventListener('click', function () {
    if (stepIndex <= 1) render('entry');
    else render(screens[stepIndex - 1]);
  });
  brandHome.addEventListener('click', function (e) { e.preventDefault(); render('entry'); });

  render('entry');
})();
