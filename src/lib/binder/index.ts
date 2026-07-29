/**
 * Binder module entry point.
 */

export { computeBinderPlacement, sortCardsPlayerFirst, computeBinderSummary } from './placement-engine';
export {
  createInitialBinderLayout,
  reconcileBinderLayout,
  validateBinderInputs,
  validateLayout,
} from './placement-engine';
export type { PlacementResult, BinderInputError, LayoutReconciliation } from './placement-engine';
