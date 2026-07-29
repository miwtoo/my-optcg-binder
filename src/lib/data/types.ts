/**
 * Core data types for the One Piece TCG binder system.
 * These define the contract between the generator/validator and the UI.
 */

/* ─── CSV Row Types ─────────────────────────────────────────── */

export interface CollectionRow {
  code: string;
  amount: number;
  /** 1-based source CSV row (2 = first data row after header) */
  row: number;
}

export interface DecklistRow {
  code: string;
  amount: number;
  /** 1-based source CSV row (2 = first data row after header) */
  row: number;
}

export interface WantedRow {
  code: string;
  amount: number;
  target: string; // "binder" or a deck/planning name
  /** 1-based source CSV row (2 = first data row after header) */
  row: number;
}

/* ─── Card Catalog ──────────────────────────────────────────── */

export type CardColor =
  | 'Red' | 'Green' | 'Blue' | 'Purple' | 'Black' | 'Yellow';
export type CardType = 'Leader' | 'Character' | 'Event' | 'Stage';

export const COLOR_ORDER: CardColor[] = [
  'Red', 'Green', 'Blue', 'Purple', 'Black', 'Yellow',
];

export const TYPE_ORDER: CardType[] = [
  'Leader', 'Character', 'Event', 'Stage',
];

export interface CatalogEntry {
  /** Vega card code, e.g. "OP05-057" */
  code: string;
  /** Card name (null if unknown) */
  name: string | null;
  /** Card color (null if unknown) */
  color: CardColor | null;
  /** Play cost (null if unknown; 0 for Leaders) */
  cost: number | null;
  /** Card type (null if unknown) */
  type: CardType | null;
  /** Path to card image relative to public/, e.g. "data/card-images/OP05-057.png" (null/undefined when unavailable) */
  image?: string | null;
}

/* ─── Binder Layout ────────────────────────────────────────── */

export interface SlotEntry {
  code: string;
  quantity: number;
}

/**
 * Discriminated slot states that preserve the exact physical pocket
 * status instead of collapsing reserved/vacant/empty to null.
 *
 * - card:    a card occupies the pocket
 * - reserved: reserved for a specific color/cost/type group
 * - vacant:   was a card pocket, but the card's quantity dropped to 0
 * - empty:    no assignment and not reserved
 */
export type DiscriminatedSlot =
  | { status: 'card'; code: string; quantity: number }
  | { status: 'reserved' }
  | { status: 'vacant' }
  | { status: 'empty' };

export interface BinderSheet {
  sheet: number;
  side: 'Front' | 'Back';
  slots: DiscriminatedSlot[];
}

export interface BinderLocation {
  sheet: number;
  side: 'Front' | 'Back';
  slot: number; // 1–9, left-to-right top-to-bottom
}

export type BinderPocketStatus = 'reserved' | 'vacant' | 'empty' | 'card';

/** Stable physical ledger assignment. sheetId is never reused or renumbered. */
export interface BinderLayoutPocket {
  sheetId: string;
  section: string;
  pocket: number;
  status: BinderPocketStatus;
  code?: string;
  quantity?: number;
  tag?: string;
}

export interface BinderLayout {
  version: 1;
  slotsPerSide: number;
  sheets: Array<{
    sheetId: string;
    sheet: number;
    side: 'Front' | 'Back';
    pockets: BinderLayoutPocket[];
  }>;
}

/* ─── Card Allocation ──────────────────────────────────────── */

export interface DeckAllocation {
  deck: string;
  quantity: number;
}

export interface CardEntry {
  code: string;
  name: string | null;
  owned: number;
  binderQuantity: number;
  deckAllocations: DeckAllocation[];
  binderLocation: BinderLocation | null;
}

/* ─── Wanted ───────────────────────────────────────────────── */

export interface WantedEntry {
  code: string;
  amount: number;
  target: string; // "binder" or deck/planning name
}

/* ─── Source Manifest ──────────────────────────────────────── */

export interface SourceFileEntry {
  checksum: string; // sha256 hex
  rowCount: number;
}

export interface SourceManifest {
  files: Record<string, SourceFileEntry>;
}

/* ─── Attribution ──────────────────────────────────────────── */

export interface Attribution {
  copyright: string;
  disclaimer: string;
  dataSource: string;
  dataSourceUrl: string;
  toolUsed: string;
}

/* ─── Binder Summary ───────────────────────────────────────── */

export interface BinderSummary {
  totalPossessedCards: number;
  totalUniqueCodes: number;
  totalSheets: number;
  totalDeckCards: number;
  totalBinderCards: number;
  reservedSlots: number;
  overflowSheets: number;
}

/* ─── Top-Level Generated Data ─────────────────────────────── */

export interface BinderData {
  meta: {
    generator: string;
    generatorVersion: string;
    catalogSource: string;
    catalogSourceVersion: string;
    totalCards: number;
    totalSheets: number;
    dataProvenance: string;
  };
  catalog: CatalogEntry[];
  cards: CardEntry[];
  sheets: BinderSheet[];
  binder: BinderSummary;
  wanted: WantedEntry[];
  sources: SourceManifest;
  attribution: Attribution;
}
