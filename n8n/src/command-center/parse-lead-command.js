// FINMENTOR Command Center v3 — authorisation and command parsing.
//
// Deployed as the n8n Code node "Parse Lead Command v2".
//
// Identity comes ONLY from "Verify Telegram Identity", which derives it from the
// authenticated Telegram Trigger update. No value here originates from a caller-supplied
// HTTP body, and there is no hardcoded owner fallback: the Settings sheet is the single
// authorisation policy source. An absent or empty allowlist denies everyone.
//
// Unauthorised updates return [] — a silent drop. Nothing downstream executes, so there
// are zero Pipeline reads, zero CRM writes and no CRM data in any Telegram reply.

const v = $('Verify Telegram Identity').first().json;
if (!v || v.verified !== true) return [];

const cfg = $('Settings to Object').first().json.settings || {};

// Policy source of truth. Deny-all when unset — never allow-all.
const allowed = String(cfg.allowed_chat_ids ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
if (allowed.length === 0) return [];

const fromId = String(v.verified_from_id);
const chatId = String(v.verified_chat_id);

// Re-assert the private-chat invariant at the authorisation boundary. Defence in depth:
// authorisation and reply destination must be the same identity, checked again here so a
// future change upstream cannot silently reintroduce the from/chat split.
if (!chatId || chatId !== fromId) return [];

// Exact match only. No prefix, substring or numeric coercion.
if (!allowed.includes(fromId)) return [];

const text = String(v.text ?? '').trim();
if (!text) return [];

const isCb = v.is_callback === true;
const cbId = String(v.callback_query_id ?? '');

function base(extra) {
  return Object.assign({
    mode: 'noop', query_type: '', command: '', lead_id: '', args: [],
    snooze_hours: 24, stage_value: '', note_text: '', deal_value: '', close_reason: '', meeting_date: '',
    chat_id: chatId, from_id: fromId, callback_query_id: cbId, is_callback: isCb,
    allowed: true, reply_text: ''
  }, extra || {});
}

// callback_data: "cmd|lead|arg" ; text: "cmd lead arg..."
const parts = isCb
  ? text.split('|').map(s => s.trim())
  : text.replace(/^\//, '/').split(/\s+/);

const cmd = (parts[0] || '').toLowerCase().replace(/^\//, '');
const rest = parts.slice(1);

const HELP =
`FINMENTOR Command Center

Запросы:
/today — новые лиды сегодня
/overdue — просроченные follow-up
/hot — горячие лиды
/pipeline — сводка воронки
/lead <ID> — карточка лида

Действия (<ID> = FIN-/fm-/FM-...):
done <ID> — закрыть SLA
snooze <ID> <часы> — отложить
stage <ID> <стадия> — сменить стадию
meeting <ID> <дата> — назначить встречу
docs <ID> — запросить документы
proposal <ID> — отправлено предложение
nurture <ID> — в подогрев
won <ID> <сумма> — сделка выиграна
lost <ID> <причина> — сделка проиграна
note <ID> <текст> — заметка`;

const queryCmds = { today: 'today', overdue: 'overdue', hot: 'hot', pipeline: 'pipeline' };
const updateCmds = ['done', 'snooze', 'stage', 'meeting', 'docs', 'proposal', 'nurture', 'won', 'lost', 'note'];

if (cmd === 'help' || cmd === 'start') {
  return [base({ mode: 'help', reply_text: HELP })];
}

if (queryCmds[cmd]) {
  return [base({ mode: 'query', query_type: queryCmds[cmd] })];
}

if (cmd === 'lead') {
  const id = rest[0] || '';
  if (!id) return [base({ mode: 'help', reply_text: 'Укажи Lead ID: /lead FIN-...' })];
  return [base({ mode: 'query', query_type: 'lead', lead_id: id })];
}

if (updateCmds.includes(cmd)) {
  const id = rest[0] || '';
  if (!id) return [base({ mode: 'help', reply_text: `Укажи Lead ID: ${cmd} FIN-...` })];
  const o = base({ mode: 'update', command: cmd, lead_id: id, args: rest.slice(1) });
  if (cmd === 'snooze') o.snooze_hours = Number(rest[1]) > 0 ? Number(rest[1]) : 24;
  if (cmd === 'stage') o.stage_value = rest.slice(1).join(' ') || 'Discovery Scheduled';
  if (cmd === 'meeting') o.meeting_date = rest.slice(1).join(' ');
  if (cmd === 'won') o.deal_value = rest[1] || '';
  if (cmd === 'lost') o.close_reason = rest.slice(1).join(' ');
  if (cmd === 'note') o.note_text = rest.slice(1).join(' ');
  return [o];
}

// Unknown command: help text only. No CRM read, no CRM write.
return [base({ mode: 'help', reply_text: 'Неизвестная команда. Напиши /help для списка.' })];
