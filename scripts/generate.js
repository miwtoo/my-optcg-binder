#!/usr/bin/env node

/**
 * generate — Generate static binder data from validated CSV inputs.
 *
 * Normal mode: loads the committed `data/binder-layout.json`, reconciles
 * collection/deck quantities against it, copies card images, and emits
 * the canonical 8-key BinderData + public artifacts.  The committed
 * ledger is never overwritten in normal mode.
 *
 * Bootstrap mode (`--init-layout`): reads the Vega snapshot, creates a
 * brand-new physical ledger via `createInitialBinderLayout`, writes it
 * to disk, then continues with the normal reconcile/publish pipeline.
 * Use this when the catalog or collection codes change structurally.
 *
 * OUTPUTS:
 *   - data/binder-layout.json        (init only)
 *   - public/data/binder-layout.json (always)
 *   - src/data/generated/binder-data.json
 *   - public/data/binder.json
 *   - public/data/card-images/
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { validateInputs } from '../src/lib/validate/index.js';
import { formatErrors } from '../src/lib/validate/errors.js';
import {
  createInitialBinderLayout,
  reconcileBinderLayout,
} from '../src/lib/binder/index.js';
import { CSV_PATHS, GENERATED_DATA_PATH, VEGA_SNAPSHOT_DIR } from '../src/lib/data/constants.js';
import { buildCatalogFromSnapshot, checkVegaSnapshot } from './vega-reader.js';

const projectRoot = resolve(import.meta.dirname, '..');

/* ─── Flags ────────────────────────────────────────────────── */

const INIT_LAYOUT = process.argv.includes('--init-layout');

/* ─── Helpers ──────────────────────────────────────────────── */

function readJsonFile(filePath) {
  try { return JSON.parse(readFileSync(filePath, 'utf-8')); } catch { return null; }
}

function computeFileChecksum(filePath) {
  if (!existsSync(filePath)) return null;
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function layoutToBinderSheets(layout) {
  // Preserve all four DiscriminatedSlot states.
  return layout.sheets.map(sheet => {
    const slots = [];
    for (const pocket of sheet.pockets) {
      switch (pocket.status) {
        case 'card':
          slots.push({ status: 'card', code: pocket.code, quantity: pocket.quantity ?? 1 });
          break;
        case 'reserved':
          slots.push({ status: 'reserved' });
          break;
        case 'vacant':
          slots.push({ status: 'vacant' });
          break;
        case 'empty':
        default:
          slots.push({ status: 'empty' });
          break;
      }
    }
    return { sheet: sheet.sheet, side: sheet.side, slots };
  });
}

/* ─── Image helpers ────────────────────────────────────────── */

function selectBestImage(code, imageAvailability) {
  const available = imageAvailability.get(code);
  if (!available || available.length === 0) return null;
  const base = available.find(img => !img.includes('_p') && !img.includes('_r'));
  if (base) return base;
  const pImg = available.find(img => img.includes('_p'));
  if (pImg) return pImg;
  const rImg = available.find(img => img.includes('_r'));
  if (rImg) return rImg;
  return available[0];
}

function copyCardImages(vegaPath, imageAvailability, codesToCopy) {
  const imagesDir = resolve(vegaPath, 'images');
  const outputDir = resolve(projectRoot, 'public', 'data', 'card-images');
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  let copied = 0;
  const manifest = {};
  const missing = [];

  for (const code of codesToCopy) {
    const bestImage = selectBestImage(code, imageAvailability);
    if (!bestImage) { missing.push(code); continue; }
    const srcPath = resolve(imagesDir, bestImage);
    const destPath = resolve(outputDir, `${code}.png`);
    if (existsSync(srcPath)) { copyFileSync(srcPath, destPath); copied++; manifest[code] = `data/card-images/${code}.png`; }
    else { missing.push(code); }
  }

  if (missing.length > 0) {
    const list = missing.map(c => `    - ${c}: no image in ${VEGA_SNAPSHOT_DIR}/images/`).join('\n');
    throw new Error(`Missing card images for ${missing.length} code(s):\n${list}\n\nCorrect the source data or add images.`);
  }
  return { copied, manifest };
}

/* ─── Main ─────────────────────────────────────────────────── */

function main() {
  console.log('📦 Generating static binder data...\n');
  const label = INIT_LAYOUT ? ' (init-layout mode — will write a new ledger)' : ' (normal mode — committed ledger preserved)';

  // ── Step 2: Check Vega snapshot ────────────────────────────
  console.log('  Step 2/7: Checking Vega snapshot...');
  const snapshot = checkVegaSnapshot(projectRoot, VEGA_SNAPSHOT_DIR);
  if (!snapshot.available) {
    console.error(`❌ No Vega snapshot at ${VEGA_SNAPSHOT_DIR}/`); process.exit(1);
  }
  console.log(`  ✔  Vega snapshot found`);

  // ── Step 3: Build catalog from Vega ────────────────────────
  console.log('  Step 3/7: Building catalog from Vega...');
  const { catalog, variantCodes, imageAvailability, packCount, cardCount } = buildCatalogFromSnapshot(snapshot.path);
  if (catalog.size === 0) { console.error('❌ No catalog data.'); process.exit(1); }
  console.log(`  ✔  ${catalog.size} base codes from ${cardCount} entries (${variantCodes.size} exact variant IDs), ${packCount} packs`);

  // ── Step 1: Validate CSVs against FRESH Vega catalog (exact variant codes) ──
  console.log(`  Step 1/7: Validating source CSVs against Vega catalog...${label}`);
  const validation = validateInputs(projectRoot, variantCodes);
  if (!validation.valid) {
    console.error('❌ Validation failed:'); console.error(formatErrors(validation.errors)); process.exit(1);
  }
  console.log(`  ✔  ${validation.collection.length} collection, ${validation.saboDeck.length} Sabo, ${validation.luffyDeck.length} Luffy, ${validation.wanted.length} wanted`);

  // ── Step 4: Load or initialise the binder layout ledger ────
  console.log('  Step 4/7: Loading binder layout...');

  const collectionMap = new Map(validation.collection.map(r => [r.code, r.amount]));
  const deckAllocations = new Map();
  deckAllocations.set('Sabo', new Map(validation.saboDeck.map(r => [r.code, r.amount])));
  deckAllocations.set('Luffy G_B [WIP]', new Map(validation.luffyDeck.map(r => [r.code, r.amount])));

  let layout;
  const binderLayoutPath = resolve(projectRoot, 'data', 'binder-layout.json');

  if (INIT_LAYOUT) {
    console.log('  ─  Bootstrap mode: creating new binder layout from Vega catalog...');
    const allCodes = [...collectionMap.keys()];
    layout = createInitialBinderLayout(catalog, allCodes);
    const dir = resolve(binderLayoutPath, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(binderLayoutPath, JSON.stringify(layout, null, 2), 'utf-8');
    console.log(`  ✔  Wrote new data/binder-layout.json (${layout.sheets.length} sides)`);
  } else {
    console.log('  ─  Normal mode: loading committed ledger...');
    if (!existsSync(binderLayoutPath)) {
      console.error(`❌ No committed ledger at data/binder-layout.json`);
      console.error('  Run with --init-layout to bootstrap from the Vega snapshot.');
      process.exit(1);
    }
    layout = JSON.parse(readFileSync(binderLayoutPath, 'utf-8'));
    console.log(`  ✔  Loaded data/binder-layout.json (${layout.sheets.length} sides)`);
  }

  // ── Step 5: Reconcile quantities and copy images ───────────
  console.log('  Step 5/7: Reconciling layout and copying images...');
  const reconciled = reconcileBinderLayout(layout, collectionMap, catalog, deckAllocations);
  console.log(`  ✔  Layout reconciled — ${reconciled.locations.size} card positions`);

  const codesToCopy = new Set([...collectionMap.keys(), ...validation.wanted.map(w => w.code)]);
  const imageResult = copyCardImages(snapshot.path, imageAvailability, codesToCopy);
  for (const [code, path] of Object.entries(imageResult.manifest)) {
    const e = catalog.get(code);
    if (e) e.image = path;
  }
  console.log(`  ✔  ${imageResult.copied} images copied`);

  // ── Step 6: Build 8-key BinderData ─────────────────────────
  console.log('  Step 6/7: Building 8-key BinderData...');

  const binderSheets = layoutToBinderSheets(reconciled.layout);

  let totalPossessed = 0, totalDeck = 0, totalBinder = 0, reservedSlots = 0;
  const cardEntries = [];

  for (const code of collectionMap.keys()) {
    const owned = collectionMap.get(code) ?? 0;
    const allocs = [];
    let inDecks = 0;
    for (const [dn, dm] of deckAllocations) {
      const dq = dm.get(code) ?? 0;
      if (dq > 0) { allocs.push({ deck: dn, quantity: dq }); inDecks += dq; }
    }
    const binderQty = Math.max(0, owned - inDecks);
    totalPossessed += owned; totalDeck += inDecks; totalBinder += binderQty;
    const loc = reconciled.locations.get(code) ?? null;
    const entry = catalog.get(code);
    cardEntries.push({ code, name: entry?.name ?? null, owned, binderQuantity: binderQty, deckAllocations: allocs, binderLocation: loc });
  }

  for (const sheet of reconciled.layout.sheets) {
    for (const pocket of sheet.pockets) {
      if (pocket.status === 'reserved') reservedSlots++;
    }
  }

  const totalSheets = binderSheets.length / 2;
  const summary = {
    totalPossessedCards: totalPossessed,
    totalUniqueCodes: cardEntries.length,
    totalSheets,
    totalDeckCards: totalDeck,
    totalBinderCards: totalBinder,
    reservedSlots,
    overflowSheets: Math.max(0, totalSheets - 50),
  };

  const sourcesFiles = { ...validation.sources.files };
  const jsonDir = resolve(snapshot.path, 'json');
  if (existsSync(jsonDir)) {
    for (const jf of readdirSync(jsonDir).filter(e => /^cards_\d+\.json$/.test(e))) {
      const jp = resolve(jsonDir, jf); const c = computeFileChecksum(jp);
      if (c) { const d = readJsonFile(jp); sourcesFiles[`${VEGA_SNAPSHOT_DIR}/json/${jf}`] = { checksum: c, rowCount: Array.isArray(d) ? d.length : 0 }; }
    }
    const pp = resolve(jsonDir, 'packs.json'); const pc = computeFileChecksum(pp);
    if (pc) { const pd = readJsonFile(pp); sourcesFiles[`${VEGA_SNAPSHOT_DIR}/json/packs.json`] = { checksum: pc, rowCount: pd ? Object.keys(pd).length : 0 }; }
    const mp = resolve(snapshot.path, 'vega.meta.toml'); const mc = computeFileChecksum(mp);
    if (mc) sourcesFiles[`${VEGA_SNAPSHOT_DIR}/vega.meta.toml`] = { checksum: mc, rowCount: 0 };
  }

  const data = {
    meta: {
      generator: 'my-optcg-binder generate.js',
      generatorVersion: '0.1.0',
      catalogSource: 'Vega',
      catalogSourceVersion: snapshot.version ?? 'unknown',
      totalCards: cardEntries.length,
      totalSheets,
      dataProvenance: `Vega snapshot at ${VEGA_SNAPSHOT_DIR}/ — ${cardCount} entries, ${catalog.size} codes, ${packCount} packs`,
      layoutVersion: reconciled.layout.version,
    },
    catalog: [...catalog.values()].filter(e => collectionMap.has(e.code)),
    cards: cardEntries,
    sheets: binderSheets,
    binder: summary,
    wanted: validation.wanted.map(w => ({ code: w.code, amount: w.amount, target: w.target })),
    sources: { files: sourcesFiles },
    attribution: {
      copyright: 'One Piece TCG card data and images © Bandai / Toei Animation. This is an unofficial fan project for personal reference only.',
      disclaimer: 'Not affiliated with Bandai, Toei Animation, or Vega.',
      dataSource: 'Vega (One Piece TCG card database)',
      dataSourceUrl: 'https://vega.gg/',
      toolUsed: 'vegapull v1.2.3 (https://github.com/arashio/vegapull)',
    },
  };

  // ── Step 7: Write outputs ──────────────────────────────────
  console.log('  Step 7/7: Writing outputs...');

  // Write public/data/binder-layout.json (the deployed layout)
  const publicLayout = resolve(projectRoot, 'public/data/binder-layout.json');
  const pubDataDir = resolve(publicLayout, '..');
  if (!existsSync(pubDataDir)) mkdirSync(pubDataDir, { recursive: true });
  writeFileSync(publicLayout, JSON.stringify(reconciled.layout, null, 2), 'utf-8');
  console.log(`  ✔  Wrote public/data/binder-layout.json`);

  // Write src/data/generated/binder-data.json
  const outPath = resolve(projectRoot, GENERATED_DATA_PATH);
  const outDir = resolve(outPath, '..');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`  ✔  Wrote ${GENERATED_DATA_PATH}`);

  // Write public/data/binder.json
  const pubPath = resolve(projectRoot, 'public/data/binder.json');
  writeFileSync(pubPath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`  ✔  Wrote public/data/binder.json`);

  console.log(`\n✅ Generation complete.`);
  console.log(`  Cards: ${totalBinder} in binder, ${totalDeck} in decks`);
  console.log(`  Images: ${imageResult.copied} copied`);
}

try { main(); } catch (err) { console.error('❌ Generation failed:', err); process.exit(1); }
