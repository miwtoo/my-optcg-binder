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

  // Public data matches generated — full byte-equivalence (JSON content SHA256)
  const pubDataPath = resolve(projectRoot, 'public/data/binder.json');
  if (!existsSync(pubDataPath)) errors.push({ file: 'public/data/binder.json', row: 0, value: '', reason: 'Public binder.json not found — run "npm run generate" first' });
  else {
    try {
      const publicData = readFileSync(pubDataPath, 'utf-8');
      const genData = readFileSync(genPath, 'utf-8');
      // Compare the full JSON payload via SHA256 — byte-for-byte equivalent content
      const genAll = createHash('sha256').update(genData).digest('hex');
      const pubAll = createHash('sha256').update(publicData).digest('hex');
      if (genAll !== pubAll) {
        errors.push({ file: 'public/data/binder.json', row: 0, value: '', reason: `Full content SHA256 differs (generated=${genAll} public=${pubAll}) — re-run "npm run generate"` });
      }
    } catch (e) {
      errors.push({ file: 'public/data/binder.json', row: 0, value: '', reason: `Public binder.json check failed: ${e instanceof Error ? e.message : 'invalid JSON'}` });
    }
  }

  // Layout byte-equivalence: data/binder-layout.json vs public/data/binder-layout.json
  const dataLayoutPath = resolve(projectRoot, 'data/binder-layout.json');
  const pubLayoutPath = resolve(projectRoot, 'public/data/binder-layout.json');
  if (existsSync(dataLayoutPath) && existsSync(pubLayoutPath)) {
    try {
      const dataBytes = readFileSync(dataLayoutPath, 'utf-8');
      const pubBytes = readFileSync(pubLayoutPath, 'utf-8');
      const dL = createHash('sha256').update(dataBytes).digest('hex');
      const pL = createHash('sha256').update(pubBytes).digest('hex');
      if (dL !== pL) {
        errors.push({ file: 'public/data/binder-layout.json', row: 0, value: 'layout', reason: `Layout content SHA256 differs — public=${pL} data=${dL}` });
      }

      // Slot-by-slot derivation check: every generated sheet's number, side,
      // and every slot's status/code/quantity must match the canonical layout.
      if (Array.isArray(generated.sheets) && existsSync(dataLayoutPath)) {
        const dataLayout = JSON.parse(dataBytes);
        const genSheets = generated.sheets;
        let genSheetIdx = 0;
        for (const layoutSheet of dataLayout.sheets) {
          const gen = genSheets[genSheetIdx];
          if (!gen) { errors.push({ file: GENERATED_DATA_PATH, row: 0, value: 'sheets', reason: `Missing generated sheet at index ${genSheetIdx} — data layout has ${dataLayout.sheets.length} sides, generated has ${genSheets.length}` }); break; }
          // Verify sheet number and side match
          if (gen.sheet !== layoutSheet.sheet) errors.push({ file: GENERATED_DATA_PATH, row: 0, value: `sheets[${genSheetIdx}].sheet`, reason: `Sheet number mismatch: generated=${gen.sheet} layout=${layoutSheet.sheet} (${layoutSheet.sheetId})` });
          if (gen.side !== layoutSheet.side) errors.push({ file: GENERATED_DATA_PATH, row: 0, value: `sheets[${genSheetIdx}].side`, reason: `Sheet side mismatch: generated=${gen.side} layout=${layoutSheet.side}` });
          if (gen.slots.length !== layoutSheet.pockets.length) {
            for (let p = 0; p < layoutSheet.pockets.length; p++) {
              const pocket = layoutSheet.pockets[p]!;
              const slot = gen.slots[p]!;
              // Card pockets must match code + quantity
              if (pocket.status === 'card') {
                if (slot.status !== 'card') errors.push({ file: GENERATED_DATA_PATH, row: 0, value: `sheets[${genSheetIdx}].slots[${p}]`, reason: `Expected 'card' status for pocket with code ${pocket.code}, got '${slot.status}'` });
                else {
                  if (slot.code !== pocket.code) errors.push({ file: GENERATED_DATA_PATH, row: 0, value: `sheets[${genSheetIdx}].slots[${p}].code`, reason: `Code mismatch: generated="${slot.code}" layout="${pocket.code}"` });
                  if (slot.quantity !== pocket.quantity) errors.push({ file: GENERATED_DATA_PATH, row: 0, value: `sheets[${genSheetIdx}].slots[${p}].quantity`, reason: `Quantity mismatch for ${pocket.code}: generated=${slot.quantity} layout=${pocket.quantity}` });
                }
              } else if (pocket.status === 'vacant') {
                if (slot.status !== 'vacant') errors.push({ file: GENERATED_DATA_PATH, row: 0, value: `sheets[${genSheetIdx}].slots[${p}]`, reason: `Expected 'vacant' status, got '${slot.status}'` });
              } else if (pocket.status === 'reserved') {
                if (slot.status !== 'reserved') errors.push({ file: GENERATED_DATA_PATH, row: 0, value: `sheets[${genSheetIdx}].slots[${p}]`, reason: `Expected 'reserved' status, got '${slot.status}'` });
              } else if (pocket.status === 'empty') {
                if (slot.status !== 'empty') errors.push({ file: GENERATED_DATA_PATH, row: 0, value: `sheets[${genSheetIdx}].slots[${p}]`, reason: `Expected 'empty' status, got '${slot.status}'` });
              }
            }
          }
          genSheetIdx++;
        }
        if (genSheetIdx < genSheets.length) {
          errors.push({ file: GENERATED_DATA_PATH, row: 0, value: 'sheets', reason: `Generated has ${genSheets.length - genSheetIdx} extra sheet(s) beyond layout` });
        }

        // Cross-validate every card's binderLocation against the canonical layout.
        if (Array.isArray(generated.cards)) {
          for (const card of generated.cards) {
            const loc = card.binderLocation;
            if (loc !== null) {
              const layoutSheet = dataLayout.sheets.find(
                (s: any) => s.sheet === loc.sheet && s.side === loc.side,
              );
              if (!layoutSheet) {
                errors.push({ file: GENERATED_DATA_PATH, row: 0, value: `cards.${card.code}.binderLocation`, reason: `Location sheet ${loc.sheet}-${loc.side} not found in layout` });
              } else {
                const pocket = layoutSheet.pockets.find((p: any) => p.pocket === loc.slot);
                if (!pocket) {
                  errors.push({ file: GENERATED_DATA_PATH, row: 0, value: `cards.${card.code}.binderLocation`, reason: `Slot ${loc.slot} not found in layout sheet ${loc.sheet}-${loc.side}` });
                } else if (pocket.status !== 'card' || pocket.code !== card.code) {
                  errors.push({ file: GENERATED_DATA_PATH, row: 0, value: `cards.${card.code}.binderLocation`, reason: `Layout pocket at ${loc.sheet}-${loc.side} slot ${loc.slot} has status=${pocket.status} code=${pocket.code}, expected 'card' with code=${card.code}` });
                }
              }
            }
          }
        }
      }
    } catch (e) {
      errors.push({ file: 'public/data/binder-layout.json', row: 0, value: '', reason: `Layout check failed: ${e instanceof Error ? e.message : 'invalid JSON'}` });
    }
  } else {
    if (!existsSync(dataLayoutPath)) errors.push({ file: 'data/binder-layout.json', row: 0, value: '', reason: 'data/binder-layout.json not found' });
    if (!existsSync(pubLayoutPath)) errors.push({ file: 'public/data/binder-layout.json', row: 0, value: '', reason: 'public/data/binder-layout.json not found' });
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
    for (const row of collectionResult.rows) { if (!catalogCodes.has(row.code)) errors.push({ file: CSV_PATHS.COLLECTION, row: row.row, value: row.code, reason: `Unknown card code "${row.code}" — not in Vega catalog` }); }
    for (const row of saboResult.rows) { if (!catalogCodes.has(row.code)) errors.push({ file: CSV_PATHS.DECK_SABO, row: row.row, value: row.code, reason: `Unknown card code "${row.code}" — not in Vega catalog` }); }
    for (const row of luffyResult.rows) { if (!catalogCodes.has(row.code)) errors.push({ file: CSV_PATHS.DECK_LUFFY, row: row.row, value: row.code, reason: `Unknown card code "${row.code}" — not in Vega catalog` }); }
    for (const row of wantedRows) { if (!catalogCodes.has(row.code)) errors.push({ file: CSV_PATHS.WANTED, row: row.row, value: row.code, reason: `Unknown card code "${row.code}" — not in Vega catalog` }); }
  }

  if (wantedRows.length > 0) errors.push(...findDuplicateWantedTargets(wantedRows, CSV_PATHS.WANTED));

  // Deck-allocation validation — use original row info from CSV row meta
  const owned = new Map(collectionResult.rows.map(r => [r.code, r.amount]));
  for (const { deckName, rows } of [
    { deckName: 'Sabo' as const, rows: saboResult.rows },
    { deckName: 'Luffy G_B [WIP]' as const, rows: luffyResult.rows },
  ]) {
    const allocated = new Map<string, number>();
    for (const row of rows) allocated.set(row.code, (allocated.get(row.code) ?? 0) + row.amount);
    for (const [code, amount] of allocated) {
      const csvRow = rows.find(r => r.code === code)?.row ?? 0;
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
    for (const row of collectionResult.rows) { if (!knownCodes.has(row.code)) errors.push({ file: CSV_PATHS.COLLECTION, row: row.row, value: row.code, reason: `Unknown code "${row.code}"` }); }
    for (const row of saboResult.rows) { if (!knownCodes.has(row.code)) errors.push({ file: CSV_PATHS.DECK_SABO, row: row.row, value: row.code, reason: `Unknown code "${row.code}"` }); }
    for (const row of luffyResult.rows) { if (!knownCodes.has(row.code)) errors.push({ file: CSV_PATHS.DECK_LUFFY, row: row.row, value: row.code, reason: `Unknown code "${row.code}"` }); }
    for (const row of wantedRows) { if (!knownCodes.has(row.code)) errors.push({ file: CSV_PATHS.WANTED, row: row.row, value: row.code, reason: `Unknown code "${row.code}"` }); }
  }

  if (wantedRows.length > 0) errors.push(...findDuplicateWantedTargets(wantedRows, CSV_PATHS.WANTED));

  const owned = new Map(collectionResult.rows.map(r => [r.code, r.amount]));
  for (const { deckName, rows } of [
    { deckName: 'Sabo' as const, rows: saboResult.rows },
    { deckName: 'Luffy G_B [WIP]' as const, rows: luffyResult.rows },
  ]) {
    const allocated = new Map<string, number>();
    for (const row of rows) allocated.set(row.code, (allocated.get(row.code) ?? 0) + row.amount);
    for (const [code, amount] of allocated) {
      const csvRow = rows.find(r => r.code === code)?.row ?? 0;
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
