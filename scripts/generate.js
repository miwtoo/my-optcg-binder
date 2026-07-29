#!/usr/bin/env node

/**
 * generate — Generate static binder data from validated CSV inputs.
 *
 * Reads strict-validated CSV inputs plus the Vega raw snapshot directory
 * (.vega/), and emits minimized generated JSON data containing:
 *   - Card catalog metadata (from Vega snapshot — exact card codes)
 *   - Inventory (from collection CSV)
 *   - Deck allocations (from deck CSVs)
 *   - Physical binder locations (computed by placement engine)
 *   - Source manifest with checksums
 *   - Card images copied into tracked public assets
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

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { validateAll } from '../src/lib/validate/index.js';
import { formatErrors } from '../src/lib/validate/errors.js';
import { computeBinderPlacement, computeBinderSummary } from '../src/lib/binder/index.js';
import { CSV_PATHS, GENERATED_DATA_PATH, VEGA_SNAPSHOT_DIR } from '../src/lib/data/constants.js';

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
  const metaPath = resolve(vegaPath, 'vega.meta.toml');
  if (existsSync(metaPath)) {
    try {
      const meta = readFileSync(metaPath, 'utf-8');
      const langMatch = meta.match(/^language\s*=\s*"([^"]+)"/m);
      const startMatch = meta.match(/^pull_start\s*=\s*"([^"]+)"/m);
      const durMatch = meta.match(/^pull_duration_ms\s*=\s*(\d+)/m);
      if (langMatch && startMatch) {
        version = `vegapull v1.2.3 (${langMatch[1]}, pulled ${startMatch[1]}, ${durMatch ? durMatch[1] : '?'}ms)`;
      }
    } catch {
      // non-fatal
    }
  }

  // Also check for version.txt as fallback
  if (!version) {
    const versionFile = resolve(vegaPath, 'version.txt');
    if (existsSync(versionFile)) {
      version = readFileSync(versionFile, 'utf-8').trim();
    }
  }

  return { available: true, version, path: vegaPath };
}

/* ─── Build Card Catalog from Vega snapshot ────────────────── */

/**
 * Strip the _pN (parallel art) or _rN (reprint) suffix from a card ID
 * to get the canonical base card code.
 * @param {string} id
 */
function toBaseCode(id) {
  return id.replace(/_(p\d+|r\d+)$/, '');
}

/**
 * Normalize a color string from Vega data to the canonical CardColor.
 * @param {string|null} v
 */
function normalizeColor(v) {
  if (!v) return null;
  const upper = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
  const valid = ['Red', 'Green', 'Blue', 'Purple', 'Black', 'Yellow'];
  return valid.includes(upper) ? upper : null;
}

/**
 * Normalize a category string from Vega data to the canonical CardType.
 * @param {string|null} v
 */
function normalizeType(v) {
  if (!v) return null;
  const lower = v.toLowerCase();
  if (lower.includes('leader')) return 'Leader';
  if (lower.includes('character')) return 'Character';
  if (lower.includes('event')) return 'Event';
  if (lower.includes('stage')) return 'Stage';
  return null;
}

/**
 * Read and parse a JSON file, returning null on error.
 * @param {string} filePath
 */
function readJsonFile(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Build the canonical card catalog from the Vega snapshot.
 *
 * Scans all cards_*.json files in .vega/json/, reads packs.json for
 * set metadata, and builds a Map of base card codes to CatalogEntry.
 *
 * For cards with parallel art (_pN) or reprint (_rN) variants, the
 * first encountered base code entry provides the canonical metadata.
 *
 * @param {string} vegaPath - absolute path to .vega/
 * @returns {{ catalog: Map<string, object>, imageAvailability: Map<string, string[]>, packCount: number, cardCount: number }}
 */
function buildCatalogFromSnapshot(vegaPath) {
  const catalog = new Map();
  const imageAvailability = new Map(); // code -> array of available image filenames
  const jsonDir = resolve(vegaPath, 'json');
  const imagesDir = resolve(vegaPath, 'images');

  // 1. Read packs.json for set metadata
  const packsPath = resolve(jsonDir, 'packs.json');
  const packsData = readJsonFile(packsPath);
  const packCount = packsData ? Object.keys(packsData).length : 0;

  // 2. Read all cards_*.json files
  const cardFiles = [];
  if (existsSync(jsonDir)) {
    const entries = readdirSync(jsonDir);
    for (const entry of entries) {
      if (/^cards_\d+\.json$/.test(entry)) {
        cardFiles.push(resolve(jsonDir, entry));
      }
    }
  }
  cardFiles.sort();

  let cardCount = 0;
  const seenBaseCodes = new Set();

  for (const filePath of cardFiles) {
    const cards = readJsonFile(filePath);
    if (!Array.isArray(cards)) continue;

    for (const card of cards) {
      cardCount++;
      const baseCode = toBaseCode(card.id);

      // Only use the first encountered entry for each base code
      if (seenBaseCodes.has(baseCode)) continue;
      seenBaseCodes.add(baseCode);

      // Extract metadata from actual card JSON
      const colors = Array.isArray(card.colors) ? card.colors : [];
      const color = colors.length > 0 ? normalizeColor(colors[0]) : null;

      catalog.set(baseCode, {
        code: baseCode,
        name: card.name ?? null,
        color: color,
        cost: typeof card.cost === 'number' ? card.cost : null,
        type: normalizeType(card.category ?? card.card_type ?? null),
      });

      // Track image availability for this base code
      const availableImages = [];
      const baseImg = `${baseCode}.png`;
      if (existsSync(resolve(imagesDir, baseImg))) {
        availableImages.push(baseImg);
      }
      // Also check for variant images
      for (let i = 1; i <= 20; i++) {
        const pImg = `${baseCode}_p${i}.png`;
        if (existsSync(resolve(imagesDir, pImg))) {
          availableImages.push(pImg);
        }
        const rImg = `${baseCode}_r${i}.png`;
        if (existsSync(resolve(imagesDir, rImg))) {
          availableImages.push(rImg);
        }
      }
      imageAvailability.set(baseCode, availableImages);
    }
  }

  return { catalog, imageAvailability, packCount, cardCount };
}

/**
 * Select the best image filename for a card code.
 * Preference: base image (no suffix) > first _p1 > first _r1.
 * @param {string} code
 * @param {Map<string, string[]>} imageAvailability
 * @returns {string|null}
 */
function selectBestImage(code, imageAvailability) {
  const available = imageAvailability.get(code);
  if (!available || available.length === 0) return null;

  // Prefer base image (no suffix)
  const base = available.find(img => !img.includes('_p') && !img.includes('_r'));
  if (base) return base;

  // Prefer first parallel art (_p1, _p2, ...)
  const pImg = available.find(img => img.includes('_p'));
  if (pImg) return pImg;

  // Fall back to first reprint (_r1, _r2, ...)
  const rImg = available.find(img => img.includes('_r'));
  if (rImg) return rImg;

  return available[0];
}

/**
 * Copy card images for all owned/wanted codes into tracked public assets.
 * @param {string} vegaPath
 * @param {Map<string, string[]>} imageAvailability
 * @param {Set<string>} codesToCopy
 * @returns {{ copied: number, skipped: number, manifest: Record<string, string> }}
 */
function copyCardImages(vegaPath, imageAvailability, codesToCopy) {
  const imagesDir = resolve(vegaPath, 'images');
  const outputDir = resolve(projectRoot, 'public', 'data', 'card-images');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  let copied = 0;
  let skipped = 0;
  /** @type {Record<string, string>} */
  const manifest = {};

  for (const code of codesToCopy) {
    const bestImage = selectBestImage(code, imageAvailability);
    if (!bestImage) {
      skipped++;
      continue;
    }

    const srcPath = resolve(imagesDir, bestImage);
    const destPath = resolve(outputDir, `${code}.png`);

    if (existsSync(srcPath)) {
      copyFileSync(srcPath, destPath);
      copied++;
      manifest[code] = `data/card-images/${code}.png`;
    } else {
      skipped++;
    }
  }

  return { copied, skipped, manifest };
}

/**
 * Compute SHA-256 checksum of a file.
 * @param {string} filePath
 */
function computeFileChecksum(filePath) {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/* ─── Main ─────────────────────────────────────────────────── */

function main() {
  console.log('📦 Generating static binder data...\n');

  // 1. Validate CSVs first
  console.log('  Step 1/5: Validating source CSVs...');
  const validation = validateAll(projectRoot);
  if (!validation.valid) {
    console.error('❌ Validation failed:');
    console.error(formatErrors(validation.errors));
    process.exit(1);
  }
  console.log(`  ✔  ${validation.collection.length} collection rows, ${validation.saboDeck.length} Sabo rows, ${validation.luffyDeck.length} Luffy rows, ${validation.wanted.length} wanted entries`);

  // 2. Check Vega snapshot
  console.log('  Step 2/5: Checking Vega snapshot...');
  const snapshot = checkVegaSnapshot();

  if (!snapshot.available) {
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
  console.log(`  ✔  Vega snapshot found at ${VEGA_SNAPSHOT_DIR}/`);

  // 3. Build catalog from Vega snapshot (NO heuristic fallback)
  console.log('  Step 3/5: Building catalog from Vega snapshot...');
  const { catalog, imageAvailability, packCount, cardCount } = buildCatalogFromSnapshot(snapshot.path);
  if (catalog.size === 0) {
    console.error('❌ Vega snapshot exists but no catalog data could be parsed.');
    console.error(`   Checked .vega/json/ for cards_*.json and packs.json`);
    process.exit(1);
  }
  console.log(`  ✔  Loaded ${catalog.size} unique card codes from ${cardCount} total card entries across ${packCount} packs`);

  // 4. Copy card images for owned/wanted codes
  console.log('  Step 4/5: Copying card images to tracked public assets...');

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

  // Collect all codes that need images (owned + wanted). Deck-only cards are
  // intentionally excluded: the asset lane is scoped to the owned/wanted
  // inventory represented by the public binder catalog.
  const codesToCopy = new Set();
  for (const code of collectionMap.keys()) codesToCopy.add(code);
  for (const w of validation.wanted) codesToCopy.add(w.code);

  const imageResult = copyCardImages(snapshot.path, imageAvailability, codesToCopy);
  console.log(`  ✔  Copied ${imageResult.copied} card images, ${imageResult.skipped} skipped (no image found)`);

  // 5. Compute binder placement + write generated data
  console.log('  Step 5/5: Computing binder placement and writing data...');

  const placement = computeBinderPlacement(collectionMap, deckAllocations, catalog);
  const summary = computeBinderSummary(placement.cards, placement.sheets);

  console.log(`  ✔  ${placement.cards.length} card entries`);
  console.log(`  ✔  ${placement.sheets.length / 2} sheets (${placement.sheets.length} sides)`);
  console.log(`  ✔  ${summary.totalBinderCards} cards in binder`);

  // Build wanted entries
  const wantedEntries = validation.wanted.map(w => ({
    code: w.code,
    amount: w.amount,
    target: w.target,
  }));

  // Build source manifest with checksums (CSVs + Vega JSON files)
  const sourcesFiles = { ...validation.sources.files };

  // Add Vega snapshot file checksums
  const jsonDir = resolve(snapshot.path, 'json');
  if (existsSync(jsonDir)) {
    const jsonEntries = readdirSync(jsonDir).filter(e => /^cards_\d+\.json$/.test(e));
    let totalJsonCards = 0;
    for (const jsonFile of jsonEntries) {
      const jsonPath = resolve(jsonDir, jsonFile);
      const checksum = computeFileChecksum(jsonPath);
      if (checksum) {
        // Count cards in this file for rowCount
        const data = readJsonFile(jsonPath);
        const rowCount = Array.isArray(data) ? data.length : 0;
        totalJsonCards += rowCount;
        sourcesFiles[`${VEGA_SNAPSHOT_DIR}/json/${jsonFile}`] = { checksum, rowCount };
      }
    }

    // packs.json
    const packsPath = resolve(jsonDir, 'packs.json');
    const packsChecksum = computeFileChecksum(packsPath);
    if (packsChecksum) {
      const packsData = readJsonFile(packsPath);
      const rowCount = packsData ? Object.keys(packsData).length : 0;
      sourcesFiles[`${VEGA_SNAPSHOT_DIR}/json/packs.json`] = { checksum: packsChecksum, rowCount };
    }

    // vega.meta.toml
    const metaPath = resolve(snapshot.path, 'vega.meta.toml');
    const metaChecksum = computeFileChecksum(metaPath);
    if (metaChecksum) {
      sourcesFiles[`${VEGA_SNAPSHOT_DIR}/vega.meta.toml`] = { checksum: metaChecksum, rowCount: 0 };
    }
  }

  const data = {
    meta: {
      generated: new Date().toISOString(),
      generator: 'my-optcg-binder generate.js',
      generatorVersion: '0.1.0',
      catalogSource: 'Vega',
      catalogSourceVersion: snapshot.version ?? 'unknown',
      totalCards: placement.cards.length,
      totalSheets: placement.sheets.length / 2,
      dataProvenance: `Generated from Vega snapshot at ${VEGA_SNAPSHOT_DIR}/ — ${cardCount} card entries, ${catalog.size} unique codes, ${packCount} packs`,
    },
    catalog: [...catalog.values()].filter(e => collectionMap.has(e.code)),
    cards: placement.cards,
    sheets: placement.sheets,
    binder: summary,
    wanted: wantedEntries,
    sources: {
      generated: validation.sources.generated,
      files: sourcesFiles,
    },
    attribution: {
      copyright: 'One Piece TCG card data and images © Bandai / Toei Animation. This is an unofficial fan project for personal reference only.',
      disclaimer: 'Not affiliated with Bandai, Toei Animation, or Vega. All trademarks belong to their respective owners.',
      dataSource: 'Vega (One Piece TCG card database)',
      dataSourceUrl: 'https://vega.gg/',
      toolUsed: 'vegapull v1.2.3 (https://github.com/arashio/vegapull)',
    },
  };

  // Write to src/data/generated/binder-data.json
  const outputPath = resolve(projectRoot, GENERATED_DATA_PATH);
  const outputDir = resolve(outputPath, '..');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
  const sizeBytes = Buffer.byteLength(JSON.stringify(data), 'utf-8');
  console.log(`  ✔  Wrote ${GENERATED_DATA_PATH} (${sizeBytes} bytes)`);

  // Write to public/data/binder.json (canonical 8-key BinderData contract)
  const publicDataDir = resolve(projectRoot, 'public', 'data');
  if (!existsSync(publicDataDir)) {
    mkdirSync(publicDataDir, { recursive: true });
  }
  const publicOutputPath = resolve(publicDataDir, 'binder.json');
  writeFileSync(publicOutputPath, JSON.stringify(data, null, 2), 'utf-8');
  const publicSizeBytes = Buffer.byteLength(JSON.stringify(data), 'utf-8');
  console.log(`  ✔  Wrote public/data/binder.json (${publicSizeBytes} bytes) — canonical 8-key BinderData contract`);

  console.log(`\n✅ Generation complete.`);
}

try {
  main();
} catch (err) {
  console.error('❌ Generation failed:', err);
  process.exit(1);
}
