// FINMENTOR Premium UX — the deterministic meeting brief.
//
// Assembles what the consultant reads before the first call. Pure function of durable data plus one
// frozen lookup table; qa/premium-ux-brief.test.mjs drives it.
//
// THE ONE RULE THIS FILE EXISTS TO ENFORCE. Two halves, assembled from different sources, never
// merged:
//
//   CLIENT FACTS          — only values the client provided or confirmed. Quoted, never summarised,
//                           never interpreted, never inferred.
//   FINMENTOR PREPARATION — «Фокус первой встречи», a constant lookup on the objective id.
//
// There is no model call here and there must never be one. An objective outside the frozen map
// renders NO focus block rather than a guess — silence is the correct failure, because a wrong
// focus line would read to the consultant exactly like a right one.

'use strict';

const B = require('./branches.js');

const str = (v) => String(v === null || v === undefined ? '' : v).trim();

// A section is emitted only when it has content. spec §14 / §16: an empty «Важно до встречи» is
// omitted entirely — never «—», never the placeholder.
function section(label, lines) {
  const kept = (Array.isArray(lines) ? lines : [lines]).map(str).filter(Boolean);
  return kept.length ? { label: label, lines: kept } : null;
}

// Build from the CRM row shape (Pipeline columns) so the brief works from durable data and not
// from a live draft. `premium` carries the three normalised values that become BP/BQ/BR once the
// migration is approved; until then they arrive from raw_json and the brief is identical either way.
function buildBrief(row) {
  const r = row || {};
  const premium = r.premium || {};
  const objectiveLabel = str(r.work_interest) || str(r.objective);
  const obj = B.objectiveByLabel(objectiveLabel);

  const facts = [];
  // Identity block is not a labelled section; it is the dossier head.
  const head = {
    company: str(r.company),
    activity: str(r.industry_category) || str(r.business_model),
    role: str(r.role),
    scale: str(r.turnover_range)
  };

  // ЗАДАЧА is the objective LABEL exactly as the client selected it (spec §26). Never derived,
  // never re-worded, and never replaced by the problem.
  facts.push(section('ЗАДАЧА', objectiveLabel));
  facts.push(section('ПРОБЛЕМА', str(r.main_pain) || str(r.selected_problems)));
  facts.push(section('ОЖИДАЕМЫЙ РЕЗУЛЬТАТ', str(r.selected_goals)));
  facts.push(section('ТЕКУЩАЯ СИСТЕМА', str(premium.current_setup || r.current_setup).split(';').map((s) => s.trim())));
  facts.push(section('ГОРИЗОНТ', str(premium.decision_horizon || r.decision_horizon)));
  facts.push(section('МАТЕРИАЛЫ', str(r.selected_documents).split(';').map((s) => s.trim())));
  facts.push(section('ВАЖНО ДО ВСТРЕЧИ', str(premium.important_context || r.important_context)));

  const clientFacts = facts.filter(Boolean);

  // FINMENTOR PREPARATION — the controlled map, and nothing else.
  const focusLines = obj ? B.FOCUS_MAP[obj.id] : null;
  const preparation = focusLines
    ? { label: 'ФОКУС ПЕРВОЙ ВСТРЕЧИ', lines: focusLines.slice(), disclaimer: B.FOCUS_DISCLAIMER, source: 'controlled_map' }
    : null;

  // spec §27 — factual only. Availability in v1, since no file is ever uploaded.
  const hasMaterials = !!str(r.selected_documents);
  const readiness = [
    { label: 'Контекст компании', state: head.company && head.activity ? 'готов' : 'не заполнен' },
    { label: 'Задача', state: objectiveLabel ? 'готова' : 'не заполнена' },
    { label: 'Материалы', state: hasMaterials ? B.REVIEW.materialsStatus.present : B.REVIEW.materialsStatus.absent }
  ];

  return {
    head: head,
    client_facts: clientFacts,
    preparation: preparation,
    readiness: readiness,
    enough: B.REVIEW.enough,
    objective_id: obj ? obj.id : null
  };
}

// A brief must never present a preparation line as something the client said. This is the assertion
// the QA gate mutates against.
function separationHolds(brief) {
  if (!brief || !brief.preparation) { return true; }
  const prep = brief.preparation.lines.map((l) => str(l));
  for (const s of brief.client_facts || []) {
    for (const line of s.lines) { if (prep.indexOf(str(line)) !== -1) { return false; } }
  }
  return brief.preparation.source === 'controlled_map';
}

module.exports = { buildBrief, separationHolds, section };
