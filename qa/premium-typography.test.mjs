#!/usr/bin/env node
// FINMENTOR — deterministic source contract for the final premium typography pass.
// Runtime geometry (overflow, clipping, wrapping and visible adjacency) is covered by
// qa/visual-evidence.mjs; this gate prevents the structural causes from returning.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const css = read('style.css');
const ru = read('index.html');
const ro = read('ro/index.html');
const qru = read('questionnaire.html');
const qro = read('ro/questionnaire.html');

let pass = 0;
const failures = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
function check(name, fn) {
  try { fn(); pass++; console.log('PASS ' + name); }
  catch (error) { failures.push(name + ': ' + error.message); console.log('FAIL ' + name + ' — ' + error.message); }
}

const section = (html, start, end) => {
  const a = html.indexOf(start);
  const b = html.indexOf(end, a + start.length);
  assert(a !== -1 && b !== -1, 'section markers missing: ' + start + ' / ' + end);
  return html.slice(a, b);
};

const luminance = (hex) => {
  const rgb = hex.replace('#', '').match(/.{2}/g).map((x) => parseInt(x, 16) / 255)
    .map((x) => x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
};
const contrast = (a, b) => {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

function formMachineSignature(html) {
  const form = html.match(/<form\b[\s\S]*?<\/form>/i);
  assert(form, 'questionnaire form missing');
  const tags = [...form[0].matchAll(/<(?:form|input|select|textarea|button)\b[^>]*>/gi)]
    .map((m) => m[0].replace(/\s+/g, ' ').trim());
  return {
    count: tags.length,
    hash: createHash('sha256').update(tags.join('\n')).digest('hex')
  };
}

check('asset-logic blocks retain their cross-industry explanation without a retail CTA', () => {
  for (const [file, html] of [['index.html', ru], ['ro/index.html', ro]]) {
    const block = section(html, '<div class="industries__asset-callout', '<div class="industries__final');
    assert(!/<a\b|\bbtn\b|retail-margin-engine/i.test(block), file + ' still carries a product CTA');
  }
});

check('asset-logic headings remain present in both languages', () => {
  assert(ru.includes('Одна финансовая логика — разные активы'), 'RU asset heading missing');
  assert(ro.includes('O singură logică financiară — active diferite'), 'RO asset heading missing');
});

check('offer cards use advisory duration labels, never administrative Termen', () => {
  assert((ru.match(/Ориентировочный срок/g) || []).length >= 2, 'RU duration labels missing');
  assert((ro.match(/Durată orientativă/g) || []).length >= 2, 'RO duration labels missing');
  assert(!/package__term"><span>Termen</.test(ro), 'RO package still says Termen');
  assert(!/>Граница<|>Limită</.test(ru + ro), 'defensive package boundary label returned');
});

check('Health Check and Business Control detail pages share the duration language', () => {
  for (const file of ['financial-health-check.html', 'business-control-system.html']) {
    assert(read(file).includes('Ориентировочный срок и стоимость'), file + ' RU heading mismatch');
  }
  for (const file of ['ro/financial-health-check.html', 'ro/business-control-system.html']) {
    assert(read(file).includes('Durată orientativă și cost'), file + ' RO heading mismatch');
  }
});

check('duration metadata is a vertical label/value component', () => {
  assert(/\.package__term\s*\{[^}]*display:\s*grid[^}]*gap:/s.test(css), 'duration container is not a grid');
  assert(/\.package__term span\s*\{[^}]*display:\s*block/s.test(css), 'duration label is not a block');
  assert(/\.package__term strong\s*\{[^}]*display:\s*block/s.test(css), 'duration value is not a block');
});

check('dark-surface micro-gold meets readable text contrast', () => {
  const token = [...css.matchAll(/--micro-label-gold:\s*(#[0-9A-Fa-f]{6})/g)][0]?.[1];
  assert(token, 'dark micro-gold token missing');
  assert(contrast(token, '#08111F') >= 4.5, 'dark contrast is ' + contrast(token, '#08111F').toFixed(2));
});

check('light-surface bronze meets readable text contrast', () => {
  const tokens = [...css.matchAll(/--micro-label-gold:\s*(#[0-9A-Fa-f]{6})/g)].map((m) => m[1]);
  assert(tokens.length >= 2, 'light micro-gold override missing');
  assert(contrast(tokens[1], '#F2EFE7') >= 4.5, 'light contrast is ' + contrast(tokens[1], '#F2EFE7').toFixed(2));
});

check('AI implementation uses a readable two-by-two layout with separated text', () => {
  assert(/\.ai-path\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s.test(css), 'AI path is not 2×2');
  assert(/\.ai-path__step strong,[\s\S]*?\{[^}]*display:\s*block/s.test(css), 'AI title is not block-level');
  assert(/\.ai-path__step span\s*\{[^}]*word-break:\s*normal[^}]*overflow-wrap:\s*normal/s.test(css), 'AI description wrapping is unsafe');
});

check('AI implementation microcopy is idiomatic in RU and RO', () => {
  const airu = read('ai-agent-economics.html');
  const airo = read('ro/ai-agent-economics.html');
  assert(airu.includes('Ежемесячный разбор ИИ-экономики'), 'RU monthly title missing');
  assert(airo.includes('Analiza lunară a economiei IA'), 'RO monthly title missing');
  assert(!airu.includes('risks and МАСШТАБИРОВАТЬ'), 'RU mixed-language collision returned');
  assert(!airo.includes('risks and EXTINDERE'), 'RO mixed-language collision returned');
});

check('known adjacent title/description components declare structural separation', () => {
  const sources = [css, read('retail-margin-engine.html'), read('ro/retail-margin-engine.html'),
    read('client-base-control-system.html'), read('ro/client-base-control-system.html')].join('\n');
  for (const selector of ['retail-feature strong', 'retail-action strong',
    'retail-path__step strong', 'cb-factor b']) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/, '\\s+');
    assert(new RegExp('\\.' + escaped + '\\s*\\{[^}]*display\\s*:\\s*block', 's').test(sources), selector + ' lacks display:block');
  }
});

check('normal prose and public buttons do not use character-level breaking', () => {
  const publicCss = [css, qru.match(/<style>[\s\S]*?<\/style>/)?.[0] || '', qro.match(/<style>[\s\S]*?<\/style>/)?.[0] || ''].join('\n');
  assert(!/word-break\s*:\s*break-all/i.test(publicCss), 'break-all found');
  assert(/\.btn\s*\{[^}]*word-break:\s*normal[^}]*overflow-wrap:\s*normal/s.test(css), 'button wrapping override missing');
});

check('working contour remains an editorial statement in both languages', () => {
  for (const [file, html, title, accent] of [
    ['index.html', ru, 'Совместный рабочий контур', 'От решения — к исполнению.'],
    ['ro/index.html', ro, 'Circuit comun de lucru', 'De la decizie la execuție.']
  ]) {
    const block = section(html, '<article class="working-contour', '</article>');
    assert(block.includes(title) && block.includes(accent), file + ' wording missing');
    assert(!/<a\b|<button\b|<svg\b/i.test(block), file + ' working contour became promotional');
  }
});

check('Financial X-Ray hero and final action read as professional CFO intake', () => {
  assert(qru.includes('Структурированная финансовая оценка'), 'RU assessment framing missing');
  assert(qru.includes('Передать на финансовую оценку'), 'RU final action missing');
  assert(qro.includes('evaluare financiară structurată'), 'RO assessment framing missing');
  assert(qro.includes('Trimiteți pentru evaluare financiară'), 'RO final action missing');
});

check('Financial X-Ray field states cover hover, focus, selected, error and disabled', () => {
  for (const [file, html] of [['questionnaire.html', qru], ['ro/questionnaire.html', qro]]) {
    for (const state of [':hover', ':focus', ':has(input:checked)', '.is-error', ':disabled']) {
      assert(html.includes(state), file + ' missing ' + state);
    }
  }
});

check('Financial X-Ray machine-control signatures are unchanged from approved HEAD', () => {
  const expected = {
    ru: ['dfef750eb765e6eb391594a6365b8cfa36cfa9e1704ed0085d9009c155aadcc3', 409],
    ro: ['9c01529ea43e1c82b5fe4ac3ad7c5388cf2c6ce82d822ed039897e2391fe98e4', 409]
  };
  for (const [key, html] of [['ru', qru], ['ro', qro]]) {
    const got = formMachineSignature(html);
    assert(got.count === expected[key][1], key + ' control count changed to ' + got.count);
    assert(got.hash === expected[key][0], key + ' machine attributes changed: ' + got.hash);
  }
});

check('visual QA explicitly covers 320, 390, 768, 1024 and 1440', () => {
  const visual = read('qa/visual-evidence.mjs');
  assert(visual.includes('const RESPONSIVE_WIDTHS = [320, 390, 768, 1024, 1440]'), 'responsive matrix incomplete');
  assert(visual.includes('CRITICAL INLINE ADJACENCY = 0'), 'visible adjacency gate missing');
  assert(visual.includes('CTA WRAPPING = PASS'), 'button wrapping gate missing');
});

check('reduced-motion users receive no hover displacement', () => {
  const block = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  assert(block.includes('.package--flagship:hover') && block.includes('transform: none !important'), 'reduced-motion hover override missing');
});

console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) process.exit(1);
