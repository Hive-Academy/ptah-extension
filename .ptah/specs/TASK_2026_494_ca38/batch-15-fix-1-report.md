# Batch 15 fix round 1 report

Executor: frontend-developer subagent. Inputs: `code-logic-review-batch-15.md` (subagent, 7/10), `code-logic-review-batch-15-codex.md` (codex, 5/10), `batch-15-report.md`, and the Batch 15 section of `batches.md` (spec-tsc BASELINE, round-1 summary, PLAN DEVIATION ruling). Nothing was committed or staged.

Paths are relative to `libs/frontend/mcp-apps-page/src/lib/` unless stated. Line numbers are 1-based and current.

## Files

| Status | File | Lines | Why |
| --- | --- | --- | --- |
| MODIFIED | `services/apps-session.service.ts` | 695 | Adds `resetConversation`, `notice`/`clearNotice`, `pendingTurn`-aware `isProcessing`, the pending-turn settle effect and private `discardSlice`. Delegates claim/release to `AppsConversationClaims` and the abort RPC to `apps-session-rpc.ts`, which keeps the file under 700 lines. |
| CREATED | `services/apps-conversation-claims.ts` | 87 | The claim order and release steps, moved unchanged out of the session service (inbox first, then the workflow claim, the interactive surface and the binding; releases in the same order, and one failing step does not block the others). |
| CREATED | `services/apps-session-rpc.ts` | 37 | `failureText` (moved) and `abortAppsSession`, the one `chat:abort` call used by Stop, New conversation and the unowned-start abort. It returns the failure reason or null. |
| MODIFIED | `services/apps-workspace-slice.ts` | 190 | `turnPending: boolean` becomes `pendingTurn: AppsPendingTurn \| null` (`livenessAtSend`), and the slice gets a new `notice`. |
| MODIFIED | `state/apps-surface-reducer.ts` | 528 | `pickedSurfaceId` plus the ruling's activation rules. |
| MODIFIED | `components/apps-page.component.ts` | 278 | New conversation calls `resetConversation()`; `role="status"` notice with a dismiss button. |
| MODIFIED | `components/apps-surface-panel.component.ts` | 437 | Failure records keyed by surface id; Date-range check in `readLastSubmit`. |
| MODIFIED | `components/apps-transcript.component.ts` | 213 | Sorts with `compareTranscriptItems`; an unstamped node sorts last. |
| CREATED | `components/apps-transcript-order.ts` | 32 | `AppsTranscriptItem` (moved) and `compareTranscriptItems`, a pure module so it can be unit-tested without the chat lib. |
| MODIFIED | `services/apps-submit-flow.ts` | 662 | `AppsSubmitHost.submitted(text, sentAt)`. |
| MODIFIED | `services/apps-surface-operations.service.ts` | 448 | The bubble's `at` is `sentAt`. |
| CREATED | `components/apps-page-conversation.spec.ts` | new | Page pins for B1, S1, M2 and codex fix-list 5 (7 tests). |
| CREATED | `components/apps-transcript-order.spec.ts` | new | Comparator pins (4 tests). |
| MODIFIED | `components/apps-surface-panel.component.spec.ts` | | Switcher, M1 and Date pins (see below). |
| MODIFIED | `services/apps-session.service.spec.ts` | | M2 pins; liveness `statuses` is now a writable fixture signal. |
| MODIFIED | `state/apps-surface-reducer.spec.ts` | | Manual-pick pins; `SurfaceContentV2` narrowing (tsc). |
| MODIFIED | `services/apps-submit-flow.spec.ts` | | Send-time pin; fixture ends the first turn; valid error code (tsc). |
| MODIFIED | `services/apps-surface-operations.service.spec.ts` | | Fixture ends the first turn. |
| MODIFIED | `services/apps-surface-lanes.spec.ts`, `services/apps-surface-sync.spec.ts` | | Valid error code (tsc). |

Nothing under `libs/frontend/declarative-dashboard/src` changed: no finding required it.

## Findings

### codex B1 (blocking): New conversation discards the wrong workspace, or discards after a failed abort. FIXED

- `AppsSessionService.resetConversation()` (`services/apps-session.service.ts:375`) captures the workspace key, the conversation and its session id before any await, and acts only on them:
  - On abort failure it writes a notice to the captured conversation's slice only (`patchOwned`): `APPS_RESET_KEPT_NOTICE` (`:62`) + ` Reason: {why}`. It returns false and discards nothing.
  - On success it marks the captured session idle. It discards (`discardSlice(key)`, `:603`) only if that key's slice still belongs to the captured routing id. A workspace switch cannot redirect the discard, and a conversation replaced during the abort is left alone.
  - With nothing running it discards at once and sends no abort.
- `discard()` stays as the synchronous public primitive (Req 2.5; used by existing specs). It now delegates to `discardSlice`.
- Page: `newConversation()` just awaits `resetConversation()` (`components/apps-page.component.ts:276`). The notice renders as `role="status"` with a "Dismiss notice" button (`:156`). It is not the `role="alert"` error. `send()` clears it, and so does a successful reset (which creates a new slice).
- Specs (`components/apps-page-conversation.spec.ts`):
  - `:322` A pressed, switch to B during the abort. B's routing id, bubbles and inbox claim are untouched; A is released and shows the empty state.
  - `:358` Abort fails: the conversation, claims and bubbles are unchanged, the `role="status"` notice shows the reason, there is no error alert, and dismiss works.
  - `:396` The conversation is replaced during the abort: the replacement is kept.
  - `:419` Nothing running: discards with 0 `chat:abort`.
- Red/green: `newConversation` temporarily reverted to `if (isProcessing()) await abort(); discard();`.
  - Result: 3 failed, 1 passed. The switch test got B's routing id `null` (B was discarded). The abort-failure test got `isActive` `false`. The replacement test got the routing id `null`.
  - After restoring: 4 passed.

### codex S1 (serious): the submitted bubble is stamped at result time and sorts after its reply. FIXED

- `AppsSubmitHost.submitted(text, sentAt)` (`services/apps-submit-flow.ts:98`). `settle` passes `active.sentAt` (`:591`), the time `surface:action` was sent. It still publishes only on applied or indeterminate, so a rejected submit shows no bubble.
- The facade stores `{ text, at: sentAt }` (`services/apps-surface-operations.service.ts:410`).
- Stable tie-break: `compareTranscriptItems` (`components/apps-transcript-order.ts:25`) orders by time, and on a tie the user bubble comes first, whatever the input order. Items of the same kind keep their input order (stable sort). The comparator uses no subtraction.
- A node with no `startTime` now sorts last (`Infinity`, `components/apps-transcript.component.ts:162`), not at epoch 0. This also closes the subagent's minor item.
- Specs:
  - `components/apps-page-conversation.spec.ts:511` (page): send at t=1000, reply node at 1200, result at 2000. Order is `['Build me a form', 'Submitted: Send', 'reply']` with exactly one bubble.
  - `services/apps-submit-flow.spec.ts:555`: result 5 s late, `at === sentAt`.
  - `components/apps-transcript-order.spec.ts`: 4 comparator cases (ties in both input orders, same-kind stability, `Infinity`).
- Red/green: `at: sentAt` temporarily reverted to `at: Date.now()`.
  - Result: 2 failed. The flow spec expected `at` 1790368193223 and received 1790368198223. The page order put the reply before the bubble.
  - After restoring: 2 passed.
- The codex request for a real user-echo integration test is not added at this layer. The real `ExecutionTreeBuilderService` needs the whole streaming accumulator stack (`StreamingAccumulatorCore`, dedup, session manager, agent stores), and none of that is public API of `@ptah-extension/chat-streaming`.
  - Existing coverage: "SDK user echo is never a node" is pinned where it is implemented, `libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.spec.ts:304`, against `execution-tree-builder.service.ts:340-346`.
  - The Apps page spec asserts exactly one "Submitted:" bubble.

### codex S2 (serious): agent snapshots override the user's switcher pick. FIXED per the PLAN DEVIATION ruling

- New slice state `AppsSurfaceState.pickedSurfaceId` (`state/apps-surface-reducer.ts:61`), held in the session slice. The page holds no state, and no UI was added.
- `activateSurface` (`:496`) sets the active surface and pins it. Picking the surface that is already active also pins it.
- `applySnapshot` (`:231`): an agent snapshot activates its surface only when the surface is new and no pick exists. An agent update to a held surface never takes the selection, pick or no pick. The pick survives because `keepActive` keeps it while its surface is held.
- Deletes, evictions, reads and `trimToBound` clear the pick through `keepPicked` (`:176`, used at `:329` and `:464`). The active surface then falls back to the most recently changed surface, and new agent surfaces auto-activate again.
- A new conversation starts with a fresh reducer state, so there is no pick.
- Superseded assertion: the old panel pin "the agent replaced b: it becomes the active surface" (panel spec, previously `:212-217`) encoded the plan wording "agent snapshot activates its surface". The coordinator's PLAN DEVIATION ruling supersedes that wording.
  - What changed: I kept that test and its first two phases (agent snapshot activates; a `ui` write does not steal the pick). Only the last phase now asserts the ruling: the pick stays on `a`, and `b`'s tab label still updates to "Second, rebuilt". It has a comment citing the ruling.
  - No other assertion was changed.
- Specs:
  - `components/apps-surface-panel.component.spec.ts`:
    - `:195` The pick survives an agent update to another surface.
    - `:223` Focus in the picked surface's input survives an agent update to another surface (same DOM node, still `document.activeElement`).
    - `:249` The pick survives a new agent surface.
    - `:267` Picked surface evicted: falls back to the most recent, the pick is cleared, and a later new agent surface activates.
    - `:293` No pick: a new agent surface activates, and an agent update to another surface does not.
  - `state/apps-surface-reducer.spec.ts:267`: 5 reducer pins (pick, update, new surface, eviction and agent-delete clear, read drop/keep).
- Red/green: the `applySnapshot` rule temporarily reverted to `origin === 'agent' ? surfaceId : keepActive(...)`.
  - Result: 6 failed (4 panel, 2 reducer).
  - After restoring: 54 passed across both suites.
- codex also asked to align the conflicting sentence in `implementation-plan.md:429`. That is a task document, which I may not edit. The team-leader or architect owns it.

### codex M (moderate) and coordinator item 4: an out-of-range `lastSubmit` renders "NaN:NaN". FIXED

- `readLastSubmit` also requires `!Number.isNaN(new Date(submittedAt).getTime())` (`components/apps-surface-panel.component.ts:77`), so an invalid Date omits the line.
- Specs (`components/apps-surface-panel.component.spec.ts`):
  - The existing malformed list (all original cases kept) now also includes `Number.MAX_VALUE` and `8_640_000_000_000_001`. The boundary `8_640_000_000_000_000` is still accepted.
  - `:508` DOM: a `MAX_VALUE` record renders no `apps-last-submit` element and no "NaN".

### Subagent M1 / coordinator item 5: `failedRenderable` was a single slot. FIXED

- `failedRenderables: ReadonlyMap<surfaceId, SurfaceRenderable>` (`components/apps-surface-panel.component.ts:287`). The template passes the surface id (`:240`).
- `fallback` checks the record of the active entry's own surface id. A new renderable of that surface (a push or read) no longer matches its record, so the build is retried.
- `markRenderFailed` (`:396`) drops records of surfaces no longer held, so the map is bounded by the held surfaces.
- Spec (`:411`): two surfaces whose builds both fail. After switching b, a, b, a, b, the builder was called exactly 2 times, no renderer is mounted, and each surface shows its own fallback text. A new renderable of `b` rebuilds (3 calls).
- Red/green: record replaced with a single-entry map (the old single-slot behavior).
  - Result: failed, "Expected number of calls: 2, Received: 5".
  - After restoring: passed.

### Subagent M2 / coordinator item 6: `isProcessing()` ignored the pending turn after the session id resolved. FIXED

- The slice now holds `pendingTurn: { livenessAtSend } | null` (`services/apps-workspace-slice.ts:47`, `:61`).
  - `send()` stores the session's liveness status at send time (`services/apps-session.service.ts:314`).
  - `start` stores `undefined`, because a new session has no status (`apps-workspace-slice.ts:187`).
- `isProcessing` (`services/apps-session.service.ts:172`) returns true while `pendingTurn !== null`, before and after the session id resolves (`:175`). After that it reads liveness alone.
- `pendingTurn` has to be cleared, or the first turn would block forever. The old `turnPending` was never cleared on success; it was only ignored once the session id existed.
  - A root effect (`:204`) clears `pendingTurn` once the session's liveness status differs from `livenessAtSend`, meaning the turn started or already ended.
  - A failed turn (`failTurn`) and a successful Stop also clear it.
- Specs:
  - `services/apps-session.service.spec.ts:782`, 3 tests:
    - A continue stays processing after `chat:continue` resolved and the session id is known, until liveness moves (then streaming, then idle, then not processing).
    - The first turn stays processing when the session id resolves before liveness reports it.
    - A successful abort ends the pending turn.
  - `components/apps-page-conversation.spec.ts:571` (page): after a second turn, freshly typed text cannot be sent (Send disabled) until liveness reports streaming and then idle.
- Red/green: `isProcessing` temporarily reverted to `if (sessionId === null) return slice.pendingTurn !== null;`.
  - Result: 4 failed (3 session, 1 page).
  - After restoring: 4 passed.
- Fixture change, explained: `apps-submit-flow.spec.ts:209` and `apps-surface-operations.service.spec.ts:261` start a conversation whose session id resolves at once while liveness never changes.
  - Under the new rule the first turn is correctly still running, so the submit flow waited. That is what failed at first: 20 submit-flow tests and 1 operations test, with no assertion changes.
  - Both `beforeEach` now report the first turn ended (`statuses` set to idle for the session, then a tick) before the tests run. This models the real sequence. No assertion was changed or removed.
- Residual: if liveness goes idle, then streaming, then idle within one effect flush (all three before an effect run), the change is not observed and the page stays "processing" until Stop. A real LLM turn takes far longer than one flush, and a successful Stop clears it. This is documented on `AppsPendingTurn`.

### Coordinator item 7: our 4 spec tsc errors. FIXED

- `apps-submit-flow.spec.ts:333`, `apps-surface-lanes.spec.ts:149` and `apps-surface-sync.spec.ts:319`: `'INTERNAL_ERROR'` became `'PERSISTENCE_UNAVAILABLE'`, a real `RpcUserErrorCode`.
  - All three are failed `surface:read` results. `AppsSurfaceSync` treats any failed read the same way and only logs the code (`services/apps-surface-sync.ts:216-217`), so each test still asserts "a coded host failure of the read". Nothing is weakened.
- `apps-surface-reducer.spec.ts:229` (now `:233`): `content()` returns `SurfaceContentV2 = Extract<SurfaceContent, { contract: 'dashboard-spec/2' }>` (`:34`). Every caller builds a v2 document, so `.surface` type-checks with no cast.

### Other numbered items in both reviews

| Review item | Disposition |
| --- | --- |
| codex fix-list 1 (reset race tests, including a replaced conversation) | Done; see B1 (`apps-page-conversation.spec.ts:396`). |
| codex fix-list 2 (identity plus send time; real-echo test) | Send time done (S1). The real-echo test does not apply at this layer (reason under S1); the echo filter is pinned in chat-streaming at spec `:304`. |
| codex fix-list 3 (persist the pick, keep focus, fix the contrary test and plan sentence) | Done (S2), including the focus pin at panel spec `:223`. The plan sentence is a task document I may not edit. |
| codex fix-list 4 (Date range) | Done. |
| codex fix-list 5 / Moderate "extend the write-back pin under an in-flight lane" | Done: `apps-page-conversation.spec.ts:458`. A committed change is in flight and a submit waits. Five real keystrokes are each stored synchronously and verbatim. The stored object survives change detection. Per keystroke there are 0 new RPCs, `materializedRevision` stays 1, and the overlays keep the same object. `setTimeout` is called exactly 5 times: only the text input's own idle debounce, re-armed once per keystroke, and no lane, sync or submit timer. That debounce's real commit then only queues behind the in-flight change (still 0 new RPCs; the overlay shows "Grace H"). |
| codex Focus 1-9 PASS items | No change needed. The B8 verbatim/synchronous contract is unchanged (`setSurfaceViewState` untouched), and the page spec `:550` pin still passes. |
| subagent Minor "`startTime === undefined` sorts to epoch 0" | Fixed (sorts last) and pinned (`apps-transcript-order.spec.ts`). |
| subagent Minor "4 spec tsc errors" | Fixed (item 7). |
| subagent Q5 "no dedupe between Submitted and typed bubbles" | Does not apply. The reviewer found them to be semantically different events, so no dedupe is needed. |
| subagent carry-overs for B20 / visual review | Not code; unchanged from `batch-15-report.md`. For visual review: the new conversation notice sits above the composer with the same spine as the error, but in warning color and `role="status"`. |

## Test counts

- mcp-apps-page: before 13 suites, 233 tests (per `batch-15-report.md`). After: 15 suites, 259 tests, all passing (+26).
  - Page conversation spec: 7.
  - Transcript order: 4.
  - Panel: 4 switcher, the focus test, M1 and the Date DOM test, which is 6 new plus the changed `:195`.
  - Session M2: 3.
  - Reducer manual pick: 5.
  - Submit-flow stamp: 1.
- declarative-dashboard: 17 suites, 214 tests, unchanged. This includes `trust-boundary.spec.ts`, which scans the updated `mcp-apps-page/src`. No new source uses `innerHTML`, `bypassSecurityTrust` or `DomSanitizer`.

## Verification (tails)

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/mcp-apps-page @ptah-extension/declarative-dashboard --skip-nx-cache --parallel=2`: exit 0, "Successfully ran targets lint, typecheck, test for 2 projects".
  - Direct jest runs: mcp-apps-page "Tests: 259 passed, 259 total"; declarative-dashboard "Tests: 214 passed, 214 total".
  - Lint: mcp-apps-page 0 problems. declarative-dashboard "0 errors, 62 warnings"; I did not touch that lib, and the warnings are pre-existing `no-non-null-assertion`.
- `npx tsc -p libs/frontend/mcp-apps-page/tsconfig.spec.json --noEmit`: exactly the 8 baseline errors: `core/src/testing/mock-rpc-service.ts` (54,16) (60,24) (66,25) (69,25) and `git-ui/.../monaco-loader.service.ts` (113,23) (151,24) (171,41) (187,28). Nothing else. `ptah_get_diagnostics` scoped to the changed files agrees (8 errors, same files).
- `npx tsc -p libs/frontend/declarative-dashboard/tsconfig.spec.json --noEmit`: exit 0, no output.
- Non-spec line counts, all 700 or less: `apps-session.service.ts` 695, `apps-submit-flow.ts` 662, `apps-surface-reducer.ts` 528, `apps-surface-panel.component.ts` 437, `apps-page.component.ts` 278.

## Deviations and notes

1. **Two extractions from `AppsSessionService`** (`apps-conversation-claims.ts`, `apps-session-rpc.ts`). The fixes pushed the service to 730 lines. The claim/release lifecycle is one responsibility and moved without changing behavior: same order, same per-step isolation. Only the log prefix of a failed release step changed, and no spec asserts it. The abort RPC had three near-identical copies; they now share one function.
2. **`turnPending: boolean` became `pendingTurn: AppsPendingTurn | null`.** The flag needed the liveness status at send time to know when to clear, and one nullable object keeps "pending without a baseline" unrepresentable. Only `apps-session.service.ts` and `apps-workspace-slice.ts` referenced the field.
3. **A new slice field, `notice`.** The ruling asks for a `role="status"` notice on abort failure. The existing `syncNotice` means "could not refresh this app" and renders in the surface panel. A separate conversation-level status line was the right fit, and state stays in the slice.
4. **Page-level `settle()` in the new spec** avoids `TestBed.tick()` after mounting. Under the zone test harness, a manual tick inside the automatic tick throws NG0101 (a stack trace confirmed it is a harness re-entry, not app code). The existing page spec follows the same pattern.
5. **Prettier side effect undone.** `npx prettier --write libs/frontend/mcp-apps-page/src` also reformatted four committed files outside this change: `state/apps-operation-overlays(.spec).ts` and `state/surface-operation-id(.spec).ts`. I rewrote each from `git show HEAD:<path>` (read-only git), and `git status` shows them unmodified.
6. **Git.** While renaming the new, untracked comparator spec, I ran `git mv -f … || mv …`. `git mv` refused because the file is untracked, and the plain `mv` ran. Nothing was staged: `git status` shows the new files as `??`. I should not have tried `git mv`; I ran no other state-changing git command.

## Out-of-scope observations

- `resetConversation` (and the old page code) skips the abort when the session id has not resolved yet. That case is the first turn, before `TabSessionBinding` binds the surface. Discarding then releases the claims. If `chat:start` resolves later, `abortUnownedStart` stops the session. But if `chat:start` already resolved and only the binding is late, nothing aborts that session. This is pre-existing (`abort()` had the same early return) and reported, not changed.
