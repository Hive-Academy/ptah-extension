---
id: TASK_2026_288
status: done
type: bugfix
title: >-
  A skills.sh install reached one agent and left a permanent finding in the
  doctor — give it a source root the reconciler can own
description: >-
  `skillsSh:install` shelled out to `npx skills add`, which writes straight into
  `{ws}/.claude/skills` or `~/.claude/skills`. That path bypasses the user layer
  entirely — no clone, no plugin overlay, no managed manifest — so the skill
  reached Claude and nothing else: not `.agents/skills` (codex, antigravity),
  not `.github/skills` (copilot), not `.cursor/skills`. The second-order effect
  was worse than the missing sync. `.claude/skills` is a MANAGED directory, and
  a path there that no manifest owns and no desired state names is `foreign` by
  rule, so every skills.sh skill became a permanent unclearable finding in `ptah
  harness doctor` — clearable only by moving or deleting the file. Ptah refusing
  to touch them was correct; the defect is that they were installed outside the
  one pipeline that would have given it proof of ownership. A `scope of
  'global'` install went to `~/.claude/skills`, outside any workspace, where the
  workspace-scoped reconciler cannot see it even in principle.
updated: '2026-08-25T21:16:28.061Z'
---

# skills.sh installs routed through a Ptah-owned source root

Machine-owned metadata carrier. Prose lives in `./context.md`.
