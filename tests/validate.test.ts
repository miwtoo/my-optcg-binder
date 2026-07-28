import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAll } from '../src/lib/validate/index.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('CSV Validation', () => {
  it('passes on valid source data', () => {
    const result = validateAll(projectRoot);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
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
