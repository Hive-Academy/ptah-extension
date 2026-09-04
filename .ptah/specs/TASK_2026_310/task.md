---
id: TASK_2026_310
status: backlog
type: REFACTORING
title: >-
  MemoryTriggerService is 1088 lines carrying six concerns; extract collaborators
  behind the facade rule with episode-tracker as the precedent
description: >-
  `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts` is
  1088 raw lines, past the point the project's file-size guidance calls a
  deliberate look rather than an alarm. Line count is not the signal here; the
  concern count is. One class owns trigger wiring and subscription lifecycle,
  the episode buffer's lifecycle, curate invocation, boot-scan mapping,
  coalescing, and rate limiting — six responsibilities with six different
  reasons to change, which is why TASK_2026_306 touched this file twice in one
  task for two unrelated defects (the stalled-pass input loss at `:744` and the
  boot-scan stall handling). The precedent for the extraction already sits in
  the same directory: `episode-tracker.ts` was pulled out of this class and has
  its own spec. `boot-scan-runner.ts` and `memory-trigger-config.ts` are two
  more. Apply the project's facade rule — `MemoryTriggerService` keeps its name,
  its DI token and every public method signature, and each extracted concern
  becomes a collaborator injected into it, exactly as `SkillSynthesisService` /
  `StageHandlersService` did in TASK_2026_256. Respect the stated guardrails:
  the extracted piece must pass the nameability test (no `helpers`, `utils`,
  `common` or `misc`), no file under roughly 150 lines created just to satisfy
  the cap, and a split that pushes the constructor past roughly eight injected
  dependencies was cut in the wrong place — prefer two or three collaborators
  over six fragments. Behaviour-preserving: the existing specs
  (`memory-trigger.service.spec.ts`, `.coalesce.spec.ts`, `.integration.spec.ts`)
  must pass unchanged, which is the whole verification.
---

# Split MemoryTriggerService behind its facade

Machine-owned metadata carrier. Prose lives in `./context.md`.
