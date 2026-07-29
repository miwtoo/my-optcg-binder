# ADR: Static data architecture & deployment

## Status

Accepted (2026-07-29)

## Context

The binder app is a fully static site (Astro) with no runtime API.
All card data, layout, and assets are pre-generated at build time.

## Decisions

### 1. Vega-derived catalog

Card metadata (name, color, cost, type, image) comes exclusively from
the `.vega/` raw snapshot produced by `vegapull v1.2.3`.  The generator
(`scripts/generate.js`) reads `cards_*.json` + `packs.json` and builds an
in-memory `Map<string, CatalogEntry>`.  The snapshot is gitignored; CI uses
the committed `src/data/generated/binder-data.json` for validation.

### 2. Dual-mode validation

- **Pre-generation** (`validateInputs` in `generate.js`): validates CSVs against
  the freshly loaded Vega catalog.  The catalog set is built from actual card
  JSON, so unknown codes are caught immediately.
- **Post-generation** (`npm run validate` / `validateAll`): validates CSVs
  against the *committed* catalog artifact AND checks that all generated
  output files (layout, checksums, public data) are consistent with
  committed sources.

### 3. Stable physical ledger

`data/binder-layout.json` is the canonical physical assignment.  Its
sheetId, section, and pocket values are immutable; reconciliation never
relocates an existing code.  New codes consume section reserves first,
then append a unique Front+Back overflow sheet after the owning color
section.  Zero-quantity cards retain their code and slot as `vacant` so
they can be restored when the card returns to positive binder quantity.

The ledger is written by `--init-layout` and committed.  Normal generation
loads and reconciles the committed ledger — it is never regenerated.

### 4. Generated data contract

`src/data/generated/binder-data.json` (and its mirror `public/data/binder.json`)
contains the 8-key BinderData contract:
`meta`, `catalog`, `cards`, `sheets`, `binder`, `wanted`, `sources`, `attribution`.

Sheets use discriminated slot states (`card`, `reserved`, `vacant`, `empty`).

### 5. Attribution & licensing

Card data and images © Bandai / Toei Animation.  This is an unofficial fan
project for personal reference only.  Not affiliated with Bandai, Toei
Animation, or Vega.  Data sourced from Vega (https://vega.gg/) via
vegapull v1.2.3 (https://github.com/arashio/vegapull).

### 6. CI / deployment

`.github/workflows/deploy.yml`:
1. `npm ci`
2. `npm run validate` (against committed artifact)
3. `npm run check`
4. `npm test`
5. `npm run build`
6. Upload Pages artifact (single upload)
7. Deploy to GitHub Pages

The mobile browser test runs after build and is a standalone script
(`tests/browser/mobile.test.mjs`) that requires `@playwright/test` or
`playwright-core` to be installed.  It is not part of `vitest`; it may
be triggered in CI as a separate step after build.

### 7. CSV exceptions

The Sabo deck CSV summary row `,51` is the sole deliberately ignored
row.  All other rows must have correct column counts and positive integer
quantities.  Blank lines and extra columns are rejected.
