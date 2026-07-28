---
title: Package Vega card data for a public static site
status: closed
labels:
  - wayfinder:research
parent: .scratch/optcg-static-binder/001-map.md
blocked_by:
assignee: assistant
---

# Package Vega card data for a public static site

## Question

Determine safe reproducible generation from the Vega snapshot into minimized static data and images, including source/licensing/attribution and variants.

**Context**: The Vega snapshot contains a full English-Asia catalog and card images. The `vegapull` binary is unavailable locally, so the snapshot must be processed as-is or via an alternative extraction path. The result must be:
- Minimized for a public static site (not the full raw snapshot).
- Reproducible from committed source (no manual steps).
- Includes proper licensing/attribution for Vega data.
- Handles card variants (alt art, parallel, etc.) with distinct codes.

What is the safe, auditable pipeline to go from Vega snapshot → static data + images?

## Resolution

- **Copyright/terms risk accepted**: the user knowingly accepts the copyright/terms risk of publishing Vega-derived official card metadata and images on the public, noncommercial GitHub Pages site. Bandai blocks live embedding and prohibits unauthorized public reproduction; this is a risk acceptance, not permission.
- **Snapshot source**: use the local external Vega English-Asia snapshot at `/Users/miwtoo/Dev/personal/optcg-deck-learn/vega/data-260726_1636-english-asia` as the source. Do not commit the 938 MB full snapshot.
- **Local extraction**: a future deterministic Node extraction script takes `SNAPSHOT_PATH`, validates snapshot metadata/json/images, then emits generated card metadata and only images for the exact valid card IDs referenced by collection, deck, and future want-list data. Generated provenance includes snapshot path/version/pull date. GitHub Actions only builds committed generated artifacts; extraction runs locally when source data changes.
- **Strict input validation**: no automatic code correction; current malformed codes must be fixed in their CSV before generation. The known Sabo empty total row remains the sole exception.
- **Variant handling**: preserve a base card and an explicitly referenced variant as distinct IDs; do not copy unreferenced variants or complete packs.
- **Output layout**: store generated images at `public/images/cards/<card-id>.png`; derive paths from exact IDs. Store a minimized, stable-key-order catalog containing only UI/search fields plus local image presence/path. Missing catalog/image data fails extraction with an explicit message.
- **Attribution**: the public site must show prominent copyright/attribution and an unofficial/non-affiliation notice, credit Vega/vegapull data provenance, and must not use Bandai logos or imply endorsement.
