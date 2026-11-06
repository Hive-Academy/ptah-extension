# Batch 4 implementation report

## Files and behavior

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/parent-delivery/parent-envelope-store.service.ts` and its spec: bounded in-memory per-parent pending envelopes (32), dedupe, seven-day expiry, oldest-report-first eviction, and warning without message bodies. This follows binding amendment A2.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/parent-delivery/parent-delivery-drainer.service.ts` and its spec: single asynchronous drain per parent, `SessionActivityRegistry` retry, stable `lane-delivery:` client ID, preserved peer origin, acceptance callback, and injectable `pending`/`delivered` event sink.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts` and its spec: inactive-parent completions enter the pending store; duplicate attempts consult the envelope; usage-limit/auth stops with no delivered report yield `failed` despite a fresh skeleton deliverable. The sent envelope line includes stop reason and reset time.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-report-router.service.ts`: reports to inactive parents enter the same pending store. Report counts and tile notes change only in the send-acceptance callback.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts` and its spec: binds the first session-bearing event, ignores later foreign-session output, and fails a resumed lane with `session-mismatch` when its first session event disagrees with the requested ID.
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts` and its spec: accepted-ID dedupe applies only to `lane-delivery:` IDs; ordinary IDs retain existing behavior.
- `libs/backend/cli-agent-runtime/src/lib/di/tokens.ts` and `register.ts`: register the store/drainer and parent-delivery event-sink token.

## Verification

- `npx tsc -p libs/backend/cli-agent-runtime/tsconfig.lib.json --noEmit`: exit 0 before final small edits and specs.
- Requested `npm run verify -- -p @ptah-extension/cli-agent-runtime,@ptah-extension/agent-sdk -- --output-style=static`: confirmed Nx targets for **2 projects**. Lint and typecheck succeeded (4/4 targets). Test target exited 1: agent-sdk 4 failed/218 passed suites, 4 failed/5410 passed tests; cli-agent-runtime 3 failed/135 passed suites, 10 failed/2891 passed tests. Failures were in the known environment suites: agent-sdk off-thread-process-spawner, plugin-loader capabilities/session-notice, sdk-query-options-builder.auto-compact-argv; cli-agent-runtime claude-approval.reader, mcp-install and the known registry auto-compact family. No changed-file suite failed in that run.
- Focused CLI Jest (parent store, drainer, OpenCode adapter, completion notifier, report router): **5 suites, 177 tests passed**, exit 0.
- Focused agent-sdk Jest (session stream pump): **1 suite, 27 tests passed**, exit 0.
- `ptah_get_diagnostics` after edits was unavailable twice: compiler remained running after its 45-second timeout. Focused Jest passed; final project typecheck after the last small edits was not rerun.

## Needs

- **Batch 5:** bind `PARENT_DELIVERY_EVENT_SINK` to agent-monitor push; its interface emits `pending` and `delivered` per envelope. Add DI smoke coverage for this registration.
- **Batch 5 or manager follow-up:** call the drainer when `AgentProcessManager.resolveParentSessionId` replaces a tab ID with a real session ID. That manager file was outside this lane's scope. Completions refused before ID resolution cannot enter the pending store yet.
- **Restart safety:** the accepted-ID ledger in `SessionStreamPump` is in-memory. A full host restart can duplicate a parent turn after acceptance but before envelope commit. Persistent storage needs lifecycle composition outside this lane's allowed files. A2 explicitly made the pending envelope store in-memory, so pending envelopes also do not survive restart.
- **A7 exception precision:** completion context carries a delivered-report count, not whether the report claimed completion. The current verdict exception treats any delivered report as a claim. A separate claim flag requires a cross-file contract update.
- **A8 first-event trust:** a new OpenCode lane binds the first session-bearing event on its own stdout. If a shared OpenCode server emits a foreign session as the very first event on that child stdout, the adapter has no independent creation token to identify it. Resume mismatch is enforced. Further isolation may require a native OpenCode session creation handshake.

## Decisions

- Used binding amendment A2's in-memory pending map behind an interface instead of the original plan's persistent store; reversible by replacing the store implementation.
- Used `agentId + turnSeq + SHA-256(body)` for a report key and `agentId + completedAt` for completion, following the plan. The hash avoids retaining a report body in the ID; reversible.
- Scoped pump dedupe to `lane-delivery:` IDs so existing human-message ID behavior stays intact; reversible.
