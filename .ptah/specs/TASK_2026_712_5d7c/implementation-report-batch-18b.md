# Batch 18b implementation report

Implemented the fork and all-rewind account gates under D23. The previous public-API blocker is resolved. Scoped diagnostics found no diagnostics in the three changed files, but reported 30 sibling-file errors. Tests were not executed under the batch rules. Named execution remains release-held under D7.

Workspace: `D:/projects/ptah-extension/.claude-worktrees/provider-accounts`.

## Files changed

- MODIFY `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`.
- MODIFY `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts`.
- MODIFY existing spec `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.spec.ts`.
- REPLACE this deliverable, `.ptah/specs/TASK_2026_712_5d7c/implementation-report-batch-18b.md`.

No other files were written. No DI registrations, existing service callers, task state, or cli-agent-runtime files changed. No git commands, sign-in, credential operations or inference were performed.

## Acceptance evidence

References below are workspace-relative.

1. **One public gate-only wrapper.** `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1754` adds `gateSessionAccount(sessionId: SessionId): Promise<void>`, delegating directly to the private `gateAccount({ sessionId })`. It does not resume, build context or duplicate admission logic. The existing authoritative lookup, original binding resolution and release hold remain in Batch 18's shared gate (`chat-slash-command-router.service.ts:107-152`).

2. **Fork gated before transcript copying.** `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:1378` calls the wrapper using the source session ID after parameter/workspace authorization and before `sdkAdapter.forkSession`. Authorization only reads metadata and checks workspace membership. No fork, context operation or conversation mutation occurs on gate refusal.

3. **All rewinds gated before activity branching.** The same handler at `:1460` gates before `isSessionActive`, the inactive path's metadata/context preparation, `ensureSessionActiveForRewind`, and `rewindFiles`. The active path no longer bypasses account admission. At `:1488`, a typed refusal from the existing inactive helper is also preserved, covering a refusal on its later recheck instead of converting it into `session-not-active`.

4. **Existing safe typed refusal reused.** The handler's catches at `:1397` and `:1548` call the existing `mainSessionAccountFailure(error)`. Recognized refusals return its typed `{ success: false, error, accountRefusal }` result before raw exception conversion, logging or Sentry. Structural code inspection and summary validation remain owned by that normalizer. RPC registration result types explicitly include this refusal variant. Unknown errors retain the previous error path; no new catch returns an unrelated fallback literal.

5. **Ambient behavior retained.** No default selection, provider lookup or resume logic was added to the handler. Ambient calls use the existing gate's unbound-session lookup branch and retain the previous SDK arguments and success results. Existing service gate calls remain unchanged as D23 requires; the new handler precheck does not bypass their later rechecks. Active rewind does not gain an auto-resume call. Specs check the same handler metadata-read counts and the ordering of the added gate.

6. **Release hold retained.** The wrapper delegates to the same gate that propagates port refusal and conservatively refuses named execution after any future successful preflight. No certificate, route selection, lease transfer or alternate account fallback was introduced.

## Test cases

Updated only `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.spec.ts`. Its gate mock is typed against the public service method at `:209` and defaults to a resolved ambient check at `:215`.

- `:2746`: parameterized fork refusals for `release-held`, `identity-unproved` and `invalid-bound`; no fork/resume or metadata mutation, source preserved, no error logging or Sentry capture.
- `:2773`: an error with a recognized account code and a private path in its raw message returns only the normalizer's safe fallback summary.
- `:2793`: ambient fork retains SDK arguments and `newSessionId`; gate runs first, handler metadata count stays one, no resume call.
- `:3043`: active and inactive rewind refusals occur before the activity check, resume helper or SDK rewind, with source preserved and no error reporting.
- `:3073`: an account refusal returned by the inactive resume helper retains its typed refusal and never reaches SDK rewind.
- `:3094`: ambient active rewind retains arguments and full SDK result; no resume call, handler metadata count stays one.
- `:3231`: ambient inactive rewind retains its resume arguments and successful rewind path; gate precedes resume, handler metadata count stays two.

These are handler-level tests with mocked service/SDK boundaries. Existing Batch 18 account-binding specs own authoritative registry resolution and admission behavior. No execution result is claimed for the added cases.

## Diagnostics

Called `ptah_get_diagnostics` with exactly the three changed TypeScript files above, then made one completion retrieval with the identical scope after the initial 45-second pending result. Final result:

- Source: `typescript-compiler`.
- Requested files: **No diagnostics in the requested files.**
- Coverage: **clean** (coverage indicator, not an error-free project).
- Project context: **30 errors, 0 warnings in sibling files**. The returned detail includes `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.account-binding.spec.ts:104-115`: TS2345 (`MockLogger` not assignable to `Logger`) and TS2352 (partial mocks cast to concrete services/adapters). This spec is outside Batch 18b ownership and was not modified. The tool's detailed list was truncated; no claim is made that all 30 errors belong to this one sibling.

No Nx, Jest, tsc, ESLint, build, serve, npm, package or e2e command ran. No workspace-wide check ran. Full project compilation and test success are not certified.

## Decisions

1. **Apply D23's public wrapper, with no DI change.** Options were a wrapper, handler account-port injection, or the side-effecting rewind helper. D23 chooses the wrapper. Evidence: existing service injection in `session-rpc.handlers.ts:199`, private gate implementation in `chat-session.service.ts`, and the explicit resumed task. Reversible and additive; no existing caller changed.

2. **Use the existing account-refusal result, not a new RPC error code.** `RpcUserErrorCode` in `libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts:7` has no provider-account codes. D22 defers shared contracts/UI. The central funnel already returns the normalizer's typed `accountRefusal`; both handlers now use that same runtime result with local union types. The transport can therefore return a successful RPC envelope containing a refused operation (`data.success === false`), as in the central funnel. No fabricated `AUTH_REQUIRED` or new shared code was introduced. Reversible when the owning RPC/UI batch adopts the shared result variant.

3. **Preserve later inactive-helper refusals.** Options were to keep converting all failed resumes to `session-not-active` or propagate its explicit `accountRefusal` through the same normalizer. Chose propagation so a refusal on recheck remains safe and typed. Evidence: `ensureSessionActiveForRewind` already exposes this optional refusal. Ordinary resume errors remain unchanged. Reversible, confined to the owned handler.

## Out-of-scope needs

- The owner must address the 30 reported sibling-file diagnostics; observed examples are the existing Batch 18 account-binding spec mock typing at lines 104-115. Run the updated handler spec plus relevant existing Batch 18 account-binding coverage when verification is authorized. Host compilation remains unverified by this lane.
- D22's shared RPC result declarations and frontend refusal presentation remain deferred. Consumers must recognize the operation-level `accountRefusal` result without clearing the conversation or offering ambient recovery. This lane did not modify shared types or frontend consumers.
- D7 certification, SDK live-turn lease transfer and the other existing Batch 18 out-of-scope items remain held; this batch does not certify named execution.
