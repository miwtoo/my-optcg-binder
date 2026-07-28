# Domain — Single-Context Layout

All persistent domain knowledge lives in exactly two places:

## `CONTEXT.md` (project root)

Resolved glossary. Contains definitions for domain terms that are settled and stable. No implementation details, no speculative design—only agreed-upon vocabulary.

## `docs/adr/` (architecture decision records)

One file per significant architectural decision. Each ADR follows a lightweight template:

```
# ADR-NNN: Title
- **Status**: proposed | accepted | superseded
- **Context**: what prompted the decision
- **Decision**: what was chosen
- **Consequences**: trade-offs and impact
```

## Rules of thumb

- If it's background knowledge a new agent needs to read first, put it in `CONTEXT.md`.
- If it's a decision that shaped the architecture, put it in `docs/adr/`.
- Everything else is transient chat context—do not persist.
