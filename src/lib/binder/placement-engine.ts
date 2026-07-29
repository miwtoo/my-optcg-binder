/**
 * Binder placement engine (legacy — tests only).
 *
 * DEPRECATED: New code should use `createInitialBinderLayout` /
 * `reconcileBinderLayout` from `./layout`.  This module is preserved
 * so existing placement integration tests continue to pass without
 * requiring a Vega snapshot.
 */

import type {
  CardEntry,
  CatalogEntry,
  BinderSheet,
  BinderLocation,
  SlotEntry,
  DeckAllocation,
  CardColor,
  CardType,
  DiscriminatedSlot,
} from '../data/types';
import { COLOR_ORDER, TYPE_ORDER } from '../data/types';
import { SLOTS_PER_SIDE, MAX_SHEETS, RESERVED_SLOTS_PER_GROUP } from '../data/constants';
import { sortCardsPlayerFirst } from './sort';

/* ─── Group Key ────────────────────────────────────────────── */

interface GroupKey {
  color: CardColor | '__LEADER__' | '__UNKNOWN__';
  cost: number;
  type: CardType | '__UNKNOWN__';
}

function groupKeyForCard(code: string, catalog: Map<string, CatalogEntry>): GroupKey {
  const entry = catalog.get(code);
  if (!entry || !entry.color || !entry.type) {
    return { color: '__UNKNOWN__', cost: -1, type: '__UNKNOWN__' };
  }
  if (entry.type === 'Leader') {
    return { color: entry.color, cost: -999, type: 'Leader' };
  }
  return { color: entry.color, cost: entry.cost ?? 999, type: entry.type };
}

function formatGroupKey(gk: GroupKey): string {
  return `${gk.color}|${gk.cost}|${gk.type}`;
}

/* ─── Main Placement Algorithm ─────────────────────────────── */

export interface PlacementResult {
  cards: CardEntry[];
  sheets: BinderSheet[];
  cardLocationMap: Map<string, BinderLocation>;
}

/**
 * Compute binder placement from collection and deck data.
 *
 * @deprecated Use `createInitialBinderLayout` / `reconcileBinderLayout`.
 */
export function computeBinderPlacement(
  collectionMap: Map<string, number>,
  deckAllocations: Map<string, Map<string, number>>,
  catalog: Map<string, CatalogEntry>,
): PlacementResult {
  const cards: CardEntry[] = [];
  const cardLocationMap = new Map<string, BinderLocation>();

  // 1. Compute binder quantity for each code
  const codeAllocations = new Map<string, { owned: number; decks: DeckAllocation[] }>();
  for (const [code, owned] of collectionMap) {
    const decks: DeckAllocation[] = [];
    let totalInDecks = 0;
    for (const [deckName, deckCodes] of deckAllocations) {
      const deckQty = deckCodes.get(code) ?? 0;
      if (deckQty > 0) { decks.push({ deck: deckName, quantity: deckQty }); totalInDecks += deckQty; }
    }
    codeAllocations.set(code, { owned, decks });
  }

  // 2. Filter to only codes with binder quantity > 0
  const binderCodes = new Map<string, number>();
  for (const [code, alloc] of codeAllocations) {
    const binderQty = alloc.owned - alloc.decks.reduce((s, d) => s + d.quantity, 0);
    if (binderQty > 0) binderCodes.set(code, binderQty);
  }

  // 3. Sort in player-first order
  const sortedCodes = sortCardsPlayerFirst([...binderCodes.keys()], catalog);

  // 4. Assign sheet/side/slot locations
  const sheetAssignments = assignInGroupsWithReservedSlots(sortedCodes, binderCodes, catalog);

  // 5. Build sheets
  const sheets = buildSheets(sheetAssignments);

  // 6. Build card entries
  for (const [code, alloc] of codeAllocations) {
    const totalInDecks = alloc.decks.reduce((s, d) => s + d.quantity, 0);
    const binderQty = Math.max(0, alloc.owned - totalInDecks);
    const location = sheetAssignments.locations.get(code) ?? null;
    const entry = catalog.get(code);
    cards.push({
      code, name: entry?.name ?? null,
      owned: alloc.owned, binderQuantity: binderQty,
      deckAllocations: alloc.decks, binderLocation: location,
    });
    if (location) cardLocationMap.set(code, location);
  }

  return { cards, sheets, cardLocationMap };
}

/* ─── Group-Based Placement with Reserve Slots ─────────────── */

interface GroupedSheetAssignments {
  locations: Map<string, BinderLocation>;
  totalSheets: number;
  overflowSheets: number;
  reservedSlots: number;
}

function assignInGroupsWithReservedSlots(
  sortedCodes: string[],
  _binderQuantities: Map<string, number>,
  catalog: Map<string, CatalogEntry>,
): GroupedSheetAssignments {
  const locations = new Map<string, BinderLocation>();

  const groups = new Map<string, string[]>();
  for (const code of sortedCodes) {
    const gk = groupKeyForCard(code, catalog);
    const key = formatGroupKey(gk);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(code);
  }

  const groupKeys = [...groups.keys()];

  let currentSheet = 1;
  let currentSide: 'Front' | 'Back' = 'Front';
  let currentSlot = 1;

  const advanceSlot = () => {
    currentSlot++;
    if (currentSlot > SLOTS_PER_SIDE) {
      currentSlot = 1;
      currentSide = currentSide === 'Front' ? 'Back' : 'Front';
      if (currentSide === 'Front') currentSheet++;
    }
  };

  const currentColorSections = new Map<string, { startSheet: number; endSheet: number }>();

  for (const gk of groupKeys) {
    const codes = groups.get(gk)!;
    const firstCode = codes[0]!;
    const firstEntry = catalog.get(firstCode);
    const isLeader = firstEntry?.type === 'Leader';
    const sectionColor = isLeader ? '__LEADER__' : (firstEntry?.color ?? '__UNKNOWN__');

    if (!currentColorSections.has(sectionColor)) {
      currentColorSections.set(sectionColor, { startSheet: currentSheet, endSheet: currentSheet });
    }

    for (const code of codes) {
      locations.set(code, { sheet: currentSheet, side: currentSide, slot: currentSlot });
      advanceSlot();
    }

    if (!isLeader && codes.length > 0) {
      for (let r = 0; r < RESERVED_SLOTS_PER_GROUP; r++) advanceSlot();
    }

    const section = currentColorSections.get(sectionColor);
    if (section) section.endSheet = currentSheet;
  }

  const totalSheets = currentSheet;
  const overflowSheets = Math.max(0, currentSheet - MAX_SHEETS);
  const reservedSlots = groupKeys.length * RESERVED_SLOTS_PER_GROUP;

  return { locations, totalSheets, overflowSheets, reservedSlots };
}

/* ─── Sheet Builder ────────────────────────────────────────── */

function buildSheets(assignments: GroupedSheetAssignments): BinderSheet[] {
  const slotMap = new Map<string, DiscriminatedSlot>();
  for (const [code, loc] of assignments.locations) {
    slotMap.set(`${loc.sheet}-${loc.side}-${loc.slot}`, { status: 'card', code, quantity: 1 });
  }

  const sheets: BinderSheet[] = [];
  const maxSheet = assignments.totalSheets;
  let reservedRemaining = assignments.reservedSlots;

  for (let s = 1; s <= maxSheet; s++) {
    for (const side of ['Front', 'Back'] as const) {
      const slots: DiscriminatedSlot[] = [];
      for (let slot = 1; slot <= SLOTS_PER_SIDE; slot++) {
        const key = `${s}-${side}-${slot}`;
        const existing = slotMap.get(key);
        if (existing) {
          slots.push(existing);
        } else if (reservedRemaining > 0) {
          slots.push({ status: 'reserved' });
          reservedRemaining--;
        } else {
          slots.push({ status: 'empty' });
        }
      }
      sheets.push({ sheet: s, side, slots });
    }
  }

  return sheets;
}

/* ─── Compute Binder Summary ───────────────────────────────── */

export function computeBinderSummary(
  cards: CardEntry[],
  sheets: BinderSheet[],
): {
  totalPossessedCards: number;
  totalUniqueCodes: number;
  totalSheets: number;
  totalDeckCards: number;
  totalBinderCards: number;
  reservedSlots: number;
  overflowSheets: number;
} {
  let totalPossessedCards = 0;
  let totalDeckCards = 0;
  let totalBinderCards = 0;
  let reservedSlots = 0;

  for (const card of cards) {
    totalPossessedCards += card.owned;
    totalDeckCards += card.deckAllocations.reduce((s, d) => s + d.quantity, 0);
    totalBinderCards += Math.max(0, card.owned - card.deckAllocations.reduce((s, d) => s + d.quantity, 0));
  }

  for (const sheet of sheets) {
    for (const slot of sheet.slots) {
      if (slot.status === 'reserved') reservedSlots++;
    }
  }

  const overflowSheets = Math.max(0, sheets.length / 2 - MAX_SHEETS);

  return {
    totalPossessedCards,
    totalUniqueCodes: cards.length,
    totalSheets: sheets.length / 2,
    totalDeckCards,
    totalBinderCards,
    reservedSlots,
    overflowSheets,
  };
}
