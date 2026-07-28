---
title: Prototype the binder and search experience
status: open
labels:
  - wayfinder:prototype
parent: .scratch/optcg-static-binder/001-map.md
blocked_by:
  - 030-define-binder-placement-policy.md
  - 020-package-local-card-catalog.md
assignee:
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
