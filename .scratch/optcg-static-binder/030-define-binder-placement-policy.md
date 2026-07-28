---
title: Specify automatic placement and growth policy
status: closed
labels:
  - wayfinder:prototype
parent: .scratch/optcg-static-binder/001-map.md
blocked_by:
  - 010-normalize-inventory-and-decklists.md
assignee: assistant
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

## Resolution

- **Slot convention**: a physical location is `Sheet N — Front|Back — Slot 1..9`; slot order is left-to-right, top-to-bottom; 50 double-sided 3×3 sheets give the initial 900 pockets.
- **Section and sort order**: initial binder sections: Leaders first, then Red, Green, Blue, Purple, Black, Yellow. Within a color: cost ascending, Character → Event → Stage, then card code ascending. Leaders: color then code.
- **Amount-based allocation**: binder quantity is collection quantity minus the quantities physically allocated to each current deck CSV. A card can therefore appear in both binder and deck search results when spare copies remain in the binder. Only card codes with positive binder quantity occupy a binder slot; duplicate copies stack in that one slot.
- **Spare pockets and inserts**: each populated color/cost/type group gets three adjacent empty pockets. A newly acquired distinct card code fills the first such empty pocket; extra copies only update the quantity.
- **Overflow**: if a group has no spare pocket, do not move existing cards. User inserts a removable sheet after the final physical sheet in that color section; the new card goes in that color's overflow area. Add further sheets there when required. The digital Binder view recomputes Sheet/Side/Slot locations after an inserted sheet; the digital Sorted view always presents the ideal player-first order regardless of physical overflow order.
- **No routine reshuffle**: routine additions never require a physical reshuffle; reshuffling is optional only when the user explicitly chooses to compact/re-sort the real binder.
