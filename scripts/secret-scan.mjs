#!/usr/bin/env node
// FINMENTOR — repo-wide secret scan over tracked files.
//
//   node scripts/secret-scan.mjs
//
// Deliberately NOT an eighth quality gate. The canonical seven cover behaviour;
// `qa/n8n-manifest-drift.test.mjs` already proves `n8n/production/` is redacted with 70
// assertions. This widens that same check to everything git tracks, so a credential cannot
// arrive through a path the workflow exports never touch.
//
// The patterns are copied verbatim from the n8n hygiene gate rather than reinvented. A
// second, subtly different set of regexes would be worse than none: it would disagree with
// the gate and give false confidence about which one is authoritative.
//
// Scope and honesty about it:
//   * scans only files git tracks, so untracked scratch work is out of scope by design;
//   * skips binary files;
//   * high-confidence shapes only. This finds a pasted credential. It does not find a
//     secret that looks like ordinary prose, and it is not a substitute for keeping
//     secrets in a secret store.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// Identical to SECRET_PATTERNS in qa/n8n-manifest-drift.test.mjs. Keep them in step.
const SECRET_PATTERNS = [
  ['telegram bot token', /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/],
  ['openai api key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['google api key', /\bAIza[A-Za-z0-9_-]{30,}\b/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['n8n api key (jwt)', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/]
];

// Exactly one allowlisted literal: the Telegram validator's test fixture. It is named to be
// unmistakable and is required for the HMAC test vector. Matched as a whole line substring,
// not as a pattern, so it cannot widen into a general exemption.
const ALLOWED_LITERALS = ['TEST_ONLY_TOKEN_NOT_A_REAL_SECRET'];

// Binary and archive types git tracks but that cannot usefully be line-scanned.
const SKIP_EXT = /\.(png|jpe?g|webp|gif|ico|zip|pdf|woff2?|ttf|eot|mp4|svg)$/i;

let files;
try {
  files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map((f) => f.trim()).filter(Boolean);
} catch (e) {
  console.error('secret-scan: not a git repository, or git unavailable');
  process.exit(2);
}

const findings = [];
let scanned = 0;

for (const rel of files) {
  if (SKIP_EXT.test(rel)) { continue; }
  let text;
  try { text = readFileSync(join(ROOT, rel), 'utf8'); } catch { continue; }
  // Skip binary: a NUL byte anywhere means this is not line-oriented text.
  if (text.includes(String.fromCharCode(0))) { continue; }
  scanned++;

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ALLOWED_LITERALS.some((a) => line.includes(a))) { continue; }
    for (const [label, re] of SECRET_PATTERNS) {
      if (re.test(line)) {
        findings.push({ file: rel, line: i + 1, label });
      }
    }
  }
}

console.log(`secret-scan: ${scanned} tracked text files scanned, ${SECRET_PATTERNS.length} patterns`);
if (findings.length) {
  console.error(`\nFAIL: ${findings.length} candidate secret(s)`);
  // The matched value is never printed — reporting a leak must not repeat it.
  for (const f of findings) { console.error(`  ${f.file}:${f.line}  ${f.label}`); }
  process.exit(1);
}
console.log('PASS: no credential-shaped literals in tracked files');
