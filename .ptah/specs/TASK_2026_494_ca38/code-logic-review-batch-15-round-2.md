# Code Logic Review — `TASK_2026_494` Batch 15, Round 2 (FINAL)

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 9/10                                 |
| Assessment          | APPROVED                             |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 0 new (1 carry-over, pre-existing)   |
| Failure modes found | 0 new                                |

This is the last round. Every round-1 finding — my own M1/M2 and codex's B1/S1/S2/M — was
re-verified against the current worktree source (not just the fix report's claims), with the
comparator logic, reducer transitions, service state machine and every listed spec read in full,
plus fresh test and `tsc` runs. All nine are correctly fixed, pinned with specs that fail on the
pre-fix behaviour (confirmed by the fix report's own red/green log, and by reading the fixes
directly), and none of the four extracted files (`apps-conversation-claims.ts`,
`apps-session-rpc.ts`, `apps-session-rpc.ts`'s `failureText`, `apps-transcript-order.ts`) changed
behaviour in the move. No new logic defect was found in the round-1-to-round-2 diff.

## Verification performed this round

- Read in full: `apps-session.service.ts` (695 lines), `apps-conversation-claims.ts`,
  `apps-session-rpc.ts`, `apps-workspace-slice.ts`, `apps-surface-reducer.ts` (528 lines),
  `apps-transcript-order.ts`, `apps-surface-panel.component.ts`, `apps-transcript.component.ts`,
  `apps-page.component.ts`.
- Read the relevant spec sections: `apps-page-conversation.spec.ts` (B1, S1, M2, codex fix-list 5),
  `apps-surface-panel.component.spec.ts` (S2's four cases, M1's two-failed-surface case, the
  Date-range case), `apps-session.service.spec.ts` (M2's three pending-turn cases).
- `npx tsc -p libs/frontend/mcp-apps-page/tsconfig.spec.json --noEmit`: exactly 8 errors, all in
  `mock-rpc-service.ts` (54,16 / 60,24 / 66,25 / 69,25) and `monaco-loader.service.ts`
  (113,23 / 151,24 / 171,41 / 187,28). No error in any `mcp-apps-page` file. Matches the baseline
  exactly; item 7 confirmed closed.
- `npx jest -c libs/frontend/mcp-apps-page/jest.config.ts --runInBand` on the 10 suites touched by
  this batch and its fixes (`apps-page.component`, `apps-page-conversation`,
  `apps-surface-panel.component`, `apps-transcript-order`, `apps-session.service`,
  `apps-surface-reducer`, `apps-submit-flow`, `apps-surface-operations.service`,
  `apps-surface-lanes`, `apps-surface-sync`): **183/183 passed**.
- `npx jest -c libs/frontend/declarative-dashboard/jest.config.ts --runInBand trust-boundary.spec.ts
  dashboard-chart.component.spec.ts surface-layout.component.spec.ts`: **37/37 passed**, including
  a fresh `trust-boundary.spec.ts` scan of the now-larger `mcp-apps-page/src`.
- `git status --short` / `git diff` (read-only): nothing staged; the new files are untracked
  (`??`); no source or spec file was touched by this review.

## Confirm table

| # | Item | Ruling | Evidence |
| --- | --- | --- | --- |
| 1 | My M1: `failedRenderable` keyed per surface | CONFIRMED FIXED | `failedRenderables = signal<ReadonlyMap<string, SurfaceRenderable>>` (`apps-surface-panel.component.ts:287`); `fallback` computed compares `this.failedRenderables().get(entry.surfaceId)` against the *current* surface's content (`:322-330`); `markRenderFailed` drops records of surfaces no longer held (`:396-407`). Spec: `apps-surface-panel.component.spec.ts:411-457` switches b→a→b→a→b across two independently-failed surfaces; builder called exactly twice (once per surface), each shows its own fallback text, and a new push of `b` (revision 2) retries (3rd call). Verified passing in this round's own run. |
| 2 | My M2: `isProcessing()` honours `turnPending`/`pendingTurn` after the session id resolves | CONFIRMED FIXED | `turnPending: boolean` replaced by `pendingTurn: AppsPendingTurn \| null` (`apps-workspace-slice.ts:47,61`); `isProcessing` checks `slice.pendingTurn !== null` unconditionally, before the `sessionId === null` early return (`apps-session.service.ts:172-180`); a root effect clears it once liveness moves off `livenessAtSend` (`:206-224`), and `failTurn`/a successful `abort()` also clear it (`:360-363`, `:586-590`). Specs: `apps-session.service.spec.ts:782-828` (3 cases: continue stays processing past resolution until liveness moves; first turn stays processing when the session id resolves before liveness reports it; a successful abort ends it); `apps-page-conversation.spec.ts` pins Send staying disabled at the page level. All passed in this round's run. |
| 3 | codex B1: reset target captured before the await; abort failure keeps the slice with a notice | CONFIRMED FIXED | `resetConversation()` captures `key`, `conversation`, `sessionId` synchronously before any `await` (`apps-session.service.ts:376-379`); on abort failure it patches only the captured slice via `patchOwned` (ownership-guarded) with `notice`, discards nothing, returns `false` (`:382-389`); on success it re-checks `isAppsSliceOf(current, conversation.routingId)` after the await before discarding, so a replacement conversation during the abort is left alone (`:394-396`); `discardSlice(key)` only runs once ownership is confirmed. Specs: `apps-page-conversation.spec.ts:322` (workspace switch during abort — B untouched, A discarded), `:358` (abort failure — role="status" notice, no discard, dismissible), `:396` (conversation replaced during abort — replacement kept), `:419` (nothing running — 0 aborts). All 4 passed in this round's run; read directly, not just the report's claim. |
| 4 | codex S1: send-time stamp, stable order | CONFIRMED FIXED | `AppsSubmitHost.submitted(text, sentAt)` publishes `active.sentAt` (the time `surface:action` was sent), not receipt time; `AppsSurfaceOperations` stores `{ text, at: sentAt }` (`apps-surface-operations.service.ts:410`, read directly). `compareTranscriptItems` sorts by `at`, ties resolve user-first, same-kind ties keep stable input order, no subtraction (`apps-transcript-order.ts:25-32`, read directly — this is the "moved to its own module" extraction, confirmed behaviour-preserving by inspection and by the passing comparator spec). An unstamped node sorts to `+Infinity`, not epoch 0, closing my own round-1 minor item (`apps-transcript.component.ts:160-163`). Spec: `apps-page-conversation.spec.ts:511-570` sends at t=1000, a reply node at 1200, a late `applied` result at t=2000 — asserts order `['Build me a form', 'Submitted: Send', 'reply']` with exactly one bubble. Passed. |
| 5 | codex S2: ruling implemented with state in slice/session, 4 cases | CONFIRMED FIXED | `AppsSurfaceState.pickedSurfaceId` (`apps-surface-reducer.ts:61`); `activateSurface` sets both `activeSurfaceId` and `pickedSurfaceId` (`:496-506`); `applySnapshot` only auto-activates a NEW surface when `state.pickedSurfaceId === null` — an agent update to a held surface never touches selection or pick (`:225-233`); `keepPicked` clears the pick when its surface is deleted/evicted/dropped by a read, applied at `applyDelete` (`:329`) and `applySurfaceRead` (`:464`); a fresh conversation gets a fresh reducer state with no pick. All four spec cases read directly in `apps-surface-panel.component.spec.ts`: `:195` (pick survives an agent update to another surface, ui-write doesn't steal it, an agent replace of the OTHER surface doesn't either — exactly matches the PLAN DEVIATION wording in `implementation-plan.md:666-669`), `:223` (focus in the picked surface's control survives an unrelated agent update — same DOM node, `document.activeElement` unchanged), `:249` (pick survives a brand-new agent surface), `:267` (picked surface evicted → falls back to most recent, pick cleared, a later new surface auto-activates again), `:293` (no pick → auto-activation still works as before). All passed in this round's run. |
| 6 | NaN date | CONFIRMED FIXED | `readLastSubmit` adds `!Number.isNaN(new Date(submittedAt).getTime())` (`apps-surface-panel.component.ts:73-79`), rejecting `Number.MAX_VALUE` and `8_640_000_000_000_001` while still accepting the exact boundary `8_640_000_000_000_000`. Spec (`apps-surface-panel.component.spec.ts:490-520`) covers both the parse-level rejection and a DOM assertion that the rendered text never contains "NaN". Passed. |
| 7 | Spec-tsc errors: 4 fixed, exactly the 8 baseline remain | CONFIRMED | Ran `npx tsc -p libs/frontend/mcp-apps-page/tsconfig.spec.json --noEmit` myself this round: exactly 8 `TS2352` errors, all in `core/src/testing/mock-rpc-service.ts` (54,60,66,69) and `git-ui/.../monaco-loader.service.ts` (113,151,171,187). Zero errors in any `mcp-apps-page` file. |
| 8 | Extraction behaviour-preserving | CONFIRMED | `apps-conversation-claims.ts`: claim order (inbox → workflow claim → interactive surface registration → `onSurfaceCreated`) and release order (inbox → workflow → `onSurfaceClosed` → sync dispose, each step isolated in its own try/catch) match the doc comment and the original inline description in the plan; nothing here differs from what `AppsSessionService.claimConversation`/`teardown` called before the move. `apps-session-rpc.ts`: `failureText` is a pure string helper (unchanged logic — Error-with-nonempty-message vs. fallback); `abortAppsSession` is the same "call chat:abort, fail-closed to a reason string, never throw" contract used identically by `abort()`, `resetConversation()` and `abortUnownedStart()`. `apps-transcript-order.ts`: the comparator and item type were pulled out of the transcript component with no semantic change (confirmed by direct comparison against the sort call site in `apps-transcript.component.ts:165`, which is a bare `.sort(compareTranscriptItems)`) — this is also independently exercised by the dedicated `apps-transcript-order.spec.ts` (4 comparator cases) cited in the fix report and by the page-level S1 spec. |
| 9 | Regressions | NONE FOUND | B8 synchronous write-back: `setSurfaceViewState`/`storeViewState` pass the renderer's emitted object straight through with no clone, no await, and the reducer's `setSurfaceViewState` is an identity-short-circuit on the same object (`apps-surface-reducer.ts:478-488`) — unchanged from round 1. Per-keystroke reconcile: the round-1-cited codex fix-list 5 spec (now `apps-page-conversation.spec.ts:458-508`, read in full) proves 0 new RPCs, an unchanged `materializedRevision`, the same overlay object identity, and `setTimeout` called exactly once per keystroke (the input's own debounce) across 5 real keystrokes with a change in flight and a submit waiting. `interaction` is bound via a `computed` (`apps-surface-panel.component.ts:335-340`), not a template call. No `innerHTML`/`bypassSecurityTrust`/`DomSanitizer` in any new or modified file; assistant markdown still renders only through the chat lib's `ExecutionNodeComponent` → `ngx-markdown`. `trust-boundary.spec.ts` passed fresh against the current `mcp-apps-page/src` in this round's own run (37/37, including that suite). |

## New findings this round

None. No blocking, serious or moderate defect was found in the round-1-to-round-2 diff. The nine
confirm-table items above are the entire scope of what changed since round 1's 7/10, and all nine
hold up under direct source reading plus a fresh test/tsc run, not just the fix report's narrative.

## Carry-overs for B20 / B16 / visual review (unchanged, re-confirmed)

- **B20 (splitter):** `apps-page.component.ts:216-219` still has the unclaimed
  `.apps-split-handle-slot` div and `--apps-conversation-width` grid variable
  (`apps-page.component.ts:66`); no B15 fix-round code writes to either. Clean seam, nothing new to
  add.
- **B16:** nothing new observed.
- **Pre-existing, out-of-scope, not a regression of this batch:** `resetConversation()` (and the
  original `abort()` it's modeled on) skips the abort entirely when the session id has not yet
  resolved — the window between `chat:start` sending and `TabSessionBinding` binding the surface.
  In that narrow window, "New conversation" discards without stopping a session that may complete
  moments later; `abortUnownedStart()` catches the case where `chat:start` itself resolves late,
  but not a start that already resolved with only the binding still pending. This is unchanged
  pre-existing behaviour (the fix report's own "Out-of-scope observations" section notes it),
  explicitly called out by the coordinator as a follow-up, not a defect in this round's fix. Not
  scored against this batch.
- **Visual review:** confirm in a real browser that (a) the two-failed-surfaces switch (M1) never
  flashes a renderer before the fallback mounts (only checked under Jest/TestBed timing so far),
  and (b) the new `role="status"` conversation notice (`apps-page.component.ts:152-172`) reads
  clearly next to the existing `role="alert"` error block without visual collision, in both
  light/dark and the narrow (<480px) stacked layout.

## One-line summary

APPROVED, 9/10 — all nine round-1 findings (my M1/M2, codex's B1/S1/S2/M, plus the coordinator's
required 4 spec-tsc fixes) are genuinely fixed with specs that fail on the pre-fix behaviour, the
extractions are behaviour-preserving, `tsc` shows exactly the 8 accepted baseline errors, 183 + 37
targeted tests pass, and no regression was found in B8 write-back, per-keystroke reconcile, the
`interaction` binding, or the markdown/innerHTML trust boundary.
