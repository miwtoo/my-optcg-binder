---
title: Specify static want-to-buy workflow
status: closed
labels:
  - wayfinder:grilling
parent: .scratch/optcg-static-binder/001-map.md
blocked_by:
  - .scratch/optcg-static-binder/020-package-local-card-catalog.md
  - .scratch/optcg-static-binder/040-design-binder-search-experience.md
assignee: assistant
---

# Specify static want-to-buy workflow

## Question

Define a static data format for wanted card code/quantity and intended destination (binder or named deck); decide search/list presentation and purchase-to-collection update workflow. Explicitly exclude pricing, store links, market data, and automated purchasing.

## Resolution

- **Source file**: `Want to Buy.csv` with columns exactly `code,amount,target`.
- **Code validation**: `code` must be an exact known Vega catalog ID (including explicitly requested variants); `amount` is a positive integer.
- **Target semantics**: `target` is `binder` or any non-empty deck/planning name. Duplicate rows for the same `(code,target)` fail, but the same code is allowed with distinct targets.
- **Target is intention only**: it does not change physical allocation until the collection/deck source files are updated.
- **Purchase workflow**: manual and explicit in one commit — update `All.csv`, reduce/remove the matching want row, and update target deck data only where its physical allocation/list needs changing.
- **UI**: a dedicated Wanted tab/list grouped/filterable by target; search and card detail label wanted entries. No pricing, store links, market data, or purchase automation.
