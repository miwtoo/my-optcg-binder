# Context — Glossary (resolved terms)

## Card Code

The unique identifier for a specific One Piece TCG card printing (e.g. `OP01-001`, `EB03-052`). Every physical copy of a card shares the same code. Variants (alt art, parallel, etc.) with distinct codes are separate.

## Collection Inventory

A CSV file that serves as the master record of what cards the binder owner physically possesses. Each row represents a card code and the quantity owned. This is the single source of truth for inventory.

## Decklist

A CSV file that records requested card counts for a specific deck build. Decklists are checked against the Collection Inventory for availability. They are not a store of physical cards.

## Binder Slot

A single pocket in the binder that holds one card code. Multiple physical copies of the same code stack in the same slot. Each slot maps to exactly one binder page, one side (front/back), and one position within the 3×3 grid.

## Player-first Order

The sorting convention used to assign card codes to binder slots. Priority is: **color → cost → type**. Cards are ordered by color first, then by play cost within each color, then by card type within each cost tier. This groups cards by how a player browses for deck-building.

## Reserved Slot

A deliberately empty binder slot set aside for a future card code (e.g., an unreleased set). Reserved slots are consumed first when a new card code arrives in that group. They are never relocated.

## Stable physical layout (resolved)

`data/binder-layout.json` is the physical ledger. A `sheetId`, section, and pocket
assignment are stable identifiers; reconciliation never relocates an existing code.
The initial ledger is derived only from a complete catalog (color, cost, and type
must all be present). Leaders are grouped by color. Other cards are grouped by
color, cost, and type. Every populated group receives three tagged `reserved`
pockets. A zero-quantity owned card remains assigned as `vacant`; `empty` means
an unassigned physical pocket, and `card` carries the actual stacked quantity.

When a new code arrives, reconciliation consumes a matching reserve first. If no
reserve exists it appends a complete Front+Back overflow sheet directly after
that color section, reusing the first empty pocket. Deck quantities are
allocations of the collection: absent codes and allocations above owned quantity
are errors. Existing cards are never relocated to make room.

The Sabo CSV summary row `,51` is the **sole ignored exception** — it is silently
skipped during parsing (not an error). All other CSV rows must have correct column
counts and valid positive-integer quantities; blank lines and extra columns are
rejected.

## Normal generation behaviour (resolved)

`npm run generate` in normal mode loads the committed `data/binder-layout.json`,
reconciles current collection/deck quantities against it, copies Vega card images,
and emits the canonical 8-key BinderData. The committed ledger is never
overwritten. Bootstrap with `--init-layout` creates a fresh ledger from the
Vega catalog.
