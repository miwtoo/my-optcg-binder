/**
 * Binder module entry point.
 *
 * Public layout API (new code):
 *   createInitialBinderLayout, reconcileBinderLayout,
 *   validateBinderInputs, validateLayout
 *
 * Legacy placement API (tests only):
 *   computeBinderPlacement, computeBinderSummary
 */

export { computeBinderPlacement, computeBinderSummary } from './placement-engine';
export { sortCardsPlayerFirst } from './sort';
export {
  createInitialBinderLayout,
  reconcileBinderLayout,
  validateBinderInputs,
  validateLayout,
} from './layout';
export type { PlacementResult } from './placement-engine';
export type { BinderInputError, LayoutReconciliation } from './layout';
