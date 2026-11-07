---
id: TASK_2026_672_af5a
status: backlog
type: FEATURE
title: Add compaction.subagentAutoStop setting
depends_on: []
created: "2026-10-14T19:33:47.288Z"
updated: "2026-11-07T00:00:00.000Z"
description: >-
  Boolean setting compaction.subagentAutoStop (default true) that turns off the automatic subagent
  budget stop without turning off compaction, with one toggle in the advanced settings UI.
estimate: S
labels:
  - follow-up
relates_to:
  - TASK_2026_657_subagent_handoff
  - TASK_2026_658_advanced_settings
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Add the key `compaction.subagentAutoStop` (boolean, default `true`). With `false`, the near-budget
warning stays, and the subagent budget monitor never stops a subagent (no handoff is needed).
Today the only off switch is `compaction.enabled`, which also turns off compaction.

Files to change:

- `libs/backend/platform-core/src/file-settings-keys.ts`: key and default, next to
  `compaction.subagentStopWeightedTokens` (`:148`).
- `libs/backend/agent-sdk/src/lib/helpers/compaction-config-provider.ts`: read it (`:52`, `:188`).
- `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.ts`: gate the stop
  next to the `enabled` check (`:474-492`).
- `libs/backend/agent-sdk/src/lib/types/settings-export.types.ts`: export list (`:59-64`).
- `libs/shared/src/lib/types/advanced-settings.types.ts`: a toggle row near `:152-178`.

Add specs for the monitor gate and the config read. Verify with
`npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/platform-core,@ptah-extension/shared`.

## Current state (2026-11-07)

- Not started. No `subagentAutoStop` key exists in `libs/`.
- The start condition is met: PR #726 (advanced settings UI) and the subagent handoff work are
  merged, and `subagent-budget-monitor.ts` exists.

Full context, plan and discussion live in [./context.md](./context.md).
