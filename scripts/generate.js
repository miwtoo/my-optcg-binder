#!/usr/bin/env node

/**
 * generate — Generate static binder data from validated CSV inputs.
 *
 * Reads strict-validated CSV inputs plus the Vega raw snapshot directory
 * (.vega/), and emits minimized generated JSON data containing:
 *   - Card catalog metadata (from Vega snapshot)
 *   - Inventory (from collection CSV)
 *   - Deck allocations (from deck CSVs)
 *   - Physical binder locations (computed by placement engine)
 *   - Source manifest with checksums
 *
 * REQUIREMENTS:
 *   - Must be run from project root
 *   - The .vega/ raw snapshot directory MUST exist (created by `vega pull all`)
 *   - All CSV files must pass validation first
 *
 * EXIT CODES:
 *   0 = success
 *   1 = missing Vega snapshot or validation error
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateAll } from '../src/lib/validate/index.js';
import { formatErrors } from '../src/lib/validate/errors.js';
import { computeBinderPlacement, computeBinderSummary } from '../src/lib/binder/index.js';
import { CSV_PATHS, GENERATED_DATA_PATH, VEGA_SNAPSHOT_DIR, SET_COLOR_MAP } from '../src/lib/data/constants.js';

const projectRoot = resolve(import.meta.dirname, '..');

/* ─── Pre-flight: check Vega snapshot ──────────────────────── */

function checkVegaSnapshot() {
  const vegaPath = resolve(projectRoot, VEGA_SNAPSHOT_DIR);
  if (!existsSync(vegaPath)) {
    return { available: false, version: null, path: vegaPath };
  }
  const entries = readdirSync(vegaPath).filter(e => !e.startsWith('.'));
  if (entries.length === 0) {
    return { available: false, version: null, path: vegaPath };
  }
  let version = null;
  try {
    const versionFile = resolve(vegaPath, 'version.txt');
    if (existsSync(versionFile)) {
      version = readFileSync(versionFile, 'utf-8').trim();
    }
  } catch {
    // non-fatal
  }
  return { available: true, version, path: vegaPath };
}

/* ─── Build Card Catalog from Vega snapshot ────────────────── */

function buildCatalogFromSnapshot(vegaPath) {
  const catalog = new Map();

  const catalogPaths = [
    resolve(vegaPath, 'catalog.json'),
    resolve(vegaPath, 'cards.json'),
    resolve(vegaPath, 'data', 'catalog.json'),
  ];

  let catalogData = null;
  for (const cp of catalogPaths) {
    if (existsSync(cp)) {
      try {
        const raw = readFileSync(cp, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          catalogData = parsed;
          break;
        }
        for (const key of ['cards', 'data', 'catalog', 'entries']) {
          if (Array.isArray(parsed[key])) {
            catalogData = parsed[key];
            break;
          }
        }
        if (catalogData) break;
      } catch {
        // try next path
      }
    }
  }

  if (catalogData) {
    for (const entry of catalogData) {
      const code = entry.id ?? entry.code ?? entry.card_id;
      if (!code) continue;
      catalog.set(String(code), {
        code: String(code),
        name: entry.name ?? null,
        color: normalizeColor(entry.color ?? entry.colour ?? null),
        cost: entry.cost ?? entry.play_cost ?? null,
        type: normalizeType(entry.type ?? entry.card_type ?? null),
      });
    }
  }

  return catalog;
}

/** @param {string|null} v */
function normalizeColor(v) {
  if (!v) return null;
  const upper = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
  const valid = ['Red', 'Green', 'Blue', 'Purple', 'Black', 'Yellow'];
  return valid.includes(upper) ? upper : null;
}

/** @param {string|null} v */
function normalizeType(v) {
  if (!v) return null;
  const lower = v.toLowerCase();
  if (lower.includes('leader')) return 'Leader';
  if (lower.includes('character')) return 'Character';
  if (lower.includes('event')) return 'Event';
  if (lower.includes('stage')) return 'Stage';
  return null;
}

/* ─── Main ─────────────────────────────────────────────────── */

function main() {
  console.log('📦 Generating static binder data...\n');

  // 1. Validate CSVs first
  console.log('  Step 1/4: Validating source CSVs...');
  const validation = validateAll(projectRoot);
  if (!validation.valid) {
    console.error('❌ Validation failed:');
    console.error(formatErrors(validation.errors));
    process.exit(1);
  }
  console.log(`  ✔  ${validation.collection.length} collection rows, ${validation.saboDeck.length} Sabo rows, ${validation.luffyDeck.length} Luffy rows, ${validation.wanted.length} wanted entries`);

  // 2. Check Vega snapshot
  console.log('  Step 2/4: Checking Vega snapshot...');
  const snapshot = checkVegaSnapshot();

  /** @type {Map<string, import('../src/lib/data/types.js').CatalogEntry>} */
  let catalog;
  if (snapshot.available) {
    console.log(`  ✔  Vega snapshot found at ${VEGA_SNAPSHOT_DIR}/`);
    catalog = buildCatalogFromSnapshot(snapshot.path);
    if (catalog.size === 0) {
      console.error('❌ Vega snapshot exists but no catalog data could be parsed.');
      console.error(`   Checked paths in ${VEGA_SNAPSHOT_DIR}/ for catalog.json, cards.json`);
      process.exit(1);
    }
    console.log(`  ✔  Loaded ${catalog.size} catalog entries`);
  } else {
    // Per spec: fail diagnostically when no raw snapshot exists
    console.error(`❌ No Vega snapshot found at expected path: ${VEGA_SNAPSHOT_DIR}/`);
    console.error('');
    console.error('  To generate binder data, you must first create a Vega snapshot:');
    console.error('  1. Install vegapull: cargo install vegapull --version 1.2.3');
    console.error('  2. Run: vega pull all');
    console.error('  3. Select English-Asia locale');
    console.error('  4. Choose .vega/ as the output directory');
    console.error('  5. Confirm image download');
    console.error('');
    console.error('  Alternatively, use the pre-committed fixture:');
    console.error('  src/data/generated/binder-data.json');
    process.exit(1);
  }

  // 3. Compute binder placement
  console.log('  Step 3/4: Computing binder placement...');

  const collectionMap = new Map();
  for (const row of validation.collection) {
    collectionMap.set(row.code, row.amount);
  }

  const deckAllocations = new Map();
  const saboMap = new Map();
  for (const row of validation.saboDeck) {
    saboMap.set(row.code, row.amount);
  }
  deckAllocations.set('Sabo', saboMap);

  const luffyMap = new Map();
  for (const row of validation.luffyDeck) {
    luffyMap.set(row.code, row.amount);
  }
  deckAllocations.set('Luffy G_B [WIP]', luffyMap);

  const placement = computeBinderPlacement(collectionMap, deckAllocations, catalog);
  const summary = computeBinderSummary(placement.cards, placement.sheets);

  console.log(`  ✔  ${placement.cards.length} card entries`);
  console.log(`  ✔  ${placement.sheets.length / 2} sheets (${placement.sheets.length} sides)`);
  console.log(`  ✔  ${summary.totalBinderCards} cards in binder`);

  // 4. Build and write generated data
  console.log('  Step 4/4: Writing generated data...');

  const wantedEntries = validation.wanted.map(w => ({
    code: w.code,
    amount: w.amount,
    target: w.target,
  }));

  const data = {
    meta: {
      generated: new Date().toISOString(),
      generator: 'my-optcg-binder generate.js',
      generatorVersion: '0.1.0',
      catalogSource: 'Vega',
      catalogSourceVersion: snapshot.version ?? 'unknown',
      totalCards: placement.cards.length,
      totalSheets: placement.sheets.length / 2,
      dataProvenance: `Generated from Vega snapshot at ${VEGA_SNAPSHOT_DIR}/`,
    },
    catalog: [...catalog.values()].filter(e => collectionMap.has(e.code)),
    cards: placement.cards,
    sheets: placement.sheets,
    binder: summary,
    wanted: wantedEntries,
    sources: validation.sources,
    attribution: {
      copyright: 'One Piece TCG card data and images © Bandai / Toei Animation. This is an unofficial fan project for personal reference only.',
      disclaimer: 'Not affiliated with Bandai, Toei Animation, or Vega. All trademarks belong to their respective owners.',
      dataSource: 'Vega (One Piece TCG card database)',
      dataSourceUrl: 'https://vega.gg/',
      toolUsed: 'vegapull v1.2.3 (https://github.com/arashio/vegapull)',
    },
  };

  const outputPath = resolve(projectRoot, GENERATED_DATA_PATH);
  const outputDir = resolve(outputPath, '..');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
  const sizeBytes = Buffer.byteLength(JSON.stringify(data), 'utf-8');
  console.log(`  ✔  Wrote ${GENERATED_DATA_PATH} (${sizeBytes} bytes)`);
  console.log(`\n✅ Generation complete.`);
}

try {
  main();
} catch (err) {
  console.error('❌ Generation failed:', err);
  process.exit(1);
}
