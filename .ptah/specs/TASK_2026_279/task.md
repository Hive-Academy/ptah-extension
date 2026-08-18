---
id: TASK_2026_279
status: backlog
type: feature
title: >-
  Give harness copies a provenance marker so a stale Ptah skill stops reading as
  a file the user wrote
description: >-
  TASK_2026_278 made the reconciler adopt legacy rival-CLI agent files by
  signature — `source: ptah` frontmatter for markdown, a `# source: ptah`
  marker plus the legacy structural shape for Codex TOML. Skills and commands
  have no such signature, so a copy the old `SkillJunctionService` left behind
  is indistinguishable from a file the user authored: it is classified
  `foreign`, it blocks the desired path, and it is counted `missing` forever.
  On the dev workspace that is exactly the two entries `ptah harness doctor`
  still reports (`.claude/skills/ptah-cli-usage`,
  `.claude/commands/orchestrate.md`) and every upgrading user inherits the same
  shape. Add a provenance marker the reconciler writes and reads, adopt
  matching entries, and keep genuinely user-authored files untouched. Also add
  the deep-verify preflight mode this needs to notice a hand-edited copy.
---

# Harness provenance marker

Machine-owned metadata carrier. Prose lives in `./context.md`.
