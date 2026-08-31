// FINMENTOR — n8n parameter expressions, evaluated the way n8n evaluates them.
//
// Execution 5055 cost a live tap to find a defect that lives ENTIRELY inside a parameter
// expression: `$('Route Edit Shape').first()` on a four-output Switch resolved an empty branch,
// so `Telegram Update Reply` was handed empty text and Telegram answered 400. Every offline gate
// passed, because every offline gate executes Code nodes and reads graph wiring — and an
// expression on a Telegram node is neither.
//
// This module closes that blind spot. It is deliberately small and deliberately faithful on the
// one rule that mattered:
//
//   $('Node').first(branchIndex = 0)   reads the node's FIRST OUTPUT BRANCH by default.
//
// A Switch sends each item down exactly one branch, so on any branch but 0 that default resolves
// nothing. Modelling `.first()` as "the item, wherever it went" would have reproduced a green run
// for a graph that fails in production, which is the only way this file could be worse than
// useless.
//
// ── WHAT AN EMPTY BRANCH YIELDS ────────────────────────────────────────────────────────────────
//
// `.first()` on an empty branch is modelled as `{ json: {} }`, so a property read returns
// undefined and renders as the empty string — which is exactly what Telegram received. n8n may
// instead raise and swallow; the observable result is the same empty string either way, and
// `evaluate` reports a thrown expression as empty too, so a gate written against this module
// catches the defect under both readings.

'use strict';

// ── the item handle n8n exposes for $('Node') and $input ──────────────────────────────────────
//
// An n8n item is always `{ json: … }`. A Code node may RETURN a bare object, and n8n normalises it
// before the next node sees it, so a harness that skips the normalisation makes every expression
// read `undefined.json` and fails for a reason that has nothing to do with the graph.
const item = (v) => (v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, 'json') ? v : { json: v == null ? {} : v });

function handle(branches) {
  const main = (Array.isArray(branches) ? branches : [branches || []]).map((b) => (b || []).map(item));
  const at = (b) => (main[b == null ? 0 : b] || []);
  return {
    // The default branch index is 0. This one default is the whole finding.
    first: (branchIndex, runIndex) => { void runIndex; const items = at(branchIndex); return items.length ? items[0] : { json: {} }; },
    last: (branchIndex, runIndex) => { void runIndex; const items = at(branchIndex); return items.length ? items[items.length - 1] : { json: {} }; },
    all: (branchIndex, runIndex) => { void runIndex; return at(branchIndex); },
    isExecuted: main.some((b) => (b || []).length > 0),
    itemMatching: (i) => { const items = at(0); return items[i] || { json: {} }; }
  };
}

// `outputs` maps node name -> array of output branches, each an array of { json }.
// A single-output node may be given as a plain array of items; it is wrapped.
function context(outputs, currentItem) {
  const byName = {};
  for (const name of Object.keys(outputs || {})) {
    const v = outputs[name];
    byName[name] = handle(Array.isArray(v) && Array.isArray(v[0]) ? v : [v || []]);
  }
  const $ = (name) => {
    if (!Object.prototype.hasOwnProperty.call(byName, name)) {
      throw new Error("$('" + name + "') refers to a node that has not executed on this path");
    }
    return byName[name];
  };
  return { $: $, json: (currentItem && currentItem.json) || currentItem || {} };
}

// ── evaluating one parameter ──────────────────────────────────────────────────────────────────
//
// An n8n parameter is a literal unless it starts with '='. After that marker, `{{ … }}` blocks are
// evaluated and concatenated with the literal text around them. A parameter that is exactly one
// block keeps the value's type; anything else is a string, as n8n does.
function evaluate(param, outputs, currentItem) {
  if (typeof param !== 'string' || param[0] !== '=') { return { ok: true, value: param, rendered: param == null ? '' : String(param) }; }
  const body = param.slice(1);
  const ctx = context(outputs, currentItem);

  const parts = [];
  let i = 0;
  while (i < body.length) {
    const open = body.indexOf('{{', i);
    if (open === -1) { parts.push({ literal: body.slice(i) }); break; }
    if (open > i) { parts.push({ literal: body.slice(i, open) }); }
    const close = body.indexOf('}}', open + 2);
    if (close === -1) { parts.push({ literal: body.slice(open) }); break; }
    parts.push({ code: body.slice(open + 2, close) });
    i = close + 2;
  }

  const values = [];
  for (const p of parts) {
    if ('literal' in p) { values.push(p.literal); continue; }
    try {
      values.push(new Function('$', '$json', '"use strict"; return (' + p.code + ');')(ctx.$, ctx.json));
    } catch (e) {
      // n8n surfaces a failed expression as an empty parameter rather than as a crash at this
      // point; the node downstream is what rejects it. Report it so a gate can say which.
      return { ok: false, value: undefined, rendered: '', error: e.message, code: p.code.trim() };
    }
  }

  if (values.length === 1 && parts.length === 1 && 'code' in parts[0]) {
    const v = values[0];
    return { ok: true, value: v, rendered: v == null ? '' : String(v) };
  }
  const rendered = values.map((v) => (v == null ? '' : String(v))).join('');
  return { ok: true, value: rendered, rendered: rendered };
}

// ── which Switch branch an item takes ─────────────────────────────────────────────────────────
//
// Only the operator this graph uses is implemented — string equality on a rule's leftValue. An
// unrecognised operator throws rather than guessing, so a future rule cannot silently route to 0.
function switchBranch(node, outputs, currentItem) {
  const rules = ((node.parameters || {}).rules || {}).values || [];
  for (let r = 0; r < rules.length; r++) {
    const conds = ((rules[r].conditions || {}).conditions) || [];
    const combinator = (rules[r].conditions || {}).combinator || 'and';
    const results = conds.map((c) => {
      const op = c.operator || {};
      if (op.type !== 'string' || op.operation !== 'equals') {
        throw new Error('unmodelled switch operator: ' + op.type + '/' + op.operation);
      }
      const left = evaluate(c.leftValue, outputs, currentItem);
      const right = evaluate(c.rightValue, outputs, currentItem);
      return left.rendered === right.rendered;
    });
    const matched = combinator === 'or' ? results.some(Boolean) : results.every(Boolean);
    if (conds.length && matched) { return { index: r, key: rules[r].outputKey, fallback: false }; }
  }
  const fb = ((node.parameters || {}).options || {}).fallbackOutput;
  if (fb === 'extra') { return { index: rules.length, key: 'extra', fallback: true }; }
  if (typeof fb === 'number') { return { index: fb, key: (rules[fb] || {}).outputKey, fallback: true }; }
  return { index: -1, key: null, fallback: true };
}

// ── the static half of the finding ────────────────────────────────────────────────────────────
//
// A node with more than one output can never be addressed safely by a bare `.first()`. Rather than
// re-finding this in production, every parameter in a graph is scanned for the shape.
const MULTI_OUTPUT_TYPES = ['n8n-nodes-base.switch', 'n8n-nodes-base.if', 'n8n-nodes-base.filter'];

function multiOutputNames(workflow) {
  const names = new Set();
  for (const n of workflow.nodes || []) {
    if (MULTI_OUTPUT_TYPES.includes(n.type)) { names.add(n.name); }
  }
  return names;
}

// Returns [{ node, parameterPath, reference, expression }] for every `$('X').first()` /
// `.last()` / `.all()` whose X is a multi-output routing node.
function unsafeRoutingReferences(workflow) {
  const multi = multiOutputNames(workflow);
  const hits = [];
  const walk = (node, value, path) => {
    if (typeof value === 'string') {
      if (value[0] !== '=') { return; }
      const re = /\$\(\s*(['"])(.*?)\1\s*\)\s*\.\s*(first|last|all)\s*\(\s*\)/g;
      let m;
      while ((m = re.exec(value)) !== null) {
        if (multi.has(m[2])) {
          hits.push({ node: node.name, parameterPath: path, reference: m[2], accessor: m[3], expression: value });
        }
      }
      return;
    }
    if (Array.isArray(value)) { value.forEach((v, i) => walk(node, v, path + '[' + i + ']')); return; }
    if (value && typeof value === 'object') { for (const k of Object.keys(value)) { walk(node, value[k], path ? path + '.' + k : k); } }
  };
  for (const n of workflow.nodes || []) { walk(n, n.parameters || {}, ''); }
  return hits;
}

module.exports = {
  handle: handle,
  evaluate: evaluate,
  switchBranch: switchBranch,
  multiOutputNames: multiOutputNames,
  unsafeRoutingReferences: unsafeRoutingReferences,
  MULTI_OUTPUT_TYPES: MULTI_OUTPUT_TYPES
};
