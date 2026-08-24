---
id: TASK_2026_319
status: backlog
type: BUGFIX
title: >-
  Booting Ptah issues LLM calls before the user has asked for anything
description: >-
  `MemoryTriggerService.runBootScan`
  (`libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:805`)
  calls `curator.curate` once per session newer than the watermark, at
  activation, gated by `memory.triggers.bootScan` — which defaults to **`true`**
  (`libs/backend/memory-curator/src/lib/triggers/memory-trigger-config.ts:53`).
  Starting the app therefore spends tokens against the user's provider with no
  user action, which is a consent question as much as a cost one. The behaviour
  is not unguarded: it is gated by a setting, abortable via
  `bootScanController`, watermarked so only sessions past the mark are
  processed, and budget-limited downstream — which is why TASK_2026_315 batch 4
  declined to change it. Flipping a shipped default is a product decision about
  whether Ptah learns from your history unprompted, not a bugfix, and it wanted
  an explicit owner. Note the correction this task carries: TASK_2026_315's own
  plan attributed the boot spend to
  `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts:802`,
  and that is **wrong** — that path calls `synthesis.enqueueAnalyze`, a local
  SQLite insert that spends nothing upstream, confirmed by a traced boot in
  which it issued no query. Do not start from the old pointer. The ordering half
  of the original finding (the boot query ran before the MCP server existed and
  was therefore tool-less) is already fixed in commit `1ef31e8db`; only the
  spend itself remains. Recorded as F5 in TASK_2026_315's follow-ups.
---

# Boot issues LLM calls with no user action

Machine-owned metadata carrier. Prose lives in `./context.md`.
