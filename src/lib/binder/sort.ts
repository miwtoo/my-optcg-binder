/**
 * Card sorting — player-first order.
 *
 * Priority: Leaders first → color (Red→Green→Blue→Purple→Black→Yellow)
 * → cost ascending → type (Character→Event→Stage) → code ascending.
 */

import type { CatalogEntry, CardColor, CardType } from '../data/types';
import { COLOR_ORDER, TYPE_ORDER } from '../data/types';

/* ─── Comparators ─────────────────────────────────────────── */

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

/* ─── Sort ────────────────────────────────────────────────── */

/**
 * Sort card codes in player-first order:
 * 1. Leaders first (ordered by color then code)
 * 2. Red → Green → Blue → Purple → Black → Yellow
 * 3. Within color: cost ascending
 * 4. Within cost: Character → Event → Stage
 * 5. Within type: code ascending
 */
export function sortCardsPlayerFirst(
  codes: string[],
  catalog: Map<string, CatalogEntry>,
): string[] {
  return [...codes].sort((a, b) => {
    const ea = catalog.get(a);
    const eb = catalog.get(b);

    const typeA = ea?.type ?? null;
    const typeB = eb?.type ?? null;
    const colorA = ea?.color ?? null;
    const colorB = eb?.color ?? null;
    const costA = ea?.cost ?? -1;
    const costB = eb?.cost ?? -1;

    // Leaders first
    const aIsLeader = typeA === 'Leader';
    const bIsLeader = typeB === 'Leader';
    if (aIsLeader && !bIsLeader) return -1;
    if (!aIsLeader && bIsLeader) return 1;

    if (aIsLeader && bIsLeader) {
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
