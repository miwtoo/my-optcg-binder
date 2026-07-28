---
title: Specify Astro build and GitHub Pages deployment
status: open
labels:
  - wayfinder:research
parent: .scratch/optcg-static-binder/001-map.md
blocked_by:
  - 020-package-local-card-catalog.md
assignee:
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
