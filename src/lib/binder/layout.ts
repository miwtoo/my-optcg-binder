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
  const locations = new Map<string, BinderLocation>();

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
          locations.set(pocket.code, {
            sheet: sheet.sheet,
            side: sheet.side,
            slot: pocket.pocket,
          });
        } else {
          // Retain code + quantity for stable slot restoration when the
          // card later has positive binder quantity again.
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

    // 2a. Find a reserved pocket in the same section
    let target: BinderLayoutPocket | undefined;
    let targetSheet: (typeof next.sheets)[number] | undefined;

    for (const sheet of next.sheets) {
      target = sheet.pockets.find(p => p.status === 'reserved' && p.section === sec);
      if (target) { targetSheet = sheet; break; }
    }

    // 2b. No reserve found — try to reuse an overflow empty pocket
    //     that is in the same section.
    if (!target) {
      for (const sheet of next.sheets) {
        target = sheet.pockets.find(p => p.status === 'empty' && p.section === sec);
        if (target) { targetSheet = sheet; break; }
      }
    }

    // 2c. Still no pocket — append a complete Front+Back overflow
    //     sheet directly after the owning color section.
    if (!target) {
      const sectionColor = entry.type === 'Leader'
        ? `Leader:${entry.color}`
        : entry.color!;

      // Determine where to insert (after the last sheet of this section)
      let insertAfter = next.sheets.length;
      let lastSheetOfSection = -1;
      for (let i = next.sheets.length - 1; i >= 0; i--) {
        const sh = next.sheets[i]!;
        if (sh.pockets.some(p => p.section.startsWith(sectionColor))) {
          lastSheetOfSection = i;
          break;
        }
      }
      if (lastSheetOfSection >= 0) insertAfter = lastSheetOfSection + 1;

      // Assign a stable overflow sheet number that won't collide
      let overflowNo = Math.max(...next.sheets.map(s => s.sheet), 0) + 1;
      // If there's existing overflow, find the next available number
      for (let s = overflowNo; ; s++) {
        if (!next.sheets.some(sh => sh.sheet === s)) { overflowNo = s; break; }
      }

      const frontSid = `overflow-${sectionColor}-${overflowNo}`;
      const frontSheet = {
        sheetId: frontSid,
        sheet: overflowNo,
        side: 'Front' as const,
        pockets: [] as BinderLayoutPocket[],
      };
      for (let i = 1; i <= SLOTS_PER_SIDE; i++) {
        frontSheet.pockets.push(emptyPocket(frontSid, sec, i, 'empty'));
      }

      const backSid = `overflow-${sectionColor}-${overflowNo}-Back`;
      const backSheet = {
        sheetId: backSid,
        sheet: overflowNo,
        side: 'Back' as const,
        pockets: [] as BinderLayoutPocket[],
      };
      for (let i = 1; i <= SLOTS_PER_SIDE; i++) {
        backSheet.pockets.push(emptyPocket(backSid, sec, i, 'empty'));
      }

      next.sheets.splice(insertAfter, 0, frontSheet, backSheet);

      target = frontSheet.pockets.find(p => p.status === 'empty')!;
      targetSheet = frontSheet;
    }

    // 2c. Fill the target pocket
    target.status = 'card';
    target.code = code;
    target.quantity = binderQty;
    delete target.tag;

    locations.set(code, {
      sheet: targetSheet!.sheet,
      side: targetSheet!.side,
      slot: target.pocket,
    });
  }

  return { layout: next, locations };
}
