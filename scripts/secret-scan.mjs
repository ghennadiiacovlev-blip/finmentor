#!/usr/bin/env node
// FINMENTOR — repo-wide secret scan over tracked files.
//
//   node scripts/secret-scan.mjs              scan every tracked text file
//   node scripts/secret-scan.mjs --self-test  prove the matcher itself is sound
//
// Deliberately NOT one of the canonical behavioural gates in `qa/run-all.mjs`. Those cover
// behaviour, and `qa/n8n-manifest-drift.test.mjs` already proves `n8n/production/` is
// redacted. This widens that same check to everything git tracks, so a credential cannot
// arrive through a path the workflow exports never touch. (Stated without a count on
// purpose: gates get added, and a number here would go stale the day one does.)
//
// The patterns are copied verbatim from the n8n hygiene gate rather than reinvented. A
// second, subtly different set of regexes would be worse than none: it would disagree with
// the gate and give false confidence about which one is authoritative.
//
// Scope and honesty about it:
//   * scans only files git tracks, so untracked scratch work is out of scope by design;
//   * skips genuinely binary content, detected by a NUL byte rather than by extension
//     alone — SVG is text and IS scanned;
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

// The allowlist holds WHOLE MATCHED VALUES, and exemption is exact equality against what a
// pattern actually matched — never a substring test against the line.
//
// This distinction is the fix for a real bypass. The previous implementation skipped an
// entire line when it *contained* an allowed substring, so
//
//     TEST_ONLY_TOKEN_NOT_A_REAL_SECRET  <a genuine credential>
//
// on one line would have hidden the genuine credential. Anything an allowlisted value sits
// next to is now still scanned; only the exact permitted value is forgiven.
//
// The single entry is the Telegram validator's HMAC test vector. It is deliberately spelled
// out in full, because the thing being forgiven is the complete `<digits>:<body>` token —
// which really does match the Telegram pattern, so this exemption is load-bearing, not
// decoration. Removing it would fail the scan on `gateway/telegram-initdata.test.mjs`.
// (This file exempts itself by the same exact-match rule, which is the intended behaviour.)
const ALLOWED_MATCHES = new Set([
  '123456789:TEST_ONLY_TOKEN_NOT_A_REAL_SECRET'
]);

// Types git tracks that cannot usefully be line-scanned. SVG is NOT here: it is XML text and
// can carry a pasted credential exactly like any other text file. Genuinely binary content
// is caught by the NUL check below regardless of extension.
const SKIP_EXT = /\.(png|jpe?g|webp|gif|ico|zip|pdf|woff2?|ttf|eot|mp4)$/i;

// Every match of `re` in `line` that is not an exactly-allowlisted value.
// Returns matched strings so callers can count them; no caller ever prints one.
function unallowedMatches(line, re) {
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  const out = [];
  let m;
  while ((m = rx.exec(line)) !== null) {
    // A zero-length match would spin forever; no real pattern here produces one, but the
    // guard costs nothing and a future pattern might.
    if (m[0] === '') { rx.lastIndex++; continue; }
    if (!ALLOWED_MATCHES.has(m[0])) { out.push(m[0]); }
  }
  return out;
}

// Scan one file's text. Returns [{ line, label }] — never the matched value.
function scanText(text) {
  const found = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const [label, re] of SECRET_PATTERNS) {
      if (unallowedMatches(lines[i], re).length > 0) {
        found.push({ line: i + 1, label });
      }
    }
  }
  return found;
}

// ---------------------------------------------------------------- self-test
//
// Proves the matcher, not the repository. Runs on synthetic strings only, and every
// credential-shaped fixture is BUILT at runtime by concatenation so that this source file
// contains no literal that would trip the scanner scanning itself.

function selfTest() {
  const ALLOWED = '123456789:TEST_ONLY_TOKEN_NOT_A_REAL_SECRET';
  const REAL_TG = '987654321:' + 'B'.repeat(35);
  const REAL_SK = 'sk-' + 'C'.repeat(25);
  const REAL_AIZA = 'AIza' + 'D'.repeat(35);
  const REAL_JWT = 'eyJ' + 'a'.repeat(12) + '.' + 'b'.repeat(12) + '.' + 'c'.repeat(12);
  const REAL_PK = '-----BEGIN RSA ' + 'PRIVATE KEY' + '-----';

  const cases = [
    // THE REGRESSION THIS SELF-TEST EXISTS FOR: an allowlisted fixture and a genuine
    // credential-shaped token on the SAME LINE. The old line-level skip missed the token.
    ['allowlisted fixture + real token on one line', ALLOWED + ' ' + REAL_TG, true],
    ['real token then allowlisted fixture, same line', REAL_TG + ' ' + ALLOWED, true],
    ['allowlisted fixture inside real code, real token appended',
      "const BOT_TOKEN = '" + ALLOWED + "'; // " + REAL_TG, true],

    // The exemption still works for the fixture on its own.
    ['allowlisted fixture alone', "const BOT_TOKEN = '" + ALLOWED + "';", false],
    ['allowlisted fixture bare', ALLOWED, false],

    // Exact match, not prefix/suffix: a near-miss must NOT inherit the exemption.
    // Built by concatenation, like every other fixture here: written as one literal it
    // would be a genuine credential-shaped string in this file, and the scanner would (quite
    // correctly) flag its own source.
    ['near-miss token sharing the allowlisted body', '987654321:' + 'TEST_ONLY_TOKEN_NOT_A_REAL_SECRET', true],
    ['allowlisted value with extra body appended', ALLOWED + 'XYZ', true],

    // Each pattern detects its own shape.
    ['telegram token alone', REAL_TG, true],
    ['openai key alone', REAL_SK, true],
    ['google key alone', REAL_AIZA, true],
    ['jwt alone', REAL_JWT, true],
    ['private key header alone', REAL_PK, true],

    // Two genuine tokens on one line still report.
    ['two real tokens on one line', REAL_SK + ' ' + REAL_AIZA, true],

    // Ordinary content stays quiet.
    ['plain prose', 'the measurement id G-94L9B8WZ12 is public configuration', false],
    ['env var reference, not a value', 'const key = process.env.N8N_API_KEY;', false]
  ];

  let pass = 0;
  const failures = [];
  for (const [name, line, shouldDetect] of cases) {
    const detected = scanText(line).length > 0;
    if (detected === shouldDetect) {
      pass++;
      console.log('  PASS  ' + name);
    } else {
      failures.push(name + ': expected ' + (shouldDetect ? 'DETECT' : 'no detection') +
        ', got ' + (detected ? 'DETECT' : 'no detection'));
      console.log('  FAIL  ' + name);
    }
  }

  // The allowlist must never be able to forgive anything but its own exact value.
  for (const allowed of ALLOWED_MATCHES) {
    const probe = allowed + ' ' + REAL_TG;
    if (scanText(probe).length === 0) {
      failures.push('allowlist entry swallowed a neighbouring credential');
      console.log('  FAIL  allowlist entry is not narrow enough');
    } else {
      pass++;
      console.log('  PASS  allowlist entry forgives only itself');
    }
  }

  // SVG must be scannable: the extension skip list must not exclude it.
  if (SKIP_EXT.test('favicon.svg')) {
    failures.push('SVG is in SKIP_EXT; SVG is text and must be scanned');
    console.log('  FAIL  svg is scanned, not skipped');
  } else {
    pass++;
    console.log('  PASS  svg is scanned, not skipped');
  }

  console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  self-test: ' + pass +
    ' checks passed, ' + failures.length + ' failed');
  if (failures.length) {
    failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
}

// ---------------------------------------------------------------- entry point

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
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
    for (const hit of scanText(text)) {
      findings.push({ file: rel, line: hit.line, label: hit.label });
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
}
