import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const generatedPath = resolve(projectRoot, 'src/data/generated/binder-data.json');

describe('Generated Data Contract', () => {
  let data: any;

  beforeAll(() => {
    expect(existsSync(generatedPath)).toBe(true);
    const raw = readFileSync(generatedPath, 'utf-8');
    data = JSON.parse(raw);
  });

  it('has all required top-level keys', () => {
    const required = ['meta', 'catalog', 'cards', 'sheets', 'binder', 'wanted', 'sources', 'attribution'];
    for (const key of required) {
      expect(data).toHaveProperty(key);
    }
  });

  it('meta has required fields', () => {
    expect(data.meta).toHaveProperty('generated');
    expect(data.meta).toHaveProperty('generator');
    expect(data.meta).toHaveProperty('catalogSource');
    expect(data.meta).toHaveProperty('totalCards');
    expect(data.meta).toHaveProperty('totalSheets');
    expect(data.meta).toHaveProperty('dataProvenance');
    expect(typeof data.meta.generated).toBe('string');
    expect(data.meta.totalCards).toBeGreaterThan(0);
    expect(data.meta.totalSheets).toBeGreaterThan(0);
  });

  it('catalog entries have required fields', () => {
    expect(Array.isArray(data.catalog)).toBe(true);
    expect(data.catalog.length).toBeGreaterThan(0);
    for (const entry of data.catalog) {
      expect(entry).toHaveProperty('code');
      expect(entry).toHaveProperty('color');
      expect(entry).toHaveProperty('cost');
      expect(entry).toHaveProperty('type');
      expect(typeof entry.code).toBe('string');
      expect(entry.code).toMatch(/^[A-Z]+-?\d+(-\d+)?$/);
    }
  });

  it('cards have required fields', () => {
    expect(Array.isArray(data.cards)).toBe(true);
    expect(data.cards.length).toBeGreaterThan(0);
    for (const card of data.cards) {
      expect(card).toHaveProperty('code');
      expect(card).toHaveProperty('owned');
      expect(card).toHaveProperty('binderQuantity');
      expect(card).toHaveProperty('deckAllocations');
      expect(Array.isArray(card.deckAllocations)).toBe(true);
      expect(card.owned).toBeGreaterThan(0);
      expect(card.binderQuantity).toBeGreaterThanOrEqual(0);
    }
  });

  it('sheets have valid structure', () => {
    expect(Array.isArray(data.sheets)).toBe(true);
    expect(data.sheets.length).toBeGreaterThan(0);
    for (const sheet of data.sheets) {
      expect(sheet).toHaveProperty('sheet');
      expect(sheet).toHaveProperty('side');
      expect(['Front', 'Back']).toContain(sheet.side);
      expect(sheet).toHaveProperty('slots');
      expect(Array.isArray(sheet.slots)).toBe(true);
      expect(sheet.slots).toHaveLength(9);
      for (const slot of sheet.slots) {
        if (slot !== null) {
          expect(slot).toHaveProperty('code');
          expect(slot).toHaveProperty('quantity');
          expect(typeof slot.code).toBe('string');
          expect(slot.quantity).toBeGreaterThan(0);
        }
      }
    }
  });

  it('binder summary has all fields', () => {
    expect(data.binder).toHaveProperty('totalPossessedCards');
    expect(data.binder).toHaveProperty('totalUniqueCodes');
    expect(data.binder).toHaveProperty('totalSheets');
    expect(data.binder).toHaveProperty('totalDeckCards');
    expect(data.binder).toHaveProperty('totalBinderCards');
    expect(data.binder).toHaveProperty('reservedSlots');
    expect(data.binder).toHaveProperty('overflowSheets');
    expect(data.binder.totalUniqueCodes).toBe(data.cards.length);
    expect(data.binder.totalSheets).toBe(data.sheets.length / 2);
  });

  it('wanted entries have required fields', () => {
    expect(Array.isArray(data.wanted)).toBe(true);
    for (const entry of data.wanted) {
      expect(entry).toHaveProperty('code');
      expect(entry).toHaveProperty('amount');
      expect(entry).toHaveProperty('target');
      expect(typeof entry.code).toBe('string');
      expect(entry.amount).toBeGreaterThan(0);
      expect(typeof entry.target).toBe('string');
      expect(entry.target.length).toBeGreaterThan(0);
    }
  });

  it('sources manifest has all files', () => {
    expect(data.sources).toHaveProperty('generated');
    expect(data.sources).toHaveProperty('files');
    expect(typeof data.sources.generated).toBe('string');
    const fileNames = Object.keys(data.sources.files);
    expect(fileNames.length).toBeGreaterThanOrEqual(3);
    expect(fileNames.some(f => f.includes('All'))).toBe(true);
    expect(fileNames.some(f => f.includes('Sabo'))).toBe(true);
    expect(fileNames.some(f => f.includes('Lufy'))).toBe(true);
  });

  it('attribution has all required notices', () => {
    expect(data.attribution).toHaveProperty('copyright');
    expect(data.attribution).toHaveProperty('disclaimer');
    expect(data.attribution).toHaveProperty('dataSource');
    expect(data.attribution).toHaveProperty('dataSourceUrl');
    expect(data.attribution).toHaveProperty('toolUsed');
    expect(data.attribution.copyright).toContain('Bandai');
    expect(data.attribution.disclaimer).toContain('Not affiliated');
  });

  it('cards with binder locations have valid references', () => {
    const cardsWithLoc = data.cards.filter(c => c.binderLocation !== null);
    for (const card of cardsWithLoc) {
      expect(card.binderLocation).toHaveProperty('sheet');
      expect(card.binderLocation).toHaveProperty('side');
      expect(card.binderLocation).toHaveProperty('slot');
      expect(card.binderLocation.sheet).toBeGreaterThanOrEqual(1);
      expect(['Front', 'Back']).toContain(card.binderLocation.side);
      expect(card.binderLocation.slot).toBeGreaterThanOrEqual(1);
      expect(card.binderLocation.slot).toBeLessThanOrEqual(9);
    }
  });

  it('deck allocations reference valid deck names', () => {
    for (const card of data.cards) {
      for (const alloc of card.deckAllocations) {
        expect(typeof alloc.deck).toBe('string');
        expect(typeof alloc.quantity).toBe('number');
        expect(alloc.quantity).toBeGreaterThan(0);
      }
    }
  });
});

describe('CSV Corrections', () => {
  it('duplicate OP05-057 is removed (only one row exists)', () => {
    const csv = readFileSync(resolve(projectRoot, 'One Piece TCG Collection - All.csv'), 'utf-8');
    const matches = csv.match(/OP05-057/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBe(1);
  });

  it('duplicate EB01-028 is removed (only one row exists)', () => {
    const csv = readFileSync(resolve(projectRoot, 'One Piece TCG Collection - All.csv'), 'utf-8');
    const matches = csv.match(/EB01-028/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBe(1);
  });

  it('duplicate OP14-074 is removed (only one row exists)', () => {
    const csv = readFileSync(resolve(projectRoot, 'One Piece TCG Collection - All.csv'), 'utf-8');
    const matches = csv.match(/OP14-074/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBe(1);
  });

  it('EB-03-008 is corrected to EB03-008', () => {
    const csv = readFileSync(resolve(projectRoot, 'One Piece TCG Collection - All.csv'), 'utf-8');
    expect(csv).not.toContain('EB-03-008');
    expect(csv).toContain('EB03-008');
  });

  it('EB03-52 is corrected to EB03-052', () => {
    const csv = readFileSync(resolve(projectRoot, 'One Piece TCG Collection - All.csv'), 'utf-8');
    expect(csv).not.toContain('EB03-52,');
    expect(csv).toContain('EB03-052');
  });

  it('Want to Buy.csv exists with valid entries', () => {
    expect(existsSync(resolve(projectRoot, 'Want to Buy.csv'))).toBe(true);
    const csv = readFileSync(resolve(projectRoot, 'Want to Buy.csv'), 'utf-8');
    const lines = csv.trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(1); // header + data
    expect(lines[0]).toContain('code');
    expect(lines[0]).toContain('target');
  });

  it('Sabo CSV preserves the ,51 exception row', () => {
    const csv = readFileSync(resolve(projectRoot, 'One Piece TCG Collection - Sabo.csv'), 'utf-8');
    expect(csv).toContain(',51');
  });
});
