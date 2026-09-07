#!/usr/bin/env node
// FINMENTOR — the .mcp.json project-scope gate.
//
//   node qa/mcp-config.test.mjs
//
// Offline. No tenant, no credential, no network.
//
// `.mcp.json` is tracked deliberately: it pins every agent session to finmentor-prod instead of
// trusting whatever a local setup remembers. That is only worth having while the file stays
// credential-free and stays pinned, and both decay silently under editing. This gate turns that
// decay into a build failure.
//
// The control in scripts/mcp-config-guard.js is STRUCTURAL CLOSURE: an exact permitted shape,
// with everything else refused whether or not it looks like a secret. These checks exercise the
// positions a credential could physically occupy, so the guard cannot pass by being unreachable.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const G = require(join(ROOT, 'scripts', 'mcp-config-guard.js'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

const RAW = readFileSync(join(ROOT, '.mcp.json'), 'utf8');
const base = () => JSON.parse(RAW);
const asText = (o) => JSON.stringify(o, null, 2);
const srv = (o) => o.mcpServers.supabase;
const withUrl = (mutate) => { const o = base(); const u = new URL(srv(o).url); mutate(u); srv(o).url = u.toString(); return asText(o); };

console.log('\n-- the tracked config --');

check('CONTROL: the tracked .mcp.json passes', () => {
  const v = G.evaluateMcpConfig(RAW);
  assert(v.ok, v.failures.join(' | '));
});

check('it is tracked, not ignored', () => {
  // The decision this gate exists to support. An ignored config cannot be audited.
  let ignored = false;
  try { ignored = /(^|\n)\.mcp\.json\s*(\n|$)/.test(readFileSync(join(ROOT, '.gitignore'), 'utf8')); } catch (e) { ignored = false; }
  assert(!ignored, '.mcp.json is gitignored; a tracked pin is the whole point');
});

check('the pin names the production project and the closed feature set', () => {
  assert(/^[a-z]{20}$/.test(G.PINNED_PROJECT_REF), 'the pinned project_ref is not a project ref');
  assert(G.PINNED_FEATURES.indexOf('account') === -1, 'account is inside the pinned scope');
  ['account', 'branching', 'storage', 'functions'].forEach((f) =>
    assert(G.FORBIDDEN_FEATURES.indexOf(f) !== -1, f + ' is no longer named as forbidden'));
});

console.log('\n-- every position a credential could occupy is refused --');

function mustFail(label, text, expect) {
  check('REFUSES: ' + label, () => {
    const v = G.evaluateMcpConfig(text);
    assert(!v.ok, 'accepted: ' + label);
    if (expect) {
      assert(v.failures.some((f) => f.includes(expect)),
        'refused, but not for the expected reason (' + expect + '): ' + v.failures.join(' | '));
    }
  });
}

mustFail('a headers block', asText((() => { const o = base(); srv(o).headers = { Authorization: 'x' }; return o; })()), 'credentials must never live in tracked config');
mustFail('an env block', asText((() => { const o = base(); srv(o).env = { A: 'b' }; return o; })()), 'credentials must never live in tracked config');
mustFail('a command/args pair', asText((() => { const o = base(); srv(o).command = 'npx'; return o; })()), 'credentials must never live in tracked config');
mustFail('any extra server key', asText((() => { const o = base(); srv(o).note = 'harmless'; return o; })()), 'unexpected key');
mustFail('userinfo in the URL', withUrl((u) => { u.username = 'user'; u.password = 'pw'; }), 'userinfo');
mustFail('a URL fragment', withUrl((u) => { u.hash = 'tok'; }), 'fragment');
mustFail('an extra query parameter', withUrl((u) => { u.searchParams.set('access', '1'); }), 'unexpected query parameter');
mustFail('a different project_ref', withUrl((u) => { u.searchParams.set('project_ref', 'aaaaaaaaaaaaaaaaaaaa'); }), 'not the pinned production project');
mustFail('the account feature', withUrl((u) => { u.searchParams.set('features', 'database,docs,debugging,development,account'); }), 'forbidden');
mustFail('a missing pinned feature', withUrl((u) => { u.searchParams.set('features', 'database,docs'); }), 'absent from the scope');
mustFail('a plain-http endpoint', withUrl((u) => { u.protocol = 'http:'; }), 'https');
mustFail('a different host', withUrl((u) => { u.hostname = 'example.com'; }), 'host must be');
mustFail('a second MCP server', asText((() => { const o = base(); o.mcpServers.other = { type: 'http', url: 'https://example.com/mcp' }; return o; })()), 'exactly one MCP server');

// The owner-named credential shapes, injected as RAW TEXT so they exercise the second net over
// the file rather than the structural rules. Values below are obviously synthetic.
mustFail('an injected access token field', asText((() => { const o = base(); srv(o).access_token = 'AAAA'; return o; })()), 'access token');
mustFail('an injected personal access token', asText((() => { const o = base(); o.personal_access = 'AAAA'; return o; })()), 'personal access token');
mustFail('an injected service_role key', asText((() => { const o = base(); srv(o).service_role = 'AAAA'; return o; })()), 'service_role key');
mustFail('an injected Bearer value', asText((() => { const o = base(); srv(o).url = srv(o).url; o.note = 'Bearer AAAA'; return o; })()), 'bearer token');
mustFail('an injected api key field', asText((() => { const o = base(); srv(o).apiKey = 'AAAA'; return o; })()), 'api key');
mustFail('an injected secret field', asText((() => { const o = base(); srv(o).secret = 'AAAA'; return o; })()), 'secret');
mustFail('an injected password field', asText((() => { const o = base(); srv(o).password = 'AAAA'; return o; })()), 'database password');

mustFail('an unparseable file', '{ not json', 'not parseable JSON');
mustFail('an empty file', '', 'empty or unreadable');

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) { failures.forEach((f) => console.error('  - ' + f)); process.exit(1); }
