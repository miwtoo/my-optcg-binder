/**
 * Binder layout — immutable ledger + reconciliation.
 *
 * No wall-clock, heuristic, or unstable identifiers.  The layout produced
 * by createInitialBinderLayout is the canonical physical assignment; every
 * subsequent reconciliation preserves every existing sheetId, pocket, and
 * card-code assignment.  New cards consume section reserves first, then
 * append a complete Front+Back overflow sheet directly after the owning
 * color section.
 */

import type {
  CatalogEntry,
  BinderLayout,
  BinderLayoutPocket,
  BinderLocation,
} from '../data/types';
import { SLOTS_PER_SIDE, RESERVED_SLOTS_PER_GROUP } from '../data/constants';
import { sortCardsPlayerFirst } from './sort';

/* ─── Errors ──────────────────────────────────────────────── */

export interface BinderInputError { code: string; reason: string }
export interface LayoutReconciliation { layout: BinderLayout; locations: Map<string, BinderLocation> }

type CatalogInput = Map<string, CatalogEntry> | CatalogEntry[];

/* ─── Helpers ─────────────────────────────────────────────── */

function asMap(input: CatalogInput): Map<string, CatalogEntry> {
  return input instanceof Map ? input : new Map(input.map(e => [e.code, e]));
}

function sectionFor(entry: CatalogEntry): string {
  if (!entry.color || !entry.type) return '__UNKNOWN__';
  return entry.type === 'Leader'
    ? `Leader:${entry.color}`
    : `${entry.color}:${entry.cost ?? 'unknown'}:${entry.type}`;
}

function emptyPocket(
  sheetId: string, section: string, pocket: number,
  status: BinderLayoutPocket['status'], tag?: string,
): BinderLayoutPocket {
  return { sheetId, section, pocket, status, ...(tag ? { tag } : {}) };
}

/* ─── Validation ──────────────────────────────────────────── */

/** Return all fatal inventory/allocation issues without mutating. */
export function validateBinderInputs(
  collection: Map<string, number>,
  decks: Map<string, Map<string, number>>,
  catalog: CatalogInput,
): BinderInputError[] {
  const entries = asMap(catalog);
  const errors: BinderInputError[] = [];
  for (const [code, amount] of collection) {
    const e = entries.get(code);
    if (!e) errors.push({ code, reason: 'collection code absent from catalog' });
    else if (!e.color || e.cost === null || !e.type)
      errors.push({ code, reason: 'catalog entry incomplete — exact layout requires color, cost, type' });
    if (!Number.isInteger(amount) || amount < 0)
      errors.push({ code, reason: 'collection quantity must be a non-negative integer' });
  }
  for (const [deck, cards] of decks) {
    for (const [code, qty] of cards) {
      if (!collection.has(code))
        errors.push({ code, reason: `deck "${deck}" code absent from collection` });
      else if (!Number.isInteger(qty) || qty < 0)
        errors.push({ code, reason: `deck "${deck}" quantity must be non-negative integer` });
      else if (qty > (collection.get(code) ?? 0))
        errors.push({ code, reason: `deck "${deck}" allocation ${qty} exceeds collection ${collection.get(code)}` });
    }
  }
  return errors;
}

/* ─── Ledger builder ──────────────────────────────────────── */

function makeLedger(sections: Array<{ section: string; codes: string[] }>): BinderLayout {
  const sheets: BinderLayout['sheets'] = [];
  let sheetNo = 1;
  let side: 'Front' | 'Back' = 'Front';
  let pocketNo = 1;

  const next = () => {
    pocketNo++;
    if (pocketNo > SLOTS_PER_SIDE) {
      pocketNo = 1;
      side = side === 'Front' ? 'Back' : 'Front';
      if (side === 'Front') sheetNo++;
    }
  };

  const getSheet = () => {
    const sid = `sheet-${sheetNo}`;
    let s = sheets.find(sh => sh.sheetId === `${sid}-${side}`);
    if (!s) {
      s = { sheetId: `${sid}-${side}`, sheet: sheetNo, side, pockets: [] };
      sheets.push(s);
    }
    return s;
  };

  for (const group of sections) {
    // Card pockets
    for (const code of group.codes) {
      getSheet().pockets.push({
        ...emptyPocket(getSheet().sheetId, group.section, pocketNo, 'card'),
        code,
        quantity: 0,
      });
      next();
    }
    // Reserved pockets (3 per group)
    for (let i = 0; i < RESERVED_SLOTS_PER_GROUP; i++) {
      getSheet().pockets.push(
        emptyPocket(getSheet().sheetId, group.section, pocketNo, 'reserved', `reserve-${group.section}-${i + 1}`),
      );
      next();
    }
  }

  // Pad unfilled physical pockets as 'empty'
  for (const sheet of sheets) {
    while (sheet.pockets.length < SLOTS_PER_SIDE) {
      sheet.pockets.push(
        emptyPocket(sheet.sheetId, '__UNASSIGNED__', sheet.pockets.length + 1, 'empty'),
      );
    }
  }

  return { version: 1, slotsPerSide: SLOTS_PER_SIDE, sheets };
}

/* ─── Public API ──────────────────────────────────────────── */

/**
 * Build the immutable initial ledger from a complete catalog.
 *
 * Every owned code gets a pocket; zero-quantity cards remain `vacant`
 * after reconciliation.  Every populated group receives three `reserved`
 * pockets.  No wall-clock, no heuristic fallback.
 */
export function createInitialBinderLayout(
  catalogInput: CatalogInput,
  codes?: Iterable<string>,
): BinderLayout {
  const catalog = asMap(catalogInput);
  const selected = codes ? [...codes] : [...catalog.keys()];
  for (const code of selected) {
    const e = catalog.get(code);
    if (!e || !e.color || e.cost === null || !e.type)
      throw new Error(`Cannot create exact layout: incomplete catalog entry ${code}`);
  }
  const grouped = new Map<string, string[]>();
  for (const code of sortCardsPlayerFirst(selected, catalog)) {
    const sec = sectionFor(catalog.get(code)!);
    if (!grouped.has(sec)) grouped.set(sec, []);
    grouped.get(sec)!.push(code);
  }
  return makeLedger(
    [...grouped].map(([section, codes]) => ({ section, codes })),
  );
}

export function validateLayout(layout: BinderLayout): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const sheet of layout.sheets) {
    for (const pocket of sheet.pockets) {
      const key = `${sheet.sheetId}:${pocket.pocket}`;
      if (seen.has(key)) errors.push(`Duplicate pocket ${key}`);
      seen.add(key);
      if (pocket.status === 'card' && !pocket.code)
        errors.push(`${key}: card pocket missing code`);
      if (pocket.status === 'reserved' && !pocket.tag)
        errors.push(`${key}: reserved pocket missing tag`);
    }
  }
  return errors;
}

/**
 * Reconcile collection/deck quantities against the committed ledger.
 *
 * - Only cards with positive `binderQty = collection - sum(deck)` get
 *   a `card` status; zero-binder cards become `vacant`.
 * - Existing assignments are never relocated.
 * - New cards consume a matching section reserve first.  If none exists,
 *   a complete Front+Back overflow sheet is appended directly after the
 *   owning color section and the first empty pocket is used.
 *
 * @throws if any input validation error is found.
 */
export function reconcileBinderLayout(
  layout: BinderLayout,
  collection: Map<string, number>,
  catalogInput: CatalogInput,
  decks = new Map<string, Map<string, number>>(),
): LayoutReconciliation {
  const catalog = asMap(catalogInput);
  const inputErrors = validateBinderInputs(collection, decks, catalog);
  if (inputErrors.length > 0) {
    throw new Error(inputErrors.map(e => `${e.code}: ${e.reason}`).join('; '));
  }

  // Deep-clone the ledger so we never mutate the committed file.
  const next: BinderLayout = JSON.parse(JSON.stringify(layout));
  const assigned = new Set<string>();

  // --- Phase 1: update existing card/vacant pockets -----------
  for (const sheet of next.sheets) {
    for (const pocket of sheet.pockets) {
      if ((pocket.status === 'card' || pocket.status === 'vacant') && pocket.code) {
        const owned = collection.get(pocket.code) ?? 0;
        let totalInDecks = 0;
        for (const [, deckMap] of decks) {
          totalInDecks += deckMap.get(pocket.code) ?? 0;
        }
        const binderQty = Math.max(0, owned - totalInDecks);
        assigned.add(pocket.code);

        if (binderQty > 0) {
          pocket.quantity = binderQty;
          pocket.status = 'card';
        } else {
          pocket.status = 'vacant';
          pocket.quantity = 0;
          delete pocket.tag;
        }
      }
    }
  }

  // --- Phase 2: add new cards (positive binder, not yet assigned) ---
  const additions = sortCardsPlayerFirst(
    [...collection.keys()].filter(code => {
      if (assigned.has(code)) return false;
      const owned = collection.get(code) ?? 0;
      let inDecks = 0;
      for (const [, dm] of decks) inDecks += dm.get(code) ?? 0;
      return (owned - inDecks) > 0;
    }),
    catalog,
  );

  for (const code of additions) {
    const entry = catalog.get(code)!;
    const sec = sectionFor(entry);
    const owned = collection.get(code) ?? 0;
    let inDecks = 0;
    for (const [, dm] of decks) inDecks += dm.get(code) ?? 0;
    const binderQty = owned - inDecks;

    let target: BinderLayoutPocket | undefined;

    // 2a. Find a reserved pocket in the same section
    for (const sheet of next.sheets) {
      target = sheet.pockets.find(p => p.status === 'reserved' && p.section === sec);
      if (target) break;
    }

    // 2b. No reserve — try to reuse an overflow empty pocket in same section
    if (!target) {
      for (const sheet of next.sheets) {
        target = sheet.pockets.find(p => p.status === 'empty' && p.section === sec);
        if (target) break;
      }
    }

    // 2c. No pocket — append a complete Front+Back overflow sheet
    //     directly after the last sheet of the owning color section.
    if (!target) {
      const sectionColor = entry.type === 'Leader'
        ? `Leader:${entry.color}`
        : entry.color!;

      // Find the final complete physical Front+Back pair belonging to this
      // color.  Overflow is always inserted after that pair: never at its
      // start and never between its two sides.
      let lastSectionIndex = -1;
      for (let i = next.sheets.length - 1; i >= 0; i--) {
        if (next.sheets[i]!.pockets.some(p => p.section.startsWith(sectionColor))) {
          lastSectionIndex = i;
          break;
        }
      }
      let insertAfter = next.sheets.length;
      if (lastSectionIndex >= 0) {
        let pairStart = lastSectionIndex;
        if (pairStart > 0 && next.sheets[pairStart - 1]!.side === 'Front' &&
            next.sheets[pairStart]!.side === 'Back') pairStart--;
        let pairEnd = lastSectionIndex + 1;
        if (next.sheets[lastSectionIndex]?.side === 'Front' &&
            next.sheets[lastSectionIndex + 1]?.side === 'Back') pairEnd++;
        insertAfter = pairEnd;
      }

      let overflowId = 1000;
      while (next.sheets.some(sh => sh.sheetId === `overflow-${sectionColor}-${overflowId}`)) overflowId++;

      const frontSid = `overflow-${sectionColor}-${overflowId}`;
      const frontSheet = {
        sheetId: frontSid,
        sheet: 0,
        side: 'Front' as const,
        pockets: [] as BinderLayoutPocket[],
      };
      for (let i = 1; i <= SLOTS_PER_SIDE; i++) frontSheet.pockets.push(emptyPocket(frontSid, sec, i, 'empty'));

      const backSid = `overflow-${sectionColor}-${overflowId}-Back`;
      const backSheet = {
        sheetId: backSid,
        sheet: 0,
        side: 'Back' as const,
        pockets: [] as BinderLayoutPocket[],
      };
      for (let i = 1; i <= SLOTS_PER_SIDE; i++) backSheet.pockets.push(emptyPocket(backSid, sec, i, 'empty'));

      next.sheets.splice(insertAfter, 0, frontSheet, backSheet);
      target = frontSheet.pockets.find(p => p.status === 'empty')!;
    }

    target.status = 'card';
    target.code = code;
    target.quantity = binderQty;
    delete target.tag;
  }

  // --- Phase 3: recompute display sheet numbers -----------------
  // Display numbers are derived from position in the ordered array.
  // sheetId is the stable immutable identifier; `sheet` is the display
  // number that the UI projects.  After any insertion, both front+back
  // halves of the same physical sheet share the same display number.
  let displayNo = 1;
  let expectedDisplay = 1;
  for (const sheet of next.sheets) {
    if (sheet.side === 'Front') {
      expectedDisplay = displayNo;
      displayNo++;
    }
    sheet.sheet = expectedDisplay;
  }

  // --- Phase 4: derive EVERY location from final ordered layout ----
  // Do not reuse locations recorded pre-insertion.  After all mutations
  // and display recomputation, scan the canonical layout and produce a
  // consistent projection from card code → (sheet, side, slot).
  const locations = new Map<string, BinderLocation>();
  for (const sheet of next.sheets) {
    for (const pocket of sheet.pockets) {
      if (pocket.status === 'card' && pocket.code) {
        locations.set(pocket.code, {
          sheet: sheet.sheet,
          side: sheet.side,
          slot: pocket.pocket,
        });
      }
    }
  }

  return { layout: next, locations };
}
