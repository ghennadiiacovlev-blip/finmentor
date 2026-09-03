// FINMENTOR — compile a tracked Workflow-SDK candidate into plain n8n workflow JSON.
//
// The subset of '@n8n/workflow-sdk' the tracked candidates use: node(), trigger(), ifElse(),
// expr(), and the chain `workflow(id, name).add(t).to(n)…` with node-level `.to()`, `.onError()`,
// `.onTrue()` / `.onFalse()`. Nothing else. The result is what the tenant stores after
// `create_workflow_from_code`: the same parameters, names, versions, flags and credentials, with
// connections derived from the chain and positions laid out by depth.
//
// Pure, offline. No SDK package is needed: the candidate file is evaluated with this shim
// standing in for the import, so the SAME tracked source that the MCP connector would compile is
// what a REST deploy sends.

import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';

const FLAGS = ['onError', 'retryOnFail', 'maxTries', 'waitBetweenTries', 'executeOnce', 'alwaysOutputData', 'disabled'];

function makeNode(spec, isTrigger) {
  const cfg = spec.config || {};
  const n = {
    __sdk: true, __trigger: !!isTrigger,
    name: cfg.name, type: spec.type, typeVersion: spec.version,
    parameters: cfg.parameters || {}, credentials: cfg.credentials || null,
    flags: {}, edges: []
  };
  for (const f of FLAGS) { if (cfg[f] !== undefined) { n.flags[f] = cfg[f]; } }
  n.to = (next) => { n.edges.push({ output: 0, target: next }); return n; };
  n.onError = (next) => { n.edges.push({ output: 1, target: next }); return n; };
  return n;
}

function makeIf(spec) {
  const cfg = spec.config || {};
  const params = Object.assign({}, cfg.parameters || {});
  if (params.options === undefined) { params.options = {}; }
  const n = {
    __sdk: true, __trigger: false,
    name: cfg.name, type: 'n8n-nodes-base.if', typeVersion: spec.version,
    parameters: params, credentials: null, flags: {}, edges: []
  };
  for (const f of FLAGS) { if (cfg[f] !== undefined) { n.flags[f] = cfg[f]; } }
  n.onTrue = (next) => { n.edges.push({ output: 0, target: next }); return n; };
  n.onFalse = (next) => { n.edges.push({ output: 1, target: next }); return n; };
  n.to = (next) => { n.edges.push({ output: 0, target: next }); return n; };
  return n;
}

function makeWorkflow(id, name) {
  const w = { __workflow: true, id, name, roots: [], chainEdges: [], current: null };
  w.add = (t) => { w.roots.push(t); w.current = t; return w; };
  w.to = (n) => { if (!w.current) { throw new Error('.to() before .add()'); } w.chainEdges.push({ from: w.current, output: 0, target: n }); w.current = n; return w; };
  return w;
}

export const sdkShim = {
  node: (spec) => makeNode(spec, false),
  trigger: (spec) => makeNode(spec, true),
  ifElse: (spec) => makeIf(spec),
  expr: (s) => '=' + s,
  workflow: (id, name) => makeWorkflow(id, name)
};

// Evaluate the candidate source with the shim in place of the import.
export function evaluateCandidate(source) {
  const body = String(source)
    .replace(/^import\s*\{[^}]*\}\s*from\s*'@n8n\/workflow-sdk';?/m, '')
    .replace(/^export default\s+/m, 'return ');
  const fn = new Function('workflow', 'node', 'trigger', 'ifElse', 'expr', body);
  return fn(sdkShim.workflow, sdkShim.node, sdkShim.trigger, sdkShim.ifElse, sdkShim.expr);
}

// Walk every node reachable from the roots (through chain edges and node edges), collect the
// edge set, and lay the graph out by depth.
export function compileWorkflow(wf, opts) {
  const o = opts || {};
  const nodes = [];
  const seen = new Set();
  const edges = [];
  const visit = (n) => {
    if (!n || !n.__sdk) { throw new Error('not an SDK node: ' + JSON.stringify(n && n.name)); }
    if (seen.has(n)) { return; }
    seen.add(n); nodes.push(n);
    for (const e of n.edges) { edges.push({ from: n, output: e.output, target: e.target }); visit(e.target); }
  };
  for (const r of wf.roots) { visit(r); }
  for (const e of wf.chainEdges) { visit(e.from); visit(e.target); edges.push(e); }

  // depth-first layout: x by depth from the root, y by root index + branch
  const depth = new Map();
  const lane = new Map();
  wf.roots.forEach((r, i) => { depth.set(r, 0); lane.set(r, i * 3); });
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of edges) {
      if (!depth.has(e.from)) { continue; }
      const d = depth.get(e.from) + 1;
      if (!depth.has(e.target) || depth.get(e.target) < d) { depth.set(e.target, d); changed = true; }
      if (!lane.has(e.target)) { lane.set(e.target, lane.get(e.from) + (e.output ? 1 : 0)); }
    }
  }

  const ids = o.ids || {};
  const out = nodes.map((n) => {
    const j = { parameters: n.parameters, id: ids[n.name] || crypto.randomUUID(), name: n.name, type: n.type, typeVersion: n.typeVersion,
      position: [(depth.get(n) || 0) * 240, (lane.get(n) || 0) * 200] };
    for (const f of FLAGS) { if (n.flags[f] !== undefined) { j[f] = n.flags[f]; } }
    if (n.credentials) { j.credentials = n.credentials; }
    if (n.type === 'n8n-nodes-base.webhook') { j.webhookId = (o.webhookIds || {})[n.name] || crypto.randomUUID(); }
    return j;
  });

  const connections = {};
  for (const e of edges) {
    connections[e.from.name] = connections[e.from.name] || { main: [] };
    const main = connections[e.from.name].main;
    while (main.length <= e.output) { main.push([]); }
    if (!main[e.output].some((x) => x.node === e.target.name)) { main[e.output].push({ node: e.target.name, type: 'main', index: 0 }); }
  }
  return { name: wf.name, nodes: out, connections, settings: o.settings || {} };
}

export function compileFile(path, opts) {
  return compileWorkflow(evaluateCandidate(readFileSync(path, 'utf8')), opts);
}
