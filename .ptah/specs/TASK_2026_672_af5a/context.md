# Context
Source: TASK_2026_657_subagent_handoff/r4-options.md "Setting design (option D)".
- Key `compaction.subagentAutoStop` (boolean, default true). false: the near-budget notes warning
  stays, the monitor never stops a subagent (no handoff needed).
- Files: platform-core `file-settings-keys.ts` (key + default), agent-sdk
  `compaction-config-provider.ts` (read), `subagent-budget-monitor.ts` (gate next to
  `compaction.enabled`), `settings-export.types.ts`, shared `advanced-settings.types.ts` (toggle row).
- Start after PR #726 (advanced settings) and the subagent handoff PR merge.
