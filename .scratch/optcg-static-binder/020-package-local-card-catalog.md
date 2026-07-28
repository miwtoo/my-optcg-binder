---
title: Package Vega card data for a public static site
status: open
labels:
  - wayfinder:research
parent: .scratch/optcg-static-binder/001-map.md
blocked_by:
assignee:
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
