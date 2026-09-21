# Lane A — backend

## Changes

- `libs/backend/agent-sdk/src/lib/message-transform/result-message.transformer.ts:25` — narrows to a result message and passes its terminal reason into settlement.
- `libs/backend/agent-sdk/src/lib/message-transform/result-message.transformer.spec.ts:74` — covers completed results, missing reasons, result precedence over Stop and failure snapshots, and recap emission.
- `libs/backend/agent-sdk/src/lib/helpers/session-turn-state.registry.ts:352` — adds an optional result reason, preserves snapshot fallbacks, commits recaps, and includes them in turn-state events. Background snapshots retain the recap; the commit default clears it for generating and forced-idle states.
- `libs/backend/agent-sdk/src/lib/helpers/session-turn-state.registry.spec.ts:104` — covers failure/Stop recap precedence, consumption across turns, background completion, and null reason/recap on forced idle.
- `libs/backend/agent-sdk/src/lib/helpers/stop-hook-handler.ts:94` — bounds the Stop snapshot recap with TURN_RECAP_MAX_CHARS; the hook's unavailable terminal reason is explicitly null.
- `libs/backend/agent-sdk/src/lib/helpers/stop-hook-handler.spec.ts:448` — verifies absent, empty, short, exact-bound, and over-bound recaps at snapshot, committed-state, and stream-event boundaries; removes the invented hook-reason expectation.
- `libs/backend/agent-sdk/src/lib/helpers/stop-failure-hook-handler.ts:81` — applies the same producer bound to the failure snapshot and stops reading a nonexistent hook reason.
- `libs/backend/agent-sdk/src/lib/helpers/stop-failure-hook-handler.spec.ts:316` — verifies the failure recap bounds and propagation, with realistic hook payloads.
- `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts:622` — reads the optional typed field from SDKResultMessage without a structural cast; documents the verified SDK contract.
- `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.spec.ts:24` — covers success/error result reasons and omitted reasons.

## Verification

All commands ran from `D:\projects\ptah-extension\.claude-worktrees\feat-notification-recap-d23df5594475`.

1. `npx nx run-many -t test -p @ptah-extension/agent-sdk` — exit 1 due to a Windows EPERM reading a Jest transform-cache file while loading the unrelated plugin-loader.service.spec.ts suite. Actual output:

   ```text
   NX   Running target test for project @ptah-extension/agent-sdk:
   - @ptah-extension/agent-sdk
   Test Suites: 1 failed, 2 skipped, 116 passed, 117 of 119 total
   Tests:       3 skipped, 2002 passed, 2005 total
   Snapshots:   0 total
   Time:        55.028 s
   Ran all test suites.
   ```

   Nx uses the singular “for project” header for this one-project invocation; the selected project count is 1.

2. `npx nx run-many -t test -p @ptah-extension/agent-sdk --runInBand --cache=false --skip-nx-cache --output-style=static` — exit 0. Serial, uncached rerun avoids the shared transform-cache access failure without changing configuration. Actual output:

   ```text
   NX   Running target test for project @ptah-extension/agent-sdk:
   - @ptah-extension/agent-sdk
   Test Suites: 2 skipped, 117 passed, 117 of 119 total
   Tests:       3 skipped, 2072 passed, 2075 total
   Snapshots:   0 total
   Time:        82.417 s, estimated 369 s
   Ran all test suites.
   NX   Successfully ran target test for project @ptah-extension/agent-sdk
   ```

3. `npx nx run-many -t typecheck -p @ptah-extension/agent-sdk` — exit 0; “Successfully ran target typecheck for project @ptah-extension/agent-sdk”, 20.3 seconds, 0/1 cache hits.
4. `npx nx run-many -t lint -p @ptah-extension/agent-sdk` — exit 0; “Successfully ran target lint for project @ptah-extension/agent-sdk”, 23.5 seconds, 0/1 cache hits.
5. `npx nx run-many -t lint -p @ptah-extension/agent-sdk --output-style=static` — exit 0 after the final spec correction; 0 errors and 49 warnings, all in untouched files. Warnings include existing unused assignments, non-null assertions, and file-size warnings.
6. Scoped `ptah_get_diagnostics` — clean baseline. Its first post-edit check caught two literal-widening errors in result fixtures; fixed with `satisfies SDKResultMessage`. Final check: 0 errors, 0 warnings.

Formatting: ran `npx prettier --write` with the ten explicitly owned TypeScript paths.

The test runner also prints existing Nx executor deprecation and Jest config module-loading warnings; they did not prevent the successful rerun.

## Notes

- Installed SDK declarations verify the root cause: sdk.d.ts:171 (BaseHookInput), :9051 (StopFailureHookInput), and :9058 (StopHookInput) contain no terminal_reason. Both result variants declare it at :5401 and :5471.
- Current manifests/lockfile specify Claude Agent SDK 0.3.278, TypeScript 6.0.3, and Zod 4.6.5, newer than the generic project guidance. Node is 24; product DI remains tsyringe. No dependencies or registrations changed.
- forceIdle's implementation is unchanged, including its existing optional reason argument. Without a supplied reason it commits null; the shared commit default now explicitly supplies a null recap.
- applySnapshot must preserve the settled recap while background tasks finish; otherwise the eventual idle notification loses it. This is covered by a regression test.
- Hook callback/event-bus consumers retain their existing full assistant text. The new chunk-stream recap is truncated at the Stop/StopFailure snapshot producers.
- The registry remains I/O-free and timer-free. Shared/frontend files and other backend libraries were not edited. No git commands were run.
- Ptah reference lookup returned no settleTurn references and resolved helper references against the main checkout; worktree callers were verified directly with rg.

