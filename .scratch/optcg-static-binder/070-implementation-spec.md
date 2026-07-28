---
title: Implement static One Piece TCG player binder
status: open
labels:
  - ready-for-agent
parent:
blocked_by:
assignee:
---

# Implement static One Piece TCG player binder

## Problem Statement

Managing a personal physical One Piece TCG collection is hard to search and organize away from home. The user needs a Pixel 8 Pro–friendly public companion site that mirrors a real removable-sheet 3×3 binder, records whether card copies are stored in the binder or in current decks, and tracks planned purchases — all without a server, database, or live API.

## Solution

A public static Astro site hosted on GitHub Pages, backed by versioned CSV and data commits. It uses generated Vega-derived card metadata and images (with explicit user-accepted copyright/terms risk and prominent attribution), models the exact physical binder and deck allocation, provides a Collection → Detail → Show in binder mobile flow, and maintains a static wanted list. The site rebuilds automatically on every push to `main`.

## User Stories

1. As a collector, I want the Collection view to be the default landing on my phone so I can start browsing immediately.
2. As a collector, I want to search by card code or card name to find cards quickly.
3. As a collector, I want to filter by color, cost, type, and location (binder / deck) to narrow down results.
4. As a collector, I want to tap a card and see its full detail — metadata, how many copies I own, and exactly where each copy lives (binder sheet/side/slot, deck name).
5. As a collector, I want a "Show in binder" button on the detail view that navigates to the exact physical sheet side and slot and highlights it.
6. As a collector, I want the physical Binder view to show a literal 3×3 grid of pockets with Front/Back sheet sides and explicit Previous/Next sheet controls.
7. As a collector, I want reserved pockets (empty spaces left for future cards) to be visually distinct so I do not mistake them for missing data.
8. As a collector, I want the digital sorted view to always show cards in the ideal player-first order (color → cost → type → code) regardless of where they physically sit after overflow insertions.
9. As a collector, I want Leaders to appear first in sorting, followed by the color sections in order: Red, Green, Blue, Purple, Black, Yellow.
10. As a collector, I want duplicate card copies to stack in a single pocket with a quantity indicator rather than consuming multiple slots.
11. As a collector, I want cards assigned to my Sabo or Luffy decklists to be reflected as stored in that deck in search and detail views, while spare copies still appear in the binder.
12. As a collector, I want to see both my binder quantity and deck quantity for each card in search results and detail.
13. As a collector, I want the Binder view to accommodate removable overflow sheets added to a color section when its groups fill up, without moving existing cards.
14. As a collector, I want the site to never require a physical reshuffle for routine additions — reshuffling is optional and manual only.
15. As a collector, I want a dedicated Wanted tab where I can see cards I plan to buy, grouped and filterable by target destination.
16. As a collector, I want each wanted entry to specify a target — binder or a specific named deck — so I know where the card is intended to go.
17. As a collector, I want the purchase workflow to be a manual commit: update the collection CSV, reduce or remove the matching want row, and update target deck data where needed.
18. As a collector, I want no search results, reserved pockets, and removable-sheet overflow to each be explicit visual states so I understand what the site is showing.
19. As a collector, I want clear validation error messages — including source CSV filename, row number, invalid value, and exact reason — when my data has issues.
20. As a collector, I want the site to be publicly accessible via GitHub Pages without requiring any login.
21. As a collector, I want the site to feel native on my Pixel 8 Pro (412 CSS px viewport): one-handed, no horizontal overflow, touch-sized controls.
22. As a collector, I want every push to `main` that touches CSVs, data, or source code to automatically trigger a validation → build → deploy pipeline.

## Implementation Decisions

- **Framework and architecture**: Astro with `output: 'static'`. All client interactivity (Collection browsing, search, filter, card detail, Binder navigation, Wanted list) uses vanilla TypeScript browser modules. No backend, database, authentication, React, Vue, or runtime server.
- **Generated data contract**: A local generator script reads strict-validated CSV inputs (collection inventory, decklists, wanted list) plus a project-local raw snapshot directory, and commits a minimized generated JSON data file containing catalog metadata, inventory, deck allocations, physical binder locations, and a source manifest with checksums. Selected card images are committed to a generated image assets directory. GitHub Actions never runs `vegapull` or extraction; the raw snapshot directory is never committed.
- **Bootstrap prerequisites**: Rust/Cargo with pinned `vegapull` v1.2.3 installed via `cargo install vegapull --version 1.2.3`. The `vega pull all` command is interactive: the operator selects English-Asia locale, chooses a project-local raw snapshot output directory, and confirms image download. The `--language` / `--output` flags are accepted by clap but ignored at runtime by the `all` subcommand.
- **Copyright and attribution**: Publishing Vega-derived official card metadata and images on the public noncommercial GitHub Pages site is a user-accepted copyright/terms risk — it is not permission. Bandai blocks live embedding and prohibits unauthorized public reproduction. The public site must display prominent copyright/attribution and unofficial/non-affiliation notices, credit Vega and vegapull data provenance, and must not use Bandai logos or imply endorsement.
- **Input validation rules**: Card codes must be exact known Vega catalog IDs (including explicitly requested variants). Quantities must be positive integers. Duplicate card-code rows in the collection CSV cause validation failure (no aggregation or automatic choice). Any invalid row, code, or quantity fails validation with the source CSV filename, row number, invalid value, and exact reason. The known accidental Sabo `,51` summary row is the sole ignored exception. Malformed existing codes must be corrected in their CSV before generation — no automatic normalization. The EB03-052 entry in the Vega catalog is accepted as the deliberate corrected code.
- **Binder allocation**: For each card code, binder quantity equals collection quantity minus the quantities physically allocated to each current deck CSV. Only codes with positive binder quantity occupy a physical slot; duplicate copies stack in that single slot with a quantity indicator. A card with spare copies appears in both binder and deck search results.
- **Physical arrangement**: A location is `Sheet N — Front|Back — Slot 1..9` (left-to-right, top-to-bottom on each side). Initial binder sections: Leaders first, then Red, Green, Blue, Purple, Black, Yellow. Within a color: cost ascending, then Character → Event → Stage, then card code ascending. Leaders ordered by color then code. Each populated color/cost/type group receives three adjacent empty reserved pockets. When a group has no spare pocket, a removable overflow sheet is inserted after the final physical sheet in that color section; new cards go in that color's overflow area without moving any existing cards. The digital Binder view recomputes sheet/side/slot locations after each insert; the digital Sorted (Collection) view always presents the ideal player-first order regardless of physical overflow placement. Routine additions never require a physical reshuffle; reshuffling is optional only when the user explicitly chooses to compact or re-sort the real binder.
- **User experience**: The Collection view is the default mobile-first landing page. Tapping a card opens its detail view first (metadata, owned quantity, all binder/deck locations). A "Show in binder" action navigates to and highlights the exact physical Sheet/Side/Slot. The physical Binder view is a literal 3×3 grid with Front/Back toggle and explicit Previous/Next sheet controls (no swipe navigation). Search supports card code and name with filters for color, cost, type, and location. Reserved pockets, no search results, and removable-sheet overflow are all explicit visual states. A dedicated Wanted tab lists wanted entries grouped and filterable by target destination, and search results and card detail views label wanted entries. Pixel 8 Pro (412 CSS px viewport width) is the mobile quality baseline: one-handed use, no horizontal overflow, touch-sized controls.
- **Want-to-buy data**: Source file is `Want to Buy.csv` with columns `code,amount,target`. The `code` value must be an exact known Vega catalog ID. `amount` is a positive integer. `target` is `binder` or any non-empty deck or planning name. Duplicate rows for the same `(code,target)` pair fail validation, but the same code may appear with distinct targets. A target expresses intention only — it does not change physical allocation until the collection or deck source files are updated. The purchase workflow is a single manual commit: update `All.csv`, reduce or remove the matching want row, and update target deck data only where its allocation or list needs changing. No pricing, store links, market data, or automated purchasing.
- **Build and deployment**: npm is the package manager with a committed `package-lock.json`. The project uses a normal GitHub Pages project site at `https://<github-user>.github.io/my-optcg-binder/`; Astro is configured with `site: 'https://<github-user>.github.io'` and `base: '/my-optcg-binder'` (replace `<github-user>` during initial setup). In the GitHub repository Settings, Pages source is set to "GitHub Actions". The deploy workflow triggers on push to `main` and `workflow_dispatch`. It uses `actions/checkout@v7`, `withastro/action@v6` (configured for Node 24 / npm / build), and `actions/deploy-pages@v5` with permissions `contents: read`, `pages: write`, `id-token: write`. Build and deploy are separate jobs; the deploy job uses the `github-pages` environment. There is no PR deployment in v1.

## Testing Decisions

The project is greenfield with no prior test suite. Testing targets one high-level seam: fixture source CSVs plus generated catalog data produce a valid static build with correct externally visible behavior. Specific checks include:

- Valid data produces a complete build with expected search results, physical locations, placement order, reserved pockets, overflow sheets, and deck/binder quantities.
- Wanted entries appear in the correct view and respect target grouping and filter.
- Images and attribution assets are present in the build output.
- Invalid data (duplicate rows, malformed codes, negative quantities) produces explicit error messages naming the source file, row, value, and reason.
- Deck allocation correctly subtracts from collection quantity and reports the remainder as binder quantity.
- Sort order follows the specified precedence (Leaders first, then color order, cost ascending, Character→Event→Stage, code ascending).
- Slot assignment respects reserved pockets and color-section overflow without moving existing cards.
- The detail-to-binder navigation model resolves to a valid sheet/side/slot.
- Search filtering by color, cost, type, and location returns the expected subset, and no-result state displays correctly.
- The mobile layout fits a 412 CSS px viewport without horizontal overflow.
- The deployment build produces Pages-ready output at the expected `site`/`base` path.
- Internal implementation details are avoided; all checks are behavioral and output-oriented.

Local commands run in order: `npm run validate` (CSV/data integrity and manifest consistency), `npm run check` (Astro type-checking and lint), `npm test` (unit/behavior tests), `npm run build` (Astro production build). CI runs these same commands in sequence and deploys only after all pass.

## Out of Scope

- Deck availability, readiness, or missing reports.
- Editing decklists in the browser.
- Multi-binder support.
- Trade inventory, pricing, marketplace or store links, or purchasing automation.
- PWA or offline functionality beyond shipped static assets.
- Live API calls, user accounts, authentication, or any backend or database.
- Copying the full raw Vega snapshot into the repository.
- Any unauthorized use of Bandai logos or implied endorsement.

## Further Notes

- Publishing Vega-derived official card data and images on a public site carries copyright and terms-of-service risk. This is a deliberate user choice — not permission — and the site must include prominent copyright, non-affiliation, and Vega provenance notices.
- Refreshing card images or catalog data is an intentional local manual workflow: re-run `vega pull all` (interactive), re-run the extraction generator, and commit the updated generated assets. GitHub Actions deploys only what has been committed.
- Initial GitHub repository setup requires configuring Pages source to "GitHub Actions" in the repository Settings and replacing `<github-user>` in the Astro `site` and `base` config values with the actual GitHub username.
- See the [closed Wayfinder map](../001-map.md) for the full decision trail and the [binder search prototype assets](assets/binder-search-prototype.html) and [prototype notes](assets/binder-search-prototype-notes.md) for the approved interaction model.
