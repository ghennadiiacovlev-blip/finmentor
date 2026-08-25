// Applies ro/runtime-strings.ro.json to the Romanian pages' inline scripts.
//
// Replaces only string LITERALS inside inline <script> blocks, so text outside script blocks is
// never touched. Line endings are preserved. Idempotent: a translated file reports 0 replacements
// and exits cleanly, because every mapping key is then absent.
//
//   node scripts/apply-ro-translations.mjs            dry run
//   node scripts/apply-ro-translations.mjs --apply    write
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const map = JSON.parse(readFileSync(join(ROOT, 'ro', 'runtime-strings.ro.json'), 'utf8'));
const apply = process.argv.includes('--apply');

const SCRIPT_RE = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
const LITERAL_RE = /(['"])((?:(?!\1)[^\\]|\\.)*)\1/g;
const CYRILLIC = /[Ѐ-ӿ]/;

let totalReplaced = 0;
let anyCyrillicLeft = 0;

for (const [file, table] of Object.entries(map)) {
  if (file.startsWith('_')) continue;

  const path = join(ROOT, file);
  const raw = readFileSync(path, 'utf8');
  const crlf = raw.includes('\r\n');
  let s = crlf ? raw.split('\r\n').join('\n') : raw;

  // GUARD: a literal that also appears as an HTML value="..." attribute in this page is
  // canonical data, not display text. setRadioByValue / setCheckboxByValue look those up by
  // exact value, so translating one silently breaks deep-link prefill, and the same strings
  // are written to the CRM — translating them would split RU and RO into two taxonomies.
  const htmlValues = new Set();
  for (const m of s.match(/value="[^"]*"/g) || []) htmlValues.add(m.slice(7, -1));

  const blocked = Object.keys(table).filter((k) => htmlValues.has(k));
  if (blocked.length) {
    console.error(`${file}: ${blocked.length} mapping(s) target an HTML value attribute and must not be translated:`);
    for (const b of blocked.slice(0, 10)) console.error(`    ${b}`);
    process.exit(1);
  }

  let replaced = 0;
  s = s.replace(SCRIPT_RE, (whole, body) => {
    const patched = body.replace(LITERAL_RE, (lit, quote, inner) => {
      if (!Object.prototype.hasOwnProperty.call(table, inner)) return lit;
      replaced++;
      const value = table[inner];
      const escaped = value.split('\\').join('\\\\').split(quote).join('\\' + quote);
      return quote + escaped + quote;
    });
    return whole.replace(body, patched);
  });

  // Remaining Cyrillic is only acceptable when it is canonical taxonomy: a value the page
  // also carries in an HTML value attribute, or one of the documented data literals.
  const CANONICAL_DATA = new Set(['да', 'нет', 'Дебиторская', 'Кредиторская']);
  const left = [];
  for (const block of s.match(SCRIPT_RE) || []) {
    for (const lit of block.match(LITERAL_RE) || []) {
      if (!CYRILLIC.test(lit)) continue;
      const inner = lit.slice(1, -1);
      if (htmlValues.has(inner) || CANONICAL_DATA.has(inner)) continue;
      left.push(lit.slice(0, 60));
    }
  }

  console.log(`${file}: ${replaced} replaced, ${left.length} untranslated display literal(s)`);
  for (const c of left.slice(0, 6)) console.log(`    left: ${c}`);

  totalReplaced += replaced;
  anyCyrillicLeft += left.length;
  if (apply) writeFileSync(path, crlf ? s.split('\n').join('\r\n') : s);
}

console.log(`\n${totalReplaced} replacement(s)${apply ? ' written' : ' (dry run)'}`);
if (anyCyrillicLeft > 0) {
  console.error(`${anyCyrillicLeft} untranslated display literal(s) - extend ro/runtime-strings.ro.json`);
  process.exit(1);
}
