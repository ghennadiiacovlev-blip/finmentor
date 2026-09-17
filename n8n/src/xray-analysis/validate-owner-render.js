// FINMENTOR V1 — validate one owner-render normalization attempt.
//
// The core X-Ray response has already passed every non-language contract. This node accepts only a
// presentation rewrite of owner_brief, proves that its structure and authorities are unchanged,
// and emits an AI-shaped item for the existing full validator. On failure it emits the exact error
// as the correction prompt for one final owner-normalizer attempt. It never persists anything.

function plainObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function cleanError(value) {
  return String(value == null ? '' : value).replace(/[\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000);
}
function extractText(ai) {
  let c = ai && (ai.output?.[0]?.content?.[0]?.text ?? ai.output_text ?? ai.text ?? ai.response
    ?? ai.message?.content ?? ai.choices?.[0]?.message?.content ?? ai.content ?? '');
  if (ai && Array.isArray(ai.output)) {
    const msg = ai.output.find((o) => o && o.type === 'message' && Array.isArray(o.content));
    if (msg) {
      const t = msg.content.find((x) => x && (x.type === 'output_text' || typeof x.text === 'string'));
      if (t && typeof t.text === 'string') c = t.text;
    }
  }
  if (typeof c !== 'string') c = JSON.stringify(c);
  c = c.replace(/```json/gi, '').replace(/```/g, '').trim();
  const a = c.indexOf('{'); const b = c.lastIndexOf('}');
  return (a !== -1 && b > a) ? c.slice(a, b + 1) : c;
}
function pairedIndex(item, fallback) {
  const p = item && item.pairedItem;
  const one = Array.isArray(p) ? p[0] : p;
  if (one && typeof one === 'object' && Number.isInteger(one.item)) return one.item;
  if (Number.isInteger(one)) return one;
  return fallback;
}
function sourceBases() {
  try {
    const correction = $('Validate Owner Render').all().map((item) => item.json)
      .filter((item) => item && item.owner_render_valid === false);
    if (correction.length) return correction;
  } catch (e) {}
  return $('Validate + Store Rows').all().map((item) => item.json)
    .filter((item) => item && item.owner_render_required === true);
}
function pathName(parts) { return parts.map((part) => typeof part === 'number' ? '[]' : part).join('.').replace(/\.\[\]/g, '[]'); }
function translatable(path) {
  return [
    /^header\.(?:role|business|scale|lead_status|priority_reason|data_quality|commercial_intent|next_action)$/,
    /^owner_fact_translations\[\]\.value_ru$/,
    /^diagnoses\[\]\.(?:conclusion|hypothesis|economic_implication)$/,
    /^pain_map\[\]\.(?:area|attention|observation|consequence|economic_category)$/,
    /^unknowns\[\]\.(?:item|why)$/,
    /^(?:first_meeting_objective|conversation_opening)$/,
    /^discovery_questions\[\]\.(?:question|why)$/,
    /^solution_hypothesis\.(?:format|rationale|if_confirmed|do_not_offer_yet)$/,
    /^solution_hypothesis\.confirmation_conditions\[\]$/,
    /^next_action\.(?:action|purpose|success_condition)$/,
    /^history\[\]\.label$/
  ].some((re) => re.test(path));
}
// Numeric fidelity guard. Only the digits themselves are compared: a thousands group and a decimal
// separator are normalized away, while units, currencies and date punctuation are deliberately NOT
// part of a token. A professional Russian rewrite legitimately renders «5 mii lei» as «5 тыс. леев»
// and «20.09.2026» as «20 сентября 2026»; only a changed number may fail the owner render.
function tokens(value) {
  const text = String(value == null ? '' : value);
  const matches = text.match(/\d{1,3}(?:[\s .,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g) || [];
  return matches
    .map((x) => x.replace(/[\s ]/g, '').replace(/[.,](?=\d{3}(?:\D|$))/g, '').replace(',', '.'))
    .sort();
}
function russianError(value) {
  const s = String(value == null ? '' : value).trim();
  if (!/[A-Za-zĂÂÎȘŞȚŢА-Яа-яЁё]/.test(s) || /^\[[A-Z]+\]$/.test(s)) return '';
  if (/[ăâîșşțţ]/i.test(s)
    || /\b(?:compania|companie|lichiditate|fluxul|numerar|trebuie|pentru|este|sunt|riscuri|risc|venituri|cheltuieli|clientul|afacerea|controlul|verificare|următor|actiune|acțiune|întâlnire|datele|financiară)\b/i.test(s)) {
    return 'contains Romanian prose';
  }
  if (/[A-Za-z]/.test(s) && !/[А-Яа-яЁё]/.test(s)) {
    const compact = s.replace(/[^A-Za-z0-9+&./_-]/g, '');
    if (!compact || compact !== compact.toUpperCase() || compact.length > 24) return 'is not Russian';
  }
  return '';
}
function compare(expected, actual, parts, errors) {
  const path = pathName(parts);
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) { errors.push(path + ' must remain an array'); return; }
    if (actual.length !== expected.length) errors.push(path + ' cardinality changed from ' + expected.length + ' to ' + actual.length);
    for (let i = 0; i < Math.min(expected.length, actual.length); i++) compare(expected[i], actual[i], parts.concat(i), errors);
    return;
  }
  if (plainObject(expected)) {
    if (!plainObject(actual)) { errors.push(path + ' must remain an object'); return; }
    const before = Object.keys(expected).sort(); const after = Object.keys(actual).sort();
    if (JSON.stringify(before) !== JSON.stringify(after)) { errors.push(path + ' object keys changed'); return; }
    for (const key of before) compare(expected[key], actual[key], parts.concat(key), errors);
    return;
  }
  if (typeof actual !== typeof expected) { errors.push(path + ' value type changed'); return; }
  if (translatable(path) && typeof expected === 'string') {
    if (expected && !actual.trim()) errors.push(path + ' was removed');
    if (JSON.stringify(tokens(expected)) !== JSON.stringify(tokens(actual))) errors.push(path + ' numbers/dates/currencies changed');
    const language = russianError(actual);
    if (language) errors.push(path + ' ' + language);
    return;
  }
  if (JSON.stringify(expected) !== JSON.stringify(actual)) errors.push(path + ' immutable value changed');
}
function mergePresentation(original, translated, parts) {
  const path = pathName(parts);
  if (Array.isArray(original)) return original.map((value, index) => mergePresentation(value, translated[index], parts.concat(index)));
  if (plainObject(original)) return Object.fromEntries(Object.keys(original).map((key) => [key, mergePresentation(original[key], translated[key], parts.concat(key))]));
  return translatable(path) && typeof original === 'string' ? translated : original;
}

const responses = $input.all();
const bases = sourceBases();
const out = [];
for (let index = 0; index < responses.length; index++) {
  const base = bases[pairedIndex(responses[index], index)];
  if (!base || !base._owner_render_state) continue;
  const state = base._owner_render_state;
  const attempt = Number(base.owner_render_attempt || 0) + 1;
  const raw = extractText(responses[index].json || {});
  const errors = [];
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (error) { errors.push('invalid JSON'); }
  if (parsed && (!plainObject(parsed) || JSON.stringify(Object.keys(parsed).sort()) !== '["owner_brief"]')) {
    errors.push('root must contain only owner_brief');
  }
  const candidate = parsed && parsed.owner_brief;
  if (parsed && !plainObject(candidate)) errors.push('owner_brief must be an object');
  if (plainObject(candidate)) compare(state.render_source, candidate, [], errors);
  const exactErrors = [...new Set(errors)].slice(0, 20);
  if (exactErrors.length) {
    const exact = exactErrors.join('; ');
    out.push({
      json: Object.assign({}, base, {
        owner_render_valid: false,
        owner_render_attempt: attempt,
        owner_render_error: exact,
        owner_render_prompt: [
          base.owner_render_prompt,
          '',
          'CORRECTION ATTEMPT — fix only the validation failures below.',
          'EXACT VALIDATION ERROR: ' + exact,
          'Return the complete corrected owner_brief object. Do not change anything else.',
          'PREVIOUS NORMALIZER OUTPUT: ' + raw.slice(0, 45000)
        ].join('\n')
      }),
      pairedItem: { item: Number(state.input_index) || 0 }
    });
    continue;
  }
  const mergedBrief = mergePresentation(state.original_owner_brief, candidate, []);
  const core = JSON.parse(JSON.stringify(state.original_core_response));
  core.owner_brief = mergedBrief;
  out.push({
    json: {
      output_text: JSON.stringify(core),
      __owner_render_completed: true,
      __owner_render_analysis_id: state.analysis_id,
      owner_render_valid: true,
      owner_render_attempt: attempt,
      request_id: base.request_id,
      analysis_id: state.analysis_id
    },
    pairedItem: { item: Number(state.input_index) || 0 }
  });
}
return out;

