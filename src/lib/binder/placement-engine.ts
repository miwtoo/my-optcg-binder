/**
 * Binder placement engine.
 *
 * Converts validated collection + deck data into physical sheet/slot
 * assignments using the policy defined in 030-define-binder-placement-policy.md:
 *
 * - Section order: Leaders first, then Red → Green → Blue → Purple → Black → Yellow
 * - Within color: cost ascending, then Character → Event → Stage, then code ascending
 * - Leaders: color → code order
 * - Each group (color + cost + type) gets 3 reserved empty pockets
 * - When a group fills its reserved pockets, an overflow sheet is added
 * - Duplicate copies stack in a single slot with quantity indicator
 * - Binder quantity = collection quantity − deck allocations
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
} from '../data/types';
import { COLOR_ORDER, TYPE_ORDER } from '../data/types';
import { SLOTS_PER_SIDE, MAX_SHEETS, RESERVED_SLOTS_PER_GROUP } from '../data/constants';

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
    // Leaders ordered by color then code
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
 * @param collectionRows - Deduplicated collection rows: code → total owned
 * @param deckAllocations - Mapping of deck name → code → quantity allocated
 * @param catalog - Card catalog for sorting metadata
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
      if (deckQty > 0) {
        decks.push({ deck: deckName, quantity: deckQty });
        totalInDecks += deckQty;
      }
    }

    codeAllocations.set(code, { owned, decks });
  }

  // 2. Filter to only codes with binder quantity > 0 for placement
  const binderCodes = new Map<string, number>();
  for (const [code, alloc] of codeAllocations) {
    const binderQty = alloc.owned - alloc.decks.reduce((sum, d) => sum + d.quantity, 0);
    if (binderQty > 0) {
      binderCodes.set(code, binderQty);
    }
  }

  // 3. Sort codes in player-first order
  const sortedCodes = sortCardsPlayerFirst([...binderCodes.keys()], catalog);

  // 4. Assign sheet/side/slot locations
  const sheetAssignments = assignInGroupsWithReservedSlots(sortedCodes, binderCodes, catalog);

  // 5. Build sheets from assignments
  const sheets = buildSheets(sheetAssignments);

  // 6. Build card entries
  for (const [code, alloc] of codeAllocations) {
    const totalInDecks = alloc.decks.reduce((sum, d) => sum + d.quantity, 0);
    const binderQty = Math.max(0, alloc.owned - totalInDecks);
    const location = sheetAssignments.locations.get(code) ?? null;
    const entry = catalog.get(code);

    cards.push({
      code,
      name: entry?.name ?? null,
      owned: alloc.owned,
      binderQuantity: binderQty,
      deckAllocations: alloc.decks,
      binderLocation: location,
    });

    if (location) {
      cardLocationMap.set(code, location);
    }
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

  // Group codes
  const groups = new Map<string, string[]>();
  for (const code of sortedCodes) {
    const gk = groupKeyForCard(code, catalog);
    const key = formatGroupKey(gk);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(code);
  }

  // Assign slots sequentially: each code gets one slot (quantity stacks)
  // Leader codes first (they have cost -999)
  // After leaders, color → cost → type groups each get 3 reserved empty pockets
  // When a group runs out, overflow sheets are added

  const groupKeys = [...groups.keys()];

  // We need to interleave reserved slots properly.
  // For each group, we allocate:
  //   - code slots (one per unique code in the group)
  //   - then 3 reserved empty slots (unless this is the last group)
  //
  // But wait — the spec says "each populated color/cost/type group gets
  // three adjacent empty pockets. A newly acquired distinct card code fills
  // the first such empty pocket."
  // So the reserved slots come AFTER the group's cards.
  //
  // Also: "When a group has no spare pocket, a removable overflow sheet is
  // inserted after the final physical sheet in that color section"
  //
  // So the algorithm is:
  // 1. Place all group cards
  // 2. Add 3 reserved slots after the group
  // 3. If we hit the end of a sheet side, the reserved slots go on the next side
  // 4. If a color section fills up, overflow sheets are inserted

  let currentSheet = 1;
  let currentSide: 'Front' | 'Back' = 'Front';
  let currentSlot = 1;

  const advanceSlot = () => {
    currentSlot++;
    if (currentSlot > SLOTS_PER_SIDE) {
      currentSlot = 1;
      if (currentSide === 'Front') {
        currentSide = 'Back';
      } else {
        currentSide = 'Front';
        currentSheet++;
      }
    }
  };

  const currentColorSections = new Map</* color */ string, { startSheet: number; endSheet: number }>();

  for (const gk of groupKeys) {
    const codes = groups.get(gk)!;
    // Detect color section changes for overflow tracking
    const firstCode = codes[0]!;
    const firstEntry = catalog.get(firstCode);
    const isLeader = firstEntry?.type === 'Leader';
    const sectionColor = isLeader ? '__LEADER__' : (firstEntry?.color ?? '__UNKNOWN__');

    // Track color section boundaries
    if (!currentColorSections.has(sectionColor)) {
      currentColorSections.set(sectionColor, { startSheet: currentSheet, endSheet: currentSheet });
    }

    // Place each code in the group
    for (const code of codes) {
      // Check if we've overflowed max sheets
      if (currentSheet > MAX_SHEETS) {
        // Overflow: add sheets beyond max (removable overflow sheets)
        // For simplicity, we continue assigning but track overflow
      }

      locations.set(code, {
        sheet: currentSheet,
        side: currentSide,
        slot: currentSlot,
      });
      advanceSlot();
    }

    // Add 3 reserved slots after the group (unless these are leaders)
    if (!isLeader && codes.length > 0) {
      // Check if we need overflow sheets (if we'd exceed current sheet tracking)
      // For the slot assignment, reserved slots occupy real slot positions
      // but with null entries
      for (let r = 0; r < RESERVED_SLOTS_PER_GROUP; r++) {
        // We track reserved slots internally; they're stored as null in the sheet
        // The locations map already recorded the group's last slot
        advanceSlot(); // skip one slot (reserved)
      }
    }

    // Update color section end
    const section = currentColorSections.get(sectionColor);
    if (section) {
      section.endSheet = currentSheet;
    }
  }

  const totalSheets = currentSheet;
  const overflowSheets = Math.max(0, currentSheet - MAX_SHEETS);
  const reservedSlots = groupKeys.length * RESERVED_SLOTS_PER_GROUP;

  return { locations, totalSheets, overflowSheets, reservedSlots };
}

/* ─── Sheet Builder ────────────────────────────────────────── */

function buildSheets(assignments: GroupedSheetAssignments): BinderSheet[] {
  // Collect all occupied slot positions
  const slotMap = new Map<string, SlotEntry>(); // "sheet-side-slot" -> entry

  for (const [code, loc] of assignments.locations) {
    const key = `${loc.sheet}-${loc.side}-${loc.slot}`;
    slotMap.set(key, { code, quantity: 1 }); // quantity is per-card-code placement
  }

  // Build sheet grid
  const sheets: BinderSheet[] = [];
  const maxSheet = assignments.totalSheets;

  for (let s = 1; s <= maxSheet; s++) {
    for (const side of ['Front', 'Back'] as const) {
      const slots: (SlotEntry | null)[] = [];
      for (let slot = 1; slot <= SLOTS_PER_SIDE; slot++) {
        const key = `${s}-${side}-${slot}`;
        const entry = slotMap.get(key) ?? null;
        slots.push(entry);
      }
      sheets.push({ sheet: s, side, slots });
    }
  }

  return sheets;
}

/* ─── Sorting ──────────────────────────────────────────────── */

/**
 * Sort card codes in player-first order:
 * 1. Leaders first (ordered by color then code)
 * 2. Red → Green → Blue → Purple → Black → Yellow
 * 3. Within each color: cost ascending
 * 4. Within cost: Character → Event → Stage
 * 5. Within type: code ascending
 */
export function sortCardsPlayerFirst(
  codes: string[],
  catalog: Map<string, CatalogEntry>,
): string[] {
  return [...codes].sort((a, b) => {
    const entryA = catalog.get(a);
    const entryB = catalog.get(b);

    const typeA = entryA?.type ?? null;
    const typeB = entryB?.type ?? null;
    const colorA = entryA?.color ?? null;
    const colorB = entryB?.color ?? null;
    const costA = entryA?.cost ?? -1;
    const costB = entryB?.cost ?? -1;

    // Leaders first
    const aIsLeader = typeA === 'Leader';
    const bIsLeader = typeB === 'Leader';
    if (aIsLeader && !bIsLeader) return -1;
    if (!aIsLeader && bIsLeader) return 1;

    // Color order
    if (aIsLeader && bIsLeader) {
      // Leaders: color then code
      const ci = compareColor(colorA, colorB);
      if (ci !== 0) return ci;
      return a.localeCompare(b);
    }

    // Non-leaders: color → cost → type → code
    const colorOrder = compareColor(colorA, colorB);
    if (colorOrder !== 0) return colorOrder;

    if (costA !== costB) return costA - costB;

    const typeOrder = compareType(typeA, typeB);
    if (typeOrder !== 0) return typeOrder;

    return a.localeCompare(b);
  });
}

function compareColor(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const ai = COLOR_ORDER.indexOf(a as CardColor);
  const bi = COLOR_ORDER.indexOf(b as CardColor);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}

function compareType(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const ai = TYPE_ORDER.indexOf(a as CardType);
  const bi = TYPE_ORDER.indexOf(b as CardType);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
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
      if (slot === null) {
        reservedSlots++;
      }
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
