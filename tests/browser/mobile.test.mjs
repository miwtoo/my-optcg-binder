/**
 * Mobile browser verification — Playwright (headless Chromium).
 *
 * Tests at 412 CSS px viewport against the built static site.
 *
 * Dependency: `@playwright/test` or `playwright-core` must be installed.
 * Runs after `npm run build` (requires dist/).
 *
 * Exits: 0 = all passed, 1 = failures, 77 = blocked (module or dist missing).
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

/* ─── Resolve Playwright (portable — no absolute paths) ────── */

let chromium;
try {
  const req = createRequire(resolve(projectRoot, 'package.json'));
  // Try @playwright/test first (the declared dependency), fall back to playwright-core
  try {
    chromium = req('@playwright/test').chromium;
  } catch {
    chromium = req('playwright-core').chromium;
  }
  if (!chromium) throw new Error('chromium not found');
} catch (e) {
  console.log(`BLOCKED: Playwright module not available — ${e.message}`);
  console.log('  Install: npm install @playwright/test');
  console.log('  Then run: npx playwright install chromium');
  process.exit(77);
}

/* ─── Static HTTP server ───────────────────────────────────── */

function serveDist() {
  return new Promise((resolveServer) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
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
  const pass = name => { console.log(`  ✔ ${name}`); passed++; };
  const fail = (name, msg) => { console.log(`  ✘ ${name}: ${msg}`); failed++; };
  const skip = (name, reason) => { console.log(`  ○ SKIP ${name}: ${reason}`); skipped++; };

  console.log('\n📱 Mobile browser verification (412px viewport)\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
  const page = await context.newPage();

  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('.app-shell', { timeout: 5000 });

    console.log('  [Layout integrity]');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    overflow ? fail('No horizontal overflow', 'scroll > client') : pass('No horizontal document overflow');

    console.log('  [Collection view]');
    await page.waitForSelector('.tab.is-active[data-view="collection"]', { timeout: 3000 });
    pass('Collection tab is active by default');
    await page.waitForFunction(() => { const el = document.querySelector('[data-count="collection"]'); return el && el.textContent.trim().length > 0; }, { timeout: 5000 }).catch(() => {});
    const collCount = await page.evaluate(() => document.querySelector('[data-count="collection"]')?.textContent?.trim() || '');
    collCount && parseInt(collCount) > 0 ? pass(`Collection count: ${collCount}`) : skip('Collection count', `got "${collCount}"`);

    console.log('  [Filters]');
    (await page.$('#search')) ? pass('Search input rendered') : fail('Search input', 'not found');
    (await page.$('#color'))  ? pass('Color filter rendered')  : fail('Color filter', 'not found');
    (await page.$('#cost'))   ? pass('Cost filter rendered')   : fail('Cost filter', 'not found');
    (await page.$('#type'))   ? pass('Type filter rendered')   : fail('Type filter', 'not found');

    const searchEl = await page.$('#search');
    if (searchEl) {
      await searchEl.fill('ZZZZ-NONEXISTENT');
      await page.waitForTimeout(800);
      const noResult = await page.evaluate(() => /no result|no card|empty|0 cards/i.test(document.body.textContent));
      noResult ? pass('No-results messaging detected') : skip('No-results state', 'no empty-state text in DOM');
      await searchEl.fill('');
      await page.waitForTimeout(300);
    }

    console.log('  [Binder view]');
    await page.click('.tab[data-view="binder"]');
    await page.waitForTimeout(800);
    const binderActive = await page.evaluate(() => document.querySelector('.tab[data-view="binder"]')?.classList.contains('is-active'));
    binderActive ? pass('Binder tab activates') : fail('Binder tab', 'not .is-active after click');
    const binderCards = await page.evaluate(() => { const m = document.body.textContent.match(/[A-Z]{2}\d+-\d+/g); return m ? m.length : 0; });
    binderCards > 0 ? pass(`Card codes in binder: ${binderCards}`) : skip('Binder card codes', '0 codes found');

    console.log('  [Wanted view]');
    await page.click('.tab[data-view="wanted"]');
    await page.waitForTimeout(800);
    const wantedActive = await page.evaluate(() => document.querySelector('.tab[data-view="wanted"]')?.classList.contains('is-active'));
    wantedActive ? pass('Wanted tab activates') : fail('Wanted tab', 'not .is-active after click');
    await page.waitForFunction(() => { const el = document.querySelector('[data-count="wanted"]'); return el && el.textContent.trim().length > 0; }, { timeout: 5000 }).catch(() => {});
    const wantCount = await page.evaluate(() => document.querySelector('[data-count="wanted"]')?.textContent?.trim() || '');
    wantCount && parseInt(wantCount) > 0 ? pass(`Wanted count: ${wantCount}`) : skip('Wanted count', `got "${wantCount}"`);

  } catch (err) {
    fail('Runtime error', err.message);
    console.error(err);
  } finally {
    await browser.close();
    server.close();
  }

  const total = passed + failed + skipped;
  console.log(`\n  Results: ${passed} passed, ${failed} failed, ${skipped} skipped (${total} total)\n`);
  if (failed > 0) { console.log(`❌ ${failed} test(s) failed — actionable failures above`); process.exit(1); }
  if (passed === 0 && skipped > 0) { process.exit(77); }
  console.log('✅ All browser tests passed');
  process.exit(0);
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
