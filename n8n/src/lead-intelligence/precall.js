// FINMENTOR Lead Intelligence v1 — Telegram pre-call brief renderer.
// Presentation only: consumes the validated owner_brief_json already stored in XRay_Analysis.
'use strict';

function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function tidy(v, n) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return !n || s.length <= n ? s : s.slice(0, n).replace(/[\s,.;:—-]+$/, '') + '…';
}
function present(v) { return String(v == null ? '' : v).trim() !== ''; }
function bullets(values, max, each) {
  return (Array.isArray(values) ? values : []).map((v) => tidy(v, each)).filter(present).slice(0, max)
    .map((v) => '• ' + esc(v)).join('\n');
}
function section(n, title, body) {
  const value = String(body || '').trim();
  return value ? '<b>' + n + '. ' + title + '</b>\n' + value : '';
}

function renderPrecallBrief(model) {
  const m = model || {};
  const b = m.brief && typeof m.brief === 'object' ? m.brief : {};
  const h = b.header || {};
  const facts = Array.isArray(b.client_facts) ? b.client_facts : [];
  const problem = facts.find((f) => f && f.id === 'main_problem') || facts[0] || {};
  const diagnoses = Array.isArray(b.diagnoses) ? b.diagnoses : [];
  const unknowns = Array.isArray(b.unknowns) ? b.unknowns : [];
  const questions = Array.isArray(b.discovery_questions) ? b.discovery_questions : [];
  const solution = b.solution_hypothesis || {};
  const next = b.next_action || {};

  const client = [
    '<b>' + esc(tidy(h.company, 90) || 'Компания не указана') + '</b>',
    [tidy(h.contact_name, 60), tidy(h.role, 60)].filter(present).map(esc).join(' · '),
    [tidy(h.business, 80), tidy(h.scale, 80)].filter(present).map(esc).join(' · '),
    present(m.lead_id) ? 'Lead ID: <code>' + esc(tidy(m.lead_id, 80)) + '</code>' : ''
  ].filter(present).join('\n');

  const view = bullets(diagnoses.map((d) => d && d.conclusion), 2, 160);
  const verification = bullets(unknowns.map((u) => u && u.item), 4, 125);
  const economics = bullets(diagnoses.map((d) => d && d.economic_implication), 2, 145);
  const ask = questions.slice(0, 7).map((q, i) => {
    const value = q && typeof q === 'object' ? q.question : q;
    return present(value) ? (i + 1) + '. ' + esc(tidy(value, 125)) : '';
  }).filter(Boolean).join('\n');
  const hypothesis = [tidy(solution.format, 110), tidy(solution.rationale, 190)].filter(present).map(esc).join('\n');
  const confirmations = bullets(solution.confirmation_conditions, 4, 125);
  const action = [tidy(next.action || h.next_action, 180), tidy(next.purpose, 130), tidy(next.success_condition, 150)]
    .filter(present).map(esc).join('\n');

  const text = [
    '<b>FINMENTOR · БРИФ К ПЕРВОЙ ВСТРЕЧЕ</b>',
    section(1, 'КЛИЕНТ', client),
    section(2, 'КЛЮЧЕВАЯ ПРОБЛЕМА', esc(tidy(problem.value, 220))),
    section(3, 'ЧТО ВИДИТ FINMENTOR', view),
    section(4, 'ПРОТИВОРЕЧИЯ И НЕИЗВЕСТНОЕ', verification),
    section(5, 'ЭКОНОМИЧЕСКИЙ СМЫСЛ', economics),
    section(6, 'ЦЕЛЬ ПЕРВОЙ ВСТРЕЧИ', esc(tidy(b.first_meeting_objective, 230))),
    section(7, 'КАК НАЧАТЬ РАЗГОВОР', esc(tidy(b.conversation_opening, 260))),
    section(8, 'ЧТО СПРОСИТЬ', ask),
    section(9, 'ГИПОТЕЗА РЕШЕНИЯ', hypothesis),
    section(10, 'ЧТО НУЖНО ПОДТВЕРДИТЬ', confirmations),
    section(11, 'СЛЕДУЮЩЕЕ ДЕЙСТВИЕ', action)
  ].filter(present).join('\n\n');
  if (text.length > 3900) throw new Error('PRECALL_TELEGRAM_LIMIT');
  return text;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { renderPrecallBrief, esc, tidy };
