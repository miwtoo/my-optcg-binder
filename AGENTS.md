# AGENTS.md — Agent Protocol

## Agent skills

- **Local markdown tracker**: issues live as markdown files under `.scratch/`, one file per issue, with YAML frontmatter for structured fields. Triage and frontier queries are grep/glob-native.
- **Standard triage labels**: a shared label taxonomy (`wayfinder:*`, `blocked`, `frontier`, etc.) applied consistently across tracker files. Labels drive status, dependency, and priority filtering without a database.
- **Single-context domain docs**: all persistent domain knowledge lives in `CONTEXT.md` (resolved glossary) and `docs/adr/` (architecture decision records). No scattering across chat logs or ad-hoc notes.
