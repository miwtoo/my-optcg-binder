/**
 * Main validation pipeline.
 *
 * Reads and validates all source CSV files, checks code consistency,
 * verifies generated data is not stale, and returns a unified result.
 *
 * The card-code reference set is always loaded from the committed
 * Vega-derived catalog artifact (src/data/generated/binder-data.json),
 * never from a hardcoded list.  This guarantees CI validates against the
 * same catalog shipped to the UI.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { CSV_PATHS, GENERATED_DATA_PATH, VEGA_SNAPSHOT_DIR } from '../data/constants';
import type { CollectionRow, DecklistRow, WantedRow } from '../data/types';
import type { SourceManifest, SourceFileEntry } from '../data/types';
import {
  parseCollectionCSV,
  parseDecklistCSV,
  parseWantedCSV,
  validateCodes,
  findDuplicateWantedTargets,
  ensureKnownCodes,
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
  const content = readFileSync(abs);
  return createHash('sha256').update(content).digest('hex');
}

function sourceEntry(filePath: string, rowCount: number): SourceFileEntry {
  const checksum = computeChecksum(filePath) ?? 'missing';
  return { checksum, rowCount };
}

/* ─── Stale-Data Checks ────────────────────────────────────── */

function checkArtifactConsistency(projectRoot: string): CSVError[] {
  const errors: CSVError[] = [];

  // 1. Generated binder data must exist and be parseable
  const genPath = resolve(projectRoot, GENERATED_DATA_PATH);
  if (!existsSync(genPath)) {
    errors.push({ file: GENERATED_DATA_PATH, row: 0, value: '', reason: `Generated data not found — run "npm run generate" first` });
    return errors; // can't check further
  }

  let generated: any;
  try {
    generated = JSON.parse(readFileSync(genPath, 'utf-8'));
  } catch {
    errors.push({ file: GENERATED_DATA_PATH, row: 0, value: '', reason: 'Generated data is not valid JSON' });
    return errors;
  }

  // 2. Generated data must have the 8-key structure
  const required = ['meta', 'catalog', 'cards', 'sheets', 'binder', 'wanted', 'sources', 'attribution'];
  for (const key of required) {
    if (!(key in generated)) {
      errors.push({ file: GENERATED_DATA_PATH, row: 0, value: key, reason: `Missing required top-level key "${key}"` });
    }
  }
  if (!Array.isArray(generated.catalog) || generated.catalog.length === 0) {
    errors.push({ file: GENERATED_DATA_PATH, row: 0, value: '', reason: 'Generated data has empty or missing catalog' });
  }
  if (!Array.isArray(generated.cards) || generated.cards.length === 0) {
    errors.push({ file: GENERATED_DATA_PATH, row: 0, value: '', reason: 'Generated data has empty or missing cards' });
  }
  if (!Array.isArray(generated.sheets) || generated.sheets.length === 0) {
    errors.push({ file: GENERATED_DATA_PATH, row: 0, value: '', reason: 'Generated data has empty or missing sheets' });
  }

  // 3. Verify CSV checksums match the source manifest in generated data
  const manifestFiles = generated.sources?.files ?? {};
  for (const csvKey of [CSV_PATHS.COLLECTION, CSV_PATHS.DECK_SABO, CSV_PATHS.DECK_LUFFY, CSV_PATHS.WANTED]) {
    const csvPath = resolve(projectRoot, csvKey);
    const actualChecksum = computeChecksum(csvPath);
    const manifestEntry = manifestFiles[csvKey];
    if (!manifestEntry) {
      errors.push({ file: csvKey, row: 0, value: '', reason: `CSV not found in generated data's source manifest` });
    } else if (manifestEntry.checksum !== actualChecksum) {
      errors.push({ file: csvKey, row: 0, value: csvKey, reason: `CSV checksum mismatch — source file has changed since last generation (expected ${manifestEntry.checksum}, actual ${actualChecksum}). Run "npm run generate".` });
    }
  }

  // 4. binder-layout.json must exist and be consistent with generated data
  const layoutPath = resolve(projectRoot, 'data/binder-layout.json');
  if (!existsSync(layoutPath)) {
    errors.push({ file: 'data/binder-layout.json', row: 0, value: '', reason: 'Binder layout not found — run "npm run generate" first' });
  } else {
    try {
      const layout = JSON.parse(readFileSync(layoutPath, 'utf-8'));
      if (!layout.version || layout.version !== 1) {
        errors.push({ file: 'data/binder-layout.json', row: 0, value: String(layout.version), reason: 'Binder layout has unexpected version' });
      }
      if (!Array.isArray(layout.sheets) || layout.sheets.length === 0) {
        errors.push({ file: 'data/binder-layout.json', row: 0, value: '', reason: 'Binder layout has no sheets' });
      }
    } catch {
      errors.push({ file: 'data/binder-layout.json', row: 0, value: '', reason: 'Binder layout is not valid JSON' });
    }
  }

  // 5. public/data/binder.json must exist and match source data
  const publicPath = resolve(projectRoot, 'public/data/binder.json');
  if (!existsSync(publicPath)) {
    errors.push({ file: 'public/data/binder.json', row: 0, value: '', reason: 'Public data not found — run "npm run generate" first' });
  } else {
    try {
      const publicData = JSON.parse(readFileSync(publicPath, 'utf-8'));
      if (publicData.meta?.totalCards !== generated.meta?.totalCards) {
        errors.push({ file: 'public/data/binder.json', row: 0, value: '', reason: `Public data out of date (${publicData.meta?.totalCards ?? 0} cards vs generated ${generated.meta?.totalCards ?? 0}) — run "npm run generate"` });
      }
    } catch {
      errors.push({ file: 'public/data/binder.json', row: 0, value: '', reason: 'Public data is not valid JSON' });
    }
  }

  return errors;
}

/* ─── Validator ────────────────────────────────────────────── */

export function validateAll(projectRoot: string = '.'): ValidationResult {
  const errors: CSVError[] = [];

  // 0. Ensure catalog codes are loaded for this project root
  ensureKnownCodes(projectRoot);

  // 1. Parse collection CSV
  const collectionPath = resolve(projectRoot, CSV_PATHS.COLLECTION);
  const collectionResult = parseCollectionCSV(collectionPath);
  errors.push(...collectionResult.errors);

  // 2. Parse Sabo deck CSV
  const saboPath = resolve(projectRoot, CSV_PATHS.DECK_SABO);
  const saboResult = parseDecklistCSV(saboPath);
  errors.push(...saboResult.errors);

  // 3. Parse Luffy deck CSV
  const luffyPath = resolve(projectRoot, CSV_PATHS.DECK_LUFFY);
  const luffyResult = parseDecklistCSV(luffyPath);
  errors.push(...luffyResult.errors);

  // 4. Parse Want to Buy CSV (optional — may not exist)
  let wantedRows: WantedRow[] = [];
  const wantedPath = resolve(projectRoot, CSV_PATHS.WANTED);
  if (existsSync(wantedPath)) {
    const wantedResult = parseWantedCSV(wantedPath);
    errors.push(...wantedResult.errors);
    wantedRows = wantedResult.rows;
  }

  // 5. Validate card codes against committed Vega catalog artifact
  if (collectionResult.rows.length > 0) {
    errors.push(...validateCodes(collectionResult.rows, CSV_PATHS.COLLECTION, errors, projectRoot));
  }
  if (saboResult.rows.length > 0) {
    errors.push(...validateCodes(saboResult.rows, CSV_PATHS.DECK_SABO, errors, projectRoot));
  }
  if (luffyResult.rows.length > 0) {
    errors.push(...validateCodes(luffyResult.rows, CSV_PATHS.DECK_LUFFY, errors, projectRoot));
  }
  if (wantedRows.length > 0) {
    errors.push(...validateCodes(wantedRows, CSV_PATHS.WANTED, errors, projectRoot));
    errors.push(...findDuplicateWantedTargets(wantedRows, CSV_PATHS.WANTED));
  }

  // Decklists are allocations of physical inventory, never independent stock.
  const owned = new Map(collectionResult.rows.map(row => [row.code, row.amount]));
  for (const [deckName, rows] of [['Sabo', saboResult.rows], ['Luffy G_B [WIP]', luffyResult.rows]] as const) {
    const allocated = new Map<string, number>();
    for (const row of rows) allocated.set(row.code, (allocated.get(row.code) ?? 0) + row.amount);
    for (const [code, amount] of allocated) {
      if (!owned.has(code)) errors.push({ file: deckName, row: 0, value: code, reason: `Deck code "${code}" is absent from collection` });
      else if (amount > owned.get(code)!) errors.push({ file: deckName, row: 0, value: code, reason: `Deck allocation ${amount} exceeds collection quantity ${owned.get(code)}` });
    }
  }

  // 6. Build source manifest (no wall-clock timestamps — checksums provide provenance)
  const sources: SourceManifest = {
    files: {
      [CSV_PATHS.COLLECTION]: sourceEntry(collectionPath, collectionResult.rowCount),
      [CSV_PATHS.DECK_SABO]: sourceEntry(saboPath, saboResult.rowCount),
      [CSV_PATHS.DECK_LUFFY]: sourceEntry(luffyPath, luffyResult.rowCount),
    },
  };
  if (wantedRows.length > 0 || existsSync(wantedPath)) {
    sources.files[CSV_PATHS.WANTED] = sourceEntry(wantedPath, wantedRows.length);
  }

  // 7. Check artifact consistency (layout, checksums, public data)
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
