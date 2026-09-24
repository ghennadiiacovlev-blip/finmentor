import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function playwrightTestApi() {
  try { return await import('playwright/test'); } catch {}
  // `npx playwright test` keeps its package in the npm execution cache rather than
  // this dependency-free repository. Resolve the API beside that CLI for local QA;
  // ordinary CI installs continue to use the package import above.
  const besideCli = process.argv[1] ? join(dirname(process.argv[1]), 'test.mjs') : '';
  if (besideCli && existsSync(besideCli)) return import(pathToFileURL(besideCli).href);
  const npxCache = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'npm-cache', '_npx') : '';
  if (npxCache && existsSync(npxCache)) {
    const candidates = readdirSync(npxCache).map((entry) => join(npxCache, entry, 'node_modules', 'playwright', 'test.mjs'))
      .filter(existsSync).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (candidates[0]) return import(pathToFileURL(candidates[0]).href);
  }
  throw new Error('Playwright test API is unavailable');
}

const { test, expect } = await playwrightTestApi();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
].find((candidate) => candidate && existsSync(candidate));
const WIDTHS = [320, 375, 390, 393, 430, 768, 1024, 1280, 1440, 1728];
const HEIGHT_FOR = (width) => width <= 430 ? 844 : width <= 768 ? 1024 : 1000;
const TABLE_ROUTES = ['/capex-hurdle-rate.html', '/ro/capex-hurdle-rate.html'];
const REAL_ESTATE_FLOWS = new Map([
  ['/real-estate-control-system.html', {
    language: 'RU',
    text: 'Актив → арендатор → договор → ставка → vacancy → обеспечение → капитальные вложения → денежный поток → доходность → решение.',
  }],
  ['/ro/real-estate-control-system.html', {
    language: 'RO',
    text: 'Activ → chiriaș → contract → chirie → vacancy → garanții → investiții de capital → flux de numerar → randament → decizie.',
  }],
]);
const LAUNCHER_WIDTHS = [390, 430, 1440];
const PHOTO_ROUTES = [
  '/real-estate-control-system.html', '/ro/real-estate-control-system.html',
  '/capital-allocation-value.html', '/ro/capital-allocation-value.html',
];

let server;
let origin;

function staticServer() {
  const mime = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.avif': 'image/avif',
  };
  return createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const relative = pathname === '/' || pathname.endsWith('/')
      ? `${pathname.replace(/^\/+/, '')}index.html`
      : pathname.replace(/^\/+/, '');
    const file = normalize(join(ROOT, relative));
    if (!file.startsWith(normalize(ROOT)) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': mime[extname(file).toLowerCase()] || 'application/octet-stream' });
    response.end(readFileSync(file));
  });
}

async function settle(page) {
  await page.evaluate(async () => {
    try { await document.fonts.ready; } catch {}
    await Promise.all([...document.images].filter((image) => !image.complete).map((image) =>
      Promise.race([image.decode?.().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 2500))])));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForTimeout(1200);
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(12 * 60 * 1000);
if (CHROME) test.use({ launchOptions: { executablePath: CHROME } });

test.beforeAll(async () => {
  server = staticServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('small financial tables map every value to a visible label; complex tables remain accessible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: HEIGHT_FOR(width) });
    for (const route of TABLE_ROUTES) {
      await page.goto(new URL(route, origin).href, { waitUntil: 'load' });
      await settle(page);
      const issues = await page.evaluate((mobile) => {
        const wrapSelector = '.fin-table-wrap, .art-table-wrap, .fcf-table-wrap, .cb-table-wrap, .retail-table-wrap, .table-scroll';
        const failures = [];
        for (const [tableIndex, table] of [...document.querySelectorAll('.rd-page .rd-sheet table')].entries()) {
          const wrap = table.closest(wrapSelector);
          const headers = [...table.querySelectorAll('thead tr:first-child > th')];
          const rows = [...table.querySelectorAll('tbody > tr')];
          const columns = Math.max(headers.length, ...rows.map((row) => row.children.length));
          const small = columns > 0 && columns <= 3;
          const pseudo = wrap && getComputedStyle(wrap, '::after');
          if (pseudo && pseudo.content !== 'none' && Number(pseudo.opacity) > 0.02
            && parseFloat(pseudo.width) > 1 && pseudo.backgroundImage !== 'none') {
            failures.push({ table: tableIndex + 1, type: 'data-overlay' });
          }
          for (const [rowIndex, row] of rows.entries()) {
            for (const [cellIndex, cell] of [...row.children].entries()) {
              const range = document.createRange();
              range.selectNodeContents(cell);
              const cellRect = cell.getBoundingClientRect();
              if ([...range.getClientRects()].some((rect) => rect.width > 0.25 && rect.height > 0.25
                && (rect.left < cellRect.left - 1 || rect.right > cellRect.right + 1
                  || rect.top < cellRect.top - 1 || rect.bottom > cellRect.bottom + 1))) {
                failures.push({ table: tableIndex + 1, row: rowIndex + 1, cell: cellIndex + 1, type: 'text-outside-cell' });
              }
              if (small && mobile && cell.getAttribute('data-table-label') !== headers[cellIndex]?.textContent.trim()) {
                failures.push({ table: tableIndex + 1, row: rowIndex + 1, cell: cellIndex + 1, type: 'label-mismatch' });
              }
            }
          }
          if (small && mobile) {
            const tableRect = table.getBoundingClientRect();
            const wrapRect = wrap?.getBoundingClientRect();
            if (!table.classList.contains('financial-table--cards')
              || !wrap?.classList.contains('financial-table-wrap--cards')
              || table.scrollWidth > wrap.clientWidth + 1
              || tableRect.left < wrapRect.left - 1 || tableRect.right > wrapRect.right + 1) {
              failures.push({ table: tableIndex + 1, type: 'mobile-card-geometry' });
            }
          }
          if (!mobile && (getComputedStyle(table).display !== 'table'
            || (rows[0] && getComputedStyle(rows[0]).display !== 'table-row')
            || (rows[0]?.children[0] && getComputedStyle(rows[0].children[0]).display !== 'table-cell'))) {
            failures.push({ table: tableIndex + 1, type: 'desktop-table-changed' });
          }
          if (wrap && table.scrollWidth > wrap.clientWidth + 1
            && (wrap.tabIndex < 0 || wrap.getAttribute('role') !== 'region'
              || !(wrap.getAttribute('aria-label') || wrap.getAttribute('aria-labelledby')))) {
            failures.push({ table: tableIndex + 1, type: 'scroll-region-inaccessible' });
          }
        }
        return failures;
      }, width <= 760);
      expect(issues, `${route} at ${width}px`).toEqual([]);
    }
  }
});

test('photo heroes keep readable copy and one clean rounded sheet transition', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: HEIGHT_FOR(width) });
    for (const route of PHOTO_ROUTES) {
      await page.goto(new URL(route, origin).href, { waitUntil: 'load' });
      await settle(page);
      const contract = await page.evaluate(() => {
        const hero = document.querySelector('.rd-cover--photo');
        const sheet = hero?.nextElementSibling?.matches('.rd-sheet') ? hero.nextElementSibling : null;
        const content = hero?.querySelector('.fx-stage__content');
        const scrim = hero?.querySelector('.fx-stage__scrim');
        const firstScene = sheet?.querySelector('section.rd-scene');
        if (!hero || !sheet || !content || !scrim || !firstScene) return { missing: true };
        const heroRect = hero.getBoundingClientRect();
        const sheetRect = sheet.getBoundingClientRect();
        const ranges = [...content.querySelectorAll('.crumbs,.doc-hero__eyebrow,h1,.doc-hero__lead,.doc-hero__context')]
          .map((element) => { const range = document.createRange(); range.selectNodeContents(element); return range.getBoundingClientRect(); });
        return {
          missing: false,
          overlap: heroRect.bottom - sheetRect.top,
          radius: parseFloat(getComputedStyle(sheet).borderTopLeftRadius),
          firstSceneMargin: parseFloat(getComputedStyle(firstScene).marginTop),
          scrimFloor: parseFloat(getComputedStyle(scrim).getPropertyValue('--rd-copy-scrim-floor')),
          scrim: getComputedStyle(scrim).backgroundImage,
          textOutside: ranges.some((rect) => rect.left < heroRect.left - 1 || rect.right > heroRect.right + 1
            || rect.top < heroRect.top - 1 || rect.bottom > heroRect.bottom + 1),
          textHitsSheet: ranges.some((rect) => rect.bottom > sheetRect.top - 12),
        };
      });
      expect(contract, `${route} at ${width}px`).toMatchObject({
        missing: false, firstSceneMargin: 0, textOutside: false, textHitsSheet: false,
      });
      expect(contract.overlap, `${route} sheet overlap at ${width}px`).toBeGreaterThanOrEqual(20);
      expect(contract.overlap, `${route} sheet overlap at ${width}px`).toBeLessThanOrEqual(70);
      expect(contract.radius, `${route} sheet radius at ${width}px`).toBeGreaterThanOrEqual(20);
      expect(contract.scrimFloor, `${route} scrim floor at ${width}px`).toBeGreaterThanOrEqual(0.65);
      expect(contract.scrim, `${route} scrim background at ${width}px`).not.toBe('none');
    }
  }
});

test('real-estate flow text stays inside its content-driven frame', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: HEIGHT_FOR(width) });
    for (const [route, expected] of REAL_ESTATE_FLOWS) {
      await page.goto(new URL(route, origin).href, { waitUntil: 'load' });
      await settle(page);
      const geometry = await page.evaluate(() => {
        const frame = document.querySelector('.doc-hero__flow');
        if (!frame) return { missing: true };
        const range = document.createRange();
        range.selectNodeContents(frame);
        const frameRect = frame.getBoundingClientRect();
        const textRect = range.getBoundingClientRect();
        const style = getComputedStyle(frame);
        return {
          missing: false,
          text: frame.textContent.trim(),
          padding: {
            top: textRect.top - frameRect.top,
            right: frameRect.right - textRect.right,
            bottom: frameRect.bottom - textRect.bottom,
            left: textRect.left - frameRect.left,
          },
          lineCount: [...range.getClientRects()].filter((rect) => rect.width > 0.25 && rect.height > 0.25).length,
          frameWidth: frameRect.width,
          parentContentWidth: frame.parentElement.clientWidth
            - parseFloat(getComputedStyle(frame.parentElement).paddingLeft)
            - parseFloat(getComputedStyle(frame.parentElement).paddingRight),
          scrollOverflow: {
            x: frame.scrollWidth - frame.clientWidth,
            y: frame.scrollHeight - frame.clientHeight,
          },
          css: {
            overflow: style.overflow,
            textOverflow: style.textOverflow,
            transform: style.transform,
            whiteSpace: style.whiteSpace,
            lineHeight: parseFloat(style.lineHeight),
            fontSize: parseFloat(style.fontSize),
            radius: parseFloat(style.borderTopLeftRadius),
          },
        };
      });
      expect(geometry.missing, `${route} flow at ${width}px`).toBe(false);
      expect(geometry.text, `${route} copy at ${width}px`).toBe(expected.text);
      for (const [side, inset] of Object.entries(geometry.padding)) {
        expect(inset, `${route} ${side} text inset at ${width}px`).toBeGreaterThan(0);
      }
      expect(geometry.scrollOverflow.x, `${route} horizontal clipping at ${width}px`).toBeLessThanOrEqual(1);
      expect(geometry.scrollOverflow.y, `${route} vertical clipping at ${width}px`).toBeLessThanOrEqual(1);
      expect(geometry.css.overflow).toBe('visible');
      expect(geometry.css.textOverflow).toBe('clip');
      expect(geometry.css.transform).toBe('none');
      expect(geometry.css.whiteSpace).not.toBe('nowrap');
      expect(geometry.css.lineHeight / geometry.css.fontSize, `${route} line height at ${width}px`).toBeGreaterThanOrEqual(1.5);
      if (width <= 430) {
        expect(geometry.lineCount, `${route} mobile wrapping at ${width}px`).toBeGreaterThan(1);
        expect(Math.abs(geometry.frameWidth - geometry.parentContentWidth), `${route} mobile width at ${width}px`).toBeLessThanOrEqual(1);
        expect(geometry.css.radius, `${route} mobile radius at ${width}px`).toBeLessThanOrEqual(16);
      }
      if (process.env.CAPTURE_REAL_ESTATE_FLOW === '1' && (width === 390 || width === 1440)) {
        const cookieDeny = page.locator('[data-cookie-choice="deny"]');
        if (await cookieDeny.isVisible().catch(() => false)) {
          await cookieDeny.click();
          await page.waitForTimeout(300);
        }
        await page.locator('.rd-cover--photo').screenshot({
          path: join(ROOT, `real-estate-flow-${width}-${expected.language}-after.png`),
          animations: 'disabled',
        });
      }
      const launcherPhase = process.env.CAPTURE_ASSISTANT_LAUNCHER_PHASE;
      if (launcherPhase && [390, 430, 1440].includes(width)) {
        const cookieDeny = page.locator('[data-cookie-choice="deny"]');
        if (await cookieDeny.isVisible().catch(() => false)) {
          await cookieDeny.click();
          await page.waitForTimeout(300);
        }
        await page.locator('.rd-cover--photo').screenshot({
          path: join(ROOT, `real-estate-launcher-${width}-${expected.language}-${launcherPhase}.png`),
          animations: 'disabled',
        });
      }
    }
  }
});

test('real-estate assistant launcher stays clear of the hero and defers on mobile', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const width of LAUNCHER_WIDTHS) {
    await page.setViewportSize({ width, height: HEIGHT_FOR(width) });
    for (const [route] of REAL_ESTATE_FLOWS) {
      await page.goto(new URL(route, origin).href, { waitUntil: 'load' });
      await settle(page);
      const cookieDeny = page.locator('[data-cookie-choice="deny"]');
      if (await cookieDeny.isVisible().catch(() => false)) {
        await cookieDeny.click();
        await page.waitForTimeout(300);
      }

      const top = await page.evaluate(() => {
        const launcher = document.querySelector('.fa-launch');
        const hero = document.querySelector('.rd-cover--photo');
        const sheet = hero?.nextElementSibling?.matches('.rd-sheet') ? hero.nextElementSibling : null;
        const launcherRect = launcher?.getBoundingClientRect();
        const style = launcher ? getComputedStyle(launcher) : null;
        const intersects = (first, second, gap = 0) => first.left < second.right + gap
          && first.right > second.left - gap && first.top < second.bottom + gap
          && first.bottom > second.top - gap;
        const protectedElements = [...(hero?.querySelectorAll('.crumbs,.doc-hero__eyebrow,h1,.doc-hero__lead,.doc-hero__flow,a,button') || [])];
        return {
          missing: !launcher || !hero || !sheet,
          visible: style?.visibility !== 'hidden' && Number(style?.opacity) > 0.01 && style?.pointerEvents !== 'none',
          ariaHidden: launcher?.getAttribute('aria-hidden'),
          tabIndex: launcher?.tabIndex,
          guarded: launcher?.classList.contains('is-hero-guarded'),
          heroOverlap: protectedElements.some((element) => intersects(launcherRect, element.getBoundingClientRect(), 20)),
          sheetGap: sheet.getBoundingClientRect().top - launcherRect.bottom,
        };
      });
      expect(top.missing, `${route} launcher at ${width}px`).toBe(false);
      expect(top.guarded, `${route} guard at ${width}px`).toBe(true);
      if (width <= 640) {
        expect(top.visible, `${route} launcher before hero exit at ${width}px`).toBe(false);
        expect(top.ariaHidden, `${route} hidden semantics at ${width}px`).toBe('true');
        expect(top.tabIndex, `${route} hidden tab stop at ${width}px`).toBe(-1);
      } else {
        expect(top.visible, `${route} desktop launcher at ${width}px`).toBe(true);
        expect(top.heroOverlap, `${route} desktop hero collision at ${width}px`).toBe(false);
        expect(top.sheetGap, `${route} desktop sheet-transition gap at ${width}px`).toBeGreaterThanOrEqual(24);
      }

      if (width <= 640) {
        await page.evaluate(() => {
          const hero = document.querySelector('.rd-cover--photo');
          document.documentElement.style.scrollBehavior = 'auto';
          window.scrollTo(0, hero.getBoundingClientRect().bottom + window.scrollY + 1);
        });
        await page.waitForTimeout(200);
        const afterHero = await page.evaluate(() => {
          const launcher = document.querySelector('.fa-launch');
          const hero = document.querySelector('.rd-cover--photo');
          const style = getComputedStyle(launcher);
          return {
            visible: style.visibility !== 'hidden' && Number(style.opacity) > 0.01 && style.pointerEvents !== 'none',
            heroBottom: hero.getBoundingClientRect().bottom,
            ariaHidden: launcher.getAttribute('aria-hidden'),
            tabIndex: launcher.tabIndex,
          };
        });
        expect(afterHero.heroBottom, `${route} post-hero scroll at ${width}px`).toBeLessThanOrEqual(0);
        expect(afterHero.visible, `${route} launcher after hero at ${width}px`).toBe(true);
        expect(afterHero.ariaHidden, `${route} restored semantics at ${width}px`).toBeNull();
        expect(afterHero.tabIndex, `${route} restored tab stop at ${width}px`).toBe(0);
      }

      const launcher = page.locator('.fa-launch');
      await launcher.click();
      await expect(page.locator('#faPanel')).toBeVisible();
      await expect(launcher).toHaveAttribute('aria-expanded', 'true');
      await page.locator('.fa-panel__close').click();
      await expect(page.locator('#faPanel')).toBeHidden();
      await expect(launcher).toHaveAttribute('aria-expanded', 'false');
    }
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: HEIGHT_FOR(390) });
  for (const [route] of REAL_ESTATE_FLOWS) {
    await page.goto(new URL(route, origin).href, { waitUntil: 'load' });
    await settle(page);
    const cookieDeny = page.locator('[data-cookie-choice="deny"]');
    if (await cookieDeny.isVisible().catch(() => false)) await cookieDeny.click();
    await page.evaluate(() => {
      const hero = document.querySelector('.rd-cover--photo');
      document.documentElement.style.scrollBehavior = 'auto';
      window.scrollTo(0, hero.getBoundingClientRect().bottom + window.scrollY + 1);
    });
    await page.waitForTimeout(50);
    const reduced = await page.locator('.fa-launch').evaluate((launcher) => {
      const style = getComputedStyle(launcher);
      const durations = style.transitionDuration.split(',').map((value) => value.trim().endsWith('ms')
        ? parseFloat(value) / 1000 : parseFloat(value));
      return {
        visible: style.visibility !== 'hidden' && Number(style.opacity) > 0.01,
        maxTransitionSeconds: Math.max(...durations),
      };
    });
    expect(reduced.visible, `${route} reduced-motion visibility`).toBe(true);
    expect(reduced.maxTransitionSeconds, `${route} reduced-motion transition`).toBeLessThanOrEqual(0.01);
  }
});

test('large statement and capital labels never intersect neighboring copy', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: HEIGHT_FOR(width) });
    for (const route of ['/owner.html', '/ro/owner.html']) {
      await page.goto(new URL(route, origin).href, { waitUntil: 'load' });
      await settle(page);
      const geometry = await page.evaluate(() => {
        const section = document.querySelector('#profit-question');
        section.scrollIntoView({ block: 'center' });
        const rangeBox = (element) => { const range = document.createRange(); range.selectNodeContents(element); return range.getBoundingClientRect(); };
        const word = rangeBox(section.querySelector('.statement-screen__keyword'));
        const copy = section.querySelector('.statement-screen__copy').getBoundingClientRect();
        const right = rangeBox(section.querySelector('.capital-chain'));
        const overlap = Math.min(word.right, right.right) - Math.max(word.left, right.left) > 0.5
          && Math.min(word.bottom, right.bottom) - Math.max(word.top, right.top) > 0.5;
        const horizontalGap = right.left >= word.right - 0.5 ? right.left - word.right : null;
        return { insideCopy: word.left >= copy.left - 1 && word.right <= copy.right + 1, overlap, horizontalGap };
      });
      expect(geometry.insideCopy, `${route} word bounds at ${width}px`).toBe(true);
      expect(geometry.overlap, `${route} column overlap at ${width}px`).toBe(false);
      if (geometry.horizontalGap !== null) expect(geometry.horizontalGap).toBeGreaterThanOrEqual(24);
    }
    for (const route of ['/capital-management.html', '/ro/capital-management.html']) {
      await page.goto(new URL(route, origin).href, { waitUntil: 'load' });
      await settle(page);
      const gaps = await page.evaluate(() => [...document.querySelectorAll('.capital-states > div')].map((row) => {
        const box = (element) => { const range = document.createRange(); range.selectNodeContents(element); return range.getBoundingClientRect(); };
        const label = box(row.querySelector('dt'));
        const description = box(row.querySelector('dd'));
        const overlap = Math.min(label.right, description.right) - Math.max(label.left, description.left) > 0.5
          && Math.min(label.bottom, description.bottom) - Math.max(label.top, description.top) > 0.5;
        const gap = description.top >= label.bottom - 0.5 ? description.top - label.bottom : description.left - label.right;
        return { overlap, gap };
      }));
      expect(gaps, `${route} at ${width}px`).toHaveLength(5);
      expect(gaps.every((item) => !item.overlap && item.gap >= 6), `${route} label gaps at ${width}px`).toBe(true);
    }
  }
});
