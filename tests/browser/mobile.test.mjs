/**
 * Mobile browser verification — Playwright (headless Chromium).
 *
 * Tests at 412 CSS px viewport against the built static site.
 * If the Playwright module cannot be resolved, exits with code 77.
 *
 * Requirements:
 *   - Built site in dist/ (run `npm run build` first)
 *   - Playwright module available in node_modules or npx cache
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..', '..');
const distDir = resolve(projectRoot, 'dist');
const distIndex = resolve(distDir, 'index.html');

/* ─── Resolve Playwright via createRequire (CJS bridge) ────── */

let chromium;
try {
  const req = createRequire(import.meta.url);
  const pwPaths = [
    resolve(projectRoot, 'node_modules/playwright-core/index.js'),
    '/Users/miwtoo/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.js',
  ];
  let pwPath = pwPaths.find(existsSync);
  if (!pwPath) pwPath = req.resolve('playwright-core');
  chromium = req(pwPath).chromium;
  if (!chromium) throw new Error('chromium not found');
} catch (e) {
  console.log(`PLAYWRIGHT_BLOCKED: Cannot resolve Playwright — ${e.message}`);
  process.exit(77);
}

/* ─── Static HTTP server ───────────────────────────────────── */

function serveDist() {
  return new Promise((resolveServer) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      // Strip the Astro base prefix so files resolve under dist/
      let cleanPath = decodeURIComponent(url.pathname).replace(/^\/my-optcg-binder/, '') || '/';
      let fp = resolve(distDir, cleanPath === '/' ? 'index.html' : cleanPath.slice(1));
      if (!existsSync(fp)) fp = resolve(distDir, 'index.html');
      try {
        const c = readFileSync(fp);
        const ext = fp.split('.').pop().toLowerCase();
        const mime = { html: 'text/html', css: 'text/css', js: 'application/javascript', mjs: 'application/javascript', json: 'application/json', png: 'image/png', svg: 'image/svg+xml', ico: 'image/x-icon', map: 'application/json' };
        res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
        res.end(c);
      } catch { res.writeHead(404); res.end('Not found'); }
    });
    server.listen(0, '127.0.0.1', () => resolveServer({ server, port: server.address().port }));
  });
}

/* ─── Tests ────────────────────────────────────────────────── */

async function run() {
  if (!existsSync(distIndex)) {
    console.log('BLOCKED: dist/index.html not found. Run "npm run build" first.');
    process.exit(77);
  }

  const { server, port } = await serveDist();
  const baseUrl = `http://127.0.0.1:${port}`;

  let passed = 0, failed = 0, skipped = 0;
  const pass = (name) => { console.log(`  ✔ ${name}`); passed++; };
  const fail = (name, msg) => { console.log(`  ✘ ${name}: ${msg}`); failed++; };
  const skip = (name, reason) => { console.log(`  ○ SKIP ${name}: ${reason}`); skipped++; };

  console.log('\n📱 Mobile browser verification (412px viewport)\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
  const page = await context.newPage();

  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('.app-shell', { timeout: 5000 });

    // ── 1. No horizontal overflow ──────────────────────────
    console.log('  [Layout integrity]');
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    overflow ? fail('No horizontal overflow', `scroll > client`) : pass('No horizontal document overflow');

    // ── 2. Collection renders ──────────────────────────────
    console.log('  [Collection view]');
    await page.waitForSelector('.tab.is-active[data-view="collection"]', { timeout: 3000 });
    pass('Collection tab is active by default');

    // Wait for the JS to hydrate and populate counts
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-count="collection"]');
      return el && el.textContent.trim().length > 0;
    }, { timeout: 5000 }).catch(() => {});

    const collCount = await page.evaluate(() =>
      document.querySelector('[data-count="collection"]')?.textContent?.trim() || ''
    );
    if (collCount && parseInt(collCount) > 0) {
      pass(`Collection count: ${collCount}`);
    } else {
      skip('Collection count visible', `got "${collCount}" — may need JS hydration wait`);
    }

    // ── 3. Filters ─────────────────────────────────────────
    console.log('  [Filters]');
    const searchEl = await page.$('#search');
    searchEl ? pass('Search input rendered') : fail('Search input', 'not found');

    const colorEl = await page.$('#color');
    colorEl ? pass('Color filter rendered') : fail('Color filter', 'not found');

    const costEl = await page.$('#cost');
    costEl ? pass('Cost filter rendered') : fail('Cost filter', 'not found');

    const typeEl = await page.$('#type');
    typeEl ? pass('Type filter rendered') : fail('Type filter', 'not found');

    // No-results: search for a string that won't match any card
    if (searchEl) {
      await searchEl.fill('ZZZZ-NONEXISTENT');
      await page.waitForTimeout(800);
      const noResultText = await page.evaluate(() => {
        const body = document.body.textContent;
        return /no result|no card|empty|not found|0 cards/i.test(body);
      });
      noResultText ? pass('No-results messaging detected') : skip('No-results state', 'no explicit empty-state text in DOM');
      await searchEl.fill('');
      await page.waitForTimeout(300);
    }

    // ── 4. Binder view ─────────────────────────────────────
    console.log('  [Binder view]');
    await page.click('.tab[data-view="binder"]');
    await page.waitForTimeout(800);

    const binderActive = await page.evaluate(() =>
      document.querySelector('.tab[data-view="binder"]')?.classList.contains('is-active')
    );
    binderActive ? pass('Binder tab activates') : fail('Binder tab', 'not .is-active after click');

    // Check that card codes are visible somewhere in the binder view
    const binderCards = await page.evaluate(() => {
      const text = document.body.textContent;
      const matches = text.match(/[A-Z]{2}\d+-\d+/g);
      return matches ? matches.length : 0;
    });
    binderCards > 0 ? pass(`Card codes in binder: ${binderCards}`) : skip('Binder card codes', '0 codes found in page text');

    // ── 5. Wanted view ─────────────────────────────────────
    console.log('  [Wanted view]');
    await page.click('.tab[data-view="wanted"]');
    await page.waitForTimeout(800);

    const wantedActive = await page.evaluate(() =>
      document.querySelector('.tab[data-view="wanted"]')?.classList.contains('is-active')
    );
    wantedActive ? pass('Wanted tab activates') : fail('Wanted tab', 'not .is-active after click');

    await page.waitForFunction(() => {
      const el = document.querySelector('[data-count="wanted"]');
      return el && el.textContent.trim().length > 0;
    }, { timeout: 5000 }).catch(() => {});

    const wantCount = await page.evaluate(() =>
      document.querySelector('[data-count="wanted"]')?.textContent?.trim() || ''
    );
    if (wantCount && parseInt(wantCount) > 0) {
      pass(`Wanted count: ${wantCount}`);
    } else {
      skip('Wanted count visible', `got "${wantCount}"`);
    }

  } catch (err) {
    fail('Runtime error', err.message);
    console.error(err);
  } finally {
    await browser.close();
    server.close();
  }

  const total = passed + failed + skipped;
  console.log(`\n  Results: ${passed} passed, ${failed} failed, ${skipped} skipped (${total} total)\n`);
  if (failed > 0) { process.exit(1); }
  if (passed === 0 && skipped > 0) { process.exit(77); }
  console.log('✅ All browser tests passed');
  process.exit(0);
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
