# Code Logic Review - TASK_2026_702 Phase 3 (canvas needs-you chip removal)

Review family: reviewer Anthropic (Sonnet), implementer codex CLI.
Score: 8/10. Verdict: APPROVED (no Blocking or Major findings).
Not run (per rule): nx, jest, build, e2e. Static review of `git diff HEAD` plus bell sources.

## Findings

1. Minor - Open no longer selects the canvas detail/lane pane (the lane-reported gap).
   Chip: `canvas-needs-you-queue.component.ts:235-246` (HEAD) called `CanvasDetailService.open`.
   Bell: `chat-attention-action-dispatcher.service.ts:46-58` calls `router.focus(...)`, which goes to
   `NotificationFocusCoordinator.run` -> `appState.requestCanvasFocus` (`notification-focus-coordinator.service.ts:~40-47`),
   so the Electron canvas still focuses the owning session tile (workspace switch, `setCurrentView('chat')`, tile cap handled).
   Approval: `parity-inventory.md:33` approves removal and names the replacement as "opens the relevant session"
   (`CanvasDetailService.open()` OR `CanvasStore.focusTile()`), and `decisions.md` #10 says the bell "covers the chip, incl. lane permissions".
   Session focus is therefore covered by the approval; exact lane-pane selection is not promised anywhere.
   Severity: low. Lane permissions can still be Allowed/Denied in the bell without opening anything; only the
   "jump to the lane that asked" convenience is lost. Optional follow-up, not a gate.
2. Minor - preserve-table line numbers are approximate. Verified semantically: permission/question/lane-permission kinds at
   `chat-attention-source.service.ts` reconcile() (~lines 62-79 in the lane's numbering; actual loop sits in the same block),
   Allow/Deny/Open/Answer actions built in `add()` (~132-136), dispatch `allow|deny` -> `respondSession`/`respondLane`
   (`chat-attention-action-dispatcher.service.ts:60-66`). Every chip capability is present except item 1. The bell is an improvement
   in places: disabled reasons, in-flight guard, generation check against stale clicks, Answer for questions.
3. Minor - stale comment `electron-shell.component.ts:265-269` still says the ticker "lives in the canvas dock row"; that comment
   is out of Phase 3 scope (dock/ticker removal) but should be cleaned with the dock removal.
4. Minor - the new absence test `orchestra-canvas.component.spec.ts:940-944` is weak: the stub was removed, so an unregistered
   element would be null regardless. It guards little; the real protection is the compile-time template check plus the repo grep.
   Acceptable for a deletion task.

## Checks

- Dangling references: `git grep -i "needs-you|All clear|canvas-needs"` in libs/ and apps/ finds only the new absence spec,
  the unrelated `needsYouCount` inspector badge (`canvas-rail-board.component.ts:453,484`, kept and independent), and unrelated "clears" words.
  No e2e (apps/ptah-electron-e2e, webview e2e), DI provider, style, or index export references the chip.
- Layout: remaining references to `session-viewport`/`canvas-interactive` are `orchestra-canvas.component.spec.ts:926-953` and
  `startup-tti.spec.ts:28,58` (waits on visibility only). None assert the removed row's geometry. The `flex-1 min-h-0` interactive area
  simply gains ~32 px; no `CanvasLayoutService` dependency on the row was found.
- Specs: removed tests covered only the chip (deferred mount/placeholder footprint) and the four deleted spec files; the chip's behavior
  now lives in `chat-attention-*.spec.ts` and notification-center specs. The remaining dock/viewport allocation and rail integration specs
  still exercise real behavior; only unused imports/stubs were removed (no leftover unused imports spotted in the diff).
- Diagnostics errors the lane cites are in untouched files.

## Residual uncertainty

- Specs were not run; the orchestrator should run `npx nx test canvas --parallel=1` and typecheck of the Electron host.
- Bell mounting in the Electron shell (`electron-shell.component.ts:62`) was confirmed by import, not by running.
