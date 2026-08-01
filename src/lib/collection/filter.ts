export type DeckAllocation = { deck: string; quantity: number };

export type CardWithDeckAllocations = {
  decks?: DeckAllocation[];
};

/** Return deck names in a stable, user-facing order. */
export function deckNames(cards: CardWithDeckAllocations[]): string[] {
  return [...new Set(cards.flatMap(card => (card.decks ?? [])
    .filter(allocation => allocation.quantity > 0)
    .map(allocation => allocation.deck)))]
    .sort((a, b) => a.localeCompare(b));
}

/** A card belongs to a selected deck only when that deck has a positive allocation. */
export function hasPositiveDeckAllocation(
  card: CardWithDeckAllocations,
  selectedDeck: string,
): boolean {
  return (card.decks ?? []).some(allocation =>
    allocation.deck === selectedDeck && allocation.quantity > 0,
  );
}
