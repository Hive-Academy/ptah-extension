# Batch 6a — chat event projection and approval routing

## Deliverables and public APIs

- `codex-chat-events.ts`: `CodexChatEvents(sessionId, identity, callbacks, now?).map(event)` projects one correlated turn into `FlatStreamEventUnion[]`. Rejects foreign/stale/duplicate events, retains stable tool IDs and separate block indexes, and settles once. `CodexChatEventCallbacks` delivers complete text/reasoning replacements, normalized live events, compaction, sanitized errors, and `CodexChatResult` (including reported usage once). Final text never becomes a fabricated delta. Nonfatal errors do not end a turn.
- `codex-chat-events.spec.ts`: regression coverage for final-only/reconciled text, distinct blocks, tools, identity isolation, terminal deduplication, usage, sanitized nonterminal errors, and live/compaction callbacks.
- `codex-chat-approval-sink.ts`: `CodexChatApprovalSink(sessionId, contextId, presentation, followUp, timeoutMs?)` implements `ApprovalSink.request`; `respond(unknown)` validates complete correlation and consumes a live reply once; `dispose()` denies outstanding prompts. Exports the four presentation choices and typed presentation/follow-up/reply ports. Edits decline with `editNotSupported`; validated user text is posted through the injected callback with steer/newTurn selected from active-turn state. Abort/timeout/disposal remove the prompt and deny.
- `codex-chat-approval-sink.spec.ts`: native outcomes, all correlation fields, edit validation and delivery modes, timeout/abort/disposal, duplicates, foreign contexts, pre-abort, presentation/cleanup failures, and follow-up failure.
- `session-approval-router.ts`: `SessionApprovalRouter(claudeHandler, cancelled)` offers `register(address, owner)` (returns release callback), `respond(address, reply)`, and `cancelPrompt(address, reason)`. Ownership includes session + thread + request. Claude forwards unchanged to `ISdkPermissionHandler.handleResponse`, preserving modifiedInput. Native dispatch uses the bound sink. Cancellation emits the existing typed session payload and never posts a response.
- `session-approval-router.spec.ts`: Claude passthrough, native routing, session/child isolation, stale reply handling, cancellation, registration collision and release.

## Verification

Required command: `npm run verify -- -p @ptah-extension/agent-sdk`.

Result: **exit 1**. Actual Nx summary: `NX   3 tasks: 2 succeeded, 1 failed`. Test and typecheck succeeded; lint failed.

- Full tests: `Test Suites: 2 skipped, 185 passed, 185 of 187 total`; `Tests: 3 skipped, 4008 passed, 4011 total`.
- Lint: 3 errors, 95 warnings. One integration blocker: agent-sdk/package.json is missing `@ptah-extension/codex-runtime` under dependencies (`@nx/dependency-checks`). The other two errors are outside ownership: `helpers/session-lifecycle/session-query-executor.accounts.spec.ts:174,183`, `no-unexpected-multiline`. None of the six new files has lint errors. No config or unrelated fixes were made.
- Full log: `C:/Users/abdal/AppData/Local/Temp/ptah-batch-6a-verify.log`; lint detail: `C:/Users/abdal/.nx/8b7110c7390b9603/cache/terminalOutputs/115633010763572367`; full-test detail: `C:/Users/abdal/.nx/8b7110c7390b9603/cache/terminalOutputs/15386019438948788417`.

Additional final-code check: `npm run verify -- -t test -p @ptah-extension/agent-sdk -- --testPathPatterns=codex-app-server` — **exit 0**, `NX   1 task: 1 succeeded, 1 cached`. `Test Suites: 5 passed, 5 total`; `Tests: 60 passed, 60 total`. This includes the concurrent Batch 6c pair of suites. Focused log: `C:/Users/abdal/AppData/Local/Temp/ptah-batch-6a-focused.log`; test detail: `C:/Users/abdal/.nx/8b7110c7390b9603/cache/terminalOutputs/1092038817241844549`.

**Header limitation:** no `Running target ... for N projects` lines were emitted. Nx used compact summaries even with dynamic output disabled for the focused check. Both commands explicitly selected exactly one project (`@ptah-extension/agent-sdk`); the actual summaries above confirm three requested tasks for the required command and one test task for the focused command. I did not fabricate the requested header or rerun a failed suite to re-read its output.

Scoped `ptah_get_diagnostics` for all six files: **0 errors, 0 warnings; clean coverage**. Earlier sibling diagnostics from Batch 6c were gone on the final diagnostics pass.

## Decisions

1. **Use the inherited runtime alias with type-only imports; report the dependency declaration blocker.** Options: import the existing core contracts or duplicate them/change project config. Evidence: root `tsconfig.base.json` declares `@ptah-extension/codex-runtime`, agent-sdk inherits it, both projects have scope:extension/type:feature tags, and scoped diagnostics/typecheck resolve all imports. However, lint requires the missing package dependency declaration. Per explicit scope, no package/config changes were made; coordinator action is required before this integration can pass lint. Reversible: yes.
2. **Keep one event mapper per turn and report usage only through result.** Options: per-turn state or a persistent multi-turn registry; usage in result or duplicate stream/callback accounting. Evidence: lane `CodexLaneEvents` correlation/terminal filtering and usage snapshot handling; thin-consumer plan section 8. The flat completion carries no duplicate usage. Reversible: yes, at consumer composition.
3. **Deliver final text as replacement content.** Options: synthesize deltas or expose a complete-content callback. Evidence: the explicit batch requirement forbids fabricated deltas, and the flat event union only has text deltas. Consumer must implement the content callback. Reversible: yes.
4. **Keep native edit semantics and core-owned rule scope.** Options: claim replacement-input authorization or decline plus follow-up. Evidence: `codex-runtime-ports.ts` ApprovalSink returns native decisions or the edit-decline marker only; `codex-approval-bridge.ts` validates native results and scopes acceptForSession through its rule store. The presentation offers deny/allowOnce/allowWithInput/alwaysAllow, mapping to decline/accept/edit-decline/acceptForSession. Reversible: only if core contracts change.
5. **Use injected presentation/follow-up/SDK-handler ports.** Options: reach into chat services or leave composition to Batch 6e. Evidence: explicit batch boundaries and existing gateway sink pattern. No registration, exports, or production wiring changed. Reversible: yes.

## Limits and remaining integration

- **Blocked project verification:** coordinator must declare the core dependency in agent-sdk/package.json; the two account-test lint errors also remain outside this batch's ownership.
- No production wiring, DI, shared types, or other-lane files were changed; Batch 6e owns composition.
- The current core port cannot transmit a denial reason or authorize a modified replacement input. A reason is accepted on the UI reply but the native wire outcome is decline; modified input must be validated by the injected validator and becomes a follow-up, never an approval.
- Presentation owns rendering/removal and registering/releasing router ownership. Core owns permission rule scope and manifest validation.
- No paid live tests and no git operations were performed.

## Absolute files written

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-events.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-events.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-approval-sink.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-approval-sink.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/session-approval-router.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/session-approval-router.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-6a-report.md

## Continuation

Added `"@ptah-extension/codex-runtime": "0.0.1"` to agent-sdk's dependencies with team-leader authorization. This is the only change to package.json and resolves the dependency declaration blocker recorded above. No install, source changes, or fixes to known noise were performed.

Verification: `npm run verify -- -t lint -p @ptah-extension/agent-sdk` selected exactly one project and exited 1. Actual compact Nx header: `NX   1 task: 0 succeeded, 1 failed`; task: `nx run @ptah-extension/agent-sdk:lint`. No `Running target ...` header was emitted. ESLint reported **97 problems (2 errors, 95 warnings)**. The only remaining errors are the two pre-existing `no-unexpected-multiline` errors identified by the coordinator as origin/main noise:

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.accounts.spec.ts:174:3
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.accounts.spec.ts:183:3

No other lint errors remain, including dependency errors for codex-runtime or zod. The known account-spec errors were left untouched; project lint therefore remains unsuccessful. Full lint detail: `C:/Users/abdal/.nx/8b7110c7390b9603/cache/terminalOutputs/17485467810470637713`.

Absolute files written in this continuation:

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/package.json
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-6a-report.md
