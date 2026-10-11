# Batch 6F report — Phase 2 code-logic review fixes (TASK_2026_627)

Input: `code-logic-review-phase2.md` (S1, S2, M1, M3, m1, m2). Not committed; the team-leader owns git.

## Backend trace for S1 (done before choosing the fix)

- `SdkAgentAdapter.releaseBudget` (`sdk-agent-adapter.ts:972-976`) calls `SessionBudgetService.release` on session end.
  `release` (`session-budget.service.ts:304-314`) deletes the entry, so `act(..., 'preview-handoff')` reached
  `previewHandoff` with `entry === undefined` and returned `noState()` (`NO_SESSION_BUDGET_STATE`). The workspace
  remembered on the entry (Batch 3) is dropped with it, so no transcript can be read afterwards.
- The RPC handler (`session-budget-rpc.handlers.ts:57-66`) only validates params (UUID session id) and forwards to `act`.
- A handoff document does survive: `runStageActions` writes it to `~/.ptah/handoffs/<sessionId>.md` whenever the
  budget crosses into the handoff or limit stage (`session-budget.service.ts:526-547`), and `write-handoff` writes it
  too. The writer keeps the newest 50 files. A source that reached the stage where the banner offers "Continue" has
  one, unless the write failed or it was pruned.
- Frontend: `rotateSession()` went through `runAction`, which needs `this.budget()`; after the first
  `NO_SESSION_BUDGET_STATE` it clears the card, so a later Retry returned silently (`!budget`).

## Findings and fixes

### S1 — the rotate fallback got no seed — FIXED

- Backend (minimal, same lib patterns): `SessionHandoffWriter.read(sessionId)` returns `{ path, content }` of the
  persisted handoff or `null` (invalid id, missing file/directory); other read errors are WARNed once, never thrown.
  `previewHandoff` with no entry now answers from that file (`persistedHandoff`): `success: true`, no `state` field,
  `seed` built with the builder's new exported `sessionHandoffSeed(content)` (the same preamble and 14,200 cap the
  builder uses; both builder call sites now use it). No file → `NO_SESSION_BUDGET_STATE` as before. A live entry
  never reads the file. `SessionBudgetHandoffWriter` is now `Pick<SessionHandoffWriter, 'write' | 'read'>`.
- Frontend: both fallback entries (Retry on `failed` + `source session unavailable`, and `beginHandover` refused
  with `source-unavailable`) call the new `continueFromGoneSource(sessionId)` instead of `rotateSession()`. It asks
  the host by session id (works with no budget card), always opens a new tab, prefills the seed when one exists,
  and otherwise shows a warning banner in the new tab: "The previous session has ended and no handoff could be
  built for it. This new session starts without its context." A `NO_SESSION_BUDGET_STATE` answer still clears the
  stale card; the failure reason goes to `console.warn`. A thrown RPC also ends in the new tab plus the notice.
  `rotateSession()` (footer "Rotate") is unchanged.

### S2 — a held handover became invisible below the handoff stage — FIXED

`SessionBudgetBannerComponent.stage()` now checks a new `pendingHandover()` (`awaiting-confirmation` or
`waiting-for-turn-end`) before the budget stage: it returns `limit` when the budget is at the limit, otherwise
`handoff`, whatever the budget stage, dismissal or a null budget. The handoff branch shows Cancel for both pending
phases (both are in the coordinator's `CANCELLABLE_PHASES`, `session-handover-coordinator.service.ts:160-166`).
The handoff body no longer needs a budget: with no budget at the handoff stage it reads "Waiting for the handover
to start. You can continue now if needed." A cancelled handover below the stage still shows nothing.

Behaviour change to note: a `waiting-for-turn-end` handover at the handoff stage now also offers
"Cancel (keep working)" (previously only Continue now), as the batch asked.

### M1 — each Retry after a rotate opened another tab — FIXED

The actions service remembers the tab the gone-source fallback opened (`goneSourceTab`, keyed by source session
id). While that tab still exists, a repeated Continue or Retry switches to it (`TabManagerService.switchTab`) and
makes no RPC; if the user closed it, the next click opens a fresh one. Local only: no backend state is faked or
cancelled (cancelling a failed op would re-run `restore` against a gone source).

### M3 — no Cancel at the `limit` stage while awaiting confirmation — FIXED (it is reachable)

Evidence: `request()` (`session-handover-coordinator.service.ts:356-363`) moves an `armed` op with reason
`budget-limit` and no `userConfirmed` to `awaiting-confirmation`; at the blocking limit a waiting `budget-auto`
op is converted to `budget-limit` in place (`:309-318`). The limit branch now shows "Cancel handover" (emits
`cancelHandover`) whenever `pendingHandover()` is true.

### Minors

- m1: `SOURCE_UNAVAILABLE_FAILURE` stays the single frontend constant; its comment now names the backend source
  (`SessionHandoverCoordinator.complete()`, `fail(operation, 'source session unavailable')` in
  `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.ts`) and what happens
  if the wording drifts (Retry falls through to `beginHandover`, whose `source-unavailable` refusal reaches the same
  fallback). Shared contract unchanged.
- m2: comment on the early return after the fallback call explains it skips the queued-input transfer by design.

## Files changed

- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-handoff-writer.ts` — `read()`.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-handoff-builder.ts` — exported `sessionHandoffSeed()`.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.ts` — `persistedHandoff()`, writer type.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-handoff-writer.spec.ts` — 3 tests.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.spec.ts` — `read` fake, 3 tests, M5 assertion.
- MODIFIED `libs/frontend/chat/src/lib/services/session-budget-actions.service.ts` — gone-source fallback, constant comment.
- MODIFIED `libs/frontend/chat/src/lib/services/session-budget-actions.service.spec.ts` — 6 tests.
- MODIFIED `libs/frontend/chat/src/lib/components/molecules/notifications/session-budget-banner.component.ts` — S2, M3.
- MODIFIED `libs/frontend/chat/src/lib/components/molecules/notifications/session-budget-banner.component.spec.ts` — 6 tests, 3 updated expectations.

## Specs that would have caught each finding

- S1: budget spec "preview-handoff for a released session returns the persisted handoff file" (and "... with no
  handoff file reports no state", "... live session never reads the file"); writer specs for `read`; actions specs
  "Retry for an ended source with no budget card still asks the host and opens a seeded tab", "an ended source with
  no handoff still opens a new tab, with a visible notice", "... preview call throws still opens a new tab".
- S2: banner "(S2) awaiting confirmation stays visible at the normal/tighten/unknown stage", "(S2) a handover
  waiting for running work stays visible without a budget", "(S2) a dismissed handoff still shows a handover
  waiting for running work", "(S2) a cancelled handover below the handoff stage shows nothing".
- M1: actions "a second Retry after the fallback switches to the tab it opened", "a second Continue after a refused
  begin switches to the tab it opened", "opens a fresh tab when the one opened for the gone source was closed".
- M3: banner "the limit stage awaiting confirmation keeps New session and offers Cancel", "the limit stage without a
  pending handover offers no Cancel".

## Verification (worktree root, one at a time)

1. `npx jest -c libs/backend/agent-sdk/jest.config.ts .../session-budget.service.spec.ts .../session-handoff-writer.spec.ts .../session-handoff-builder.spec.ts --coverage=false --maxWorkers=2` — 3 suites, 126 tests passed.
2. `npx jest -c libs/frontend/chat/jest.config.ts .../session-budget-actions.service.spec.ts .../session-budget-banner.component.spec.ts --coverage=false --maxWorkers=2` — 2 suites, 90 tests passed.
3. `npx nx typecheck @ptah-extension/agent-sdk --parallel=1` — passed.
4. `npx nx typecheck @ptah-extension/chat --parallel=1` — passed.
5. `npx nx lint @ptah-extension/agent-sdk --parallel=1` — 0 errors, 53 warnings (baseline 53). The only warning in a
   changed file is the existing `max-lines` on `session-budget.service.ts` (751 now, already over 700 before; +27
   lines here).
6. `npx nx lint @ptah-extension/chat --parallel=1` — 0 errors, 35 warnings (baseline 35). The only warning in a
   changed file is the existing unused `Gauge` import in `session-budget-banner.component.ts:16` (not a changed line).

## Deferred

- 627-L9 (review M2, not fixed by instruction): the gone-source fallback skips the queued-input transfer, so queued
  composer text stays in the old tab and the user is not told. Follow-up: carry or point at the queued text when
  the fallback opens the new tab.
- Not changed, noted: the failed banner remains on the old tab after a successful fallback (Retry now just switches
  to the opened tab). Visual review of the new limit-stage "Cancel handover" button and the no-budget handoff copy is
  still owed under the Phase 2 visual review.
- Pre-existing lint warnings above (`max-lines` on `session-budget.service.ts`, unused `Gauge`) left as they were.
