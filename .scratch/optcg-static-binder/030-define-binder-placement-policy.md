---
title: Specify automatic placement and growth policy
status: open
labels:
  - wayfinder:prototype
parent: .scratch/optcg-static-binder/001-map.md
blocked_by:
  - 010-normalize-inventory-and-decklists.md
assignee:
---

# Specify automatic placement and growth policy

## Question

Specify ordering keys, 3×3 page/slot convention, bucket headroom/reserved-slot allocation, insert/overflow behavior, and when a local physical rearrangement is required.

**Context**: Binder slots are assigned automatically in player-first order (color → cost → type). The binder has 50 sheets × 2 sides × 9 pockets = 900 slots. Some slots are reserved for future cards. As new cards are added to the collection, the algorithm must decide:
- Exact ordering key precedence (what breaks ties within the same color/cost/type?).
- 3×3 page and slot numbering convention (top-left = slot 1, bottom-right = slot 9?).
- How much headroom to leave per color/cost bucket.
- How reserved slots are allocated and maintained.
- What happens when a bucket overflows (insert, shift, flag for physical rearrangement?).
- When a physical rearrangement of the binder is required vs. automatic slot assignment is sufficient.
