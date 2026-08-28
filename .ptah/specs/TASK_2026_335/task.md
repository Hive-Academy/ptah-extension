---
id: TASK_2026_335
status: done
type: BUGFIX
title: >-
  Three places the renderer silently loses a user's own content — the segment
  cap, the unflushed persistence debounce, and the stdout front-truncation
description: >-
  Both Phase 3 reviewers of TASK_2026_323 independently found the same class of
  defect: content the user produced or watched being discarded with no marker and
  no notice. First, `agent-monitor.store.ts:821-823` caps segments at 500 with a
  bare `slice(-500)` — no fold, no synthetic marker — sitting directly beside a
  `streamEvents` cap at `:1680-1821` that DOES fold what it drops into the
  surviving structure, so the codebase already knows folding is required on this
  surface. A long Codex or Copilot subagent loses its earliest reasoning
  permanently. Second, `tab-manager.service.ts:1862-1890` debounces the
  `localStorage` write by 500 ms trailing with a 5 s max wait and has NO flush on
  teardown: there is no `ngOnDestroy`, no `beforeunload` listener anywhere in app
  or lib source, and `apps/ptah-electron/src/main.ts:84` `before-quit` flushes
  only `fileSettings` and Sentry. `setTimeout` timers do not survive teardown, so
  finishing a turn and closing the panel within 500 ms loses the last finalized
  assistant message — and on restore `SessionLoaderService` discards the resumed
  messages as already cached, so it does not come back. Third,
  `agent-monitor.store.ts:2007-2012` front-truncates stdout and stderr past 50 KB
  with no truncation marker. The third is pre-existing rather than new, but it is
  the same defect on the same surface and should be fixed with the others.
relates_to:
  - TASK_2026_323
labels:
  - chat-streaming
  - chat-state
  - data-loss
executor: frontend-developer
estimate: M
---

# Silent content loss on the chat and agent-card surfaces

Machine-owned metadata carrier. Prose lives in `./context.md`.
