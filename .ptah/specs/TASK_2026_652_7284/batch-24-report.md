# Batch 24 report

## Fixes

- **M2 — reload earlier proposals:** `harness-workflow.service.ts:65,81-88` adds optional `sessionIds` and validates array/string entries while accepting old records. `:155,193-199` merges restored earlier IDs before bound conversation IDs with first-occurrence deduplication; an unbound surface still returns `[]`. `:238` writes the full list in every snapshot. `:582-586` restores earlier IDs without changing the registry or router, and `:500` clears them on dispose. The head `sessionId()` remains bound to the conversation. Tests at `harness-workflow.service.spec.ts:302-341,645-688,726-733` cover persisted IDs, an old record, order/deduplication, fresh-workflow cleanup, and invalid shapes.
- **M3 — unknown-session proposal:** `harness-workflow-message.handler.ts:153-166` logs the session ID at **debug** and drops the event. The guard at `:155-156` stays silent when no workflow is bound or the mode is not configure-harness; those events are unrelated to the active configuration and would create noise. Tests at `harness-workflow-message.handler.spec.ts:158-179` verify the log, drop, and silence.
- **Buffered replay:** `harness-workflow-message.handler.ts:138-149` catches each failed `applyProposal`, logs a real `Error`, and continues replaying. The regression test at `harness-workflow-message.handler.spec.ts:246-271` verifies the later event still runs.

## Decisions

- **Restored ID ownership:** Keep earlier IDs in the workflow's private signal and leave the conversation registry and stream router unchanged. The existing head binding remains the source for `sessionId()`. Reversible: yes.
- **Log level:** Use `LoggingService.debug(context, message)` (`libs/frontend/core/src/lib/services/logging.service.ts:159-160`) for unknown-session proposals. Such events can arrive before the stream router appends the session, so a normal-level warning would be noisy. Reversible: yes.

## Verification

- Prettier write on the four changed source/spec files: passed.
- Project typecheck and lint: both passed via `npx nx run-many -t typecheck,lint -p @ptah-extension/harness-builder --parallel=1`.
- Project Jest: **7 suites, 153 tests passed, 0 failed** via `npx nx test @ptah-extension/harness-builder --parallel=1 --maxWorkers=2`; above the required 146-test floor.
- Scoped Ptah diagnostics: no errors in the four changed files; 14 diagnostics remain in untouched sibling files. Nx Cloud reported a disabled organization after successful local targets.

## Deviations

- PowerShell `Select-Object -Last` was used in place of `tail` to limit command output on this Windows worktree.
- The first strengthened dispose regression exposed a misplaced signal clear in the start-failure rollback. The clear was added to `dispose()` and the full verification sequence was rerun successfully.
