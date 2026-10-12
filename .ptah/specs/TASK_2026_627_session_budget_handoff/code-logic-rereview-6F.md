# Code Logic Re-review: Batch 6F (TASK_2026_627)

Scope: `git diff b1ac8e9f8..98852ac81` (9 files), against `code-logic-review-phase2.md` and `batch-6F-report.md`.
Tests run (one at a time): agent-sdk `helpers/session-budget` 6 suites / 269 pass; chat `session-budget-actions.service.spec` + `session-budget-banner.component.spec` 90 pass. No TODO/STUB/PLACEHOLDER markers and no empty bodies in the changed files.

## Verdict: APPROVED. Score 8/10. 0 blocking, 0 serious, 3 moderate/minor.

## Closure of original findings

- S1 CLOSED. `previewHandoff` with no entry now calls `persistedHandoff` (`session-budget.service.ts:~816`), which reads `~/.ptah/handoffs/<id>.md` through `SessionHandoffWriter.read` (`session-handoff-writer.ts:~157`) and builds the seed with the shared `sessionHandoffSeed` (`session-handoff-builder.ts:105`), so the preamble and the cap match the live path. Both fallback entries in the actions service call `continueFromGoneSource` (`session-budget-actions.service.ts:~220, ~267`), which works with no budget card.
- S2 CLOSED. `stage()` checks `pendingHandover()` before the budget stage and the dismissal check (`session-budget-banner.component.ts:~468`). The handoff body no longer needs a budget.
- M1 CLOSED. `goneSourceTab` reuse (`session-budget-actions.service.ts:318-325`) switches to the opened tab instead of opening another, and opens a fresh one when the user closed it (checked through `findTabByIdAcrossWorkspaces`).
- M3 CLOSED. The limit branch shows "Cancel handover" when `pendingHandover()` is true and emits the same `cancelHandover` output. `cancelHandover()` is keyed by the handover's `operationId` and `sessionId`.
- M2 deferred as 627-L9, not re-raised.

## Checks on the new code

- `read`: validates the id through `resolveSessionHandoffPath` (UUID plus a path that stays directly under the handoffs directory), so a traversal is not possible. ENOENT and ENOTDIR return null silently, which is the normal "no file" case. Other errors are WARNed once per code and return null, so `read` never throws. An empty file is treated as missing. Corrupt content is not validated, but it is our own markdown and is only used as seed text, so this is acceptable.
- Different workspace: the handoff directory is user-global and keyed by the session UUID. Session ids are unique, so another workspace's file cannot be returned for this id. The only exposure is that any caller who knows a valid session id can read that handoff through the RPC, which is the same trust level as the existing `write-handoff` action.
- Concurrent clicks: `_busy` is set in `goneSourceSeed` and checked before it. The tab is registered in `goneSourceTab` right after the await resumes, with no further await in between, so a second click either returns on `_busy` or hits the reuse branch. No double tab.
- `pendingHandover` precedence: `handover()` comes from `_handoverClient.stateFor(resolvedSessionId())` (`chat-view.component.ts:936`), so it is per session. The banner is shown only for the active tab. No wrong-session or wrong-tab banner was found.

## Findings

### Moderate: stale persisted handoff is used without a hint (`session-budget.service.ts:~816`)
The file is written at the handoff or limit stage. If the user then extended or compacted and worked on, the ended session's final state is newer than the file. `persistedHandoff` returns the file as the seed with no age or staleness marker. Impact: a new session seeded with older context. This is acceptable for a source that is already gone, but nothing tells the user. Suggest noting in the seed or the UI that it is from the last handoff point (or comparing the file mtime and reporting it).

### Minor: silent ignore when busy (`session-budget-actions.service.ts:326`)
If another budget action is in flight, `continueFromGoneSource` returns with no feedback. The click appears dead for the duration of that call. Low likelihood, short window.

### Minor: single remembered slot (`session-budget-actions.service.ts:124`)
`goneSourceTab` holds one source only. Alternating between two different ended sources opens duplicate tabs. Unlikely in practice. Also, in grid mode `switchTab` on a canvas-tile tab was not shown to focus the tile; the specs do not cover it.

## Five questions (short)
1. Silent failures: a read error becomes null, which becomes the "no handoff" notice plus a `console.warn`. The user is told. OK.
2. User actions: repeated Retry or Continue is handled. Cancel at the limit stage works. Dismiss while a handover is pending is overridden by design.
3. Wrong answer: a stale handoff seed (see the moderate finding).
4. Dependency failure: RPC throw is caught and ends in the new tab plus the notice. Disk read failure is WARNed once.
5. Missing: queued input transfer (627-L9, known).
