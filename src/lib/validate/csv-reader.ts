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

/* ─── Catalog Code Loading ─────────────────────────────────── */

/**
 * Load the canonical set of known card codes from the committed
 * Vega-derived catalog artifact.  Falls back to an empty set if the
 * generated data has not been produced yet (e.g. first bootstrap).
 *
 * In CI the artifact is always present because `npm run validate`
 * runs after `npm run generate` or on a committed seed.
 */
function loadCatalogCodes(projectRoot: string): Set<string> {
  const catalogPath = resolve(projectRoot, 'src/data/generated/binder-data.json');
  if (!existsSync(catalogPath)) return new Set();
  try {
    const raw = readFileSync(catalogPath, 'utf-8');
    const data = JSON.parse(raw);
    const catalog = data?.catalog;
    if (!Array.isArray(catalog)) return new Set();
    return new Set(catalog.map((e: any) => e?.code).filter(Boolean));
  } catch {
    return new Set();
  }
}

/** Module-scoped cache; populated once the first time a project root is provided. */
let _knownCodes: Set<string> | null = null;
let _knownCodesRoot: string | null = null;

/**
 * Ensure the known-code set has been loaded for the given project root.
 * Idempotent: only reads the artifact once per root.
 */
export function ensureKnownCodes(projectRoot: string): Set<string> {
  if (_knownCodes !== null && _knownCodesRoot === projectRoot) return _knownCodes;
  _knownCodes = loadCatalogCodes(projectRoot);
  _knownCodesRoot = projectRoot;
  return _knownCodes;
}

/**
 * Normalize line endings and BOM.
 */
function normalizeCSV(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Parse a generic CSV string into rows.
 *
 * Rules:
 *   - blank lines between data rows are REJECTED (not silently filtered)
 *   - a trailing empty line from a final `\n` is allowed (common CSV convention)
 *   - every data row must have exactly the expected column count
 *   - fields are trimmed
 *   - no quoted fields expected in our data
 */
function parseCSVLines(
  text: string,
  expectedColumns: number,
  filePath: string,
  errors: CSVError[],
): { fields: string[]; lineNumber: number }[] {
  const normalized = normalizeCSV(text);
  const lines = normalized.split('\n');
  const result: { fields: string[]; lineNumber: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const isLast = i === lines.length - 1;
    const line = lines[i]!;
    const trimmed = line.trim();

    // Allow a trailing empty line (from final `\n`), but reject interior blank lines
    if (trimmed.length === 0) {
      if (isLast) continue;
      errors.push({ file: filePath, row: i + 1, value: '', reason: 'Blank row — blank lines are not permitted' });
      continue;
    }

    const fields = line.split(',').map(s => s.trim());

    // Extra columns are rejected
    if (fields.length > expectedColumns) {
      errors.push({ file: filePath, row: i + 1, value: line, reason: `Expected ${expectedColumns} column(s), got ${fields.length}: "${line}"` });
      continue;
    }

    result.push({ fields, lineNumber: i + 1 });
  }

  return result;
}

/* ─── Collection CSV ───────────────────────────────────────── */

export function parseCollectionCSV(filePath: string): CSVParseResult<CollectionRow> {
  return parseCSVInternal<CollectionRow>(
    filePath,
    (fields, rowNum, errors) => {
      if (fields.length < 2) {
        errors.push({ file: filePath, row: rowNum, value: fields.join(','), reason: `Expected 2 columns (code,amount), got ${fields.length}` });
        return null;
      }
      const code = fields[0]!.trim();
      const amountStr = fields[1]!.trim();
      const amount = Number(amountStr);

      if (!code) {
        errors.push({ file: filePath, row: rowNum, value: '(empty)', reason: 'Empty card code in field 0' });
        return null;
      }
      if (!Number.isInteger(amount) || amount < 1) {
        errors.push({ file: filePath, row: rowNum, value: amountStr, reason: `Amount must be a positive integer, got "${amountStr}"` });
        return null;
      }
      return { code, amount, row: rowNum };
    },
    true, // deduplicate
    2,   // expected columns: code,amount
    HEADER_COLLECTION,
  );
}

/* ─── Decklist CSV ─────────────────────────────────────────── */

export function parseDecklistCSV(filePath: string): CSVParseResult<DecklistRow> {
  // Sabo deck has the known `,51` exception row
  const isSabo = filePath.includes('Sabo');

  return parseCSVInternal<DecklistRow>(
    filePath,
    (fields, rowNum, errors) => {
      // Per spec: the Sabo `,51` summary row is the sole ignored exception.
      if (isSabo && fields.length === 2 && SABO_TOTAL_ROW.test(fields.join(','))) {
        return null; // silently skip — spec says this is the only permitted non-card row
      }
      if (fields.length < 2) {
        errors.push({ file: filePath, row: rowNum, value: fields.join(','), reason: `Expected 2 columns (code,amount), got ${fields.length}` });
        return null;
      }
      const code = fields[0]!.trim();
      const amountStr = fields[1]!.trim();
      const amount = Number(amountStr);

      if (!code) {
        errors.push({ file: filePath, row: rowNum, value: '(empty)', reason: 'Empty card code in field 0' });
        return null;
      }
      if (!Number.isInteger(amount) || amount < 1) {
        errors.push({ file: filePath, row: rowNum, value: amountStr, reason: `Amount must be a positive integer, got "${amountStr}"` });
        return null;
      }
      return { code, amount, row: rowNum };
    },
    true, // deduplicate
    2,   // expected columns: code,amount
    HEADER_DECKLIST,
  );
}

/* ─── Want to Buy CSV ──────────────────────────────────────── */

export function parseWantedCSV(filePath: string): CSVParseResult<WantedRow> {
  return parseCSVInternal<WantedRow>(
    filePath,
    (fields, rowNum, errors) => {
      if (fields.length < 3) {
        errors.push({ file: filePath, row: rowNum, value: fields.join(','), reason: `Expected 3 columns (code,amount,target), got ${fields.length}` });
        return null;
      }
      const code = fields[0]!.trim();
      const amountStr = fields[1]!.trim();
      const target = fields[2]!.trim();
      const amount = Number(amountStr);

      if (!code) {
        errors.push({ file: filePath, row: rowNum, value: '(empty)', reason: 'Empty card code in field 0' });
        return null;
      }
      if (!Number.isInteger(amount) || amount < 1) {
        errors.push({ file: filePath, row: rowNum, value: amountStr, reason: `Amount must be a positive integer, got "${amountStr}"` });
        return null;
      }
      if (!target) {
        errors.push({ file: filePath, row: rowNum, value: '(empty)', reason: 'Target must be non-empty (e.g. "binder" or a deck name)' });
        return null;
      }
      return { code, amount, target, row: rowNum };
    },
    false, // no dedup for wanted — same code can have different targets
    3,   // expected columns: code,amount,target
    HEADER_WANTED,
  );
}

/* ─── Generic CSV Validator ────────────────────────────────── */

export function validateCardCode(code: string, projectRoot?: string): boolean {
  return ensureKnownCodes(projectRoot ?? process.cwd()).has(code);
}

export function getKnownCodes(projectRoot?: string): Set<string> {
  return ensureKnownCodes(projectRoot ?? process.cwd());
}

/**
 * Validate that all card codes in parsed rows are known Vega catalog codes.
 * Requires `projectRoot` to resolve the committed catalog artifact.
 */
export function validateCodes<T extends { code: string }>(
  rows: T[],
  file: string,
  _existingErrors: CSVError[],
  projectRoot?: string,
): CSVError[] {
  const known = ensureKnownCodes(projectRoot ?? process.cwd());
  const errors: CSVError[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (!known.has(row.code)) {
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
  _existingErrors: CSVError[],
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

/** Validate wanted rows by their meaningful composite identity. */
export function findDuplicateWantedTargets(rows: WantedRow[], file: string): CSVError[] {
  const seen = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const key = `${row.code}\u0000${row.target}`;
    const lines = seen.get(key) ?? [];
    lines.push(i + 2);
    seen.set(key, lines);
  }
  return [...seen.entries()].filter(([, lines]) => lines.length > 1).map(([key, lines]) => {
    const [code, target] = key.split('\u0000');
    return { file, row: lines[0]!, value: `${code},${target}`, reason: `Duplicate wanted pair (code,target) appears ${lines.length} times (rows ${lines.join(', ')})` };
  });
}

/* ─── Internal Parser ──────────────────────────────────────── */

/**
 * Expected header column names per CSV type.
 */
const HEADER_COLLECTION = ['code', 'amount'];
const HEADER_DECKLIST = ['code', 'amount'];
const HEADER_WANTED = ['code', 'amount', 'target'];

function validateExactHeader(
  fields: string[],
  expected: string[],
  filePath: string,
): CSVError | null {
  if (fields.length === 0) {
    return { file: filePath, row: 1, value: '', reason: 'Header row is empty' };
  }
  const mismatch = fields.find((f, i) => {
    const exp = expected[i];
    return !exp || f.toLowerCase() !== exp;
  });
  if (mismatch !== undefined) {
    const line = fields.join(',');
    return {
      file: filePath, row: 1, value: line,
      reason: `Expected header: ${expected.join(',')}. Got: "${line}". First mismatch: "${mismatch}" (expected "${expected[fields.indexOf(mismatch)] ?? '<too many>'}")`,
    };
  }
  if (fields.length !== expected.length) {
    return {
      file: filePath, row: 1, value: fields.join(','),
      reason: `Expected ${expected.length} column(s), got ${fields.length}: "${fields.join(',')}"`,
    };
  }
  return null;
}

function parseCSVInternal<T extends { code: string }>(
  filePath: string,
  rowParser: (fields: string[], rowNum: number, errors: CSVError[]) => T | null,
  deduplicateCodes: boolean,
  expectedColumns: number,
  expectedHeader?: string[],
): CSVParseResult<T> {
  const errors: CSVError[] = [];
  const rows: T[] = [];

  const absolutePath = resolve(filePath);
  if (!existsSync(absolutePath)) {
    return { rows, errors: [{ file: filePath, row: 0, value: '', reason: `File not found: ${filePath}` }], rowCount: 0 };
  }

  const content = readFileSync(absolutePath, 'utf-8');

  const parsed = parseCSVLines(content, expectedColumns, filePath, errors);

  if (parsed.length === 0) {
    return { rows, errors: [{ file: filePath, row: 0, value: '', reason: 'File is empty' }], rowCount: 0 };
  }

  // Validate header (first line) — exact column names required
  if (expectedHeader) {
    const headerErr = validateExactHeader(parsed[0]!.fields, expectedHeader, filePath);
    if (headerErr) {
      errors.push(headerErr);
      return { rows, errors, rowCount: 0 };
    }
  } else {
    // Legacy fallback: just check first column is "code"
    const header = parsed[0]!.fields;
    if (header.length < 2 || !header[0] || header[0].toLowerCase() !== 'code') {
      errors.push({ file: filePath, row: 1, value: header.join(','), reason: `Expected header starting with "code", got "${header[0]}"` });
      return { rows, errors, rowCount: 0 };
    }
  }

  // Parse data rows (skip header)
  for (let i = 1; i < parsed.length; i++) {
    const { fields, lineNumber } = parsed[i]!;
    const result = rowParser(fields, lineNumber, errors);
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
