import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAll } from '../src/lib/validate/index.js';
import { computeBinderPlacement, computeBinderSummary, sortCardsPlayerFirst } from '../src/lib/binder/index.js';
import { SET_COLOR_MAP } from '../src/lib/data/constants.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ─── Heuristic catalog (same as build-fixture.js) ─────────── */

const knownLeaders = new Set([
  'OP05-007', 'OP05-051', 'OP07-015', 'OP07-016', 'OP07-017',
  'OP08-043', 'OP08-046', 'OP10-062', 'OP11-008', 'OP13-012',
  'ST06-015', 'ST35-001', 'OP13-004', 'OP02-068',
]);

function buildHeuristicCatalog(codes: string[]) {
  const catalog = new Map();
  for (const code of codes) {
    const prefix = code.match(/^([A-Z]+\d+)/)?.[1] ?? '';
    const heuristic = SET_COLOR_MAP[prefix];
    catalog.set(code, {
      code,
      name: null,
      color: heuristic?.color ?? null,
      cost: knownLeaders.has(code) ? 0 : null,
      type: knownLeaders.has(code) ? 'Leader' : null,
    });
  }
  return catalog;
}

describe('Binder Placement Engine', () => {
  const validation = validateAll(projectRoot);
  const allCodes = [
    ...new Set([
      ...validation.collection.map(r => r.code),
      ...validation.saboDeck.map(r => r.code),
      ...validation.luffyDeck.map(r => r.code),
    ]),
  ];
  const catalog = buildHeuristicCatalog(allCodes);

  const collectionMap = new Map(validation.collection.map(r => [r.code, r.amount]));
  const deckAllocations = new Map();
  deckAllocations.set('Sabo', new Map(validation.saboDeck.map(r => [r.code, r.amount])));
  deckAllocations.set('Luffy G_B [WIP]', new Map(validation.luffyDeck.map(r => [r.code, r.amount])));

  it('produces correct card count', () => {
    const result = computeBinderPlacement(collectionMap, deckAllocations, catalog);
    expect(result.cards.length).toBe(collectionMap.size);
  });

  it('binder quantity never exceeds owned quantity', () => {
    const result = computeBinderPlacement(collectionMap, deckAllocations, catalog);
    for (const card of result.cards) {
      expect(card.binderQuantity).toBeLessThanOrEqual(card.owned);
      expect(card.binderQuantity).toBeGreaterThanOrEqual(0);
    }
  });

  it('deck quantity sums correctly', () => {
    const result = computeBinderPlacement(collectionMap, deckAllocations, catalog);
    for (const card of result.cards) {
      const totalInDecks = card.deckAllocations.reduce((s, d) => s + d.quantity, 0);
      expect(totalInDecks + card.binderQuantity).toBe(card.owned);
    }
  });

  it('cards with binder quantity > 0 have a location', () => {
    const result = computeBinderPlacement(collectionMap, deckAllocations, catalog);
    const codesWithBinder = result.cards.filter(c => c.binderQuantity > 0);
    for (const card of codesWithBinder) {
      expect(card.binderLocation).not.toBeNull();
    }
  });

  it('all sheets are valid', () => {
    const result = computeBinderPlacement(collectionMap, deckAllocations, catalog);
    for (const sheet of result.sheets) {
      expect(sheet.sheet).toBeGreaterThanOrEqual(1);
      expect(['Front', 'Back']).toContain(sheet.side);
      expect(sheet.slots).toHaveLength(9);
    }
  });

  it('generates at least one sheet (binder has cards)', () => {
    const result = computeBinderPlacement(collectionMap, deckAllocations, catalog);
    expect(result.sheets.length).toBeGreaterThan(0);
  });

  it('computes summary correctly', () => {
    const result = computeBinderPlacement(collectionMap, deckAllocations, catalog);
    const summary = computeBinderSummary(result.cards, result.sheets);
    expect(summary.totalUniqueCodes).toBe(result.cards.length);
    expect(summary.totalSheets).toBe(result.sheets.length / 2);
    expect(summary.totalPossessedCards).toBeGreaterThan(0);
  });

  it('every sheet slot has a valid discriminated status', () => {
    const result = computeBinderPlacement(collectionMap, deckAllocations, catalog);
    const validStatuses = ['card', 'reserved', 'vacant', 'empty'];
    for (const sheet of result.sheets) {
      for (const slot of sheet.slots) {
        expect(validStatuses).toContain(slot.status);
        if (slot.status === 'card') {
          expect(slot).toHaveProperty('code');
          expect(slot).toHaveProperty('quantity');
          expect(slot.quantity).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('Sort Order', () => {
  it('Leaders sort before non-leaders', () => {
    const catalog = new Map();
    catalog.set('OP01-001', { code: 'OP01-001', name: null, color: 'Red', cost: 0, type: 'Leader' });
    catalog.set('OP01-002', { code: 'OP01-002', name: null, color: 'Red', cost: 3, type: 'Character' });
    const sorted = sortCardsPlayerFirst(['OP01-002', 'OP01-001'], catalog);
    expect(sorted[0]).toBe('OP01-001');
    expect(sorted[1]).toBe('OP01-002');
  });

  it('sorts by color order: Red, Green, Blue, Purple, Black, Yellow', () => {
    const catalog = new Map();
    catalog.set('OP01-001', { code: 'OP01-001', name: null, color: 'Red', cost: 3, type: 'Character' });
    catalog.set('OP02-001', { code: 'OP02-001', name: null, color: 'Green', cost: 3, type: 'Character' });
    catalog.set('OP03-001', { code: 'OP03-001', name: null, color: 'Purple', cost: 3, type: 'Character' });
    const sorted = sortCardsPlayerFirst(['OP02-001', 'OP03-001', 'OP01-001'], catalog);
    expect(sorted[0]).toBe('OP01-001'); // Red
    expect(sorted[1]).toBe('OP02-001'); // Green
    expect(sorted[2]).toBe('OP03-001'); // Purple
  });

  it('sorts by cost ascending within same color', () => {
    const catalog = new Map();
    catalog.set('C-01', { code: 'C-01', name: null, color: 'Red', cost: 5, type: 'Character' });
    catalog.set('C-02', { code: 'C-02', name: null, color: 'Red', cost: 1, type: 'Character' });
    catalog.set('C-03', { code: 'C-03', name: null, color: 'Red', cost: 3, type: 'Character' });
    const sorted = sortCardsPlayerFirst(['C-01', 'C-02', 'C-03'], catalog);
    expect(sorted[0]).toBe('C-02'); // cost 1
    expect(sorted[1]).toBe('C-03'); // cost 3
    expect(sorted[2]).toBe('C-01'); // cost 5
  });

  it('sorts by type: Character → Event → Stage within same color/cost', () => {
    const catalog = new Map();
    catalog.set('A', { code: 'A', name: null, color: 'Red', cost: 3, type: 'Event' });
    catalog.set('B', { code: 'B', name: null, color: 'Red', cost: 3, type: 'Character' });
    catalog.set('C', { code: 'C', name: null, color: 'Red', cost: 3, type: 'Stage' });
    const sorted = sortCardsPlayerFirst(['A', 'B', 'C'], catalog);
    expect(sorted[0]).toBe('B'); // Character
    expect(sorted[1]).toBe('A'); // Event
    expect(sorted[2]).toBe('C'); // Stage
  });

  it('sorts by code ascending as final tiebreaker', () => {
    const catalog = new Map();
    catalog.set('OP01-003', { code: 'OP01-003', name: null, color: 'Red', cost: 3, type: 'Character' });
    catalog.set('OP01-001', { code: 'OP01-001', name: null, color: 'Red', cost: 3, type: 'Character' });
    const sorted = sortCardsPlayerFirst(['OP01-003', 'OP01-001'], catalog);
    expect(sorted[0]).toBe('OP01-001');
    expect(sorted[1]).toBe('OP01-003');
  });
});
