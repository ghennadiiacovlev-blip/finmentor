// FINMENTOR — turn "live workflow -> target workflow" into the atomic operation list the n8n
// MCP connector's update_workflow accepts. Pure; no network.
//
// WHY. A whole-workflow PUT through the REST API is one blind write. The connector applies an
// ordered operation list ALL-OR-NOTHING and records a named version, so a deploy becomes an
// explicit, reviewable delta with a first-class rollback (restore_workflow_version). The delta
// is computed from the same candidate the dry-run produced, so what is sent is exactly what the
// gate verified.
//
// COVERAGE. Nodes: added (addNode + setNodeSettings for flags), removed (removeNode), changed
// parameters (updateNodeParameters replace:true), changed flags (setNodeSettings), changed
// credentials (setNodeCredential). Connections: removed/added per (source, outputIndex, target,
// inputIndex). Refuses a type or typeVersion change on an existing node — the connector has no
// operation for it, so such a node must be removed and re-added under a different plan.

const FLAGS = ['alwaysOutputData', 'onError', 'retryOnFail', 'executeOnce', 'maxTries', 'waitBetweenTries'];

function edges(w) {
  const out = [];
  for (const [src, c] of Object.entries(w.connections || {})) {
    (c.main || []).forEach((branch, i) => {
      for (const e of branch || []) { out.push({ source: src, sourceIndex: i, target: e.node, targetIndex: e.index || 0 }); }
    });
  }
  return out;
}
const key = (e) => e.source + '|' + e.sourceIndex + '|' + e.target + '|' + e.targetIndex;
const norm = (v) => JSON.stringify(v === undefined ? null : v);

export function diffToOps(live, target) {
  const ops = [];
  const refusals = [];
  const liveBy = Object.fromEntries(live.nodes.map((n) => [n.name, n]));
  const targetBy = Object.fromEntries(target.nodes.map((n) => [n.name, n]));
  const liveEdges = edges(live); const targetEdges = edges(target);
  const liveKeys = new Set(liveEdges.map(key)); const targetKeys = new Set(targetEdges.map(key));

  // 1. connections that go away (before nodes are removed, and before flags change)
  for (const e of liveEdges) {
    if (!targetKeys.has(key(e))) { ops.push({ type: 'removeConnection', source: e.source, sourceIndex: e.sourceIndex, target: e.target, targetIndex: e.targetIndex }); }
  }
  // 2. nodes that go away
  for (const n of live.nodes) { if (!targetBy[n.name]) { ops.push({ type: 'removeNode', nodeName: n.name }); } }
  // 3. nodes that change
  for (const n of target.nodes) {
    const l = liveBy[n.name];
    if (!l) { continue; }
    if (l.type !== n.type || l.typeVersion !== n.typeVersion) { refusals.push(n.name + ': type/typeVersion change (' + l.type + '@' + l.typeVersion + ' -> ' + n.type + '@' + n.typeVersion + ')'); continue; }
    if (norm(l.parameters) !== norm(n.parameters)) { ops.push({ type: 'updateNodeParameters', nodeName: n.name, parameters: n.parameters || {}, replace: true }); }
    const settings = {};
    for (const f of FLAGS) { if (norm(l[f]) !== norm(n[f])) { settings[f] = n[f] === undefined ? (f === 'onError' ? 'stopWorkflow' : false) : n[f]; } }
    if (Object.keys(settings).length) { ops.push({ type: 'setNodeSettings', nodeName: n.name, settings }); }
    if (norm(l.credentials) !== norm(n.credentials)) {
      for (const [ck, cv] of Object.entries(n.credentials || {})) { ops.push({ type: 'setNodeCredential', nodeName: n.name, credentialKey: ck, credentialId: cv.id, credentialName: cv.name }); }
      if (!n.credentials || !Object.keys(n.credentials).length) { refusals.push(n.name + ': credential removal has no operation'); }
    }
    if ((l.disabled === true) !== (n.disabled === true)) { ops.push({ type: 'setNodeDisabled', nodeName: n.name, disabled: n.disabled === true }); }
  }
  // 4. nodes that appear
  for (const n of target.nodes) {
    if (liveBy[n.name]) { continue; }
    const node = { name: n.name, type: n.type, typeVersion: n.typeVersion, parameters: n.parameters || {}, position: n.position || [0, 0] };
    if (n.id) { node.id = n.id; }
    if (n.credentials) { node.credentials = n.credentials; }
    if (n.disabled) { node.disabled = true; }
    ops.push({ type: 'addNode', node });
    const settings = {};
    for (const f of FLAGS) { if (n[f] !== undefined) { settings[f] = n[f]; } }
    if (Object.keys(settings).length) { ops.push({ type: 'setNodeSettings', nodeName: n.name, settings }); }
  }
  // 5. connections that appear
  for (const e of targetEdges) {
    if (!liveKeys.has(key(e))) { ops.push({ type: 'addConnection', source: e.source, sourceIndex: e.sourceIndex, target: e.target, targetIndex: e.targetIndex }); }
  }
  // 6. workflow settings
  if (norm(live.settings || {}) !== norm(target.settings || {})) { refusals.push('workflow settings differ; set them explicitly'); }
  if (live.name !== target.name) { ops.push({ type: 'setWorkflowMetadata', name: target.name }); }
  return { ops, refusals };
}

// Apply the same delta to a JSON copy of the live workflow, so what the connector will produce
// can be compared to the target BEFORE anything is sent (and to the fresh read AFTER).
export function applyOps(live, ops) {
  const w = JSON.parse(JSON.stringify(live));
  const byName = (n) => w.nodes.find((x) => x.name === n);
  for (const op of ops) {
    if (op.type === 'removeConnection') {
      const c = (w.connections[op.source] || {}).main || [];
      if (c[op.sourceIndex]) { c[op.sourceIndex] = c[op.sourceIndex].filter((e) => !(e.node === op.target && (e.index || 0) === op.targetIndex)); }
    } else if (op.type === 'removeNode') {
      w.nodes = w.nodes.filter((n) => n.name !== op.nodeName);
      delete w.connections[op.nodeName];
      for (const c of Object.values(w.connections)) { c.main = (c.main || []).map((b) => (b || []).filter((e) => e.node !== op.nodeName)); }
    } else if (op.type === 'updateNodeParameters') {
      byName(op.nodeName).parameters = op.parameters;
    } else if (op.type === 'setNodeSettings') {
      const n = byName(op.nodeName);
      for (const [k, v] of Object.entries(op.settings)) {
        if ((k === 'onError' && v === 'stopWorkflow') || v === false) { delete n[k]; } else { n[k] = v; }
      }
    } else if (op.type === 'setNodeCredential') {
      const n = byName(op.nodeName); n.credentials = n.credentials || {}; n.credentials[op.credentialKey] = { id: op.credentialId, name: op.credentialName };
    } else if (op.type === 'setNodeDisabled') {
      const n = byName(op.nodeName); if (op.disabled) { n.disabled = true; } else { delete n.disabled; }
    } else if (op.type === 'addNode') {
      const n = Object.assign({}, op.node); w.nodes.push(n);
    } else if (op.type === 'addConnection') {
      w.connections[op.source] = w.connections[op.source] || { main: [] };
      const main = w.connections[op.source].main;
      while (main.length <= op.sourceIndex) { main.push([]); }
      if (!main[op.sourceIndex]) { main[op.sourceIndex] = []; }
      main[op.sourceIndex].push({ node: op.target, type: 'main', index: op.targetIndex });
    } else if (op.type === 'setWorkflowMetadata') {
      if (op.name) { w.name = op.name; }
    }
  }
  return w;
}

// Behavioural equality: parameters, type, version, flags, credentials, disabled, and the edge set.
// Positions, ids and webhook ids are presentation and tenant-assigned.
export function sameBehaviour(a, b) {
  const f = [];
  const nodeSig = (n) => norm({ p: n.parameters, t: n.type, v: n.typeVersion, a: n.alwaysOutputData === true, e: n.onError || null, r: n.retryOnFail === true, x: n.executeOnce === true, m: n.maxTries || null, w: n.waitBetweenTries || null, c: n.credentials || null, d: n.disabled === true });
  const an = Object.fromEntries(a.nodes.map((n) => [n.name, n])); const bn = Object.fromEntries(b.nodes.map((n) => [n.name, n]));
  for (const k of Object.keys(an)) { if (!bn[k]) { f.push('missing node: ' + k); } else if (nodeSig(an[k]) !== nodeSig(bn[k])) { f.push('node differs: ' + k); } }
  for (const k of Object.keys(bn)) { if (!an[k]) { f.push('extra node: ' + k); } }
  const ae = new Set(edges(a).map(key)); const be = new Set(edges(b).map(key));
  for (const k of ae) { if (!be.has(k)) { f.push('missing edge: ' + k); } }
  for (const k of be) { if (!ae.has(k)) { f.push('extra edge: ' + k); } }
  return f;
}
