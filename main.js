/* ============================================================================
   FINMENTOR — main.js  (vanilla, no dependencies)
   Robust by design: intro dismissal runs first; every feature is guarded so a
   failure in one never blocks the others or traps the intro overlay.
   ========================================================================== */
/*
  FINMENTOR — proprietary website content and implementation.
  © 2026 FINMENTOR / Ghennadi Iacovlev. All rights reserved.
  Unauthorized copying, redistribution or commercial reuse is prohibited.
  Contact: cfo@finmentor.md
*/

(function () {
  'use strict';

  var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  /* ------------------------------------------------------------- INTRO */
  function initIntro() {
    var intro = document.getElementById('intro');
    if (!intro) return;

    var alreadySkipped = document.documentElement.classList.contains('intro-skip');
    var INTRO_MS = 4400;

    function dismiss() {
      intro.classList.add('is-done');
      document.body.classList.remove('is-locked');
      try { sessionStorage.setItem('fm_intro_played', '1'); } catch (e) {}
      window.setTimeout(function () { if (intro && intro.parentNode) intro.style.display = 'none'; }, 650);
    }

    if (alreadySkipped || prefersReduced) {
      // Guard already hid it pre-paint; ensure clean final state, no scroll lock.
      intro.classList.add('is-done');
      intro.style.display = 'none';
      return;
    }

    // Play once
    document.body.classList.add('is-locked');
    var skip = document.getElementById('introSkip');
    if (skip) skip.addEventListener('click', dismiss);
    var timer = window.setTimeout(dismiss, INTRO_MS);
    // Safety net if anything stalls
    window.setTimeout(function () {
      if (!intro.classList.contains('is-done')) { window.clearTimeout(timer); dismiss(); }
    }, INTRO_MS + 2500);
  }

  /* ------------------------------------------------------------- PARTICLE FIELD (constellation) */
  function ParticleField(canvas, opts) {
    opts = opts || {};
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var particles = [];
    var w = 0, h = 0, raf = null, running = false;
    var density = opts.density || 0.00008;   // particles per px²
    var maxParticles = opts.max || 90;
    var linkDist = opts.linkDist || 130;
    var dotColor = opts.dotColor || 'rgba(201,162,39,0.55)';
    var lineColor = opts.lineColor || 'rgba(120,150,200,';
    var pointer = { x: -9999, y: -9999 };

    function resize() {
      var r = canvas.getBoundingClientRect();
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
    }

    function build() {
      var count = Math.min(maxParticles, Math.floor(w * h * density));
      particles = [];
      for (var i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.25,
          vy: (Math.random() - 0.5) * 0.25,
          r: Math.random() * 1.6 + 0.6
        });
      }
    }

    function step() {
      ctx.clearRect(0, 0, w, h);
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;

        // gentle pointer attraction
        var dxp = pointer.x - p.x, dyp = pointer.y - p.y;
        var dp = dxp * dxp + dyp * dyp;
        if (dp < 18000) { p.x += dxp * 0.0009; p.y += dyp * 0.0009; }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = dotColor;
        ctx.fill();
      }
      // links
      for (var a = 0; a < particles.length; a++) {
        for (var b = a + 1; b < particles.length; b++) {
          var dx = particles[a].x - particles[b].x;
          var dy = particles[a].y - particles[b].y;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < linkDist) {
            ctx.beginPath();
            ctx.moveTo(particles[a].x, particles[a].y);
            ctx.lineTo(particles[b].x, particles[b].y);
            ctx.strokeStyle = lineColor + (0.14 * (1 - dist / linkDist)).toFixed(3) + ')';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }
      if (running) raf = requestAnimationFrame(step);
    }

    this.start = function () { if (running) return; running = true; raf = requestAnimationFrame(step); };
    this.stop = function () { running = false; if (raf) cancelAnimationFrame(raf); };
    this.setPointer = function (x, y) { pointer.x = x; pointer.y = y; };
    this.resize = resize;

    resize();
    window.addEventListener('resize', debounce(resize, 200));
  }

  /* ------------------------------------------------------------- CANVASES */
  function initCanvases() {
    if (prefersReduced) return;

    var heroCanvas = document.querySelector('.hero__canvas');
    if (heroCanvas) {
      var hero = new ParticleField(heroCanvas, {
        max: 95, linkDist: 140,
        dotColor: 'rgba(201,162,39,0.50)',
        lineColor: 'rgba(120,150,210,'
      });
      hero.start();
      // pointer-driven links over hero
      var heroSection = document.querySelector('.hero');
      if (heroSection) {
        heroSection.addEventListener('pointermove', function (e) {
          var r = heroCanvas.getBoundingClientRect();
          hero.setPointer(e.clientX - r.left, e.clientY - r.top);
        });
        heroSection.addEventListener('pointerleave', function () { hero.setPointer(-9999, -9999); });
      }
    }

    var introCanvas = document.querySelector('.intro__canvas');
    if (introCanvas && !document.documentElement.classList.contains('intro-skip')) {
      var intro = new ParticleField(introCanvas, {
        max: 70, linkDist: 150,
        dotColor: 'rgba(232,199,102,0.45)',
        lineColor: 'rgba(120,150,210,'
      });
      intro.start();
      // stop the intro field shortly after the overlay is gone
      window.setTimeout(function () { intro.stop(); }, 8000);
    }
  }

  /* ------------------------------------------------------------- CUSTOM CURSOR */
  function initCursor() {
    if (!canHover || prefersReduced) return;
    var cursor = document.getElementById('cursor');
    if (!cursor) return;
    document.documentElement.classList.add('has-cursor');
    var dot = cursor.querySelector('.cursor__dot');
    var ring = cursor.querySelector('.cursor__ring');

    var mx = window.innerWidth / 2, my = window.innerHeight / 2;
    var rx = mx, ry = my;

    window.addEventListener('pointermove', function (e) {
      mx = e.clientX; my = e.clientY;
      dot.style.left = mx + 'px';
      dot.style.top = my + 'px';
    });

    (function loop() {
      rx += (mx - rx) * 0.18;
      ry += (my - ry) * 0.18;
      ring.style.left = rx + 'px';
      ring.style.top = ry + 'px';
      requestAnimationFrame(loop);
    })();

    var interactive = 'a, button, [tabindex], .card, input, textarea';
    document.addEventListener('pointerover', function (e) {
      if (e.target.closest && e.target.closest(interactive)) cursor.classList.add('is-hover');
    });
    document.addEventListener('pointerout', function (e) {
      if (e.target.closest && e.target.closest(interactive)) cursor.classList.remove('is-hover');
    });
  }

  /* ------------------------------------------------------------- HEADER SCROLL STATE */
  function initHeader() {
    var header = document.getElementById('header');
    if (!header) return;
    function onScroll() {
      if (window.scrollY > 24) header.classList.add('is-scrolled');
      else header.classList.remove('is-scrolled');
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ------------------------------------------------------------- MOBILE MENU */
  function initMenu() {
    var burger = document.getElementById('burger');
    var menu = document.getElementById('mobileMenu');
    if (!burger || !menu) return;

    function setOpen(open) {
      burger.classList.toggle('is-open', open);
      menu.classList.toggle('is-open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      menu.setAttribute('aria-hidden', open ? 'false' : 'true');
      document.body.classList.toggle('is-locked', open);
    }
    burger.addEventListener('click', function () { setOpen(!menu.classList.contains('is-open')); });
    menu.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () { setOpen(false); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.classList.contains('is-open')) setOpen(false);
    });
  }

  /* ------------------------------------------------------------- COUNTERS */
  function initCounters() {
    var nums = document.querySelectorAll('[data-count]');
    if (!nums.length) return;

    function animate(el) {
      var target = parseInt(el.getAttribute('data-count'), 10) || 0;
      if (prefersReduced) { el.textContent = target; return; }
      var dur = 1400, start = null;
      function tick(ts) {
        if (!start) start = ts;
        var p = Math.min((ts - start) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
        el.textContent = Math.round(target * eased);
        if (p < 1) requestAnimationFrame(tick);
        else el.textContent = target;
      }
      requestAnimationFrame(tick);
    }

    var seen = new WeakSet();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && !seen.has(en.target)) {
          seen.add(en.target);
          animate(en.target);
        }
      });
    }, { threshold: 0.6 });
    nums.forEach(function (n) { io.observe(n); });
  }

  /* ------------------------------------------------------------- SCROLL REVEAL */
  function initReveal() {
    var items = document.querySelectorAll('.reveal');
    if (!items.length) return;

    items.forEach(function (el) {
      var d = el.getAttribute('data-reveal-delay');
      if (d) el.style.setProperty('--reveal-delay', d);
    });

    if (prefersReduced || !('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
    items.forEach(function (el) { io.observe(el); });
  }

  /* ------------------------------------------------------------- HERO PARALLAX */
  function initParallax() {
    if (prefersReduced) return;
    var hero = document.querySelector('.hero');
    var mesh = document.querySelector('.hero__mesh');
    var content = document.querySelector('.hero__content');
    if (!hero || !mesh) return;

    hero.addEventListener('pointermove', function (e) {
      var cx = (e.clientX / window.innerWidth - 0.5);
      var cy = (e.clientY / window.innerHeight - 0.5);
      mesh.style.transform = 'translate(' + (cx * 22) + 'px,' + (cy * 22) + 'px)';
      if (content) content.style.transform = 'translate(' + (cx * -8) + 'px,' + (cy * -8) + 'px)';
    });
    hero.addEventListener('pointerleave', function () {
      mesh.style.transform = '';
      if (content) content.style.transform = '';
    });
  }

  /* ------------------------------------------------------------- LANGUAGE (visual stub; full i18n later) */
  function initLang() {
    var groups = document.querySelectorAll('.lang');
    groups.forEach(function (group) {
      group.querySelectorAll('.lang__btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var lang = btn.getAttribute('data-lang');
          document.querySelectorAll('.lang__btn').forEach(function (b) {
            b.classList.toggle('is-active', b.getAttribute('data-lang') === lang);
          });
          // Stage 1: only RU content exists. RO/EN dictionaries are wired in a later stage.
        });
      });
    });
  }

  /* ------------------------------------------------------------- CASES (S5) */
  function initCases() {
    var filters = document.getElementById('casesFilters');
    var card = document.getElementById('caseCard');
    if (!filters || !card) return;

    var ICON = {
      finance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16v-4"/><path d="M12 16V8"/><path d="M16 16v-6"/></svg>',
      treasury: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/></svg>',
      bi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l3-3 3 2 5-6"/></svg>',
      ai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/><circle cx="12" cy="12" r="2"/></svg>',
      realestate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V9l5-4 5 4v12"/><path d="M9 21v-5h2v5"/></svg>',
      construction: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21h16"/><path d="M6 21V8h7v13"/><path d="M13 12h5v9"/><path d="M9 21V8"/><path d="M6 5l4-2 4 2"/></svg>',
      production: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4"/></svg>',
      ecommerce: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/><path d="M2 3h2l2.4 12.4a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L21 7H6"/></svg>',
      trade: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/><rect x="8" y="4" width="8" height="8" rx="1"/></svg>',
      bcs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2.4"/><circle cx="5" cy="5" r="1.8"/><circle cx="19" cy="5" r="1.8"/><circle cx="5" cy="19" r="1.8"/><circle cx="19" cy="19" r="1.8"/><path d="M6.4 6.4l4 4M17.6 6.4l-4 4M6.4 17.6l4-4M17.6 17.6l-4-4"/></svg>'
    };

    var GROUPS = [
      { id: 'expertise', label: 'Экспертиза' },
      { id: 'industry', label: 'Отрасли' },
      { id: 'system', label: 'Система' }
    ];

    var CASES = [
      { id: 'finance', group: 'expertise', chip: 'Finance', dir: 'Finance · Управленческий учёт',
        title: 'Собственник не понимает реальную прибыль бизнеса',
        problem: 'Бухгалтерская прибыль есть, но денег на счетах не хватает.',
        solution: 'Построение P&L, Cash Flow, управленческого учёта и план-факт анализа.',
        result: 'Собственник видит реальную прибыль, маржинальность, затраты и точки потерь.' },
      { id: 'treasury', group: 'expertise', chip: 'Treasury', dir: 'Treasury · Казначейство',
        title: 'Деньги расходуются хаотично, возникают кассовые разрывы',
        problem: 'Платежи идут без приоритетов, нет резервов и фондов.',
        solution: 'Фондовое планирование, платёжный календарь, лимиты, резервы, Cash Gap контроль.',
        result: 'Деньги распределяются по правилам, собственник заранее видит дефицит ликвидности.' },
      { id: 'bi', group: 'expertise', chip: 'Power BI + 1C', dir: 'Power BI + 1C Integration',
        title: 'Руководитель получает отчёты из 1С поздно и вручную',
        problem: 'Данные есть в 1С, Excel и разных таблицах, но единой картины бизнеса нет.',
        solution: 'Интеграция 1С с Power BI, настройка модели данных, автоматические дашборды.',
        tagsLabel: 'Что видно в Power BI',
        tags: ['выручка','прибыль','расходы','дебиторка','кредиторка','остатки денег','продажи','склад','маржинальность','KPI','план-факт','cash flow','аренда','CAPEX','проекты'],
        result: 'Собственник открывает дашборд и видит бизнес в реальном времени — без ручной подготовки отчётов.' },
      { id: 'ai', group: 'expertise', chip: 'AI & Automation', dir: 'AI & Automation',
        title: 'Финансовая отчётность собирается вручную',
        problem: 'Сотрудники тратят много времени на сбор данных, согласования и отчёты.',
        solution: 'Автоматизация через AI, Make, n8n и AI-агентов.',
        tagsLabel: 'Примеры автоматизации',
        tags: ['автоматический сбор отчётов','уведомления о рисках','контроль просроченной дебиторки','напоминания ответственным','AI-анализ отклонений','управленческий отчёт','интеграция Google Sheets / email / CRM / 1С / Power BI'],
        result: 'Меньше ручной работы, быстрее контроль, меньше ошибок.' },
      { id: 'realestate', group: 'industry', chip: 'Недвижимость', dir: 'Real Estate · Недвижимость',
        title: 'Объект сдаётся, но собственник не понимает его доходность',
        problem: 'Аренда есть, но нет анализа NOI, ROA, окупаемости, рисков арендаторов и рыночной ставки.',
        solution: 'Модель доходности объекта, анализ арендаторов, rent-to-sales, NPV, IRR, Cap Rate, DSCR.',
        result: 'Собственник понимает, выгоден ли объект, где риски и как повысить стоимость актива.' },
      { id: 'construction', group: 'industry', chip: 'Строительство', dir: 'Construction · Строительство',
        title: 'CAPEX выходит из-под контроля',
        problem: 'Расходы по стройке растут, подрядчики меняют сметы, прозрачного контроля бюджета нет.',
        solution: 'CAPEX dashboard, план-факт по статьям, контроль подрядчиков, бюджет проекта, cash flow строительства.',
        result: 'Собственник видит отклонения, перерасходы и прогноз бюджета до завершения проекта.' },
      { id: 'production', group: 'industry', chip: 'Производство', dir: 'Production · Производство',
        title: 'Компания не понимает себестоимость и маржинальность продукции',
        problem: 'Продажи растут, но прибыль не увеличивается.',
        solution: 'Анализ себестоимости, маржинальности, запасов, производственных KPI и план-факт затрат.',
        result: 'Видно, какие продукты прибыльные, где потери и что нужно оптимизировать.' },
      { id: 'ecommerce', group: 'industry', chip: 'E-commerce', dir: 'E-commerce',
        title: 'Оборот растёт, но денег и прибыли нет',
        problem: 'Маркетинг, склад, логистика и возвраты съедают маржу.',
        solution: 'Unit economics, CAC, LTV, ROMI, маржинальность каналов, cash flow, Power BI dashboard.',
        result: 'Собственник понимает, какие каналы и товары реально зарабатывают.' },
      { id: 'trade', group: 'industry', chip: 'Торговля', dir: 'Trade · Торговля и дистрибуция',
        title: 'Деньги заморожены в складе',
        problem: 'Большие остатки, низкая оборачиваемость, нет анализа прибыльности категорий.',
        solution: 'ABC/XYZ анализ, оборачиваемость, маржинальность, складской dashboard, план закупок.',
        result: 'Меньше замороженных денег, лучше управление ассортиментом и закупками.' },
      { id: 'bcs', group: 'system', chip: 'Business Control System', dir: 'Business Control System',
        title: 'Собственник хочет видеть весь бизнес в одной системе',
        problem: 'Финансы, продажи, склад, проекты, KPI и деньги — в разных местах.',
        solution: 'Business Control System — единый контур управления бизнесом.',
        tagsLabel: 'Включает',
        tags: ['P&L','Cash Flow','Treasury','фондовое планирование','Power BI','1С integration','KPI','AI automation','карта рисков','план действий на 90 дней'],
        result: 'Собственник управляет бизнесом через цифры, аналитику и AI.' }
    ];

    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    // Build grouped chips
    GROUPS.forEach(function (g) {
      var wrap = document.createElement('div');
      wrap.className = 'filter-group';
      var lab = document.createElement('span');
      lab.className = 'filter-group__label';
      lab.textContent = g.label;
      wrap.appendChild(lab);
      CASES.filter(function (c) { return c.group === g.id; }).forEach(function (c) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chip' + (c.id === 'bcs' ? ' chip--bcs' : '');
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', 'false');
        btn.tabIndex = -1;
        btn.dataset.case = c.id;
        btn.innerHTML = (c.id === 'bcs' ? '<span class="chip__star">★</span>' : '') + esc(c.chip);
        wrap.appendChild(btn);
      });
      filters.appendChild(wrap);
    });

    var chips = Array.prototype.slice.call(filters.querySelectorAll('.chip'));

    function render(c) {
      var tagsHtml = '';
      if (c.tags && c.tags.length) {
        tagsHtml = '<div class="case-tags-wrap"><span class="case-tags__label">' + esc(c.tagsLabel) + '</span><div class="case-tags">' +
          c.tags.map(function (t) { return '<span class="case-tag">' + esc(t) + '</span>'; }).join('') + '</div></div>';
      }
      var isBcs = c.id === 'bcs';
      var ctaClass = isBcs ? 'btn btn--primary case-card__cta' : 'btn btn--ghost case-card__cta';
      var ctaHref = isBcs ? '#solutions' : '#consult';
      var ctaText = isBcs ? 'Построить систему управления' : 'Обсудить ваш случай';
      return '<div class="case-card__inner">' +
        '<div class="case-card__eyebrow"><span class="case-card__icon">' + (ICON[c.id] || '') + '</span>' +
          '<span class="case-card__dir">' + esc(c.dir) + '</span><span class="case-card__kicker">Кейс</span></div>' +
        '<h3 class="case-card__title">' + esc(c.title) + '</h3>' +
        '<div class="case-block case-block--problem"><span class="case-block__label">Проблема</span><p>' + esc(c.problem) + '</p></div>' +
        '<div class="case-block case-block--solution"><span class="case-block__label">Решение FINMENTOR</span><p>' + esc(c.solution) + '</p>' + tagsHtml + '</div>' +
        '<div class="case-block case-block--result"><span class="case-block__label">Результат</span><p>' + esc(c.result) + '</p></div>' +
        '<a href="' + ctaHref + '" class="' + ctaClass + '">' + ctaText + '</a>' +
        '</div>';
    }

    function activate(id, focus) {
      var found = CASES.filter(function (x) { return x.id === id; });
      if (!found.length) return;
      var c = found[0];
      chips.forEach(function (ch) {
        var on = ch.dataset.case === id;
        ch.classList.toggle('is-active', on);
        ch.setAttribute('aria-selected', on ? 'true' : 'false');
        ch.tabIndex = on ? 0 : -1;
      });
      card.classList.add('is-switching');
      window.setTimeout(function () {
        card.innerHTML = render(c);
        card.classList.remove('is-switching');
      }, 180);
      if (focus) {
        var act = filters.querySelector('.chip.is-active');
        if (act) act.focus();
      }
    }

    chips.forEach(function (ch) {
      ch.addEventListener('click', function () { activate(ch.dataset.case); });
    });

    filters.addEventListener('keydown', function (e) {
      if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].indexOf(e.key) === -1) return;
      e.preventDefault();
      var idx = chips.indexOf(document.activeElement);
      if (idx === -1) { for (var i = 0; i < chips.length; i++) { if (chips[i].classList.contains('is-active')) { idx = i; break; } } }
      if (idx === -1) idx = 0;
      var dir = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
      var next = (idx + dir + chips.length) % chips.length;
      activate(chips[next].dataset.case, true);
    });

    // Initial render (no fade-out delay on first paint)
    card.innerHTML = render(CASES[0]);
    chips.forEach(function (ch) {
      var on = ch.dataset.case === CASES[0].id;
      ch.classList.toggle('is-active', on);
      ch.setAttribute('aria-selected', on ? 'true' : 'false');
      ch.tabIndex = on ? 0 : -1;
    });
  }

  /* ------------------------------------------------------------- CONSULT FORM (S8) */
  function initForm() {
    var form = document.getElementById('consultForm');
    if (!form) return;
    var success = document.getElementById('formSuccess');
    var submit = form.querySelector('.form__submit');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = form.querySelector('[name="name"]');
      var contact = form.querySelector('[name="contact"]');
      var consent = form.querySelector('[name="consent"]');
      var consentWrap = consent ? consent.closest('.consent') : null;
      var ok = true;
      [name, contact].forEach(function (f) {
        if (!f.value.trim()) { f.classList.add('is-error'); ok = false; }
        else f.classList.remove('is-error');
      });
      if (consent && !consent.checked) {
        if (consentWrap) consentWrap.classList.add('is-error');
        ok = false;
      } else if (consentWrap) {
        consentWrap.classList.remove('is-error');
      }
      if (!ok) {
        if (!name.value.trim()) name.focus();
        else if (!contact.value.trim()) contact.focus();
        else if (consent && !consent.checked) consent.focus();
        return;
      }

      var lead = {
        name: name.value.trim(),
        contact: contact.value.trim(),
        business: (form.querySelector('[name="business"]') || {}).value || '',
        message: (form.querySelector('[name="message"]') || {}).value || ''
      };

      /* ====================================================================
         ПОДКЛЮЧЕНИЕ ОТПРАВКИ ЗАЯВКИ  (выбрать ОДИН вариант перед запуском)
         --------------------------------------------------------------------
         Сейчас заявка НЕ отправляется — только валидируется и показывает успех.
         Реальные токены НЕ подключены. Раскомментируйте нужный блок и подставьте данные.

         ── ВАРИАНТ A · FORMSPREE (проще всего, без сервера) ──────────────────
         1) Зарегистрируйтесь на https://formspree.io и создайте форму.
         2) Вставьте ваш endpoint вместо FORMSPREE_ENDPOINT.
         3) Раскомментируйте:

         // var FORMSPREE_ENDPOINT = 'https://formspree.io/f/XXXXXXXX'; // ← ВСТАВИТЬ ENDPOINT
         // fetch(FORMSPREE_ENDPOINT, {
         //   method: 'POST',
         //   headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
         //   body: JSON.stringify(lead)
         // }).then(function (r) { if (!r.ok) throw new Error('send failed'); });

         ── ВАРИАНТ B · TELEGRAM BOT ─────────────────────────────────────────
         1) Создайте бота через @BotFather → получите TOKEN.
         2) Узнайте CHAT_ID: напишите боту, откройте
            https://api.telegram.org/bot<TOKEN>/getUpdates — поле chat.id.
         3) Вставьте TOKEN и CHAT_ID и раскомментируйте:

         // var TELEGRAM_TOKEN   = 'ВСТАВИТЬ_TELEGRAM_TOKEN';   // ← ТОКЕН бота от @BotFather
         // var TELEGRAM_CHAT_ID = 'ВСТАВИТЬ_CHAT_ID';          // ← ВАШ CHAT ID
         // var text = 'Заявка с сайта. Имя: ' + lead.name + ', Контакт: ' + lead.contact +
         //   ', Бизнес: ' + lead.business + ', Задача: ' + lead.message;
         // fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage', {
         //   method: 'POST',
         //   headers: { 'Content-Type': 'application/json' },
         //   body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text })
         // });
         //
         // ВНИМАНИЕ (вариант B): токен бота будет виден в коде страницы (он публичный).
         // Для продакшена безопаснее отправлять lead на свой webhook / serverless-функцию,
         // которая уже пересылает сообщение в Telegram, не раскрывая токен.

         После подключения console.log ниже можно удалить.
         ==================================================================== */
      try { console.log('[finmentor] lead (ещё не отправляется):', lead); } catch (err) {}

      // TODO (приоритет): подключить Make/n8n webhook —
      //   form submit → webhook → Telegram + Gmail + Google Sheets.
      //   Готовые варианты подключения (Formspree / Telegram Bot) описаны в блоке выше.
      if (success) success.hidden = false;
      if (submit) submit.disabled = true;
    });

    form.addEventListener('input', function (e) {
      if (e.target && e.target.classList) e.target.classList.remove('is-error');
    });
    form.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'consent') {
        var w = e.target.closest('.consent');
        if (w) w.classList.remove('is-error');
      }
    });
  }

  /* ------------------------------------------------------------- UTILS */
  function debounce(fn, ms) {
    var t;
    return function () {
      var ctx = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  /* ------------------------------------------------------------- QUESTIONNAIRE (questionnaire.html) */
  function initQuestionnaire() {
    var form = document.getElementById('qForm');
    if (!form) return;
    var success = document.getElementById('qSuccess');
    var copyBtn = document.getElementById('qCopy');
    var bar = document.getElementById('qProgress');

    // scroll-based progress bar
    if (bar) {
      var update = function () {
        var rect = form.getBoundingClientRect();
        var total = form.offsetHeight - window.innerHeight;
        var scrolled = -rect.top;
        var pct = total > 0 ? (scrolled / total) * 100 : 0;
        bar.style.width = Math.max(2, Math.min(100, pct)) + '%';
      };
      window.addEventListener('scroll', update, { passive: true });
      window.addEventListener('resize', update);
      update();
    }

    function collectAnswers() {
      var lines = ['FINMENTOR — Анкета диагностики', ''];
      var qs = form.querySelectorAll('.q');
      Array.prototype.forEach.call(qs, function (q) {
        var labelEl = q.querySelector('.q__label, legend');
        var label = labelEl ? labelEl.textContent.trim() : '';
        var val = '';
        var sel = q.querySelector('select');
        var radios = q.querySelectorAll('input[type="radio"]');
        var checks = q.querySelectorAll('input[type="checkbox"]');
        var text = q.querySelector('input[type="text"], input[type="email"], input[type="tel"], input[type="number"], textarea');
        if (sel) { val = sel.value; }
        else if (radios.length) { Array.prototype.forEach.call(radios, function (r) { if (r.checked) val = r.parentNode.textContent.trim(); }); }
        else if (checks.length) { var arr = []; Array.prototype.forEach.call(checks, function (c) { if (c.checked) arr.push(c.parentNode.textContent.trim()); }); val = arr.join(', '); }
        else if (text) { val = text.value.trim(); }
        if (label) lines.push(label + ': ' + (val || '—'));
      });
      return lines.join('\n');
    }

    function fallbackCopy(txt, cb) {
      var ta = document.createElement('textarea');
      ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta); if (cb) cb();
    }
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var txt = collectAnswers();
        var done = function () {
          copyBtn.textContent = 'Скопировано ✓';
          setTimeout(function () { copyBtn.textContent = 'Скопировать ответы'; }, 2500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(done, function () { fallbackCopy(txt, done); });
        } else { fallbackCopy(txt, done); }
      });
    }

    form.addEventListener('input', function (e) {
      if (e.target && e.target.classList) e.target.classList.remove('is-error');
    });

    form.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'q_consent') {
        var row = document.getElementById('qConsentRow');
        if (row) row.classList.remove('is-error');
      }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = form.querySelector('[name="q_name"]');
      var consent = form.querySelector('[name="q_consent"]');
      var consentRow = document.getElementById('qConsentRow');
      var ok = true;
      // имя желательно, согласие обязательно; остальные поля НЕ блокируют отправку
      if (name && !name.value.trim()) { name.parentNode.classList.add('is-error'); ok = false; }
      else if (name) name.parentNode.classList.remove('is-error');
      if (consent && !consent.checked) { if (consentRow) consentRow.classList.add('is-error'); ok = false; }
      else if (consentRow) consentRow.classList.remove('is-error');
      if (!ok) {
        if (name && !name.value.trim()) name.focus();
        else if (consentRow) consentRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      /* TODO: подключить Make/n8n webhook:
         questionnaire submit -> webhook -> AI agent -> Telegram + Gmail + Google Sheets / CRM.
         Пример:
         // var payload = collectAnswers();
         // fetch('WEBHOOK_URL', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: payload })
         //   .then(function (r) { if (!r.ok) throw new Error('send failed'); })
         //   .catch(function () { ... показать fallback-контакты ... });
         Пока backend не подключён — данные НЕ уходят в CRM / AI-agent, показываем честный success ниже. */

      try { console.log('[finmentor] questionnaire (не отправляется автоматически):\n' + collectAnswers()); } catch (err) {}
      if (success) { success.hidden = false; success.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    });
  }

  /* Working Capital Quick Scan — client-side self-diagnostic, no backend, no PII to GA4 */
  function initWcScan() {
    var root = document.getElementById('wcScan');
    if (!root) return;
    function ga(name, params) { if (typeof gtag === 'function') { try { gtag('event', name, params || {}); } catch (e) {} } }
    var questions = Array.prototype.slice.call(root.querySelectorAll('[data-scan-q]'));
    var bar = document.getElementById('scanBar');
    var submit = document.getElementById('scanSubmit');
    var result = document.getElementById('scanResult');
    var answers = {}, started = false;

    function updateBar() { if (bar) bar.style.width = Math.round(Object.keys(answers).length / questions.length * 100) + '%'; }
    questions.forEach(function (q) {
      var qid = q.getAttribute('data-scan-q');
      Array.prototype.slice.call(q.querySelectorAll('.scan__opt')).forEach(function (opt) {
        opt.addEventListener('click', function () {
          Array.prototype.slice.call(q.querySelectorAll('.scan__opt')).forEach(function (o) { o.classList.remove('is-sel'); o.setAttribute('aria-pressed', 'false'); });
          opt.classList.add('is-sel'); opt.setAttribute('aria-pressed', 'true');
          answers[qid] = parseInt(opt.getAttribute('data-score'), 10) || 0;
          if (!started) { started = true; ga('start_working_capital_scan'); }
          updateBar();
        });
      });
    });

    var LEVELS = {
      low: { band: 'Низкий риск · базовый контроль есть', title: 'У вас уже есть часть контроля', text: 'Следующий шаг — связать оборотный капитал с Cash Flow, платёжным календарём и регулярной управленческой отчётностью.' },
      medium: { band: 'Средний риск · деньги могут застревать', title: 'Есть признаки, что деньги застревают', text: 'Похоже, деньги могут застревать в дебиторке, запасах, авансах или платёжной дисциплине. Стоит провести диагностику оборотного капитала и Cash Flow.' },
      high: { band: 'Высокий риск · нужна диагностика', title: 'Деньгами, вероятно, управляют реактивно', text: 'Высокая вероятность, что платежи решаются вручную, cash gap виден поздно, а прибыль не превращается в свободный cash flow. Рекомендуется Financial Health Check или Discovery Call.' }
    };
    function levelFor(total) { var pct = total / (questions.length * 3); return pct < 0.34 ? 'low' : (pct < 0.67 ? 'medium' : 'high'); }
    function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
    function buildShare(L) {
      var lines = ['Мини-скан оборотного капитала — FINMENTOR', 'Результат: ' + L.band];
      var nm = val('scanName'), co = val('scanCompany'), ct = val('scanContact'), cm = val('scanComment');
      if (nm) lines.push('Имя: ' + nm);
      if (co) lines.push('Компания: ' + co);
      if (ct) lines.push('Контакт: ' + ct);
      if (cm) lines.push('Комментарий: ' + cm);
      lines.push('https://www.finmentor.md/working-capital-scan.html');
      var text = lines.join('\n');
      root.__shareText = text;
      var tg = document.getElementById('scanTg');
      if (tg) tg.href = 'https://t.me/finmentor_md_bot';
    }
    function show() {
      if (Object.keys(answers).length < questions.length) {
        var un = questions.filter(function (q) { return !(q.getAttribute('data-scan-q') in answers); })[0];
        if (un) un.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      var total = 0; Object.keys(answers).forEach(function (k) { total += answers[k]; });
      var lvl = levelFor(total), L = LEVELS[lvl];
      document.getElementById('scanBand').textContent = L.band;
      document.getElementById('scanTitle').textContent = L.title;
      document.getElementById('scanText').textContent = L.text;
      result.hidden = false;
      result.scrollIntoView({ behavior: 'smooth', block: 'start' });
      ga('complete_working_capital_scan', { result_level: lvl + '_risk' });
      root.__L = L; buildShare(L);
    }
    if (submit) submit.addEventListener('click', show);
    ['scanName', 'scanCompany', 'scanContact', 'scanComment'].forEach(function (id) { var el = document.getElementById(id); if (el) el.addEventListener('input', function () { if (root.__L) buildShare(root.__L); }); });
    var tgEl = document.getElementById('scanTg'); if (tgEl) tgEl.addEventListener('mousedown', function () { if (root.__L) buildShare(root.__L); });

    var copyBtn = document.getElementById('scanCopy');
    function fallbackCopy(text) { var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); }
    if (copyBtn) copyBtn.addEventListener('click', function () {
      if (root.__L) buildShare(root.__L);
      var text = root.__shareText || '';
      function done() { var old = copyBtn.textContent; copyBtn.textContent = 'Скопировано ✓'; setTimeout(function () { copyBtn.textContent = old; }, 1800); ga('copy_working_capital_scan_result'); }
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text); done(); }); }
      else { fallbackCopy(text); done(); }
    });
  }

  /* GA4 events — delegated, fired only if gtag is available; never blocks navigation */
  function initGA() {
    function send(name, params) {
      if (typeof gtag === 'function') { try { gtag('event', name, params || {}); } catch (e) {} }
    }
    function safeLinkUrl(a) {
      var href = a.getAttribute('href') || '';
      if (/^mailto:/i.test(href)) return 'mailto';
      if (/^tel:/i.test(href)) return 'tel';
      if (/t\.me\//i.test(href)) return 'telegram';
      if (/wa\.me\//i.test(href)) return 'whatsapp';
      try {
        var u = new URL(href, window.location.href);
        if (u.origin !== window.location.origin) return u.hostname;
        return u.pathname + (u.hash || '');
      } catch (e) {
        return href.split('?')[0].slice(0, 120);
      }
    }
    function safeLinkText(a) {
      return (a.textContent || '')
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, '[email]')
        .replace(/\+?\d[\d\s().-]{6,}\d/g, '[phone]')
        .trim()
        .slice(0, 80);
    }
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a, button') : null;
      if (!a) return;
      var name = a.getAttribute('data-ga');
      if (!name) {
        var href = a.getAttribute('href') || '';
        if (/t\.me\//.test(href)) name = 'click_telegram';
        else if (/wa\.me\//.test(href)) name = 'click_whatsapp';
        else if (/^mailto:/.test(href)) name = 'click_email';
        else if (/treasury-waterfall\.html/.test(href)) name = 'click_treasury_waterfall';
        else if (/power-bi-dlya-sobstvennika\.html/.test(href)) name = 'click_powerbi_integration';
        else if (/templates\.html/.test(href)) name = 'click_template_request';
        else if (/methodology\.html/.test(href)) name = 'click_methodology';
        else if (/cases\.html/.test(href)) name = 'click_cases';
        else if (/working-capital-scan\.html/.test(href)) name = 'click_working_capital_scan';
        else if (/working-capital\.html/.test(href)) name = 'click_working_capital';
        else if (/questionnaire\.html/.test(href)) name = 'click_questionnaire';
        else if (/#consult$/.test(href)) name = 'click_discovery_call';
      }
      if (name) send(name, { link_url: safeLinkUrl(a), link_text: safeLinkText(a) });
    }, true);
  }

  function guard(fn) { try { fn(); } catch (e) { if (window.console) console.warn('[finmentor]', e); } }

  /* ------------------------------------------------------------- BOOT */
  ready(function () {
    guard(initIntro);     // first — never let other failures trap the overlay
    guard(initCanvases);
    guard(initCursor);
    guard(initHeader);
    guard(initMenu);
    guard(initCounters);
    guard(initReveal);
    guard(initParallax);
    guard(initCases);
    guard(initForm);
    guard(initQuestionnaire);
    guard(initWcScan);
    guard(initLang);
    guard(initGA);
  });
})();
