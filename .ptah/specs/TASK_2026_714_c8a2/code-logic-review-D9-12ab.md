# Code Logic Review - D9 batches 12a+12b (native Codex history read)

Score: 5/10. Verdict: REVISE. Blocking 1, Serious 3, Moderate 5.
Scope read: full diff plus `codex-session-history.ts`/`.spec.ts`, `codex-context.ts` (open, serialize, close), `codex-runtime.ts` (open), pinned schema (`definitions.v2`), repo-wide implementers of `CodexContext`/`CodexRuntime`. Nothing was executed (per instructions); compile findings below are by static reading.

## Blocking

### B1. Interface change breaks every other `CodexContext` implementer/fake (typecheck/ts-jest)
`readHistory()` was added as a required member of `CodexContext` (codex-runtime.types.ts, `CodexContext`) and `CodexRuntime`. No file outside codex-runtime references `readHistory` for Codex (grep: only agent-sdk's unrelated `session-history-reader`). Will fail to compile:
- `class FakeContext implements CodexContext`: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.spec.ts:59`, `.../cli-agents/codex-lane-parity.spec.ts:104`.
- `class NativeContext implements CodexContext`: `.../cli-agents/codex-lane-activation.spec.ts:174`.
- `jest.Mocked<CodexContext> = {...}` literals: `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:71`, `.../codex-chat-turn-lifecycle.spec.ts:61`, `libs/backend/rpc-handlers/src/lib/chat/session/chat-continue-codex-resume-once.spec.ts:242`.
- Not checked and likely similar: any object typed as `CodexRuntime` port in `apps/ptah-electron` / cli-engine specs (`codex-runtime-composition.spec.ts`, `codex-lane-composition.spec.ts`). Production code outside codex-runtime only consumes the types (no production implementer found).
Fix: add `readHistory` stubs to these fakes in this batch (or make it a separate optional/segregated port) before commit; run typecheck for cli-agent-runtime, agent-sdk, rpc-handlers, ptah-electron.

## Serious

### S1. "Read-only" history goes through `thread/resume` and mutates state
`CodexRuntime.readHistory` (codex-runtime.ts:56-74) calls `this.open(profile, resume, secrets)` -> `RuntimeContext.open` (codex-context.ts:232-285) which sends `thread/resume` with model/sandbox/approvalPolicy/baseInstructions/developerInstructions/config overrides, calls `store.persist(identity)` (committing identity, bumping `generations`), and on `close()` `store.markInactive` (codex-context.ts:991-997). So a history read re-configures the thread, rewrites the identity store, and marks a live session inactive. It also throws `Codex context is already open` (codex-runtime.ts:84) when the chat context for the same `contextId` is live, i.e. history for an active session fails as `processFailure`. This contradicts the goal ("cannot ... mutate the thread") and the spec test only asserts no `turn/start` (codex-runtime.spec.ts new test), not no `thread/resume`/persist. Fix: open a dedicated read-only process path (spawn + initialize + `thread/read` etc., no resume/persist/markInactive), or document and test the exact accepted side effects.

### S2. Turn items silently replaced/dropped by item pages
codex-session-history.ts:136-164. (a) In the paginated path `thread/turns/list` is already requested with `itemsView:'full'`, then every turn is re-fetched via `thread/items/list` and `items` is overwritten by `entries.map(entry => entry.item)` (line 162); an empty/short items page for a turn that already carried full items silently loses them (success-looking result). (b) Legacy path: `turn.itemsView === 'full'` is the only way to keep embedded items (line 147); `itemsView` is optional in the zod `turn` (codex-protocol-schemas.ts:447), so a legacy server omitting it triggers items/list calls (possibly unsupported on legacy -> misreported error) and overwrites embedded items. Fix: keep embedded items when `itemsView==='full'` or undefined-with-nonempty items; only hydrate for `summary`/`notLoaded`; assert an items-count invariant.

### S3. Error classification mislabels real failures as `threadNotFound`
codex-session-history.ts:39-41: any `CodexRequestRejectedError` for `thread/read`, or for `thread/resume` (any reason: config rejected, auth, internal error), becomes `threadNotFound`. Auth/quota/internal RPC errors thus look like a missing thread and may drive the caller to discard or recreate history. `CodexResumeProfileChangedError` and `CodexContextStateError` (open, line 66 post-request `assertOpen` inside the try) map to `processFailure`; a close mid-read is reported as process failure instead of the context-state error. Fix: classify by JSON-RPC error code/message from the pinned manifest (or only treat the documented not-found shape as not-found); let `CodexContextStateError` and `CodexResumeProfileChangedError` pass through.

## Moderate

- M1. Child discovery second branch (codex-session-history.ts:113): any listed thread with a `parentThreadId` and the same `sessionId` is pulled in even when its parent is not in the tree (orphans, unrelated forks of the same session). Cycle safety is fine (the selection set only grows; loop terminates), but "children of this root" is over-inclusive; restrict to parent-reachable threads or document sessionId semantics (schema marks `sessionId` required but its sharing semantics are not pinned).
- M2. Root with `parentThreadId` set is rejected as `malformedPage` (line 91): resuming a sub-agent thread's history fails with a misleading code.
- M3. Cost: every reload lists the full thread corpus twice (archived false/true, up to 100 pages x 100) from the shared home, then 1 read + (1 read) + N items calls per thread, all inside the context `serialize` queue (codex-context.ts:222), blocking other operations. The `MAX_PAGES` overflow (line 87) reports `stalledCursor`, which is the wrong code for a legitimate very large history (cap hit silently reframed as an error; fine as non-silent, but name it separately, e.g. `pageLimitExceeded`).
- M4. `rootTurnId` (schema Turn) and other unknown thread/turn fields are stripped by non-strict `z.object`, so the snapshot loses them; acceptable per existing policy but note for fidelity. `listed` `thread/list` entries use `sourceKinds` as a fixed list; schema default without it is interactive only, fine.
- M5. Specs do not cover the stated failure paths: the "missing thread" test (codex-session-history.spec.ts:70) throws `CodexSessionHistoryError('threadNotFound')` from the fixture itself, so `from()` mapping is untested there (only codex-runtime.spec.ts new case covers a `failMethod`); no tests for: parentThreadId cycle, thread of another session excluded, empty/blank `nextCursor`, `MAX_PAGES` overflow, duplicate turn/item ids, archived listing, legacy (`includeTurns:true`) path, multi-child ordering tie-break, close mid-read leaving no pending request. Only 4 cases, all single-child.

## Checks that pass
- Schema parity (pinned `definitions.v2`): `ThreadReadParams{threadId, includeTurns?}`, `ThreadListParams` (all fields nullish/optional, `useStateDbOnly` optional boolean, `limit` uint32), `ThreadTurnsListParams{itemsView,sortDirection,cursor,limit}`, `ThreadItemsListParams{turnId,cursor string|{type:'item',itemId}}`, responses `{data, nextCursor, backwardsCursor}` and `ThreadItemEntry{item,turnId,startedAtMs?,completedAtMs?}` match the zod definitions in codex-protocol-methods.ts:76-117 and codex-protocol-schemas.ts:491-502; params use `strictObject`, results `object`, consistent with the neighbouring methods. Validator spec confirms the manifest lists the four methods.
- Paging: per-fetch repeated-cursor set, empty-string cursor rejection, 100-page cap -> stall-safe and bounded.
- Ordering: root first, children by `createdAt` then `id.localeCompare`; turns/items requested `asc`; deterministic.
- Never-empty: no catch-and-default; all errors typed `CodexSessionHistoryError` with fixed text and `cause` retained (no payload leakage). `homeMismatch` precheck before spawn.
- Disposal: `readHistory` closes the context in `finally` (codex-runtime.ts:69-72); `call` re-checks `assertOpen` before and after each request.
- No `thread/revert`/`rollback`, no `turn/start` in the history module. No `any`, `as unknown as`, `@ts-ignore`, `eslint-disable` found in the new/changed files (type-level `import('...')` inline types in codex-runtime.types.ts are style only).

## Five questions (short)
1. Silent failure: S2 (items dropped by an empty page); legacy `itemsView` omitted.
2. Unexpected user action: reloading history of a live session fails (`already open`) and a reload mutates identity store (S1).
3. Wrong answer from data: orphan child threads included (M1); a sub-agent root rejected (M2).
4. Dependency failure: non-not-found RPC rejection reported as `threadNotFound` (S3).
5. Missing: live-shape confirmation (spec admits fixtures are UNCONFIRMED), test coverage in M5, compile updates in B1.

## Verdict
REVISE (5/10, confidence MEDIUM-HIGH). Top risk: B1 breaks typecheck in three other libs, and S1 makes the "read-only" read resume and rewrite the thread/identity store. Required before accept: B1 stubs, S1 decision (read-only process path or an explicit accepted/tested contract), S2 item-preservation fix, S3 error mapping, plus tests for cycle/other-session/page-cap/legacy paths.
