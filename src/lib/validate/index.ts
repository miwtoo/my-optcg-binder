/**
 * Main validation pipeline.
 *
 * Reads and validates all source CSV files, checks code consistency,
 * and returns a unified result.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { CSV_PATHS } from '../data/constants';
import type { CollectionRow, DecklistRow, WantedRow } from '../data/types';
import type { SourceManifest, SourceFileEntry } from '../data/types';
import {
  parseCollectionCSV,
  parseDecklistCSV,
  parseWantedCSV,
  validateCodes,
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

/* ─── Validator ────────────────────────────────────────────── */

export function validateAll(projectRoot: string = '.'): ValidationResult {
  const errors: CSVError[] = [];

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

  // 5. Validate card codes against known catalog
  if (collectionResult.rows.length > 0) {
    errors.push(...validateCodes(collectionResult.rows, CSV_PATHS.COLLECTION, errors));
  }
  if (saboResult.rows.length > 0) {
    errors.push(...validateCodes(saboResult.rows, CSV_PATHS.DECK_SABO, errors));
  }
  if (luffyResult.rows.length > 0) {
    errors.push(...validateCodes(luffyResult.rows, CSV_PATHS.DECK_LUFFY, errors));
  }
  if (wantedRows.length > 0) {
    errors.push(...validateCodes(wantedRows, CSV_PATHS.WANTED, errors));
  }

  // 6. Build source manifest
  const sources: SourceManifest = {
    generated: new Date().toISOString(),
    files: {
      [CSV_PATHS.COLLECTION]: sourceEntry(collectionPath, collectionResult.rowCount),
      [CSV_PATHS.DECK_SABO]: sourceEntry(saboPath, saboResult.rowCount),
      [CSV_PATHS.DECK_LUFFY]: sourceEntry(luffyPath, luffyResult.rowCount),
    },
  };
  if (wantedRows.length > 0 || existsSync(wantedPath)) {
    sources.files[CSV_PATHS.WANTED] = sourceEntry(wantedPath, wantedRows.length);
  }

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
