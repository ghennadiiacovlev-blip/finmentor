/* FINMENTOR — Website Lead Assistant (v8)
   Rule-based navigator: helps the visitor pick a first step.
   No backend, no external API, no AI chat, no personal data collected or sent to GA4.
   Self-contained; safe to load on every page. */
(function () {
  if (window.__faInit) return;
  window.__faInit = true;

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }
  function ga(name, params) {
    if (typeof gtag === 'function') { try { gtag('event', name, params || {}); } catch (e) {} }
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  var TG = 'https://t.me/Yakovlev_Ghennadi';
  // Discovery Call target: same-page section on the homepage, otherwise the homepage section.
  function disco() { return document.getElementById('consult') ? '#consult' : 'index.html#consult'; }

  ready(function () {
    if (document.getElementById('faPanel')) return;

    var LANG = (document.documentElement.lang || 'ru').slice(0, 2);
    var I18N = {
      ru: {
        launchLg: 'Нужна подсказка?', launchSm: 'Помочь выбрать шаг',
        launchAria: 'Открыть финансовый навигатор — помощь в выборе первого шага',
        title: 'Финансовый навигатор FINMENTOR', closeAria: 'Закрыть навигатор',
        intro: 'Я помогу выбрать первый шаг: mini-scan, диагностика, Discovery Call или нужную страницу. Это не финансовое заключение — для анализа данных нужна диагностика.',
        q: 'Что сейчас больше всего беспокоит?',
        disc: 'Ассистент помогает выбрать первый шаг. Это не финансовое заключение и не индивидуальная рекомендация.',
        back: '&larr; Назад', backAria: 'Назад к выбору',
        sc: [
          { choose: 'assistant_choose_working_capital', opt: 'Прибыль есть, но денег не хватает',
            a: 'Часто причина в оборотном капитале: дебиторка, запасы, авансы или условия оплаты. Начните с короткого mini-scan.',
            ctas: [ { l: 'Пройти mini-scan', h: 'working-capital-scan.html', e: 'assistant_click_mini_scan', p: true },
                    { l: 'Страница про оборотный капитал', h: 'working-capital.html' },
                    { l: 'Discovery Call', h: disco(), e: 'assistant_click_discovery_call' } ] },
          { choose: 'assistant_choose_treasury', opt: 'Платежи идут хаотично',
            a: 'В такой ситуации обычно нужен платёжный календарь, приоритеты платежей и контроль покрытия на 7 / 14 / 30 дней.',
            ctas: [ { l: 'Открыть казначейство', h: 'kaznacheystvo.html', p: true },
                    { l: 'Смотреть методологию', h: 'methodology.html' },
                    { l: 'Discovery Call', h: disco(), e: 'assistant_click_discovery_call' } ] },
          { choose: 'assistant_choose_reporting', opt: 'Нет понятного P&L / Cash Flow',
            a: 'Если собственник не видит прибыль, деньги и риски в одной логике, первым шагом обычно является Financial Health Check.',
            ctas: [ { l: 'Пройти полную диагностику', h: 'questionnaire.html', p: true },
                    { l: 'Discovery Call', h: disco(), e: 'assistant_click_discovery_call' },
                    { l: 'Business Control System', h: 'business-control-system.html' } ] },
          { choose: 'assistant_choose_powerbi', opt: 'Хочу Power BI dashboard',
            a: 'Power BI имеет смысл только после определения финансовой логики: какие показатели считать, из каких источников брать данные и кто отвечает за качество данных.',
            ctas: [ { l: 'Power BI для собственника', h: 'power-bi-dlya-sobstvennika.html', p: true },
                    { l: '1C → Power BI интеграция', h: 'power-bi-dlya-sobstvennika.html' },
                    { l: 'Discovery Call', h: disco(), e: 'assistant_click_discovery_call' } ] },
          { choose: 'assistant_choose_fit', opt: 'Хочу понять, подходит ли FINMENTOR',
            a: 'Лучший первый шаг — Discovery Call на 20–30 минут. Это короткий квалификационный разговор, чтобы понять, есть ли смысл в диагностике.',
            ctas: [ { l: 'Записаться на Discovery Call', h: disco(), e: 'assistant_click_discovery_call', p: true },
                    { l: 'Смотреть анонимные сценарии', h: 'cases.html' },
                    { l: 'Написать в Telegram', h: TG, e: 'assistant_click_telegram', tg: true } ] }
        ]
      },
      ro: {
        launchLg: 'Ai nevoie de un sfat?', launchSm: 'Ajută-mă să aleg pasul',
        launchAria: 'Deschide navigatorul financiar — ajutor în alegerea primului pas',
        title: 'Navigator financiar FINMENTOR', closeAria: 'Închide navigatorul',
        intro: 'Te ajut să alegi primul pas: mini-scan, diagnostic, Discovery Call sau pagina potrivită. Nu este o concluzie financiară — pentru analiza datelor este nevoie de un diagnostic.',
        q: 'Ce te preocupă cel mai mult acum?',
        disc: 'Navigatorul ajută la alegerea primului pas. Nu este o concluzie financiară și nici o recomandare individuală.',
        back: '&larr; Înapoi', backAria: 'Înapoi la alegere',
        sc: [
          { choose: 'assistant_choose_working_capital', opt: 'Profit există, dar banii nu ajung',
            a: 'Adesea cauza este în capitalul circulant: creanțe, stocuri, avansuri sau condiții de plată. Începeți cu un mini-scan scurt.',
            ctas: [ { l: 'Treci mini-scanul', h: 'working-capital-scan.html', e: 'assistant_click_mini_scan', p: true },
                    { l: 'Despre capitalul circulant', h: 'capital-circulant.html' },
                    { l: 'Discovery Call', h: disco(), e: 'assistant_click_discovery_call' } ] },
          { choose: 'assistant_choose_treasury', opt: 'Plăți haotice, fără priorități',
            a: 'În această situație e nevoie de un calendar de plăți, priorități de plată și control al acoperirii pe 7 / 14 / 30 de zile.',
            ctas: [ { l: 'Deschide trezoreria', h: 'trezorerie.html', p: true },
                    { l: 'Vezi metodologia', h: 'methodology.html' },
                    { l: 'Discovery Call', h: disco(), e: 'assistant_click_discovery_call' } ] },
          { choose: 'assistant_choose_reporting', opt: 'Nu există P&L / Cash Flow clar',
            a: 'Dacă proprietarul nu vede profitul, banii și riscurile într-o singură logică, primul pas este de obicei un Financial Health Check.',
            ctas: [ { l: 'Treci diagnosticul complet', h: 'questionnaire.html', p: true },
                    { l: 'Discovery Call', h: disco(), e: 'assistant_click_discovery_call' },
                    { l: 'Metodologie', h: 'methodology.html' } ] },
          { choose: 'assistant_choose_powerbi', opt: 'Vreau un dashboard Power BI',
            a: 'Power BI are sens doar după definirea logicii financiare: ce indicatori se calculează, din ce surse și cine răspunde de calitatea datelor.',
            ctas: [ { l: 'Power BI pentru proprietar', h: 'power-bi-pentru-proprietar.html', p: true },
                    { l: '1C → Power BI', h: 'power-bi-pentru-proprietar.html' },
                    { l: 'Discovery Call', h: disco(), e: 'assistant_click_discovery_call' } ] },
          { choose: 'assistant_choose_fit', opt: 'Vreau să înțeleg dacă FINMENTOR mi se potrivește',
            a: 'Cel mai bun prim pas — un Discovery Call de 20–30 de minute. O discuție scurtă de calificare, ca să vedem dacă are sens un diagnostic.',
            ctas: [ { l: 'Programează un Discovery Call', h: disco(), e: 'assistant_click_discovery_call', p: true },
                    { l: 'Vezi scenarii anonime', h: 'cases.html' },
                    { l: 'Scrie pe Telegram', h: TG, e: 'assistant_click_telegram', tg: true } ] }
        ]
      },
      en: {
        launchLg: 'Need a hint?', launchSm: 'Help me choose a step',
        launchAria: 'Open the financial navigator — help choosing the first step',
        title: 'FINMENTOR financial navigator', closeAria: 'Close the navigator',
        intro: 'I will help you choose a first step: a quick scan, a diagnostic, a Discovery Call or the right page. This is not a financial conclusion — analysing data requires a diagnostic.',
        q: 'What concerns you most right now?',
        disc: 'The navigator helps you choose a first step. It is not a financial conclusion or individual advice.',
        back: '&larr; Back', backAria: 'Back to the options',
        sc: [
          { choose: 'assistant_choose_working_capital', opt: 'Profit on paper, but not enough cash',
            a: 'The cause is often working capital: receivables, inventory, advances or payment terms. Start with a short quick scan.',
            ctas: [ { l: 'Take the quick scan', h: 'working-capital-scan.html', e: 'assistant_click_mini_scan', p: true },
                    { l: 'About working capital', h: 'working-capital.html' },
                    { l: 'Discovery Call', h: disco(), e: 'assistant_click_discovery_call' } ] },
          { choose: 'assistant_choose_treasury', opt: 'Payments are chaotic',
            a: 'In this situation you usually need a payment calendar, payment priorities and 7 / 14 / 30-day coverage control.',
            ctas: [ { l: 'Open treasury', h: 'treasury.html', p: true },
                    { l: 'See the methodology', h: 'methodology.html' },
                    { l: 'Discovery Call', h: disco(), e: 'assistant_click_discovery_call' } ] },
          { choose: 'assistant_choose_reporting', opt: 'No clear P&L / Cash Flow',
            a: 'If the owner cannot see profit, cash and risk in one logic, the first step is usually a Financial Health Check.',
            ctas: [ { l: 'Take the full diagnostic', h: 'questionnaire.html', p: true },
                    { l: 'Discovery Call', h: disco(), e: 'assistant_click_discovery_call' },
                    { l: 'Methodology', h: 'methodology.html' } ] },
          { choose: 'assistant_choose_powerbi', opt: 'I want a Power BI dashboard',
            a: 'Power BI makes sense only after the financial logic is defined: which metrics, from which sources and who owns data quality.',
            ctas: [ { l: 'Power BI for the owner', h: 'power-bi-for-owner.html', p: true },
                    { l: '1C → Power BI', h: 'power-bi-for-owner.html' },
                    { l: 'Discovery Call', h: disco(), e: 'assistant_click_discovery_call' } ] },
          { choose: 'assistant_choose_fit', opt: 'I want to understand if FINMENTOR fits',
            a: 'The best first step is a 20–30 minute Discovery Call. A short qualifying conversation to see whether a diagnostic makes sense.',
            ctas: [ { l: 'Book a Discovery Call', h: disco(), e: 'assistant_click_discovery_call', p: true },
                    { l: 'See anonymous scenarios', h: 'cases.html' },
                    { l: 'Message on Telegram', h: TG, e: 'assistant_click_telegram', tg: true } ] }
        ]
      }
    };
    if (!I18N[LANG]) LANG = 'ru';
    var T = I18N[LANG];
    var SC = T.sc;

    var DISC = '<p class="fa-disclaimer">' + T.disc + '</p>';

    var launch = document.createElement('button');
    launch.type = 'button';
    launch.className = 'fa-launch';
    launch.setAttribute('aria-haspopup', 'dialog');
    launch.setAttribute('aria-expanded', 'false');
    launch.setAttribute('aria-controls', 'faPanel');
    launch.setAttribute('aria-label', T.launchAria);
    launch.innerHTML =
      '<svg class="fa-launch__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z"/></svg>' +
      '<span class="fa-launch__lg">' + T.launchLg + '</span>' +
      '<span class="fa-launch__sm">' + T.launchSm + '</span>';

    var panel = document.createElement('div');
    panel.className = 'fa-panel';
    panel.id = 'faPanel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', T.title);
    panel.hidden = true;
    panel.innerHTML =
      '<div class="fa-panel__head">' +
        '<span class="fa-panel__title">' + T.title + '</span>' +
        '<button type="button" class="fa-panel__close" aria-label="' + T.closeAria + '">' +
          '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="fa-panel__body" id="faBody"></div>';

    document.body.appendChild(launch);
    document.body.appendChild(panel);
    var body = panel.querySelector('#faBody');
    var closeBtn = panel.querySelector('.fa-panel__close');

    function renderMenu() {
      var h = '<p class="fa-intro">' + T.intro + '</p>' +
              '<p class="fa-q">' + T.q + '</p>' +
              '<div class="fa-options">';
      SC.forEach(function (s, i) { h += '<button type="button" class="fa-opt" data-i="' + i + '">' + esc(s.opt) + '</button>'; });
      h += '</div>' + DISC;
      body.innerHTML = h;
      Array.prototype.forEach.call(body.querySelectorAll('.fa-opt'), function (btn) {
        btn.addEventListener('click', function () { renderAnswer(SC[+btn.getAttribute('data-i')]); });
      });
      body.scrollTop = 0;
    }

    function renderAnswer(s) {
      ga(s.choose);
      var h = '<button type="button" class="fa-back" id="faBack" aria-label="' + T.backAria + '">' + T.back + '</button>' +
              '<p class="fa-q" style="margin-top:var(--sp-4)">' + esc(s.opt) + '</p>' +
              '<p class="fa-answer__text">' + esc(s.a) + '</p>' +
              '<div class="fa-ctas">';
      s.ctas.forEach(function (c) {
        var cls = 'btn btn--sm ' + (c.p ? 'btn--primary' : 'btn--ghost');
        var attrs = 'href="' + c.h + '"';
        if (c.tg) attrs += ' target="_blank" rel="noopener noreferrer"';
        attrs += ' data-ev="' + (c.e || '') + '"';
        h += '<a class="' + cls + '" ' + attrs + '>' + esc(c.l) + '</a>';
      });
      h += '</div>' + DISC;
      body.innerHTML = h;
      body.querySelector('#faBack').addEventListener('click', renderMenu);
      Array.prototype.forEach.call(body.querySelectorAll('.fa-ctas a'), function (a) {
        a.addEventListener('click', function () {
          var ev = a.getAttribute('data-ev'); if (ev) ga(ev);
          var href = a.getAttribute('href') || '';
          if (href.charAt(0) === '#') close(); // same-page anchor: close so the section is visible
        });
      });
      body.scrollTop = 0;
    }

    var lastFocus = null;
    function open() {
      if (!panel.hidden) return;
      lastFocus = document.activeElement;
      renderMenu();
      panel.hidden = false;
      launch.classList.add('is-open');
      launch.setAttribute('aria-expanded', 'true');
      ga('open_finmentor_assistant');
      setTimeout(function () { try { closeBtn.focus(); } catch (e) {} }, 30);
      document.addEventListener('keydown', onKey);
      document.addEventListener('click', onDocClick, true);
    }
    function close() {
      if (panel.hidden) return;
      panel.hidden = true;
      launch.classList.remove('is-open');
      launch.setAttribute('aria-expanded', 'false');
      ga('close_finmentor_assistant');
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onDocClick, true);
      if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    }
    function onKey(e) { if (e.key === 'Escape' || e.keyCode === 27) close(); }
    function onDocClick(e) {
      if (panel.hidden) return;
      if (panel.contains(e.target) || launch.contains(e.target)) return;
      close();
    }

    launch.addEventListener('click', function () { panel.hidden ? open() : close(); });
    closeBtn.addEventListener('click', function () { close(); });
  });
})();
