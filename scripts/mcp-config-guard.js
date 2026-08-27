// FINMENTOR — the .mcp.json project-scope guard.
//
// WHY THIS FILE EXISTS.
//
// `.mcp.json` is tracked ON PURPOSE (owner decision, P8.3A): it carries no secret, it makes the
// project-scoped Supabase MCP configuration reproducible, and it PINS the agent to
// finmentor-prod rather than trusting whatever a local setup happens to remember. A tracked
// config that pins production is worth more than an untracked one nobody can audit — but only
// for as long as it stays credential-free and stays pinned. Both of those are properties that
// decay silently under editing, which is what this file turns into a build failure.
//
// THE CONTROL IS STRUCTURAL CLOSURE, NOT A BLOCKLIST.
//
// A blocklist of forbidden words ("bearer", "service_role", ...) can only refuse the credential
// shapes someone thought of. This guard instead permits an exact, closed structure and refuses
// everything else: one server, named `supabase`, with exactly the keys `type` and `url`, whose
// URL has exactly the query parameters `project_ref` and `features`, with exactly the pinned
// values. Every position where a credential could physically sit — a `headers` block, an `env`
// block, an extra query parameter, URL userinfo, a fragment, an extra JSON key — is refused
// because it is not on the permitted structure, whether or not it looks like a secret. The word
// blocklist below is a SECOND net over the raw text; it is not the control.
//
// Credential-shaped LITERALS (JWTs, sk- keys) are scripts/secret-scan.mjs's job over every
// tracked file, and that scan covers this file like any other. This guard deliberately does not
// carry a second copy of those regexes: two sets would drift and neither would be authoritative.
// Both run in the same CI step. See docs/FINMENTOR_CI_QUALITY_GATE.md.

'use strict';

// The pinned production identity, verified through the Supabase management surface on
// 2026-08-27: finmentor-prod / eu-central-1 / ACTIVE_HEALTHY / PostgreSQL 17.6. Changing this
// constant repoints every agent session at a different database, so it is deliberately a
// tracked source edit and not configuration.
const PINNED_PROJECT_REF = 'exvmtjxmfouzuschiuwj';

const PINNED_SERVER_NAME = 'supabase';
const PINNED_HOST = 'mcp.supabase.com';
const PINNED_PATH = '/mcp';
const PINNED_TYPE = 'http';

// Exactly this set — not a subset, not a superset. A missing feature is a silent capability
// change; an extra one is a capability nobody approved. `account` (Supabase account and
// organisation management) is the feature that would break project scoping outright, and it
// cannot appear here because nothing outside this list can.
const PINNED_FEATURES = ['database', 'docs', 'debugging', 'development'];

// Feature names that must never be reachable, named explicitly so a failure says WHY rather than
// just "not permitted". These are already excluded by the exact-set rule above; this list exists
// so whoever reads the failure understands the stakes.
const FORBIDDEN_FEATURES = ['account', 'branching', 'storage', 'functions'];

const ALLOWED_SERVER_KEYS = ['type', 'url'];
const ALLOWED_QUERY_PARAMS = ['project_ref', 'features'];

// The second net. Applied to the RAW FILE TEXT, so it fires on a credential hidden in a key
// name, a value, or anywhere else — including places the structural rules would already refuse.
const FORBIDDEN_WORDS = [
  ['access token', /access[_-]?token/i],
  ['service_role key', /service[_-]?role/i],
  ['refresh token', /refresh[_-]?token/i],
  ['Authorization header', /authorization/i],
  ['bearer token', /bearer/i],
  ['api key', /api[_-]?key/i],
  ['secret', /secret/i],
  ['database password', /password/i],
  ['personal access token', /\bpat\b|personal[_-]?access/i],
  ['bare token field', /\btokens?\b/i],
  ['credential field', /\bcredentials?\b/i],
  ['supabase secret key prefix', /sb_secret/i]
];

// Keys that are never permitted in a server entry, named for the failure message. Any key outside
// ALLOWED_SERVER_KEYS is refused anyway; these get their own wording because they are the ones a
// hurried contributor would actually reach for.
const NAMED_HAZARD_KEYS = ['headers', 'env', 'command', 'args', 'token', 'apiKey', 'auth'];

// Evaluates the text of a .mcp.json. Pure: no filesystem, no network, no git.
// Returns { ok, failures[] }. Never throws — an unparseable config is a FAILURE, not an
// exception, because a config that cannot be read must not be able to pass a build.
function evaluateMcpConfig(text) {
  const failures = [];
  const fail = (m) => failures.push(m);

  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, failures: ['.mcp.json is empty or unreadable'] };
  }

  // ---- the second net, over raw text, before any parsing.
  FORBIDDEN_WORDS.forEach((entry) => {
    if (entry[1].test(text)) { fail('forbidden credential-bearing term in .mcp.json: ' + entry[0]); }
  });

  let cfg;
  try { cfg = JSON.parse(text); }
  catch (e) { fail('.mcp.json is not parseable JSON'); return { ok: false, failures: failures }; }

  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    fail('.mcp.json is not a JSON object');
    return { ok: false, failures: failures };
  }

  // ---- top level: exactly one key, `mcpServers`.
  Object.keys(cfg).forEach((k) => {
    if (k !== 'mcpServers') { fail('unexpected top-level key in .mcp.json: ' + k); }
  });
  const servers = cfg.mcpServers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    fail('.mcp.json has no `mcpServers` object');
    return { ok: false, failures: failures };
  }

  // ---- exactly one server, named `supabase`. A second server is a second authority.
  const names = Object.keys(servers);
  if (names.length !== 1) {
    fail('.mcp.json must declare exactly one MCP server, found ' + names.length + ': ' + names.join(', '));
  }
  names.forEach((n) => {
    if (n !== PINNED_SERVER_NAME) { fail('unexpected MCP server declared: ' + n); }
  });

  const srv = servers[PINNED_SERVER_NAME];
  if (!srv || typeof srv !== 'object' || Array.isArray(srv)) {
    fail('the `' + PINNED_SERVER_NAME + '` server entry is missing or not an object');
    return { ok: false, failures: failures };
  }

  // ---- the server entry: exactly `type` and `url`, nothing else.
  Object.keys(srv).forEach((k) => {
    if (ALLOWED_SERVER_KEYS.indexOf(k) === -1) {
      const named = NAMED_HAZARD_KEYS.some((h) => h.toLowerCase() === k.toLowerCase());
      fail(named
        ? 'the `' + PINNED_SERVER_NAME + '` server carries a `' + k + '` block; credentials must never live in tracked config'
        : 'unexpected key in the `' + PINNED_SERVER_NAME + '` server entry: ' + k);
    }
  });
  ALLOWED_SERVER_KEYS.forEach((k) => {
    if (!Object.prototype.hasOwnProperty.call(srv, k)) { fail('the server entry is missing `' + k + '`'); }
  });

  if (srv.type !== PINNED_TYPE) {
    fail('transport must be `' + PINNED_TYPE + '`, found ' + JSON.stringify(srv.type));
  }

  if (typeof srv.url !== 'string') {
    fail('the server `url` must be a string');
    return { ok: false, failures: failures };
  }

  let u;
  try { u = new URL(srv.url); }
  catch (e) { fail('the server `url` is not a valid URL'); return { ok: false, failures: failures }; }

  if (u.protocol !== 'https:') { fail('the MCP endpoint must be https, found ' + u.protocol); }
  if (u.hostname !== PINNED_HOST) { fail('the MCP endpoint host must be ' + PINNED_HOST + ', found ' + u.hostname); }
  if (u.pathname !== PINNED_PATH) { fail('the MCP endpoint path must be ' + PINNED_PATH + ', found ' + u.pathname); }

  // Userinfo is the oldest place to hide a credential in a URL, and the easiest to miss by eye.
  if (u.username || u.password) { fail('the MCP endpoint URL carries userinfo credentials'); }
  if (u.hash) { fail('the MCP endpoint URL carries a fragment'); }

  // ---- query parameters: exactly `project_ref` and `features`, each exactly once.
  const seen = [];
  u.searchParams.forEach((_v, k) => { if (seen.indexOf(k) === -1) { seen.push(k); } });
  seen.forEach((k) => {
    if (ALLOWED_QUERY_PARAMS.indexOf(k) === -1) {
      fail('unexpected query parameter on the MCP endpoint: ' + k);
    }
  });
  ALLOWED_QUERY_PARAMS.forEach((k) => {
    const n = u.searchParams.getAll(k).length;
    if (n === 0) { fail('the MCP endpoint is missing the `' + k + '` parameter'); }
    if (n > 1) { fail('the MCP endpoint declares `' + k + '` ' + n + ' times; scope must be unambiguous'); }
  });

  // ---- the pin itself.
  const ref = u.searchParams.get('project_ref');
  if (ref !== PINNED_PROJECT_REF) {
    fail('project_ref is not the pinned production project (expected ' + PINNED_PROJECT_REF + ')');
  }

  // ---- the feature scope: exact set, order-insensitive, no duplicates.
  const rawFeatures = u.searchParams.get('features');
  if (rawFeatures !== null) {
    const feats = rawFeatures.split(',').map((f) => f.trim()).filter((f) => f !== '');
    feats.forEach((f) => {
      if (FORBIDDEN_FEATURES.indexOf(f) !== -1) {
        fail('feature `' + f + '` is forbidden: it widens scope beyond this project');
      }
    });
    if (new Set(feats).size !== feats.length) { fail('the feature scope contains duplicates'); }
    feats.filter((f) => PINNED_FEATURES.indexOf(f) === -1)
      .forEach((f) => fail('feature outside the pinned scope: ' + f));
    PINNED_FEATURES.filter((f) => feats.indexOf(f) === -1)
      .forEach((f) => fail('pinned feature absent from the scope: ' + f));
  }

  return { ok: failures.length === 0, failures: failures };
}

module.exports = {
  evaluateMcpConfig: evaluateMcpConfig,
  PINNED_PROJECT_REF: PINNED_PROJECT_REF,
  PINNED_SERVER_NAME: PINNED_SERVER_NAME,
  PINNED_FEATURES: PINNED_FEATURES,
  FORBIDDEN_FEATURES: FORBIDDEN_FEATURES,
  ALLOWED_SERVER_KEYS: ALLOWED_SERVER_KEYS,
  ALLOWED_QUERY_PARAMS: ALLOWED_QUERY_PARAMS
};
