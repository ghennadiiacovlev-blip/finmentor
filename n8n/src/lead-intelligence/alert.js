// FINMENTOR Lead Intelligence v1 — short Telegram entry alert.
'use strict';

function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function tidy(v, n) { const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n).replace(/[\s,.;:—-]+$/, '') + '…' : s; }
function present(v) { return String(v == null ? '' : v).trim() !== ''; }
function qualificationLabel(value) {
  return ({ HOT: 'Высокий приоритет', WARM: 'Требует внимания', COLD: 'Низкий приоритет', INCOMPLETE: 'Данные неполные' })[String(value || '').toUpperCase()] || tidy(value, 24);
}
function zoneLabel(value) {
  return ({ GREEN: 'Устойчивая', YELLOW: 'Требует внимания', ORANGE: 'Существенные пробелы', RED: 'Критическая', UNKNOWN: 'Без оценки' })[String(value || '').toUpperCase()] || tidy(value, 24);
}
function translateOwnerEnums(value) {
  return String(value == null ? '' : value).replace(/\b(?:HOT|WARM|COLD|INCOMPLETE)\b/gi, (x) => qualificationLabel(x))
    .replace(/\b(?:GREEN|YELLOW|ORANGE|RED|UNKNOWN)\b/gi, (x) => zoneLabel(x));
}

function contactLines(contact) {
  const c = contact || {}; const out = [];
  out.push('Предпочтительно: ' + esc(c.preferred_label || 'Не указано'));
  const reachable = Array.isArray(c.reachable_channels) ? c.reachable_channels : [];
  // Owner alerts are high-frequency operational messages, not a contact directory. Show the
  // client's preferred reachable channel when possible; otherwise one fallback. Never print
  // phone + email + Telegram together.
  const selected = reachable.find((x) => x && x.key === c.preferred_contact_channel && present(x.value))
    || reachable.find((x) => x && present(x.value));
  if (selected) out.push(esc(selected.label || 'Контакт') + ': ' + esc(tidy(selected.value, 72)));
  else if (c.preferred_contact_channel === 'telegram') out.push('⚠️ Telegram-контакт не подключён');
  else out.push('Доступных каналов нет');
  return out.join('\n');
}

function importanceLines(model) {
  const out = [];
  if (present(model.qualification)) out.push('Квалификация: <b>' + esc(qualificationLabel(model.qualification)) + '</b>');
  if (present(model.financial_zone)) out.push('Финансовая зона: <b>' + esc(zoneLabel(model.financial_zone)) + '</b>');
  if (present(model.priority_reason)) out.push('Почему важно: ' + esc(tidy(translateOwnerEnums(model.priority_reason), 240)));
  return out;
}

function finmentorViewLines(model) {
  const out = [];
  if (present(model.observation)) out.push(esc(tidy(model.observation, 300)));
  const maturity = model.maturity || {};
  if (present(maturity.label) || present(maturity.score_1_to_5)) {
    const value = [present(maturity.score_1_to_5) ? String(maturity.score_1_to_5) + '/5' : '', tidy(maturity.label, 90)].filter(present).join(' · ');
    out.push('Зрелость: ' + esc(value));
  }
  return out;
}

function riskLines(model) {
  const out = [];
  const risks = Array.isArray(model.risks) ? model.risks : [];
  risks.slice(0, 2).forEach((risk) => {
    const value = risk && typeof risk === 'object' ? risk.title : risk;
    if (present(value)) out.push('• ' + esc(tidy(value, 170)));
  });
  const unknown = model.needs_verification || {};
  const unknownText = unknown && typeof unknown === 'object' ? unknown.item : unknown;
  if (present(unknownText)) out.push('• Проверить: ' + esc(tidy(unknownText, 220)));
  return out;
}

function discoveryLines(value) {
  const rows = Array.isArray(value) ? value : [];
  return rows.slice(0, 3).map((row, index) => {
    const question = row && typeof row === 'object' ? row.question : row;
    return present(question) ? (index + 1) + '. ' + esc(tidy(question, 180)) : '';
  }).filter(Boolean);
}

function renderLeadIntelligenceAlert(model) {
  const m = model || {};
  const meta = [tidy(m.contact_name, 60), tidy(m.role, 50)].filter(present).map(esc).join(' · ');
  const scale = [tidy(m.business, 70), tidy(m.scale, 80)].filter(present).map(esc).join(' · ');
  const importance = importanceLines(m);
  const view = finmentorViewLines(m);
  const risks = riskLines(m);
  const discovery = discoveryLines(m.discovery_questions);
  return [
    '🔔 <b>FINMENTOR · Новый лид</b>',
    '',
    '<b>' + esc(tidy(m.company, 80) || 'Компания не указана') + '</b>',
    meta,
    scale,
    present(m.lead_id) ? 'Lead ID: <code>' + esc(tidy(m.lead_id, 80)) + '</code>' : '',
    '',
    importance.length ? '<b>ВАЖНОСТЬ</b>' : '',
    ...importance,
    importance.length ? '' : '',
    '<b>КЛЮЧЕВАЯ ПРОБЛЕМА</b>',
    esc(tidy(m.main_pain, 240) || 'Нужно уточнить на первом контакте'),
    '',
    '<b>ЧТО ВИДИТ FINMENTOR</b>',
    ...(view.length ? view : ['Недостаточно данных для вывода']),
    '',
    risks.length ? '<b>РИСКИ / ЧТО НУЖНО ПРОВЕРИТЬ</b>' : '',
    ...risks,
    risks.length ? '' : '',
    discovery.length ? '<b>ПЕРВЫЙ РАЗГОВОР</b>' : '',
    ...discovery,
    discovery.length ? '' : '',
    '',
    '<b>КОНТАКТ</b>',
    contactLines(m.contact),
    '',
    '<b>СЕЙЧАС</b>',
    esc(tidy(m.next_action, 220) || 'Открыть разбор клиента')
  ].filter((line, idx, all) => line !== '' || (idx > 0 && all[idx - 1] !== '')).join('\n').trim();
}

if (typeof module !== 'undefined' && module.exports) module.exports = {
  renderLeadIntelligenceAlert, contactLines, importanceLines, finmentorViewLines, riskLines, discoveryLines, qualificationLabel, zoneLabel, translateOwnerEnums, esc, tidy
};
