# Batch 6b report

Implementation written; scoped compiler diagnostics clean. Jest/lint verification is pending the machine-wide FIFO lock, not claimed as passing.

## Files and public API

- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts`: CodexChatAdapter implements IAgentAdapter. Opens/resumes core contexts through resolveGatedCodexRuntime(scope.container, 'chat', platform), persists native thread metadata before publishing session resolution, subscribes before starting turns, projects through CodexChatEvents, and closes abandoned streams. A context owns exactly one CodexChatApprovalSink. Router ownership releases on dismiss, including timeout, abort and disposal. Native errors expose CodexChatAdapterError with fixed operation/code strings, never raw dependency messages. Session tokens guard teardown; reset/dispose and tab-end invalidate pending opens. Failed interrupts block subsequent turns. Permission/model/effort call native updateNextTurn; /compact calls native compact.
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts`: 13 authored tests for the real gated resolver with a deterministic runtime port, native lifecycle, terminal deduplication, honest usage reporting, unsupported operations, stale tokens, approval disposal/timeout, interrupted follow-ups, reset/tab-close races and live-resume configuration refusal. No paid runtime calls.
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.ts`: RoutingAgentAdapter implements IAgentAdapter. Session operations use persisted identity (live identity only when no persisted identity exists), validate live/persisted consistency and session IDs like SessionRuntimeRouter, and never use the focused provider or catch failures into legacy retry. New admission uses injected RuntimeHostCapabilities, default nativeCodex:false. Existing legacy history stays legacy even when new native admission is enabled; existing native identity stays native even when new admission is disabled.
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.spec.ts`: 8 authored cases for default legacy admission, host-enabled native admission, unchanged legacy history, persisted native routing with Claude provider metadata, no fallback, and missing/conflicting identities.
- This report: `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-6b-report.md`.

### Ports Batch 6e must bind

CodexChatAdapter takes CodexChatAdapterPorts:
- platform: CodexParityPlatform; info: existing ProviderInfo shape (no shared ProviderId expansion in this batch).
- profile(config, sessionId?): constructs a validated chat CodexExecutionProfile and, for resume, loads the CodexThreadIdentity. Must use the session's admitted identity rather than focused provider state, enforce immutable home/workspace/provider, and reject unsupported options rather than dropping them. Core revalidates the native execution profile and resume identity.
- createScope(sink): returns CodexChatScope containing a context-owned DependencyContainer and async dispose(). Composition must register the supplied forwarding ApprovalSink before runtime resolution; dispose closes its owned runtime and disposes its container, also on failed admission. Do not reuse a scope across independent contexts. The adapter itself obtains runtime only via the gated resolver. Requests arriving before thread binding are declined.
- metadata.save(sessionId, CodexThreadIdentity, title?): narrow adapter to Batch 6d's sole metadata writer, preserving thread ID, normalized home/workspace, provider and native execution identity. No transcript persistence, no SessionMetadataStore import.
- approvals: shared SessionApprovalRouter; presentation: CodexChatApprovalPresentation. The adapter owns register() release functions, not the presenter.
- replacement.validateReplacement and replacement.failed: validate approval-edit text and report failed delivery. Adapter posts through core steer while active or publishes a native new-turn stream when idle.
- callbacks(sessionId): CodexChatEventCallbacks for result, replacement content, file/image/approval events, compaction phases and sanitized errors.
- publish(sessionId, stream): drain follow-up stream into that session's existing chat channel.

RoutingAgentAdapter takes the shared SessionRuntimeIdentityLookup, legacy and native IAgentAdapter implementations, and optional RuntimeHostCapabilities. Composition must derive nativeCodex from host support plus the parity/DS1 admission policy, not introduce another user setting. Omission disables new native routing. The runtime's gated resolver independently enforces DS1, so a misconfigured capability cannot bypass the core gate. A selected native session's gate failure remains visible, never reroutes it to legacy.

Global model/installation/provider metadata delegates to legacy. Shared resolved-ID and result-stat callbacks register on both implementations. Legacy-specific live/worktree/compaction-stat callback shapes register on legacy only; native observations use the explicit event port. No index exports or DI registrations were changed.

## Verification

- Ran scoped ptah_get_diagnostics after the final edits against all four absolute source/spec paths: TypeScript compiler, Errors: 0, Warnings: 0, coverage clean. Earlier diagnostics identified a required legacy preTokens field and mock signatures; those issues were fixed before the final clean run.
- Formatted all four files with the repository's Prettier.
- Started exactly once: `npm run verify -- -t test -p @ptah-extension/agent-sdk -- --testPathPatterns=codex-app-server`.
  - Log: `C:/Users/abdal/AppData/Local/Temp/ptah-6b-tests.log`.
  - Pending FIFO lock; no Nx execution header or test count available. 21 new cases authored; no claim they have run.
- Started exactly once: `npm run verify -- -p @ptah-extension/agent-sdk`.
  - Log: `C:/Users/abdal/AppData/Local/Temp/ptah-6b-verify.log`.
  - Pending FIFO lock; no Nx execution header, lint result, typecheck-target result or full test count available.
- Both commands request exactly one project. The requested “Running target X for N projects” header cannot yet be confirmed because Nx has not started.
- Last observed lock holder: pid 5748, wizard-library-alignment worktree, verify lint/test/typecheck for eight projects, acquired 2026-10-25T18:21:21.125Z. This lane's focused run queued at 18:24:24.863Z and full verification at 18:26:47.084Z. One completion check per launched command was made; neither had completed. Runs were left queued for the coordinator to collect, not cancelled/restarted or bypassed.
- Known unrelated lint/test noise was not independently re-established because these runs have not begun.
- No builds, host verification, live/paid model tests, installation commands or git actions were run.

## Unsupported IAgentAdapter operations and limits

CodexChatAdapterError(code='unsupported', operation=...) is explicit for:
- verifyInstallation; getSupportedModels; getDefaultModel; getApiModels: no corresponding model/installation API on the existing CodexRuntime/CodexContext contract.
- setLiveStatsCallback, setWorktreeCreatedCallback, setWorktreeRemovedCallback: native events do not supply those legacy aggregate/worktree payloads.
- setCompactionStartCallback: legacy payload requires preTokens, which normalized native compaction events do not report. Native compaction phase callbacks remain supported through CodexChatEventCallbacks.
- executeSlashCommand except /compact: no additional verified command mappings in the assigned core context API.
- setSessionPermissionLevel with SDK-only default/acceptEdits/bypassPermissions aliases. Frontend ask/plan/auto-edit/yolo use the native API directly.
- sendMessageToSession options other than files/images/admission: unsupported values are not silently discarded.
- resumeSession on an already active native context with configuration other than prompt/tabId: use the explicit native setting methods rather than silently ignoring changed configuration.

Overlapping turn admission reports typed busy; this adapter does not emulate the legacy SDK's queued follow-ups. Edited approvals use native steer. A failed interrupt blocks subsequent turn admission until a successful interrupt or context teardown. Only reported input/output usage produces the legacy result-stat payload; unknown cost is null, missing counters do not become zero. Native result callbacks still receive terminal results when usage is absent.

preloadSdk legitimately has nothing to load; getCliJsPath returns null. initialize reports local adapter lifecycle readiness, not an installation probe. Native runtime availability is established at gated open.

## Decisions

1. Context-owned registered scope rather than sharing a mutable runtime-wide approval sink. Evidence: codex-gateway-adapter.ts's scoped consumer ownership and the runtime's registration-time ApprovalSink boundary; requirement says one sink per context. The host creates the registration scope, keeping composition at the host boundary. Reversible at the port binding without changing session routing.
2. Use persisted-first identity plus mismatch validation; reject unknown/missing bindings rather than infer legacy from focus. Evidence: session-runtime-router.ts and implementation-plan.md:187. Options were identity dispatch versus current-provider dispatch; only identity dispatch satisfies retained history semantics. Reversible only through an explicit migration, not a fallback.
3. Native callback port carries compaction phases and sparse results; do not fabricate the legacy preTokens or live SessionStatsEntry payload. Evidence: shared CompactionStartCallback requires preTokens, while CodexRuntimeEvent compaction has phase only. Options were inventing counters, widening shared types outside ownership, or explicit unsupported legacy callback with supported native event delivery. Chose the latter; reversible when normalized evidence/contract grows.
4. Typed unsupported operations instead of SDK/proxy translation. Evidence: explicit batch requirement and current CodexContext API. Native /compact and settings are implemented; unverified mappings remain visible refusals. Reversible as core features acquire contracts.
5. Metadata through save port instead of importing SessionMetadataStore. Evidence: Batch 6d concurrently owns the sole writer; Batch 6b explicitly forbids that import/edit. The port carries the whole native thread identity and title without transcripts. Reversible binding in 6e.
6. Invalidate pending opens on reset/dispose/tab end. Evidence: native open is asynchronous and can finish after host teardown; without a generation/cancellation check it would republish a session after closure. Local lifecycle guards are reversible and covered by regression tests.

## Remaining work / limitations

- Coordinator must collect both queued verification logs, confirm single-project Nx headers and counts, and address any new-file test/lint failures before treating this batch as verified.
- Batch 6e must supply the ports and exports/DI; this batch intentionally does not wire production hosts.
- No changes were made to the other lane's metadata/auth/schema files or the 6a/6c siblings.
- No live parity claims or installation validation are made.

## Absolute inventory

Created only:
1. D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts
2. D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts
3. D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.ts
4. D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.spec.ts
5. D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-6b-report.md

