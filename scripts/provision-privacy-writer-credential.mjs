#!/usr/bin/env node
// FINMENTOR — provision the privacy_audit_writer runtime credential.
//
//   node scripts/provision-privacy-writer-credential.mjs --confirm
//
// WHY THIS IS A SCRIPT AND NOT SOMETHING THAT ALREADY RAN. It mints a database secret. A secret is
// the owner's to hold, not something an agent should create unprompted in a live tenant and then
// have to convey. Everything it does is prepared, reviewable and reversible; the trigger is yours.
//
// WHAT IT DOES, IN ORDER:
//
//   1. rotates the password of the LOGIN role `privacy_audit_writer` to 32 fresh random bytes;
//   2. creates an n8n Postgres credential holding it, SEPARATE from `FINMENTOR Supabase G5`;
//   3. prints the credential id, and prints the password ONCE, to stdout only.
//
// It writes the password to no file, and this script is tracked, so the password is never in git.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not touch any workflow. It does not substitute the
// credential id into a candidate. It does not activate anything. Wiring
// `__PRIVACY_AUDIT_CREDENTIAL_ID__` into the submit endpoint is a separate, explicit deploy step.
//
// THE ROLE IS NOT CREATED HERE. `privacy_audit_writer` already exists with INSERT and nothing else;
// see docs/PREMIUM_UX_PRIVACY_STORE_PROOF.md for the measured privilege matrix. This script assumes
// that role and refuses to invent privileges for it.

import crypto from 'node:crypto';

const CRED_NAME = 'FINMENTOR Privacy Audit Writer';
const ROLE = 'privacy_audit_writer';

const CONFIRM = process.argv.includes('--confirm');

// n8n
const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const WRITE_KEY = process.env.N8N_FIX_API_KEY;

// Postgres. Supplied by the owner rather than guessed: the pooler host, port and username form
// differ between Supabase connection modes, and a credential that silently points at the wrong one
// fails at the worst possible moment.
const PG_HOST = process.env.PRIVACY_PG_HOST;
const PG_PORT = process.env.PRIVACY_PG_PORT || '5432';
const PG_DATABASE = process.env.PRIVACY_PG_DATABASE || 'postgres';
const PG_USER = process.env.PRIVACY_PG_USER;   // e.g. privacy_audit_writer.<project-ref> on the pooler
const PG_SSL = process.env.PRIVACY_PG_SSL || 'require';

// The rotation runs through whatever admin SQL path the owner already uses. This script prints the
// statement rather than executing it, because the admin path here is an MCP tool rather than a
// connection string this process holds.
function say(m) { console.log(m); }
function die(m) { console.error('\nABORTED: ' + m); process.exit(1); }

const missing = [];
if (!BASE) { missing.push('N8N_BASE_URL'); }
if (!WRITE_KEY) { missing.push('N8N_FIX_API_KEY'); }
if (!PG_HOST) { missing.push('PRIVACY_PG_HOST'); }
if (!PG_USER) { missing.push('PRIVACY_PG_USER'); }

say('');
say('Privacy audit writer credential');
say('='.repeat(70));
say('  role       : ' + ROLE);
say('  credential : ' + CRED_NAME);
say('  host       : ' + (PG_HOST || '(unset)') + ':' + PG_PORT + '/' + PG_DATABASE);
say('  db user    : ' + (PG_USER || '(unset)'));
say('  ssl        : ' + PG_SSL);
say('');

if (missing.length) { die('set these first: ' + missing.join(', ')); }
if (!CONFIRM) { die('this creates a live credential and rotates a live password; re-run with --confirm'); }

// 32 bytes, base64url — no quoting hazards in a SQL literal or a JSON body.
const password = crypto.randomBytes(32).toString('base64url');

say('STEP 1 — rotate the role password. Run this as an admin, then press on:');
say('');
say("  alter role " + ROLE + " with password '" + password + "';");
say('');

const res = await fetch(BASE + '/api/v1/credentials', {
  method: 'POST',
  headers: { 'X-N8N-API-KEY': WRITE_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: CRED_NAME,
    type: 'postgres',
    data: {
      host: PG_HOST,
      port: Number(PG_PORT),
      database: PG_DATABASE,
      user: PG_USER,
      password: password,
      ssl: PG_SSL,
      allowUnauthorizedCerts: false
    }
  })
});
const text = await res.text();
if (!res.ok) { die('n8n refused the credential: ' + res.status + ' ' + text.slice(0, 400)); }

let id = null;
try { id = JSON.parse(text).id; } catch (e) { /* fall through */ }
say('STEP 2 — credential created.');
say('');
say('  credential id : ' + (id || '(see response: ' + text.slice(0, 200) + ')'));
say('');
say('STEP 3 — verify WITHOUT leaving a row. Run one INSERT that the opaque-key CHECK must reject:');
say('');
say('  insert into privacy.privacy_acknowledgements');
say("    (submission_key, privacy_notice_version, privacy_locale,");
say('     privacy_notice_shown_at, privacy_notice_acknowledged_at, privacy_legal_basis)');
say("  values ('NOT_AN_OPAQUE_KEY', 'probe', 'ru', now(), now(), 'PENDING_LEGAL_REVIEW');");
say('');
say('  23514 (check_violation) = the credential connects and may INSERT. Correct.');
say('  42501 (insufficient_privilege) = the grant or the role is wrong. STOP.');
say('  a connection error = host/user/ssl is wrong. STOP.');
say('');
say('STEP 4 — put the credential id into the submit endpoint at deploy time, replacing');
say('         __PRIVACY_AUDIT_CREDENTIAL_ID__. Do NOT commit it into a candidate.');
say('');
say('The password is printed ONCE, here, and stored nowhere else by this script:');
say('');
say('  ' + password);
say('');
