import { describe, expect, it } from 'vitest';
import { deckNames, hasPositiveDeckAllocation } from '../src/lib/collection/filter.js';

describe('collection deck filtering', () => {
  const cards = [
    { decks: [{ deck: 'Sabo', quantity: 2 }, { deck: 'Unused', quantity: 0 }] },
    { decks: [{ deck: 'Luffy G_B [WIP]', quantity: 1 }] },
    { decks: [{ deck: 'Sabo', quantity: 1 }] },
  ];

  it('lists each deck once in stable order', () => {
    expect(deckNames(cards)).toEqual(['Luffy G_B [WIP]', 'Sabo']);
  });

  it('omits cards with missing, empty, or non-positive deck allocations', () => {
    expect(deckNames([
      {},
      { decks: [] },
      { decks: [{ deck: 'Zero', quantity: 0 }, { deck: 'Negative', quantity: -1 }] },
      { decks: [{ deck: 'Active', quantity: 1 }] },
    ] as { decks?: { deck: string; quantity: number }[] }[])).toEqual(['Active']);
  });

  it('returns no deck options when no card has a positive allocation', () => {
    expect(deckNames([
      { decks: [{ deck: 'Empty', quantity: 0 }] },
      { decks: [] },
    ])).toEqual([]);
  });

  it('matches only cards with a positive allocation for the selected deck', () => {
    expect(cards.map(card => hasPositiveDeckAllocation(card, 'Sabo'))).toEqual([true, false, true]);
    expect(hasPositiveDeckAllocation(cards[0], 'Unused')).toBe(false);
  });
});
