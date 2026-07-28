import type { CardColor } from './types';

/**
 * Constants for the binder system.
 */

/** Number of rows per sheet (3×3 grid). */
export const SLOTS_PER_SIDE = 9;

/** Number of sides per sheet (Front/Back). */
export const SIDES_PER_SHEET = 2;

/** Maximum number of sheets in a standard binder. */
export const MAX_SHEETS = 50;

/** Maximum slots in the base binder: 50 × 2 × 9 = 900. */
export const MAX_SLOTS = MAX_SHEETS * SIDES_PER_SHEET * SLOTS_PER_SIDE;

/** Number of reserved (empty) pockets per color/cost/type group. */
export const RESERVED_SLOTS_PER_GROUP = 3;

/** Paths for source CSV files (relative to project root). */
export const CSV_PATHS = {
  COLLECTION: 'One Piece TCG Collection - All.csv',
  DECK_SABO: 'One Piece TCG Collection - Sabo.csv',
  DECK_LUFFY: 'One Piece TCG Collection - Lufy G_B [WIP].csv',
  WANTED: 'Want to Buy.csv',
} as const;

/** Path for generated output (relative to project root). */
export const GENERATED_DATA_PATH = 'src/data/generated/binder-data.json';

/** Expected Vega snapshot directory. */
export const VEGA_SNAPSHOT_DIR = '.vega';

export interface CardColorHeuristic {
  color: CardColor;
  desc: string;
}

/** Color mapping based on card set prefix heuristics (for fixture data). */
export const SET_COLOR_MAP: Record<string, CardColorHeuristic> = {
  'ST01': { color: 'Red', desc: 'Straw Hat Crew' },
  'ST02': { color: 'Green', desc: 'Worst Generation' },
  'ST03': { color: 'Blue', desc: 'Seven Warlords' },
  'ST04': { color: 'Purple', desc: 'Animal Kingdom Pirates' },
  'ST05': { color: 'Red', desc: 'Film Edition' },
  'ST06': { color: 'Purple', desc: 'Navy' },
  'ST07': { color: 'Black', desc: 'Big Mom Pirates' },
  'ST08': { color: 'Yellow', desc: 'Charlotte Family' },
  'ST09': { color: 'Yellow', desc: 'Yamato' },
  'ST10': { color: 'Red', desc: 'Three Captains' },
  'ST11': { color: 'Green', desc: 'Uta' },
  'ST12': { color: 'Blue', desc: 'Zoro & Sanji' },
  'ST13': { color: 'Purple', desc: 'Rob Lucci' },
  'ST14': { color: 'Black', desc: 'Koby' },
  'ST15': { color: 'Red', desc: 'Eustass Kid' },
  'ST16': { color: 'Green', desc: 'Monkey D. Luffy' },
  'ST17': { color: 'Purple', desc: 'Donquixote Doflamingo' },
  'ST18': { color: 'Yellow', desc: 'Monkey D. Luffy' },
  'ST30': { color: 'Black', desc: 'Navy' },
  'ST35': { color: 'Red', desc: 'Edward Newgate' },
  'OP01': { color: 'Red', desc: 'Romance Dawn' },
  'OP02': { color: 'Green', desc: 'Paramount War' },
  'OP03': { color: 'Purple', desc: 'Pillars of Strength' },
  'OP04': { color: 'Blue', desc: 'Kingdoms of Intrigue' },
  'OP05': { color: 'Red', desc: 'Awakening of the New Era' },
  'OP06': { color: 'Green', desc: 'Wings of the Captain' },
  'OP07': { color: 'Purple', desc: '500 Years in the Void' },
  'OP08': { color: 'Blue', desc: 'Two Legends' },
  'OP09': { color: 'Black', desc: 'Emperors in the New World' },
  'OP10': { color: 'Red', desc: 'Royal Blood' },
  'OP11': { color: 'Green', desc: 'A Fist of Divine Speed' },
  'OP12': { color: 'Purple', desc: 'Exceed the New Age' },
  'OP13': { color: 'Blue', desc: 'A Clash of Kings' },
  'OP14': { color: 'Black', desc: 'Primal Earth' },
  'OP15': { color: 'Yellow', desc: 'Celestial Dragons' },
  'OP16': { color: 'Red', desc: 'Final Sea - New World' },
  'EB01': { color: 'Blue', desc: 'Extra Booster - Memorial Collection' },
  'EB02': { color: 'Black', desc: 'Extra Booster - Anime 25th Collection' },
  'EB03': { color: 'Purple', desc: 'Extra Booster - Heroines' },
};
