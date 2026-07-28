---
title: Specify Astro build and GitHub Pages deployment
status: closed
labels:
  - wayfinder:research
parent: .scratch/optcg-static-binder/001-map.md
blocked_by:
  - 020-package-local-card-catalog.md
assignee: assistant
---

# Specify Astro build and GitHub Pages deployment

## Question

Decide Astro/static-client architecture, generated-data contract, GitHub Actions build/deploy workflow, and validation commands.

**Context**: Astro is under consideration as the static-site framework. The build must:
- Process the Vega snapshot into minimized static data (blocked by ticket 020).
- Import the three CSVs and generate the binder slot assignment.
- Produce a fully static site deployable to GitHub Pages.
- Rebuild on every commit that touches CSVs, the Vega snapshot, or site source.

Key unknowns:
- Astro vs. plain static client (SPA without a framework)? Trade-offs?
- Contract between data generation scripts and Astro pages: JSON files? Astro content collections?
- GitHub Actions workflow: trigger on push to main? Specific paths?
- Validation: lint, type-check, or test commands that must pass before deploy.

## Resolution

- **Framework**: Astro static output (`output: 'static'`), with vanilla TypeScript browser modules for Collection, search, filter, card detail, and Binder interaction. No React, Vue, or runtime backend.
- **Generated-data contract**: a future local generator reads strict-validated CSV inputs plus the project-local `.vega/` snapshot, and commits a minimized generated JSON data file (catalog, inventory, deck allocations, physical locations, and source manifest/checksums) plus selected `public/images/cards/` assets. Client UI reads that generated data at build time. GitHub Actions never runs vegapull or extraction because raw `.vega/` is uncommitted.
- **Package manager**: npm with committed `package-lock.json`. Future scripts: `generate` (local extraction), `validate` (CSV/data integrity), `check` (Astro type/lint), `test` (unit tests), `build` (Astro production build).
- **CI validation order**: `npm run validate` → `npm run check` → `npm test` → `npm run build`. Deployment runs only after all pass. `validate` must report CSV/data errors explicitly and verify generated-manifest source consistency.
- **GitHub Pages URL**: normal project site at `https://<github-user>.github.io/my-optcg-binder/`. Astro config: `site: 'https://<github-user>.github.io'`, `base: '/my-optcg-binder'` (replace `<github-user>` during initial setup). In repository Settings → Pages, select source "GitHub Actions".
- **Workflow**: path `.github/workflows/deploy.yml`, triggers on push to `main` and `workflow_dispatch`. Uses `actions/checkout@v7`, `withastro/action@v6` (Node 24 / npm / build config), and `actions/deploy-pages@v5`. Permissions: `contents: read`, `pages: write`, `id-token: write`. Separate `build` and `deploy` jobs; deploy job uses `environment: github-pages`. See official guides: [Astro deploy to GitHub Pages](https://docs.astro.build/en/guides/deploy/github-pages/) and [GitHub Pages custom workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site#publishing-with-a-custom-github-actions-workflow).
- **Rebuild behavior**: source and data commits to `main` automatically rebuild and deploy. No deployment on pull requests in v1.
