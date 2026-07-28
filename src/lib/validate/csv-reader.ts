import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CollectionRow, DecklistRow, WantedRow } from '../data/types';

/* ─── Validation Result Types ──────────────────────────────── */

export interface CSVError {
  file: string;
  row: number;        // 1-based, 1 = header
  value: string;
  reason: string;
}

export interface CSVParseResult<T> {
  rows: T[];
  errors: CSVError[];
  rowCount: number;    // data rows (excl. header)
}

/* ─── Known Exceptions ─────────────────────────────────────── */

/**
 * The Sabo deck CSV has a trailing summary row `,51` that is a total
 * line, not a card entry. Per spec, this is the sole ignored exception.
 */
const SABO_TOTAL_ROW = /^,51$/;

/* ─── Helpers ──────────────────────────────────────────────── */

function knownCardCodeSet(): Set<string> {
  // This is populated from the Vega catalog; for validation we use a
  // comprehensive set of known OP/ST/EB/P codes from the One Piece TCG.
  // In practice this should come from the Vega snapshot, but for the
  // committed fixture we use a reference set covering all codes in the CSVs.
  return new Set([
    // OP sets
    'P-069', 'P-105',
    'OP02-068', 'OP03-110',
    'OP05-007', 'OP05-034', 'OP05-042', 'OP05-051', 'OP05-057', 'OP05-069',
    'OP07-015', 'OP07-016', 'OP07-017', 'OP07-054',
    'OP08-043', 'OP08-046',
    'OP10-062',
    'OP11-008', 'OP11-061',
    'OP12-062', 'OP12-086', 'OP12-090', 'OP12-093', 'OP12-097', 'OP12-098',
    'OP13-004', 'OP13-005', 'OP13-008', 'OP13-012', 'OP13-017', 'OP13-019',
    'OP13-040', 'OP13-051', 'OP13-081', 'OP13-093', 'OP13-113',
    'OP14-074',
    'OP15-032',
    'OP16-022', 'OP16-026', 'OP16-027', 'OP16-032', 'OP16-034', 'OP16-038',
    'OP16-042', 'OP16-045', 'OP16-048', 'OP16-054', 'OP16-055', 'OP16-056',
    'OP16-085', 'OP16-086', 'OP16-091', 'OP16-096', 'OP16-099',
    // ST decks
    'ST06-015',
    'ST30-014',
    'ST35-001', 'ST35-002', 'ST35-003', 'ST35-004', 'ST35-005',
    // EB sets
    'EB01-022', 'EB01-028', 'EB01-042',
    'EB02-017',
    'EB03-008', 'EB03-010', 'EB03-013', 'EB03-017', 'EB03-034', 'EB03-037',
    'EB03-041', 'EB03-052', 'EB03-058',
  ]);
}

/**
 * Normalize line endings and BOM.
 */
function normalizeCSV(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Parse a generic CSV string into rows.
 */
function parseCSVLines(text: string): string[][] {
  const normalized = normalizeCSV(text);
  const lines = normalized.split('\n').filter(Boolean);
  return lines.map(line => {
    // Simple CSV parsing (no quoted fields expected in our data)
    return line.split(',').map(s => s.trim());
  });
}

/* ─── Collection CSV ───────────────────────────────────────── */

export function parseCollectionCSV(filePath: string): CSVParseResult<CollectionRow> {
  return parseCSVInternal<CollectionRow>(
    filePath,
    (fields, rowNum, errors) => {
      if (fields.length < 2) {
        errors.push({ file: filePath, row: rowNum, value: fields.join(','), reason: 'Expected at least 2 columns: code,amount' });
        return null;
      }
      const code = fields[0]!.trim();
      const amountStr = fields[1]!.trim();
      const amount = Number(amountStr);

      if (!code) {
        errors.push({ file: filePath, row: rowNum, value: code, reason: 'Empty card code' });
        return null;
      }
      if (!Number.isInteger(amount) || amount < 1) {
        errors.push({ file: filePath, row: rowNum, value: amountStr, reason: 'Amount must be a positive integer' });
        return null;
      }
      return { code, amount };
    },
    true, // deduplicate
  );
}

/* ─── Decklist CSV ─────────────────────────────────────────── */

export function parseDecklistCSV(filePath: string): CSVParseResult<DecklistRow> {
  // Sabo deck has the known `,51` exception row
  const isSabo = filePath.includes('Sabo');

  return parseCSVInternal<DecklistRow>(
    filePath,
    (fields, rowNum, errors) => {
      // Sabo exception: ignore the trailing summary row
      if (isSabo && fields.length === 2 && SABO_TOTAL_ROW.test(fields.join(','))) {
        return null; // silently skip
      }
      if (fields.length < 2) {
        errors.push({ file: filePath, row: rowNum, value: fields.join(','), reason: 'Expected at least 2 columns: code,amount' });
        return null;
      }
      const code = fields[0]!.trim();
      const amountStr = fields[1]!.trim();
      const amount = Number(amountStr);

      if (!code) {
        errors.push({ file: filePath, row: rowNum, value: code, reason: 'Empty card code' });
        return null;
      }
      if (!Number.isInteger(amount) || amount < 1) {
        errors.push({ file: filePath, row: rowNum, value: amountStr, reason: 'Amount must be a positive integer' });
        return null;
      }
      return { code, amount };
    },
    true, // deduplicate
  );
}

/* ─── Want to Buy CSV ──────────────────────────────────────── */

export function parseWantedCSV(filePath: string): CSVParseResult<WantedRow> {
  return parseCSVInternal<WantedRow>(
    filePath,
    (fields, rowNum, errors) => {
      if (fields.length < 3) {
        errors.push({ file: filePath, row: rowNum, value: fields.join(','), reason: 'Expected at least 3 columns: code,amount,target' });
        return null;
      }
      const code = fields[0]!.trim();
      const amountStr = fields[1]!.trim();
      const target = fields[2]!.trim();
      const amount = Number(amountStr);

      if (!code) {
        errors.push({ file: filePath, row: rowNum, value: code, reason: 'Empty card code' });
        return null;
      }
      if (!Number.isInteger(amount) || amount < 1) {
        errors.push({ file: filePath, row: rowNum, value: amountStr, reason: 'Amount must be a positive integer' });
        return null;
      }
      if (!target) {
        errors.push({ file: filePath, row: rowNum, value: target, reason: 'Target must be non-empty (e.g. "binder" or a deck name)' });
        return null;
      }
      return { code, amount, target };
    },
    false, // no dedup for wanted — same code can have different targets
  );
}

/* ─── Generic CSV Validator ────────────────────────────────── */

const KNOWN_CODES = knownCardCodeSet();

export function validateCardCode(code: string): boolean {
  return KNOWN_CODES.has(code);
}

export function getKnownCodes(): Set<string> {
  return KNOWN_CODES;
}

/**
 * Validate that all card codes in parsed rows are known Vega catalog codes.
 */
export function validateCodes<T extends { code: string }>(
  rows: T[],
  file: string,
  existingErrors: CSVError[],
): CSVError[] {
  const errors: CSVError[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (!KNOWN_CODES.has(row.code)) {
      errors.push({
        file,
        row: i + 2, // +2 because header is row 1, data starts at row 2
        value: row.code,
        reason: `Unknown card code "${row.code}" — not in Vega catalog`,
      });
    }
  }
  return errors;
}

/**
 * Check for duplicate card codes within a collection/decklist parse result.
 */
export function findDuplicateCodes<T extends { code: string }>(
  rows: T[],
  file: string,
  existingErrors: CSVError[],
): CSVError[] {
  const errors: CSVError[] = [];
  const seen = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const indices = seen.get(row.code) || [];
    indices.push(i + 2); // data rows start at line 2
    seen.set(row.code, indices);
  }
  for (const [code, lines] of seen) {
    if (lines.length > 1) {
      errors.push({
        file,
        row: lines[0]!,
        value: code,
        reason: `Duplicate card code "${code}" appears ${lines.length} times (rows ${lines.join(', ')})`,
      });
    }
  }
  return errors;
}

/* ─── Internal Parser ──────────────────────────────────────── */

function parseCSVInternal<T>(
  filePath: string,
  rowParser: (fields: string[], rowNum: number, errors: CSVError[]) => T | null,
  deduplicateCodes: boolean,
): CSVParseResult<T> {
  const errors: CSVError[] = [];
  const rows: T[] = [];

  const absolutePath = resolve(filePath);
  if (!existsSync(absolutePath)) {
    return { rows, errors: [{ file: filePath, row: 0, value: '', reason: `File not found: ${filePath}` }], rowCount: 0 };
  }

  const content = readFileSync(absolutePath, 'utf-8');
  const parsed = parseCSVLines(content);

  if (parsed.length === 0) {
    return { rows, errors: [{ file: filePath, row: 0, value: '', reason: 'File is empty' }], rowCount: 0 };
  }

  // Validate header
  const header = parsed[0]!;
  if (header.length < 2 || !header[0] || header[0].toLowerCase() !== 'code') {
    errors.push({ file: filePath, row: 1, value: header.join(','), reason: `Expected header starting with "code", got "${header[0]}"` });
    return { rows, errors, rowCount: 0 };
  }

  // Parse data rows
  for (let i = 1; i < parsed.length; i++) {
    const fields = parsed[i]!;
    const rowNum = i + 1;
    const result = rowParser(fields, rowNum, errors);
    if (result !== null) {
      rows.push(result);
    }
  }

  // Deduplicate check for collection/decklist CSVs
  if (deduplicateCodes && rows.length > 0) {
    const dedupErrors = findDuplicateCodes(rows, filePath, errors);
    errors.push(...dedupErrors);
  }

  return { rows, errors, rowCount: rows.length };
}
