---
title: Prototype the binder and search experience
status: closed
labels:
  - wayfinder:prototype
parent: .scratch/optcg-static-binder/001-map.md
blocked_by:
  - 030-define-binder-placement-policy.md
  - 020-package-local-card-catalog.md
assignee: assistant
---

# Prototype the binder and search experience

## Question

Decide page/sheet visual model, card result/location affordances, filters, mobile behavior, and no-result/overflow presentation.

**Context**: The site needs to let a user browse the binder visually (page/sheet level) and search for specific cards. Key unknowns:
- Page/sheet visual model: grid of 9 slots per side, with front/back toggle? Scrollable page list? Mini-map navigator?
- Card result affordances: how to show which page/slot a card is in, and how many copies are in the slot?
- Filters: by color, cost, type, set, or decklist membership?
- Mobile behavior: how does the 3×3 grid and page navigation work on small screens?
- Edge cases: no search results, overflow (more cards than binder capacity), reserved slots (empty but intentional).

## Resolution

Prototype assets:
- `assets/binder-search-prototype.html`
- `assets/binder-search-prototype-notes.md`

Confirmed UX decisions:

- **Default landing**: Collection is the default, mobile-first landing view and is a fast vertically scrollable player-first browse surface.
- **Card detail flow**: tapping a card opens card detail first; detail shows metadata, owned quantity, binder/deck locations. A `Show in binder` button navigates to and highlights the exact physical Sheet/Side/Slot.
- **Binder navigation**: physical Binder remains literal 3×3 grid with Front/Back toggle and explicit Previous/Next sheet controls. No swipe navigation.
- **Search and filters**: search supports card code and name with filters for color, cost, type, and location. Reserved pockets, no-results, and removable-sheet overflow are explicit visual states.
- **Mobile baseline**: Pixel 8 Pro (412 CSS px) is the mobile quality baseline: one-handed, no horizontal overflow, touch-sized controls.
- **Digital order**: the sorted digital view supports browsing independently of physical overflow placement.
