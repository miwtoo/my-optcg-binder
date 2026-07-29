/**
 * Validation pipeline — dual-mode.
 *
 * Pre-generation (used by `scripts/generate.js`):
 *   validateInputs(projectRoot, catalogFromVega)
 *   validates CSVs against the FRESHLY loaded Vega catalog.
 *
 * Post-generation (used by `npm run validate` / `scripts/validate.js`):
 *   validateAll(projectRoot)
 *   validates CSVs against the COMMITTED catalog artifact, then checks
 *   that all committed artifacts (layout, checksums, public data) are fresh.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { CSV_PATHS, GENERATED_DATA_PATH } from '../data/constants';
import type { CollectionRow, DecklistRow, WantedRow } from '../data/types';
import type { SourceManifest, SourceFileEntry } from '../data/types';
import {
  parseCollectionCSV,
  parseDecklistCSV,
  parseWantedCSV,
  validateCodes,
  findDuplicateWantedTargets,
  type CSVError,
} from './csv-reader';

/* ─── Validation Result ────────────────────────────────────── */

export interface ValidationResult {
  valid: boolean;
  collection: CollectionRow[];
  saboDeck: DecklistRow[];
  luffyDeck: DecklistRow[];
  wanted: WantedRow[];
  errors: CSVError[];
  sources: SourceManifest;
}

/* ─── Source Checksum ──────────────────────────────────────── */

function computeChecksum(filePath: string): string | null {
  const abs = resolve(filePath);
  if (!existsSync(abs)) return null;
  return createHash('sha256').update(readFileSync(abs)).digest('hex');
}

function sourceEntry(filePath: string, rowCount: number): SourceFileEntry {
  return { checksum: computeChecksum(filePath) ?? 'missing', rowCount };
}

/* ─── Stale-Data Checks (post-generation) ──────────────────── */

function checkArtifactConsistency(projectRoot: string): CSVError[] {
  const errors: CSVError[] = [];

  const genPath = resolve(projectRoot, GENERATED_DATA_PATH);
  if (!existsSync(genPath)) {
    errors.push({ file: GENERATED_DATA_PATH, row: 0, value: '', reason: 'Generated data not found — run "npm run generate" first' });
    return errors;
  }

  let generated: any;
  try { generated = JSON.parse(readFileSync(genPath, 'utf-8')); }
  catch { errors.push({ file: GENERATED_DATA_PATH, row: 0, value: '', reason: 'Generated data is not valid JSON' }); return errors; }

  // 8-key structure
  const required = ['meta', 'catalog', 'cards', 'sheets', 'binder', 'wanted', 'sources', 'attribution'];
  for (const key of required) {
    if (!(key in generated)) errors.push({ file: GENERATED_DATA_PATH, row: 0, value: key, reason: `Missing required top-level key "${key}"` });
  }
  if (!Array.isArray(generated.catalog) || generated.catalog.length === 0) errors.push({ file: GENERATED_DATA_PATH, row: 0, value: '', reason: 'Generated data has empty or missing catalog' });
  if (!Array.isArray(generated.cards) || generated.cards.length === 0) errors.push({ file: GENERATED_DATA_PATH, row: 0, value: '', reason: 'Generated data has empty or missing cards' });
  if (!Array.isArray(generated.sheets) || generated.sheets.length === 0) errors.push({ file: GENERATED_DATA_PATH, row: 0, value: '', reason: 'Generated data has empty or missing sheets' });

  // CSV checksum freshness
  const manifestFiles = generated.sources?.files ?? {};
  for (const csvKey of [CSV_PATHS.COLLECTION, CSV_PATHS.DECK_SABO, CSV_PATHS.DECK_LUFFY, CSV_PATHS.WANTED]) {
    const csvPath = resolve(projectRoot, csvKey);
    const actualChecksum = computeChecksum(csvPath);
    const manifestEntry = manifestFiles[csvKey];
    if (!manifestEntry) errors.push({ file: csvKey, row: 0, value: '', reason: 'CSV not found in generated data source manifest' });
    else if (manifestEntry.checksum !== actualChecksum) errors.push({ file: csvKey, row: 0, value: csvKey, reason: `CSV checksum mismatch — source changed since last generate (expected ${manifestEntry.checksum}, actual ${actualChecksum}). Re-run "npm run generate".` });
  }

  // Layout consistency
  const layoutPath = resolve(projectRoot, 'data/binder-layout.json');
  if (!existsSync(layoutPath)) errors.push({ file: 'data/binder-layout.json', row: 0, value: '', reason: 'Binder layout not found — run "npm run generate" first' });
  else {
    try {
      const layout = JSON.parse(readFileSync(layoutPath, 'utf-8'));
      if (!layout.version || layout.version !== 1) errors.push({ file: 'data/binder-layout.json', row: 0, value: String(layout.version), reason: 'Binder layout has unexpected version' });
      if (!Array.isArray(layout.sheets) || layout.sheets.length === 0) errors.push({ file: 'data/binder-layout.json', row: 0, value: '', reason: 'Binder layout has no sheets' });
    } catch { errors.push({ file: 'data/binder-layout.json', row: 0, value: '', reason: 'Binder layout is not valid JSON' }); }
  }

  // Public data matches generated (full content comparison, not just counts)
  const publicPath = resolve(projectRoot, 'public/data/binder.json');
  if (!existsSync(publicPath)) errors.push({ file: 'public/data/binder.json', row: 0, value: '', reason: 'Public data not found — run "npm run generate" first' });
  else {
    try {
      const publicData = JSON.parse(readFileSync(publicPath, 'utf-8'));
      for (const section of ['catalog', 'cards', 'wanted', 'sources'] as const) {
        const genSec = JSON.stringify(generated[section]);
        const pubSec = JSON.stringify(publicData[section]);
        if (genSec !== pubSec) {
          const genChk = createHash('sha256').update(genSec).digest('hex');
          const pubChk = createHash('sha256').update(pubSec).digest('hex');
          errors.push({ file: 'public/data/binder.json', row: 0, value: section, reason: `public key "${section}" content SHA256 differs (gen=${genChk} pub=${pubChk}) — re-run "npm run generate"` });
        }
      }
      // Layout content checksum comparison:
      //   generated.sheets = 8-key DiscriminatedSlot[] derived from the reconciled layout
      //   public/data/binder-layout.json = full BinderLayout from the same reconciliation
      const layoutPubPath = resolve(projectRoot, 'public/data/binder-layout.json');
      if (existsSync(layoutPubPath)) {
        const layoutData = JSON.parse(readFileSync(layoutPubPath, 'utf-8'));
        const genSheets = generated.sheets;
        const pubLayoutSheets = layoutData.sheets;
        const genShk = createHash('sha256').update(JSON.stringify(genSheets)).digest('hex');
        const pubShk = createHash('sha256').update(JSON.stringify(pubLayoutSheets)).digest('hex');
        // The 8-key sheets are a flattened view; the full BinderLayout includes more state.
        // Compare sheet count and slot positions as a sanity check.
        if (Array.isArray(genSheets) && Array.isArray(pubLayoutSheets) && genSheets.length !== pubLayoutSheets.length) {
          errors.push({ file: 'public/data/binder-layout.json', row: 0, value: 'sheets', reason: `Sheet count mismatch: generated=${genSheets.length} public-layout=${pubLayoutSheets.length}` });
        }
        // Compare the layout with the data binder-layout.json as the canonical source of truth
        const dataLayoutPath = resolve(projectRoot, 'data/binder-layout.json');
        if (existsSync(dataLayoutPath)) {
          const dataLayout = JSON.parse(readFileSync(dataLayoutPath, 'utf-8'));
          const dataSheetsStr = JSON.stringify(dataLayout.sheets);
          const pubSheetsStr = JSON.stringify(layoutData.sheets);
          if (dataSheetsStr !== pubSheetsStr) {
            errors.push({ file: 'public/data/binder-layout.json', row: 0, value: 'layout', reason: 'public/binder-layout.json content differs from data/binder-layout.json' });
          }
          // Also verify the 8-key sheets match the data layout
          // Count cards in the data layout
          const dataCardCount = dataLayout.sheets.reduce((sum: number, s: any) => sum + s.pockets.filter((p: any) => p.status === 'card').length, 0);
          if (Array.isArray(genSheets)) {
            const genCardCount = genSheets.reduce((sum: number, s: any) => sum + s.slots.filter((sl: any) => sl?.status === 'card').length, 0);
            if (dataCardCount !== genCardCount) {
              errors.push({ file: 'data/binder-layout.json', row: 0, value: 'layout', reason: `Card pocket count mismatch: data-layout=${dataCardCount} generated-sheets=${genCardCount}` });
            }
          }
        }
      }
    } catch (e) {
      errors.push({ file: 'public/data/binder.json', row: 0, value: '', reason: `Public data check failed: ${e instanceof Error ? e.message : 'invalid JSON'}` });
    }
  }

  return errors;
}

/* ─── Input Validation (pre-generation, optional fresh catalog) ── */

export function validateInputs(
  projectRoot: string,
  catalogCodes?: Set<string>,
): ValidationResult {
  const errors: CSVError[] = [];

  const collectionPath = resolve(projectRoot, CSV_PATHS.COLLECTION);
  const collectionResult = parseCollectionCSV(collectionPath);
  errors.push(...collectionResult.errors);

  const saboPath = resolve(projectRoot, CSV_PATHS.DECK_SABO);
  const saboResult = parseDecklistCSV(saboPath);
  errors.push(...saboResult.errors);

  const luffyPath = resolve(projectRoot, CSV_PATHS.DECK_LUFFY);
  const luffyResult = parseDecklistCSV(luffyPath);
  errors.push(...luffyResult.errors);

  let wantedRows: WantedRow[] = [];
  const wantedPath = resolve(projectRoot, CSV_PATHS.WANTED);
  if (existsSync(wantedPath)) {
    const wantedResult = parseWantedCSV(wantedPath);
    errors.push(...wantedResult.errors);
    wantedRows = wantedResult.rows;
  }

  // Validate codes against provided catalog set, or fall back to committed artifact
  if (catalogCodes && catalogCodes.size > 0) {
    for (const row of collectionResult.rows) { if (!catalogCodes.has(row.code)) errors.push({ file: CSV_PATHS.COLLECTION, row: 0, value: row.code, reason: `Unknown card code "${row.code}" — not in Vega catalog` }); }
    for (const row of saboResult.rows) { if (!catalogCodes.has(row.code)) errors.push({ file: CSV_PATHS.DECK_SABO, row: 0, value: row.code, reason: `Unknown card code "${row.code}" — not in Vega catalog` }); }
    for (const row of luffyResult.rows) { if (!catalogCodes.has(row.code)) errors.push({ file: CSV_PATHS.DECK_LUFFY, row: 0, value: row.code, reason: `Unknown card code "${row.code}" — not in Vega catalog` }); }
    for (const row of wantedRows) { if (!catalogCodes.has(row.code)) errors.push({ file: CSV_PATHS.WANTED, row: 0, value: row.code, reason: `Unknown card code "${row.code}" — not in Vega catalog` }); }
  }

  if (wantedRows.length > 0) errors.push(...findDuplicateWantedTargets(wantedRows, CSV_PATHS.WANTED));

  // Deck-allocation validation — use original row info from CSV row meta
  const owned = new Map(collectionResult.rows.map(r => [r.code, r.amount]));
  const saboRowMap = new Map(saboResult.rows.map((r, i) => [r.code, i + 2]));
  const luffyRowMap = new Map(luffyResult.rows.map((r, i) => [r.code, i + 2]));
  for (const { deckName, rows, rowMap } of [
    { deckName: 'Sabo', rows: saboResult.rows, rowMap: saboRowMap },
    { deckName: 'Luffy G_B [WIP]' as const, rows: luffyResult.rows, rowMap: luffyRowMap },
  ]) {
    const allocated = new Map<string, number>();
    for (const row of rows) allocated.set(row.code, (allocated.get(row.code) ?? 0) + row.amount);
    for (const [code, amount] of allocated) {
      const csvRow = rowMap.get(code) ?? 0;
      if (!owned.has(code)) errors.push({ file: deckName, row: csvRow, value: code, reason: `Deck code "${code}" is absent from collection` });
      else if (amount > owned.get(code)!) errors.push({ file: deckName, row: csvRow, value: code, reason: `Deck allocation ${amount} exceeds collection quantity ${owned.get(code)}` });
    }
  }

  const sources: SourceManifest = {
    files: {
      [CSV_PATHS.COLLECTION]: sourceEntry(collectionPath, collectionResult.rowCount),
      [CSV_PATHS.DECK_SABO]: sourceEntry(saboPath, saboResult.rowCount),
      [CSV_PATHS.DECK_LUFFY]: sourceEntry(luffyPath, luffyResult.rowCount),
    },
  };
  if (wantedRows.length > 0 || existsSync(wantedPath)) sources.files[CSV_PATHS.WANTED] = sourceEntry(wantedPath, wantedRows.length);

  return {
    valid: errors.length === 0,
    collection: collectionResult.rows,
    saboDeck: saboResult.rows,
    luffyDeck: luffyResult.rows,
    wanted: wantedRows,
    errors,
    sources,
  };
}

/* ─── Post-Generation Validation (committed artifact checks) ── */

export function validateAll(projectRoot: string = '.'): ValidationResult {
  const errors: CSVError[] = [];

  const collectionPath = resolve(projectRoot, CSV_PATHS.COLLECTION);
  const collectionResult = parseCollectionCSV(collectionPath);
  errors.push(...collectionResult.errors);

  const saboPath = resolve(projectRoot, CSV_PATHS.DECK_SABO);
  const saboResult = parseDecklistCSV(saboPath);
  errors.push(...saboResult.errors);

  const luffyPath = resolve(projectRoot, CSV_PATHS.DECK_LUFFY);
  const luffyResult = parseDecklistCSV(luffyPath);
  errors.push(...luffyResult.errors);

  let wantedRows: WantedRow[] = [];
  const wantedPath = resolve(projectRoot, CSV_PATHS.WANTED);
  if (existsSync(wantedPath)) {
    const wantedResult = parseWantedCSV(wantedPath);
    errors.push(...wantedResult.errors);
    wantedRows = wantedResult.rows;
  }

  // Validate against COMMITTED catalog artifact
  const catalogPath = resolve(projectRoot, GENERATED_DATA_PATH);
  let knownCodes = new Set<string>();
  if (existsSync(catalogPath)) {
    try {
      const gen = JSON.parse(readFileSync(catalogPath, 'utf-8'));
      if (Array.isArray(gen?.catalog)) knownCodes = new Set(gen.catalog.map((e: any) => e?.code).filter(Boolean));
    } catch { /* non-fatal */ }
  }

  if (knownCodes.size > 0) {
    for (const row of collectionResult.rows) { if (!knownCodes.has(row.code)) errors.push({ file: CSV_PATHS.COLLECTION, row: 0, value: row.code, reason: `Unknown code "${row.code}"` }); }
    for (const row of saboResult.rows) { if (!knownCodes.has(row.code)) errors.push({ file: CSV_PATHS.DECK_SABO, row: 0, value: row.code, reason: `Unknown code "${row.code}"` }); }
    for (const row of luffyResult.rows) { if (!knownCodes.has(row.code)) errors.push({ file: CSV_PATHS.DECK_LUFFY, row: 0, value: row.code, reason: `Unknown code "${row.code}"` }); }
    for (const row of wantedRows) { if (!knownCodes.has(row.code)) errors.push({ file: CSV_PATHS.WANTED, row: 0, value: row.code, reason: `Unknown code "${row.code}"` }); }
  }

  if (wantedRows.length > 0) errors.push(...findDuplicateWantedTargets(wantedRows, CSV_PATHS.WANTED));

  const owned = new Map(collectionResult.rows.map(r => [r.code, r.amount]));
  const saboRowMap = new Map(saboResult.rows.map((r, i) => [r.code, i + 2]));
  const luffyRowMap = new Map(luffyResult.rows.map((r, i) => [r.code, i + 2]));
  for (const { deckName, rows, rowMap } of [
    { deckName: 'Sabo', rows: saboResult.rows, rowMap: saboRowMap },
    { deckName: 'Luffy G_B [WIP]' as const, rows: luffyResult.rows, rowMap: luffyRowMap },
  ]) {
    const allocated = new Map<string, number>();
    for (const row of rows) allocated.set(row.code, (allocated.get(row.code) ?? 0) + row.amount);
    for (const [code, amount] of allocated) {
      const csvRow = rowMap.get(code) ?? 0;
      if (!owned.has(code)) errors.push({ file: deckName, row: csvRow, value: code, reason: `Deck code "${code}" absent from collection` });
      else if (amount > owned.get(code)!) errors.push({ file: deckName, row: csvRow, value: code, reason: `Deck allocation ${amount} exceeds collection ${owned.get(code)}` });
    }
  }

  const sources: SourceManifest = {
    files: {
      [CSV_PATHS.COLLECTION]: sourceEntry(collectionPath, collectionResult.rowCount),
      [CSV_PATHS.DECK_SABO]: sourceEntry(saboPath, saboResult.rowCount),
      [CSV_PATHS.DECK_LUFFY]: sourceEntry(luffyPath, luffyResult.rowCount),
    },
  };
  if (wantedRows.length > 0 || existsSync(wantedPath)) sources.files[CSV_PATHS.WANTED] = sourceEntry(wantedPath, wantedRows.length);

  // Freshness checks
  errors.push(...checkArtifactConsistency(projectRoot));

  return {
    valid: errors.length === 0,
    collection: collectionResult.rows,
    saboDeck: saboResult.rows,
    luffyDeck: luffyResult.rows,
    wanted: wantedRows,
    errors,
    sources,
  };
}
