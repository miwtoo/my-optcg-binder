# Triage Labels — Standard Label Mapping

Labels are applied via the `labels` YAML frontmatter field as a list.

## wayfinder labels (project phase)

| Label                 | Purpose                                                |
|-----------------------|--------------------------------------------------------|
| `wayfinder:map`       | Top-level wayfinder map (canonical project overview)   |
| `wayfinder:grilling`  | Requirements / specification / definition ticket       |
| `wayfinder:research`  | Investigation, proof-of-concept, or spike              |
| `wayfinder:prototype` | Design, UX, or structural prototype to validate        |
| `wayfinder:build`     | Implementation tickets (future use)                    |

## Status labels

| Label    | Purpose                                 |
|----------|-----------------------------------------|
| `blocked`| Issue cannot proceed until dependencies  |
| `frontier`| Ready for assignment (open, unblocked)  |

## Domain labels (reserved for future use)

| Label      | Purpose                    |
|------------|----------------------------|
| `data`     | Data / CSV / catalog work  |
| `build`    | CI / deployment / tooling  |
| `ux`       | User-facing experience     |

## Lifecycle

- Issues start with one `wayfinder:*` label plus optional domain labels.
- `blocked` is added/removed as dependencies change.
- `frontier` is derived (not stored) per the tracker spec.
