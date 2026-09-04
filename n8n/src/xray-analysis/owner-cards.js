// FINMENTOR X-Ray Analysis — the OWNER Telegram cards (presentation only).
//
// Inlined by scripts/build-xray-analysis-workflow.mjs into "Validate + Store Rows" (review card,
// failure card), "Review POST Verdict" (approved card) and "Analysis Failed Row" (failure card) at
// the owner-cards marker comment of each source. qa/xray-owner-cards-golden.test.mjs drives THIS file.
//
// OWNER DECISION 2026-09-04 (premium CFO console, RU owner UI):
//   * one authoritative card per analysis; a second message only on a real state transition;
//   * no Lead ID, no review token, no raw JSON, no prompt, no confidence enum, no ORANGE/LOW/…
//     in the visible body — internal enums render as professional Russian with one icon;
//   * the customer's language is metadata only («Клиент: RO»); the card itself stays Russian;
//   * a data-quality doubt renders as ONE line, «⚠️ Требуется проверка исходных данных», never
//     as a bare figure like «Проверить цифры: 12mil»;
//   * every dynamic value is HTML-escaped; tags are written here and never come from data.
//
// The card RENDERS an already-decided model. Scoring, validation, the review flow and the
// CLIENT_READY semantics live elsewhere and are not touched by anything in this file.

const XRAY_OWNER_CARDS = (function () {
  const ZONE = {
    RED: { icon: '🔴', label: 'Критическая зона' },
    ORANGE: { icon: '🟠', label: 'Существенные пробелы' },
    YELLOW: { icon: '🟡', label: 'Требует внимания' },
    GREEN: { icon: '🟢', label: 'Устойчивое управление' },
    UNKNOWN: { icon: '⚪', label: 'Недостаточно данных' }
  };
  // Company scale, one owner-facing format (OWNER DECISION 2026-09-04): «1–5 млн EUR».
  function scaleLabel(v) {
    let s = String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
    if (!s) return '';
    s = s.replace(/^(\d+)\s*[–-]\s*(\d+)\s*(?:M|mln|млн)\s*(?:€|EUR)$/i, '$1–$2 млн EUR');
    s = s.replace(/^(?:€|EUR)\s*(\d+)\s*(тыс\.?|млн)\s*[–-]\s*(?:€|EUR)\s*(\d+)\s*(тыс\.?|млн)$/i, (m, a, ua, b, ub) => a + ' ' + ua.replace(/\.?$/, '.').replace('млн.', 'млн') + ' – ' + b + ' ' + ub.replace('тыс', 'тыс.').replace('тыс..', 'тыс.') + ' EUR');
    s = s.replace(/^(\d+)\s*[–-]\s*(\d+)\s*(?:€|EUR)$/i, '$1–$2 EUR');
    return s;
  }
  // Owner-facing product names, RU only. The client-locale label never enters the owner card.
  const PRODUCT_RU = {
    FINANCIAL_HEALTH_CHECK: 'Комплексная финансовая диагностика (Financial Health Check)',
    BUSINESS_CONTROL_SYSTEM: 'Business Control System — система финансового контроля',
    MONTHLY_CFO_SUPPORT: 'Monthly CFO Support — ежемесячное сопровождение CFO',
    DISCOVERY_CALL: 'Диагностическая встреча (Discovery Call)'
  };
  const CAUSE_RU = {
    MODEL_OUTPUT_INVALID: 'Модель вернула ответ вне контракта анализа',
    RATE_LIMIT: 'Превышен лимит запросов к модели',
    AUTH: 'Ошибка доступа к модели',
    MODEL: 'Модель недоступна',
    UPSTREAM_TRANSIENT: 'Временный сбой на стороне модели',
    UNKNOWN: 'Неизвестная ошибка'
  };
  const CIRCLED = ['①', '②', '③', '④', '⑤'];
  const MAX_TEXT = 3900; // Telegram allows 4096; leave room for the caption some paths add

  // OWNER CORRECTION 2026-09-04 — the owner console is Russian. For a client whose analysis was
  // produced in Romanian, the model's free text (risk titles, priorities) is NOT rendered: the
  // questionnaire's canonical risk-zone codes map deterministically to the owner's Russian terms,
  // and when even those are absent the card says where the detail lives. No translation call,
  // no new cost, no nondeterminism; the customer's own result keeps its Romanian untouched.
  const RISK_ZONE_RU = {
    cash_flow: 'Денежный поток (Cash Flow)',
    management_pl: 'Управленческий P&L',
    payments: 'Платёжный календарь и контроль платежей',
    receivables_payables: 'Дебиторская и кредиторская задолженность',
    margin: 'Реальная маржа',
    kpi_dashboard: 'KPI, риски и отклонения',
    data_systems: 'Системы и качество данных'
  };
  const SEE_ANALYSIS = 'См. подробный анализ клиента';
  // Latin tokens that are legitimate inside Russian owner copy (product and finance terms).
  const LATIN_OK = /\b(retail|e-?commerce|distribution|services|manufacturing|fitness|real estate|other|cash ?flow|p&amp;l|p&l|cfo|kpi|bi|power bi|excel|1c|erp|crm|eur|mdl|usd|ron|mln|mil|mii|srl|sa|llc|ltd|sme|b2b|b2c|it|hr|saas|horeca|fmcg|financial health check|health check|ok)\b/gi;
  // Deterministic "is this safe on the Russian console?": Cyrillic prose passes; a Latin string
  // passes only if nothing but allow-listed terms, digits, currency and punctuation remains.
  function ownerSafe(text) {
    const s = String(text === undefined || text === null ? '' : text);
    if (!s.trim()) return false;
    if (/[ăâîșțĂÂÎȘȚşţŞŢ]/.test(s)) return false;
    const rest = s.replace(LATIN_OK, ' ').replace(/[0-9€$%.,;:/()+\-–—·&'"«»\s]/g, ' ');
    return !/[A-Za-z]{2,}/.test(rest);
  }
  const isRo = (locale) => String(locale || '').toLowerCase() === 'ro';

  function esc(v) {
    return String(v === undefined || v === null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function tidy(v, max) {
    const s = String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
    if (!max || s.length <= max) return s;
    return s.slice(0, max).replace(/[\s,.;:—-]+$/, '') + '…';
  }
  const present = (v) => String(v === undefined || v === null ? '' : v).trim() !== '';
  const join = (blocks) => blocks.filter(present).join('\n\n');
  const header = (icon, title) => icon + ' <b>FINMENTOR · ' + title + '</b>';
  const clientLine = (locale) => 'Клиент: ' + (String(locale || '').toLowerCase() === 'ro' ? 'RO' : 'RU');

  // «Retail · 1–5M € · 50–100 сотрудников» — classified questionnaire labels only, never free text.
  function contextLine(ctx, locale) {
    const c = ctx || {};
    const guard = (v) => present(v) && (!isRo(locale) || ownerSafe(v));
    const parts = [];
    if (guard(c.industry)) parts.push(tidy(c.industry, 40));
    if (guard(c.turnover)) parts.push(tidy(scaleLabel(c.turnover), 30));
    if (guard(c.employees)) parts.push(tidy(c.employees, 20) + ' сотрудников');
    return parts.join(' · ');
  }

  function identity(m) {
    const ctx = contextLine(m.context, m.locale);
    const meta = [ctx ? esc(ctx) : '', clientLine(m.locale)].filter(present).join(' · ');
    return '<b>' + esc(tidy(m.company, 70) || 'Компания не указана') + '</b>\n' + meta;
  }

  // model = { company, locale, context: { industry, turnover, employees }, score (number|''|null),
  //           zone, maturity (1..5|''), primary_risk, priorities: [..], product,
  //           needs_verification: boolean }
  function renderReview(model) {
    const m = model || {};
    const z = ZONE[String(m.zone || '').toUpperCase()] || ZONE.UNKNOWN;
    const scored = m.score !== '' && m.score !== null && m.score !== undefined && Number.isFinite(Number(m.score));
    const scoreLine = scored
      ? '<b>' + Math.round(Number(m.score)) + ' / 100</b> · ' + z.icon + ' <b>' + z.label + '</b>'
      : ZONE.UNKNOWN.icon + ' <b>' + ZONE.UNKNOWN.label + '</b>';
    const maturity = present(m.maturity) && Number.isFinite(Number(m.maturity))
      ? '<b>Зрелость финансового управления:</b> ' + Number(m.maturity) + '/5' : '';
    // RO client: the model's free text stays in the customer's result; the owner card renders the
    // canonical risk zones (Russian, deterministic) or points at the detailed analysis.
    let risk = '';
    let priorities = '';
    if (isRo(m.locale)) {
      const zones = (Array.isArray(m.risk_zones) ? m.risk_zones : []).map((z) => RISK_ZONE_RU[String(z || '').toLowerCase()]).filter(Boolean).slice(0, 3);
      risk = '<b>Ключевой риск</b>\n' + (zones.length ? esc(zones[0]) : SEE_ANALYSIS);
      if (zones.length > 1) { priorities = '<b>Зоны риска по анкете</b>\n' + zones.map((z, i) => CIRCLED[i] + ' ' + esc(z)).join('\n'); }
    } else {
      risk = present(m.primary_risk) ? '<b>Ключевой риск</b>\n' + esc(tidy(m.primary_risk, 160)) : '';
      const pri = (Array.isArray(m.priorities) ? m.priorities : []).filter(present).slice(0, 3);
      priorities = pri.length ? '<b>Управленческие приоритеты</b>\n' + pri.map((p, i) => CIRCLED[i] + ' ' + esc(tidy(p, 120))).join('\n') : '';
    }
    const product = PRODUCT_RU[String(m.product || '').toUpperCase()] || '';
    const recommendation = product ? '<b>Рекомендация FINMENTOR</b>\n' + esc(product) : '';
    const warning = m.needs_verification === true ? '⚠️ <b>Требуется проверка исходных данных</b>' : '';
    return join([
      header('📊', 'Финансовый рентген'),
      identity(m),
      [scoreLine, maturity].filter(present).join('\n'),
      risk, priorities, recommendation, warning,
      '<b>Статус:</b> ожидает проверки консультанта'
    ]).slice(0, MAX_TEXT);
  }

  // model = { company, locale }
  function renderApproved(model) {
    const m = model || {};
    return join([
      header('✅', 'Анализ подтверждён'),
      identity(Object.assign({}, m, { context: null })),
      'Результат открыт клиенту в Mini App.\n<b>Статус:</b> готово для клиента'
    ]).slice(0, MAX_TEXT);
  }

  // model = { company, locale, cause: MODEL_OUTPUT_INVALID|RATE_LIMIT|AUTH|MODEL|UPSTREAM_TRANSIENT|UNKNOWN }
  function renderFailed(model) {
    const m = model || {};
    const cause = CAUSE_RU[String(m.cause || '').toUpperCase()] || CAUSE_RU.UNKNOWN;
    return join([
      header('❌', 'Анализ не сформирован'),
      identity(Object.assign({}, m, { context: null })),
      '<b>Причина</b>\n' + esc(cause),
      '<b>Что сделать</b>\nУдалить строку этого анализа в XRay_Analysis — на следующем цикле анализ будет выполнен повторно.'
    ]).slice(0, MAX_TEXT);
  }

  return { ZONE, PRODUCT_RU, CAUSE_RU, RISK_ZONE_RU, SEE_ANALYSIS, esc, tidy, ownerSafe, scaleLabel, contextLine, renderReview, renderApproved, renderFailed };
})();

if (typeof module !== 'undefined') { module.exports = XRAY_OWNER_CARDS; }
