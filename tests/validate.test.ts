import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { validateAll, validateInputs } from '../src/lib/validate/index.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('CSV Validation', () => {
  it('passes on valid source data (the Sabo ,51 summary row is silently ignored per spec)', () => {
    const result = validateAll(projectRoot);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports a public unknown-code error after the skipped Sabo summary row', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'optcg-validation-'));
    try {
      writeFileSync(resolve(root, 'One Piece TCG Collection - All.csv'), 'code,amount\nOP13-004,1\n');
      writeFileSync(resolve(root, 'One Piece TCG Collection - Sabo.csv'), 'code,amount\nOP13-004,1\n,51\nZZZZ-NOPE,3\n');
      writeFileSync(resolve(root, 'One Piece TCG Collection - Lufy G_B [WIP].csv'), 'code,amount\nOP13-004,1\n');
      writeFileSync(resolve(root, 'Want to Buy.csv'), 'code,amount,target\nOP13-004,1,binder\n');
      const result = validateInputs(root, new Set(['OP13-004']));
      expect(result.errors).toContainEqual({
        file: 'One Piece TCG Collection - Sabo.csv',
        row: 4,
        value: 'ZZZZ-NOPE',
        reason: 'Unknown card code "ZZZZ-NOPE" — not in Vega catalog',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports duplicate collection rows with source filename, row, value, and reason', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'optcg-validation-'));
    try {
      writeFileSync(resolve(root, 'One Piece TCG Collection - All.csv'), 'code,amount\nOP13-004,1\nOP13-004,2\n');
      writeFileSync(resolve(root, 'One Piece TCG Collection - Sabo.csv'), 'code,amount\nOP13-004,1\n');
      writeFileSync(resolve(root, 'One Piece TCG Collection - Lufy G_B [WIP].csv'), 'code,amount\nOP13-004,1\n');
      writeFileSync(resolve(root, 'Want to Buy.csv'), 'code,amount,target\nOP13-004,1,binder\n');
      const result = validateInputs(root, new Set(['OP13-004']));
      expect(result.errors).toContainEqual({
        file: resolve(root, 'One Piece TCG Collection - All.csv'),
        row: 2,
        value: 'OP13-004',
        reason: 'Duplicate card code "OP13-004" appears 2 times (rows 2, 3)',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports negative quantities with source filename, row, value, and reason', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'optcg-validation-'));
    try {
      writeFileSync(resolve(root, 'One Piece TCG Collection - All.csv'), 'code,amount\nOP13-004,-2\n');
      writeFileSync(resolve(root, 'One Piece TCG Collection - Sabo.csv'), 'code,amount\nOP13-004,1\n');
      writeFileSync(resolve(root, 'One Piece TCG Collection - Lufy G_B [WIP].csv'), 'code,amount\nOP13-004,1\n');
      writeFileSync(resolve(root, 'Want to Buy.csv'), 'code,amount,target\nOP13-004,1,binder\n');
      const result = validateInputs(root, new Set(['OP13-004']));
      expect(result.errors).toContainEqual({
        file: resolve(root, 'One Piece TCG Collection - All.csv'),
        row: 2,
        value: '-2',
        reason: 'Amount must be a positive integer, got "-2"',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('parses all collection rows', () => {
    const result = validateAll(projectRoot);
    // After deduplication: original ~67 rows minus 3 duplicates = 64 unique codes
    expect(result.collection.length).toBeGreaterThan(0);
    expect(result.collection.every(r => r.code && r.amount > 0)).toBe(true);
  });

  it('parses Sabo deck with the ,51 exception row silently skipped', () => {
    const result = validateAll(projectRoot);
    // The `,51` row should be silently skipped — count should be pure data rows
    expect(result.saboDeck.length).toBeGreaterThan(0);
    // Verify no row has empty code
    expect(result.saboDeck.every(r => r.code.length > 0)).toBe(true);
  });

  it('parses Luffy deck', () => {
    const result = validateAll(projectRoot);
    expect(result.luffyDeck.length).toBeGreaterThan(0);
    expect(result.luffyDeck.every(r => r.code && r.amount > 0)).toBe(true);
  });

  it('parses Want to Buy CSV', () => {
    const result = validateAll(projectRoot);
    expect(result.wanted.length).toBeGreaterThan(0);
    expect(result.wanted.every(w => w.code && w.amount > 0 && w.target.length > 0)).toBe(true);
  });

  it('generates source manifest with checksums', () => {
    const result = validateAll(projectRoot);
    expect(result.sources.files).toBeDefined();
    expect(Object.keys(result.sources.files).length).toBeGreaterThanOrEqual(3);
    for (const [, entry] of Object.entries(result.sources.files)) {
      expect(entry.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.rowCount).toBeGreaterThan(0);
    }
  });

  it('contains no duplicate card codes in collection', () => {
    const result = validateAll(projectRoot);
    const codes = result.collection.map(r => r.code);
    const uniqueCodes = new Set(codes);
    expect(codes.length).toBe(uniqueCodes.size);
  });

  it('contains no duplicate card codes in Sabo deck', () => {
    const result = validateAll(projectRoot);
    const codes = result.saboDeck.map(r => r.code);
    const uniqueCodes = new Set(codes);
    expect(codes.length).toBe(uniqueCodes.size);
  });

  it('contains no duplicate card codes in Luffy deck', () => {
    const result = validateAll(projectRoot);
    const codes = result.luffyDeck.map(r => r.code);
    const uniqueCodes = new Set(codes);
    expect(codes.length).toBe(uniqueCodes.size);
  });
});
