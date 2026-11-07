---
id: TASK_2026_246
status: backlog
type: REFACTORING
title: >-
  Humanize agent-generation: split its god files behind an unchanged facade
updated: 2026-11-07T00:00:00.000Z
description: >-
  The compile gate is fixed (batch 0). Split the oversized services in
  `libs/backend/agent-generation`, merge the two diverging `convertStreamEventToFlatEvent`
  copies, and move direct `node:fs` use behind `IFileSystemProvider`.
---

# Humanize agent-generation

Machine-owned metadata carrier. Prose lives in `./context.md`.

## Description

Behavior-preserving structural refactor of `libs/backend/agent-generation`, in strictly
serial batches (plan in `context.md`, "The batches"). Batches 1 to 9 are open:

- Split `src/lib/services/user-layer/user-layer-mirror.service.ts` (2651 lines) behind a facade
  that keeps the class name and every public signature.
- Reduce the other large services: `enhanced-prompts/enhanced-prompts.service.ts` (1490),
  `orchestrator.service.ts` (1431), `content-generation.service.ts` (1266) and
  `wizard/multi-phase-analysis.service.ts` (1184).
- Merge the two `convertStreamEventToFlatEvent` copies (`content-generation.service.ts` and
  `wizard/multi-phase-analysis.service.ts`). They emit different `thinking_start` events. Which
  behavior is correct is a product decision (batch 6, needs sign-off).
- Replace direct `node:fs` imports with `IFileSystemProvider` (batch 9, behavior change, needs
  sign-off). The only host consumers left are `apps/ptah-electron` and
  `libs/backend/cli-engine/src/lib/container.ts:121`.

## Current state (2026-11-07)

- Done: batch 0, the compile gate, in `9ecfe8ddb`. `project.json:36` declares `typecheck`.
- Some helpers already moved out of the mirror service (`user-layer-fs-ops.ts`,
  `user-layer-clone-state.ts`, `user-layer-orphan-reaper.ts`), but the service grew from 1642 to
  2651 lines.
- `wizard/` now has specs (`multi-phase-analysis.service.spec.ts`, `analysis-schema.spec.ts`).
- 14 non-spec files still import `fs` directly.
- The VS Code host consumer named in `context.md` (`apps/ptah-extension-vscode`) was removed in
  `1cee6fafe`. The lib `CLAUDE.md` cited there no longer exists.
