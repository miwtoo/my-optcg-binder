# Issue Tracker — Local Markdown Tracker

## Root

All tracker data lives under `.scratch/`. Each issue is one markdown file.

## File structure

```
.scratch/<project>/<NNN>-<slug>.md
```

Example: `.scratch/optcg-static-binder/010-normalize-inventory-and-decklists.md`

## YAML frontmatter fields

| Field        | Required | Values                        | Description                                         |
|--------------|----------|-------------------------------|-----------------------------------------------------|
| `title`      | yes      | string                        | Human-readable issue title                          |
| `status`     | yes      | `open` / `closed`             | Whether the issue is active or resolved             |
| `labels`     | yes      | list of strings               | Taxonomy tags (see triage-labels.md)                |
| `parent`     | no       | file path (string)            | Parent issue path, relative to project root         |
| `blocked_by` | no       | comma-separated file paths    | Issues that must be resolved before this one        |
| `assignee`   | no       | string                        | Who is responsible (empty = unassigned)             |

## Frontier definition

The **frontier** is the set of issues matching all three criteria:

1. `status: open`
2. `blocked_by` is empty or all blockers are `status: closed`
3. `assignee` is empty (unassigned)

This is the list of ready-to-work, unclaimed tickets.
