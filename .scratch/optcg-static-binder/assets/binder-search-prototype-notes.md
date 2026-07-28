# Binder search prototype notes

## UX decisions demonstrated

- **Physical binder:** this remains a literal Sheet 4, with Front/Back controls, explicit Previous/Next navigation, and a left-to-right, top-to-bottom 3×3 pocket map. Quantity stays on the pocket; reserved empty pockets are labelled rather than mistaken for missing cards.
- **Digital sort is separate:** Sorted view shows the same cards in Leader → color → cost → type → code order. It makes clear that overflow can change physical placement without changing the preferred digital order.
- **Search answers “where is it?”:** each result can show binder Sheet/Side/Slot and a deck location with independent copy counts. The search matches code and name.
- **Filters stay lightweight:** color, cost, type, and location (everywhere, binder, decks) are available together, with a visible reset and a plain no-result state.
- **Overflow is non-destructive:** the dark callout explains inserting a removable sheet after a full color section; the preview button confirms that existing cards do not move.
- **Mobile keeps the object legible:** the grid remains three columns, while sheet navigation uses explicit touch-sized Previous/Next controls. Result locations wrap below the card name. Swipe is intentionally not part of this version after the user decision.
- **Collection is the fast path:** the new view lists every currently owned placeholder card in ideal player-first order. Each item has art, code, name, quantity, and compact binder/deck locations. Tapping an item switches to Physical binder, opens Sheet 4 Front, scrolls it into view, and highlights the pocket.
- **Views have separate jobs:** Physical binder answers “where is it in the real binder?”, Collection answers “what do I own?”, and Sorted view explains the ideal ordering logic without replacing either browse mode.
- **Confirmed landing flow:** Collection is the default landing view. Tapping a card opens a dedicated detail surface first, with metadata, quantities, and prominent binder/deck locations. `Show in binder` then opens the exact physical Sheet/Side/Slot and highlights that pocket.

## Pixel 8 Pro test pass

At a 412 CSS px viewport, please test with one hand:

1. Collection is the first screen: scroll the two-column browse cards, check code/name/quantity/location readability, tap Nami, and confirm the dedicated detail surface appears before any binder navigation.
2. From Nami detail, use `Show in binder` and confirm the exact Sheet/Side/Slot is visible and highlighted.
3. Use Previous/Next near the bottom of the binder, including at Sheet 1 and Sheet 50, and confirm the controls remain easy to hit.
4. Switch Front/Back with the visible buttons and confirm the physical view stays a literal 3×3 grid.
5. Scroll to Card locations and check that Binder Sheet/Side/Slot and Deck copy-count chips are readable without horizontal scrolling.
6. Tap the sticky search field after scrolling, search `Nami`, then try a filter combination with no results.

## Questions for review

1. On a 412px Pixel 8 Pro viewport, does Collection → Detail → Show in binder feel like the right one-handed flow?
2. Is `Show in binder` prominent and specific enough when a card has both binder and deck copies?
3. On a real card result, should deck locations be grouped behind a “show all” control when there are many decks?
4. Is the distinction between “reserved” and simply empty clear enough, or should reserved pockets use a stronger visual marker?
