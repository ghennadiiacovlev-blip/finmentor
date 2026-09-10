// FINMENTOR Lead Intelligence v1 — short Telegram entry alert.
'use strict';

function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function tidy(v, n) { const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n).replace(/[\s,.;:—-]+$/, '') + '…' : s; }
function present(v) { return String(v == null ? '' : v).trim() !== ''; }

function contactLines(contact) {
  const c = contact || {}; const out = [];
  out.push('Предпочтительно: ' + esc(c.preferred_label || 'Не указано'));
  if (c.preferred_contact_channel === 'telegram' && !(c.telegram && c.telegram.reachable)) out.push('⚠️ Telegram-контакт не подключён');
  const reachable = Array.isArray(c.reachable_channels) ? c.reachable_channels : [];
  if (reachable.length) {
    out.push('Доступно:');
    for (const x of reachable.slice(0, 3)) out.push(esc(x.label) + ': ' + esc(tidy(x.value, 72)));
  } else out.push('Доступных каналов нет');
  return out.join('\n');
}

function renderLeadIntelligenceAlert(model) {
  const m = model || {};
  const meta = [tidy(m.contact_name, 60), tidy(m.role, 50)].filter(present).map(esc).join(' · ');
  const scale = [tidy(m.business, 70), tidy(m.scale, 80)].filter(present).map(esc).join(' · ');
  return [
    '🔔 <b>FINMENTOR · Новый лид</b>',
    '',
    '<b>' + esc(tidy(m.company, 80) || 'Компания не указана') + '</b>',
    meta,
    scale,
    '',
    '<b>ГЛАВНАЯ БОЛЬ</b>',
    esc(tidy(m.main_pain, 240) || 'Нужно уточнить на первом контакте'),
    '',
    '<b>ЧТО ЗАМЕТИЛ FINMENTOR</b>',
    esc(tidy(m.observation, 300) || 'Недостаточно данных для вывода'),
    '',
    '<b>КОНТАКТ</b>',
    contactLines(m.contact),
    '',
    '<b>СЕЙЧАС</b>',
    esc(tidy(m.next_action, 220) || 'Открыть разбор клиента')
  ].filter((line, idx, all) => line !== '' || (idx > 0 && all[idx - 1] !== '')).join('\n').trim();
}

if (typeof module !== 'undefined' && module.exports) module.exports = { renderLeadIntelligenceAlert, contactLines, esc, tidy };
