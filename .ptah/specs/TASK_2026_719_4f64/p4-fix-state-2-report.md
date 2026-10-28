# P4 fix 2: state service (re-review items 1 and 2)

## Frontend implementation: `TASK_2026_719_4f64`, P4 re-review items 1–2

**Tasks completed**: code-logic-review-p4-rereview.md "New defects / remaining gaps", items 1 (refused overlap) and 2 (`refreshAccountStatus` freshness). This builds on the uncommitted first P4 state fix.

**Files**:

- MODIFIED D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/core/src/lib/services/provider-accounts-state.service.ts: the per-profile epoch is replaced by a handle clock. Starting a request takes a sequence number and does not invalidate anything. Status reads are now guarded too.
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/core/src/lib/services/provider-accounts-state.service.spec.ts: 13 deferred-response tests.

## Design (replaces the start-advanced epoch)

`Slot.handleClocks` (`:121`) maps each profile to a `HandleClock` (`:95`) with three fields:

- `started`: the sequence number of the latest handle-bearing request for that profile. Handle-bearing requests are sign-in, cancel and sign-out writes, and status reads.
- `accepted`: the sequence number of the newest reply whose handle state was taken.
- `invalidated`: a counter. It goes up when an applied snapshot shows the profile is not pending, which covers terminal states and removal.

`startHandleRequest` (`:655`) creates the clock when the profile has none, so a profile with no earlier local write is covered. It then increments `started` and returns a `HandleTicket` (`:105`) holding `{generation, seq, invalidated}`. Starting a request no longer invalidates anything.

`acceptHandleReply` (`:676`) is the single gate for both writes and status reads. It rejects a reply in any of these cases:

- the workspace generation changed (a workspace reset);
- `invalidated` moved since the request started (a terminal or removal snapshot);
- `seq <= accepted`, meaning a newer request's reply was already accepted. One exception: when the held handle has the same `operationId`, the reply is accepted. This covers a status read that lands before the sign-in reply carrying that operation's script.

On success the gate sets `accepted = max(accepted, seq)`.

Item 1 (refused overlap):

- `write()` takes a ticket at `:596-599`.
- A refused, failed or timed-out reply returns before the gate and leaves the clock unchanged. So a busy or conflict contender cannot discard sign-in A's handle or script, whichever reply arrives first.
- At `:629-634` the reply must still pass `acceptedPending` and then `acceptHandleReply`. `acceptHandleReply` comes last because it updates the clock.
- Two successful overlapping attempts still resolve to the newer one: the reply with the higher sequence number wins in either arrival order.
- The epoch is never rolled back.
- Terminal and removal invalidation stays authoritative: `apply()` at `:513-515` bumps `invalidated`. So does workspace invalidation: the generation check, plus `handleClocks.clear()` at `:449`.

Item 2 (status freshness):

- `refreshAccountStatus` (`:336-358`) takes a ticket at request time.
- It returns before changing anything unless `acceptHandleReply` passes. This guards both inserting an operation and deleting one (with its fallback script).

## Tests added (spec)

1. `:486`, `it.each` with 8 cases: a sign-in or sign-out contender refused with busy or conflict, with A's reply arriving before or after the refusal. A's handle and script are kept, and Cancel sends A's `operationId`.
2. `:532`: a status read with the same operation lands before the sign-in reply, and the script is still kept. This pins the same-operation exception.
3. `:549`, `describe('deferred status reads …')`, 4 tests:
   - A status reply arrives after a workspace reset and a terminal push. No operation is installed, and a later pending push does not expose one either.
   - A status reply that crossed a terminal push installs nothing.
   - An old status reply with no operation, arriving after a newer sign-in B', leaves B's handle and script in place.
   - A newer status read wins over an older one, both when the older reply would insert an operation and when it would delete one.

Before this change, the refused-contender cases failed through the start-advanced epoch, and the status cases failed because there was no guard. I reasoned this from the code; I did not re-run them against the old code, because that would need a git state change.

## Specs that mock or pin the changed members

- `write()`, `apply()`, `resetForWorkspace()` and the new private helpers are covered only by `provider-accounts-state.service.spec.ts`.
- `refreshAccountStatus` is also mocked as `jest.fn` in `libs/frontend/chat/src/lib/settings/providers/accounts/accounts-section.component.spec.ts:125`. Its signature did not change.
- All existing tests pass unchanged, including the 6 first-fix deferred tests and the status/fallback tests at spec `:309-339` and `:476` (now later in the file).

## Verification

- `npx jest -c libs/frontend/core/jest.config.ts libs/frontend/core/src/lib/services/provider-accounts-state.service.spec.ts --maxWorkers=2`: 1 suite, **36/36 passed** (23 existing + 13 new).
- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/settings/providers/accounts --maxWorkers=2`: 4 suites, **72/72 passed**.
- `npx tsc --noEmit -p libs/frontend/core/tsconfig.lib.json`: exit 0, no output.
- `npx eslint` on both files: exit 0, no output.
- Not run, by instruction: `npm run verify`, build, serve, install, any git command. `ptah_get_diagnostics` was not run; the tsc and eslint commands above cover the two files.

## Rules (batches.md 1–13)

- No `process.cwd()`.
- No `jest.spyOn` on module namespaces.
- No new injection tokens.
- The fallback is never logged; no log path was added.
- Only the 2 assigned files plus this report were written.
- No git commands.
- 19 tool calls.

## Decisions

- **Decision:** order requests with per-profile sequence numbers and an "accepted" watermark, instead of serializing same-profile writes.
  - **Options:** (a) advance the token only when a reply is accepted as the new operation; (b) serialize same-profile handle writes.
  - **Evidence:** the re-review allows either. Option (a) keeps the service's existing permission for overlapping calls, which the UI relies on (`:515-522` per the review). It also lets status reads share the same gate.
  - **Reversible:** yes; the change is local to the service.
- **Decision:** allow the same-operation exception for older replies.
  - **Evidence:** a status read sent after sign-in A is likely to return A's operation before A's reply arrives. Without the exception, A's script (which only A's reply carries) would be lost.
  - **Reversible:** yes.

## Out-of-scope observations

- The invalidation rule, inherited from the first fix, is the same as before: every applied snapshot in which a profile with an in-flight request is not pending bumps its `invalidated` counter.
  - So an unrelated snapshot (for example, another profile's write) applied between a sign-in's start and its pending state also drops that sign-in's reply.
  - This is rare and safe: the handle comes back through a status read. Tightening it would need the revision of the snapshot that invalidated the profile, compared with the reply's snapshot revision.
