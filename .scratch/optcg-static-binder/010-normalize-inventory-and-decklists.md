---
title: Define collection import and deck availability rules
status: open
labels:
  - wayfinder:grilling
parent: .scratch/optcg-static-binder/001-map.md
blocked_by:
assignee:
---

# Define collection import and deck availability rules

## Question

Decide duplicate-code aggregation, invalid-row handling, code normalization, deck availability semantics, and report format.

**Context**: The supplied CSVs may contain duplicate card code rows, inconsistent formatting, codes with spacing/case mismatches, or rows that should be ignored (e.g., the empty Sabo total row). The Vega catalog has the corrected EB03-052 entry already. Deck availability checks need a clear semantic: exact quantity match, partial fill, or some threshold.

Known inputs to account for:
- Duplicate card codes in the collection CSV (aggregate or error?).
- Invalid or unparseable rows (skip, warn, or fail?).
- Code normalization (strip whitespace, uppercase, etc.).
- The empty Sabo total row should be ignored.
- EB03-052 is corrected in Vega catalog and does not need a local override.
- Report format: human-readable text, structured JSON, or both?
