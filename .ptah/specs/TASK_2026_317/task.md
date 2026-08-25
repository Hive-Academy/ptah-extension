---
id: TASK_2026_317
status: in_review
type: BUGFIX
title: >-
  Surface workflows are routed by a correlation id no registry knows, so New
  Project questions land on a stranger's tile and the watchdog kills the session
description: >-
  Starting a New Project fails three separate ways, and the first two share one
  root cause. `SdkQueryOptionsBuilder` derives every prompt's routing ids from
  `sessionConfig.tabId ?? sessionId`
  (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:646`),
  and for a NEW session the SDK UUID does not exist yet — so an AskUserQuestion
  raised by a surface workflow carries the harness's CORRELATION id in BOTH
  `sessionId` and `tabId`. A chat tab is unharmed, because there the correlation
  id IS a bound `TabId`; that is exactly why this only ever broke on the non-tab
  surfaces (New Project, harness builder, setup wizard) while canvas tiles have
  always worked. On a surface both of `StreamRouter.routeQuestionPrompt`'s
  lookups miss, no targets are attached, and `ChatViewComponent`'s
  "show it on the active tile" safety net paints the card onto whichever canvas
  session happens to be focused while the workflow's own panel stays empty.
  `chat:pending-questions`, which looks up by real session id, could never
  replay them after a reload either. Second, the 180s `NoActivityWatchdog` treats
  a turn parked on `canUseTool` as a wedged provider: an AskUserQuestion emits
  zero stream events by construction, so a user reading a card the UI labels
  "No timeout" had the whole session aborted under them three minutes in —
  inside the prompt's own 5-minute grace. Third, `WebviewNavigationService` kept
  a private mirror of the current view that every direct `setCurrentView` caller
  (each Electron navbar tab, the host's `switchView` message) left stale, and
  `navigateToView` short-circuits against it — so "Resume New Project" reported
  success and navigated nowhere. Evidence and full reasoning in `./context.md`.
---

# Surface workflows cannot receive the questions they ask

Machine-owned metadata carrier. Prose lives in `./context.md`; the batch
breakdown lives in `./tasks.md`.
