# Binder & Search UX — Prototype Notes

## Approved UX decisions

- **Default view**: Collection (player-first sorted browse) is the default landing view on mobile.
- **Card interaction**: tapping a card opens its detail view first (metadata, owned quantity, binder/deck locations). A `Show in binder` action navigates to the exact physical Sheet/Side/Slot and highlights it.
- **Binder navigation**: physical Binder view is a literal 3×3 grid with explicit Front/Back toggle and Previous/Next sheet controls. No swipe navigation.
- **Search**: supports card code and name search with filters for color, cost, type, and location. Explicit states for reserved pockets, no results, and removable-sheet overflow.
- **Mobile baseline**: Pixel 8 Pro (412 CSS px) is the quality baseline — one-handed use, no horizontal overflow, touch-sized controls.
- **Digital views**: sorted digital order is always available alongside the physical Binder view, independent of physical overflow placement.

## Files

- `binder-search-prototype.html` — interactive HTML prototype illustrating the agreed flows and states.
