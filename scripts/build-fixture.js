#!/usr/bin/env node

/**
 * build-fixture — Generate the committed JSON fixture/data artifact.
 *
 * This script derives a minimal generated JSON fixture from the provided
 * CSV source data and heuristic card metadata (set prefix → color mapping).
 * It does NOT require a Vega snapshot.
 *
 * The fixture is sufficient for the UI/build pipeline to function and is
 * committed to the repository. A proper `npm run generate` using a live
 * Vega snapshot would replace it with richer metadata.
 *
 * USAGE: node scripts/build-fixture.js
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { validateAll } from '../src/lib/validate/index.js';
import { computeBinderPlacement, computeBinderSummary } from '../src/lib/binder/index.js';
import { CSV_PATHS, GENERATED_DATA_PATH, SET_COLOR_MAP } from '../src/lib/data/constants.js';

const projectRoot = resolve(import.meta.dirname, '..');

/* ─── Checksum helper ──────────────────────────────────────── */

function computeChecksum(filePath) {
  const abs = resolve(projectRoot, filePath);
  if (!existsSync(abs)) return 'missing';
  return createHash('sha256').update(readFileSync(abs)).digest('hex');
}

/* ─── Heuristic catalog builder ────────────────────────────── */

function buildHeuristicCatalog(codes) {
  const catalog = new Map();

  for (const code of codes) {
    const prefix = code.match(/^([A-Z]+\d+)/)?.[1] ?? '';
    const heuristic = SET_COLOR_MAP[prefix];
    const numPart = code.match(/\d+$/)?.[0] ?? '0';

    // Leaders typically end in 001 (or are from starter decks)
    // For now, use a simple heuristic based on known patterns
    let type = null;
    let cost = null;

    // Known leader codes from the collection
    const knownLeaders = new Set([
      'OP05-007', 'OP05-051', 'OP07-015', 'OP07-016', 'OP07-017',
      'OP08-043', 'OP08-046', 'OP10-062', 'OP11-008', 'OP13-012',
      'ST06-015', 'ST35-001', 'OP13-004', 'OP02-068',
    ]);

    if (knownLeaders.has(code)) {
      type = 'Leader';
      cost = 0;
    } else if (heuristic) {
      // Non-leaders: determine type from number range heuristics
      // In One Piece TCG, card numbering is usually: 001-xxx leaders,
      // then characters, events, stages. Without Vega data we mark as null.
      type = null;
      cost = null;
    }

    catalog.set(code, {
      code,
      name: null,
      color: heuristic?.color ?? null,
      cost,
      type,
    });
  }

  return catalog;
}

/* ─── Main ─────────────────────────────────────────────────── */

function main() {
  console.log('📦 Building fixture from source CSVs...\n');

  // 1. Validate CSVs
  console.log('  Step 1/3: Validating source CSVs...');
  const validation = validateAll(projectRoot);
  if (!validation.valid) {
    console.error('❌ Source CSV validation failed:');
    for (const err of validation.errors) {
      console.error(`  [${err.file}:${err.row}] ${err.reason} (value: "${err.value}")`);
    }
    process.exit(1);
  }
  console.log(`  ✔  ${validation.collection.length} collection, ${validation.saboDeck.length} Sabo, ${validation.luffyDeck.length} Luffy, ${validation.wanted.length} wanted`);

  // 2. Build heuristic catalog
  console.log('  Step 2/3: Building heuristic card catalog...');
  const allCodes = new Set([
    ...validation.collection.map(r => r.code),
    ...validation.saboDeck.map(r => r.code),
    ...validation.luffyDeck.map(r => r.code),
    ...validation.wanted.map(r => r.code),
  ]);
  const catalog = buildHeuristicCatalog(allCodes);
  console.log(`  ✔  ${catalog.size} heuristic catalog entries`);
  console.log(`  ℹ  Catalog source: set-prefix → color mapping (${Object.keys(SET_COLOR_MAP).length} sets mapped)`);
  console.log(`  ℹ  Card names and precise types from Vega catalog unavailable in fixture`);

  // 3. Compute binder placement
  console.log('  Step 3/3: Computing binder placement...');
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
  console.log(`  ✔  ${summary.totalBinderCards} cards in binder, ${summary.totalDeckCards} in decks`);

  // 4. Build the data artifact
  const wantedEntries = validation.wanted.map(w => ({
    code: w.code,
    amount: w.amount,
    target: w.target,
  }));

  const data = {
    meta: {
      generated: new Date().toISOString(),
      generator: 'my-optcg-binder build-fixture.js',
      generatorVersion: '0.1.0',
      catalogSource: 'heuristic (set-prefix color mapping — no Vega snapshot)',
      catalogSourceVersion: '0.1.0-fixture',
      totalCards: placement.cards.length,
      totalSheets: placement.sheets.length / 2,
      dataProvenance: 'Fixture derived from source CSVs and set-prefix→color heuristics. ' +
        'Replace by running `npm run generate` with a live Vega snapshot at .vega/.',
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

  // Ensure output directories exist
  const outputPath = resolve(projectRoot, GENERATED_DATA_PATH);
  const outputDir = resolve(outputPath, '..');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
  const sizeBytes = Buffer.byteLength(JSON.stringify(data), 'utf-8');
  console.log(`\n  ✔  Wrote ${GENERATED_DATA_PATH} (${sizeBytes} bytes)`);

  // 5. Generate public/data/binder.json for the existing UI
  const publicDataDir = resolve(projectRoot, 'public', 'data');
  if (!existsSync(publicDataDir)) {
    mkdirSync(publicDataDir, { recursive: true });
  }

  const uiCards = placement.cards.map(c => {
    const loc = c.binderLocation;
    const cat = catalog.get(c.code);
    const totalDeckQty = c.deckAllocations.reduce((s, d) => s + d.quantity, 0);
    // Derive first deck name if any
    const deckName = c.deckAllocations.length > 0 ? c.deckAllocations[0].deck : undefined;
    return {
      code: c.code,
      name: cat?.name ?? c.code,
      color: cat?.color ?? 'Red',
      cost: cat?.cost ?? 0,
      type: cat?.type ?? 'Character',
      owned: c.owned,
      binder: c.binderQuantity,
      deckQty: totalDeckQty,
      deck: deckName,
      slot: loc?.slot,
      sheet: loc?.sheet,
      side: loc?.side?.toLowerCase() ?? undefined,
    };
  });

  const uiPayload = {
    cards: uiCards,
    wanted: wantedEntries,
  };

  const uiOutputPath = resolve(publicDataDir, 'binder.json');
  writeFileSync(uiOutputPath, JSON.stringify(uiPayload, null, 2), 'utf-8');
  const uiSizeBytes = Buffer.byteLength(JSON.stringify(uiPayload), 'utf-8');
  console.log(`  ✔  Wrote public/data/binder.json (${uiSizeBytes} bytes)`);
  console.log(`\n✅ Fixture built successfully.`);

  // Print first few sheets summary
  console.log(`\n📋 Binder summary:`);
  console.log(`  Total possessed: ${summary.totalPossessedCards} copies`);
  console.log(`  Unique card codes: ${summary.totalUniqueCodes}`);
  console.log(`  In binder: ${summary.totalBinderCards}`);
  console.log(`  In decks: ${summary.totalDeckCards}`);
  console.log(`  Sheets: ${summary.totalSheets}`);
  console.log(`  Reserved slots: ${summary.reservedSlots}`);
  console.log(`  Overflow sheets: ${summary.overflowSheets}`);
}

try {
  main();
} catch (err) {
  console.error('❌ Fixture build failed:', err);
  process.exit(1);
}
