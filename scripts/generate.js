#!/usr/bin/env node

/**
 * generate — Generate static binder data from validated CSV inputs.
 *
 * Reads strict-validated CSV inputs plus the Vega raw snapshot directory
 * (.vega/), and emits:
 *   - data/binder-layout.json  — stable initial physical ledger
 *   - src/data/generated/binder-data.json — canonical 8-key BinderData
 *   - public/data/binder.json  — same 8-key contract for the UI
 *   - public/data/card-images/ — one selected card PNG per owned/wanted code
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
import {
  createInitialBinderLayout,
  reconcileBinderLayout,
} from '../src/lib/binder/index.js';
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

  if (!version) {
    const versionFile = resolve(vegaPath, 'version.txt');
    if (existsSync(versionFile)) {
      version = readFileSync(versionFile, 'utf-8').trim();
    }
  }

  return { available: true, version, path: vegaPath };
}

/* ─── Build Card Catalog from Vega snapshot ────────────────── */

function toBaseCode(id) {
  return id.replace(/_(p\d+|r\d+)$/, '');
}

function normalizeColor(v) {
  if (!v) return null;
  const upper = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
  const valid = ['Red', 'Green', 'Blue', 'Purple', 'Black', 'Yellow'];
  return valid.includes(upper) ? upper : null;
}

function normalizeType(v) {
  if (!v) return null;
  const lower = v.toLowerCase();
  if (lower.includes('leader')) return 'Leader';
  if (lower.includes('character')) return 'Character';
  if (lower.includes('event')) return 'Event';
  if (lower.includes('stage')) return 'Stage';
  return null;
}

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
 * Scans all cards_*.json files, reads packs.json for set metadata,
 * and builds a Map of base card codes to CatalogEntry.
 *
 * Cards with parallel art (_pN) or reprint (_rN) variants are deduplicated —
 * the first-occurring base code entry supplies canonical metadata.
 *
 * Vega `cost: null` (legitimate for counter Events) is mapped to -1 so the
 * placement engine can produce an exact layout.
 *
 * @param {string} vegaPath
 * @returns {{ catalog: Map<string, object>, imageAvailability: Map<string, string[]>, packCount: number, cardCount: number }}
 */
function buildCatalogFromSnapshot(vegaPath) {
  const catalog = new Map();
  const imageAvailability = new Map();
  const jsonDir = resolve(vegaPath, 'json');
  const imagesDir = resolve(vegaPath, 'images');

  const packsPath = resolve(jsonDir, 'packs.json');
  const packsData = readJsonFile(packsPath);
  const packCount = packsData ? Object.keys(packsData).length : 0;

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

      if (seenBaseCodes.has(baseCode)) continue;
      seenBaseCodes.add(baseCode);

      const colors = Array.isArray(card.colors) ? card.colors : [];
      const color = colors.length > 0 ? normalizeColor(colors[0]) : null;

      // Map null Vega cost (legitimate for counter Events) to -1
      // so placement-engine exact-layout creation succeeds.
      let cost = typeof card.cost === 'number' ? card.cost : -1;

      catalog.set(baseCode, {
        code: baseCode,
        name: card.name ?? null,
        color,
        cost,
        type: normalizeType(card.category ?? card.card_type ?? null),
        image: null, // populated after image copy
      });

      // Track image availability
      const availableImages = [];
      const baseImg = `${baseCode}.png`;
      if (existsSync(resolve(imagesDir, baseImg))) {
        availableImages.push(baseImg);
      }
      for (let i = 1; i <= 20; i++) {
        const pImg = `${baseCode}_p${i}.png`;
        if (existsSync(resolve(imagesDir, pImg))) availableImages.push(pImg);
        const rImg = `${baseCode}_r${i}.png`;
        if (existsSync(resolve(imagesDir, rImg))) availableImages.push(rImg);
      }
      imageAvailability.set(baseCode, availableImages);
    }
  }

  return { catalog, imageAvailability, packCount, cardCount };
}

function selectBestImage(code, imageAvailability) {
  const available = imageAvailability.get(code);
  if (!available || available.length === 0) return null;
  // Prefer base image (no suffix) > first parallel art > first reprint
  const base = available.find(img => !img.includes('_p') && !img.includes('_r'));
  if (base) return base;
  const pImg = available.find(img => img.includes('_p'));
  if (pImg) return pImg;
  const rImg = available.find(img => img.includes('_r'));
  if (rImg) return rImg;
  return available[0];
}

/**
 * Copy card images for all owned/wanted codes into tracked public assets.
 * Returns a manifest mapping code → relative path.
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
  const manifest = {};

  for (const code of codesToCopy) {
    const bestImage = selectBestImage(code, imageAvailability);
    if (!bestImage) { skipped++; continue; }

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

function computeFileChecksum(filePath) {
  if (!existsSync(filePath)) return null;
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/* ─── Helpers: convert BinderLayout → BinderSheet[] ────────── */

function layoutToBinderSheets(layout) {
  // BinderLayout uses discriminated pocket states; convert to
  // BinderSheet[] where only 'card' pockets appear as SlotEntry.
  return layout.sheets.map(sheet => {
    const slots = [];
    for (const pocket of sheet.pockets) {
      if (pocket.status === 'card' && pocket.code) {
        slots.push({ code: pocket.code, quantity: pocket.quantity ?? 1 });
      } else {
        slots.push(null);
      }
    }
    return { sheet: sheet.sheet, side: sheet.side, slots };
  });
}

/* ─── Main ─────────────────────────────────────────────────── */

function main() {
  console.log('📦 Generating static binder data...\n');

  // ── Step 1: Validate CSVs ──────────────────────────────────
  console.log('  Step 1/7: Validating source CSVs...');
  const validation = validateAll(projectRoot);
  if (!validation.valid) {
    console.error('❌ Validation failed:');
    console.error(formatErrors(validation.errors));
    process.exit(1);
  }
  console.log(`  ✔  ${validation.collection.length} collection rows, ${validation.saboDeck.length} Sabo rows, ${validation.luffyDeck.length} Luffy rows, ${validation.wanted.length} wanted entries`);

  // ── Step 2: Check Vega snapshot ────────────────────────────
  console.log('  Step 2/7: Checking Vega snapshot...');
  const snapshot = checkVegaSnapshot();
  if (!snapshot.available) {
    console.error(`❌ No Vega snapshot found at ${VEGA_SNAPSHOT_DIR}/`);
    console.error('  Run: vega pull all (vegapull v1.2.3, English, images=yes)');
    process.exit(1);
  }
  console.log(`  ✔  Vega snapshot found at ${VEGA_SNAPSHOT_DIR}/`);

  // ── Step 3: Build catalog from Vega ────────────────────────
  console.log('  Step 3/7: Building catalog from Vega snapshot...');
  const { catalog, imageAvailability, packCount, cardCount } = buildCatalogFromSnapshot(snapshot.path);
  if (catalog.size === 0) {
    console.error('❌ Vega snapshot exists but no catalog data parsed.');
    process.exit(1);
  }
  console.log(`  ✔  ${catalog.size} unique codes from ${cardCount} entries across ${packCount} packs`);

  // ── Step 4: Create initial binder layout ledger ────────────
  console.log('  Step 4/7: Creating immutable binder layout...');

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

  const allCollectionCodes = [...collectionMap.keys()];

  // Build the immutable initial layout from the real Vega catalog.
  const initialLayout = createInitialBinderLayout(catalog, allCollectionCodes);

  // The layout is written to disk even though it will be reconciled
  // before consumption — the .json file IS the canonical ledger source.
  const binderLayoutPath = resolve(projectRoot, 'data', 'binder-layout.json');
  const binderLayoutDir = resolve(binderLayoutPath, '..');
  if (!existsSync(binderLayoutDir)) {
    mkdirSync(binderLayoutDir, { recursive: true });
  }
  writeFileSync(binderLayoutPath, JSON.stringify(initialLayout, null, 2), 'utf-8');
  const layoutPockets = initialLayout.sheets.reduce((sum, s) => sum + s.pockets.length, 0);
  console.log(`  ✔  Wrote data/binder-layout.json — ${initialLayout.sheets.length} sides, ${layoutPockets} pockets`);

  // ── Step 5: Reconcile quantities and write card images ─────
  console.log('  Step 5/7: Reconciling layout and copying card images...');

  const reconciled = reconcileBinderLayout(initialLayout, collectionMap, catalog, deckAllocations);
  const locations = reconciled.locations;

  // Copy card images
  const codesToCopy = new Set();
  for (const code of collectionMap.keys()) codesToCopy.add(code);
  for (const w of validation.wanted) codesToCopy.add(w.code);

  const imageResult = copyCardImages(snapshot.path, imageAvailability, codesToCopy);
  console.log(`  ✔  Copied ${imageResult.copied} card images, ${imageResult.skipped} skipped`);

  // Attach image paths to catalog entries
  for (const [code, path] of Object.entries(imageResult.manifest)) {
    const entry = catalog.get(code);
    if (entry) entry.image = path;
  }

  // ── Step 6: Build 8-key BinderData ─────────────────────────
  console.log('  Step 6/7: Building canonical 8-key BinderData...');

  // Compute summary metrics from reconciled layout
  const binderSheets = layoutToBinderSheets(reconciled.layout);

  let totalPossessedCards = 0;
  let totalDeckCards = 0;
  let totalBinderCards = 0;
  let reservedSlots = 0;
  let vacantSlots = 0;

  const cardEntries = [];
  for (const code of allCollectionCodes) {
    const owned = collectionMap.get(code) ?? 0;
    const deckAllocEntries = [];
    for (const [deckName, deckMap] of deckAllocations) {
      const dq = deckMap.get(code) ?? 0;
      if (dq > 0) deckAllocEntries.push({ deck: deckName, quantity: dq });
    }
    const inDecks = deckAllocEntries.reduce((s, d) => s + d.quantity, 0);
    const binderQty = Math.max(0, owned - inDecks);
    totalPossessedCards += owned;
    totalDeckCards += inDecks;
    totalBinderCards += binderQty;

    const loc = locations.get(code) ?? null;
    const entry = catalog.get(code);

    cardEntries.push({
      code,
      name: entry?.name ?? null,
      owned,
      binderQuantity: binderQty,
      deckAllocations: deckAllocEntries,
      binderLocation: loc,
    });
  }

  // Count reserved and vacant pockets from reconciled layout
  for (const sheet of reconciled.layout.sheets) {
    for (const pocket of sheet.pockets) {
      if (pocket.status === 'reserved') reservedSlots++;
      if (pocket.status === 'vacant') vacantSlots++;
    }
  }

  const totalSheets = binderSheets.length / 2;
  const overflowSheets = Math.max(0, totalSheets - 50);

  const summary = {
    totalPossessedCards,
    totalUniqueCodes: cardEntries.length,
    totalSheets,
    totalDeckCards,
    totalBinderCards,
    reservedSlots,
    overflowSheets,
  };

  // Build wanted entries
  const wantedEntries = validation.wanted.map(w => ({
    code: w.code,
    amount: w.amount,
    target: w.target,
  }));

  // Build source manifest
  const sourcesFiles = { ...validation.sources.files };
  const jsonDir = resolve(snapshot.path, 'json');
  if (existsSync(jsonDir)) {
    const jsonEntries = readdirSync(jsonDir).filter(e => /^cards_\d+\.json$/.test(e));
    for (const jsonFile of jsonEntries) {
      const jsonPath = resolve(jsonDir, jsonFile);
      const checksum = computeFileChecksum(jsonPath);
      if (checksum) {
        const data = readJsonFile(jsonPath);
        sourcesFiles[`${VEGA_SNAPSHOT_DIR}/json/${jsonFile}`] = {
          checksum,
          rowCount: Array.isArray(data) ? data.length : 0,
        };
      }
    }
    const packsPath = resolve(jsonDir, 'packs.json');
    const packsChecksum = computeFileChecksum(packsPath);
    if (packsChecksum) {
      const pd = readJsonFile(packsPath);
      sourcesFiles[`${VEGA_SNAPSHOT_DIR}/json/packs.json`] = { checksum: packsChecksum, rowCount: pd ? Object.keys(pd).length : 0 };
    }
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
      totalCards: cardEntries.length,
      totalSheets,
      dataProvenance: `Generated from Vega snapshot at ${VEGA_SNAPSHOT_DIR}/ — ${cardCount} card entries, ${catalog.size} unique codes, ${packCount} packs`,
    },
    catalog: [...catalog.values()].filter(e => collectionMap.has(e.code)),
    cards: cardEntries,
    sheets: binderSheets,
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

  // ── Step 7: Write outputs ─────────────────────────────────
  console.log('  Step 7/7: Writing generated outputs...');

  // Write src/data/generated/binder-data.json
  const outputPath = resolve(projectRoot, GENERATED_DATA_PATH);
  const outputDir = resolve(outputPath, '..');
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`  ✔  Wrote ${GENERATED_DATA_PATH} (${Buffer.byteLength(JSON.stringify(data), 'utf-8')} bytes)`);

  // Write public/data/binder.json
  const publicDataDir = resolve(projectRoot, 'public', 'data');
  if (!existsSync(publicDataDir)) mkdirSync(publicDataDir, { recursive: true });
  const publicOutputPath = resolve(publicDataDir, 'binder.json');
  writeFileSync(publicOutputPath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`  ✔  Wrote public/data/binder.json (${Buffer.byteLength(JSON.stringify(data), 'utf-8')} bytes)`);

  console.log(`\n✅ Generation complete.`);
  console.log(`  Layout: ${initialLayout.sheets.length} sides, ${layoutPockets} pockets`);
  console.log(`  Cards: ${totalBinderCards} in binder, ${totalDeckCards} in decks`);
  console.log(`  Images: ${imageResult.copied} copied, ${imageResult.skipped} skipped`);
}

try {
  main();
} catch (err) {
  console.error('❌ Generation failed:', err);
  process.exit(1);
}
