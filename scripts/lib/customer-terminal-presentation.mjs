// Canonical customer-visible terminal renderers for the Telegram Concierge.
//
// Locale authority is the current-cycle session emitted by Build Bot Response, followed by the
// persisted current-cycle session row. Telegram language_code is intentionally not consulted:
// these nodes run after the customer locale has already been established.

function responseRead(premiumAware) {
  return premiumAware
    ? "const b = ($('Build Bot Response (Premium)').isExecuted ? $('Build Bot Response (Premium)') : $('Build Bot Response')).first().json || {};"
    : "const b = $('Build Bot Response').first().json || {};";
}

function sessionRead(premiumAware) {
  return premiumAware
    ? "const persisted = ($('Get Bot Session (Premium)').isExecuted ? $('Get Bot Session (Premium)') : $('Get Bot Session')).first().json || {};"
    : "const persisted = $('Get Bot Session').first().json || {};";
}

const LOCALE_LINES = [
  "function normalizeLocale(value) {",
  "  const locale = String(value || '').trim().toLowerCase().replace(/_/g, '-');",
  "  if (locale === 'ro' || locale.startsWith('ro-')) return 'ro';",
  "  if (locale === 'ru' || locale.startsWith('ru-')) return 'ru';",
  "  return '';",
  "}",
  "const locale = normalizeLocale(b.session && b.session.language) || normalizeLocale(persisted.language) || normalizeLocale(b.lead_payload && b.lead_payload.client && b.lead_payload.client.language) || 'ru';",
  "const ro = locale === 'ro';"
];

export function buildIntakeTransportCode({ premiumAware = false } = {}) {
  return [
    '// Client confirmation message. Reached both after a fresh Intake call and on a retry where the lead already exists.',
    '// Presentation follows the authoritative current-cycle locale; business and persistence decisions are unchanged.',
    "function safeText(v) { return String(v ?? '').replace(/\\r/g, '').replace(/[<>]/g, '').replace(/[_*\\[\\]()~>#=|{}]/g, ' ').replace(/[ \\t]{2,}/g, ' ').trim(); }",
    responseRead(premiumAware),
    "const p = $('Parse Telegram Update').first().json;",
    "const cfg = (() => { try { return $('Settings to Object').first().json.settings || {}; } catch (e) { return {}; } })();",
    "const site = cfg.website_url || 'https://finmentor.md';",
    'let intake = null;',
    "try { intake = $('Parse Intake Response').first().json; } catch (e) { intake = null; }",
    sessionRead(premiumAware),
    "const ok = intake ? intake.intake_ok === true : String(persisted.lead_id || '') !== '';",
    "const isMeeting = !!(b.lead_payload && b.lead_payload.meta && b.lead_payload.meta.request_type === 'meeting_request');",
    ...LOCALE_LINES,
    'const successText = ro',
    '  ? (isMeeting',
    "    ? '✅ Solicitarea pentru întâlnire a fost înregistrată.\\n\\nVă vom contacta pentru a stabili o oră convenabilă.\\n\\nVom reveni în cel mult 1 zi lucrătoare.'",
    "    : 'Vă mulțumim. Solicitarea dumneavoastră a fost transmisă consultantului FINMENTOR.\\n\\nVom reveni în cel mult 1 zi lucrătoare.')",
    '  : (isMeeting',
    "    ? 'Запрос на встречу принят.\\n\\nМы свяжемся с вами, чтобы согласовать удобное время.\\n\\nМы свяжемся с вами в течение 1 рабочего дня.'",
    "    : 'Спасибо. Ваш запрос передан эксперту FINMENTOR.\\n\\nМы свяжемся с вами в течение 1 рабочего дня.');",
    'const failText = ro',
    '  ? (isMeeting',
    "    ? 'Nu am putut înregistra solicitarea pentru întâlnire.\\n\\nSolicitarea nu este considerată acceptată. Reveniți la meniul principal și încercați din nou.'",
    "    : 'Nu am putut transmite solicitarea consultantului.\\n\\nSolicitarea nu este considerată acceptată. Reveniți la meniul principal și încercați din nou.')",
    '  : (isMeeting',
    "    ? 'Не удалось зарегистрировать запрос на встречу.\\n\\nЗапрос не считается принятым. Вернитесь в главное меню и повторите действие.'",
    "    : 'Не удалось передать запрос консультанту.\\n\\nОбращение не считается принятым. Вернитесь в главное меню и повторите действие.');",
    'const successRows = ro ? [',
    "  [{ text: '📊 Ce să pregătiți pentru analiză', callback_data: 'm|xray' }],",
    "  [{ text: '💼 Serviciile FINMENTOR', callback_data: 'm|services' }],",
    "  [{ text: '🌐 Deschideți site-ul', url: site }],",
    "  [{ text: '🏠 Meniul principal', callback_data: 'n|menu' }]",
    '] : [',
    "  [{ text: '📊 Что подготовить к разбору', callback_data: 'm|xray' }],",
    "  [{ text: '💼 Услуги FINMENTOR', callback_data: 'm|services' }],",
    "  [{ text: '🌐 Открыть сайт', url: site }],",
    "  [{ text: '🏠 Главное меню', callback_data: 'n|menu' }]",
    '];',
    'const failRows = ro ? [',
    "  [{ text: '🏠 Meniul principal', callback_data: 'n|menu' }],",
    "  [{ text: '🌐 Deschideți site-ul', url: site }]",
    '] : [',
    "  [{ text: '🏠 Главное меню', callback_data: 'n|menu' }],",
    "  [{ text: '🌐 Открыть сайт', url: site }]",
    '];',
    "const corr = (p.is_callback ? ('cb:' + String(p.callback_query_id || '')) : ('msg:' + String(p.chat_id || ''))) + ':confirm';",
    'return [{ json: {',
    "  chat_id: String(b.chat_id || p.chat_id || ''),",
    '  text: safeText(ok ? successText : failText),',
    "  keyboard_layout_id: ok ? 'L4_CCUC' : 'L2_CU',",
    '  keyboard_data: { rows: ok ? successRows : failRows },',
    "  parse_mode: '',",
    '  disable_preview: true,',
    '  correlation_id: corr.slice(0, 100),',
    '  intake_ok: ok',
    '} }];'
  ].join('\n');
}

export function buildRecoveryRequestCode({ premiumAware = false } = {}) {
  return [
    '// Controlled recovery: the business response could NOT be rendered, so we send a known-good',
    '// static L1_C screen that returns the client to a safe, known point. The session is not advanced.',
    "const t = $('Build Transport Request').first().json;",
    responseRead(premiumAware),
    sessionRead(premiumAware),
    ...LOCALE_LINES,
    "const text = ro ? 'Nu am putut afișa corect acest pas. Reveniți la meniul principal și încercați din nou.' : 'Не удалось корректно отобразить этот шаг. Вернитесь в главное меню и попробуйте ещё раз.';",
    "const menu = ro ? '🏠 Meniul principal' : '🏠 Главное меню';",
    'return [{ json: {',
    "  chat_id: String(t.chat_id || ''),",
    '  text,',
    "  keyboard_layout_id: 'L1_C',",
    "  keyboard_data: { rows: [[{ text: menu, callback_data: 'n|menu' }]] },",
    "  parse_mode: '',",
    '  disable_preview: true,',
    "  correlation_id: (String(t.correlation_id || '') + ':recovery').slice(0, 100)",
    '} }];'
  ].join('\n');
}
