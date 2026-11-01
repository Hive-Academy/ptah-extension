# Batch 6g ROUTING2 report

## Findings

- SN1 / decision 12 — implemented. `routing-agent-adapter.ts:20` adds `NativeChatAdapter.owns(sessionId: SessionId): boolean`. The single ID-routing helper at line 186 checks native ownership before consulting metadata. Every existing ID-keyed operation uses that helper, including resume, end, interrupt, activity/token queries, token-conditional end, slash commands, message sending, setters and session models. Unknown sessions still route to legacy; persisted native sessions cannot fall back after a native failure. ADAPTER2 supplies ownership for open sessions and pending opens keyed by tab ID.
- SN1 regression — `routing-agent-adapter.spec.ts:77` closes a tab while a native start promise is pending: end reaches native, cancels the promise, and never calls legacy or metadata lookup. Line 111 additionally checks native ownership wins over a legacy persisted binding for session controls.
- Style M1 — implemented at `routing-agent-adapter.ts:189`: one exhaustive switch handles both runtime identities and unknown sessions, with a `never` assignment so adding a runtime member requires a routing decision.
- m2 / FM-R6 — router-side contract and regression coverage complete. `session-approval-router.ts:17` requires sink cancellation to settle ownership only; line 89 documents the router as the sole presenter using the caller's reason. Existing delete-before-cancel behavior already prevents reentrant/repeated cancellation. `session-approval-router.spec.ts:125` asserts one notification and the original disposed reason when a later cancellation requests timeout, for both sink return values. The timeout-order test also asserts exactly one notification. Removing the sink's own presentation belongs to ADAPTER2.
- Style M8 — retained wire-compatible string identity through `PermissionPromptCancelledPayload['sessionId']` at `session-approval-router.ts:9`. Shared cancellation payload uses string (`libs/shared/src/lib/types/session-runtime.types.ts:79`), and the native reply schema uses `z.string()` (`codex-chat-approval-sink.ts:22`). Branding only this address would require conversions at external wire boundaries outside this lane.
- Store style M3 — implemented: `CodexSessionMetadataError` now uses `unavailable-storage` at `session-metadata-store.ts:129,951`, matching the existing account-storage spelling. `session-metadata-store.spec.ts:2290` tests rejection of an inactive-workspace Codex write with this code and no storage update. The spawning session was notified of the rename for WIRING2.
- Store style M9 — deferred, behavior-preserving unification is not cheap. `session-metadata-store.ts:319` accepts arbitrary legacy workspace strings, replaces separators and strips trailing slashes; `normalizeCodexWorkspaceKey` (`libs/backend/codex-runtime/src/lib/codex-home-path.ts:24`) validates absolute paths, resolves lexical path segments and preserves filesystem roots. Replacing one with the other changes legacy acceptance/root behavior or weakens Codex identity validation.
- `session-runtime-identity.ts` and its spec required no edits: its existing resolution/validation remains the fallback after ownership.

## Contracts

- Native ownership takes precedence over identity lookup, including pending tab IDs.
- Sink `cancel(threadId, requestId)` does not present cancellation when called by the router. The router emits exactly one payload with its supplied reason.
- Metadata storage error code is `unavailable-storage`; there is no old-code alias.
- No other lane's source, host registrations, task state, or git state was modified.

## Files written

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/session-approval-router.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/session-approval-router.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/session-metadata-store.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/session-metadata-store.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-6g-routing-report.md

## Verification

Formatted the six source/spec files with the repository Prettier command; exit code 0.

Scoped `ptah_get_diagnostics` was requested for all six changed files and checked once again for its cached result. Both responses said:

> Source: typescript-compiler — Unavailable.
> Coverage: qualified — 6 files unchecked.
> TypeScript check still running after 45s. It was not cancelled — retry shortly and the completed result is served from cache.

One scoped verification command was started:

`npm run verify -- -t test -p @ptah-extension/agent-sdk -- --testPathPatterns="routing-agent-adapter|session-approval-router|session-runtime-identity|session-metadata-store"`

Output was filtered through `Select-Object -Last 65`. It remained running at the one permitted completion check (native exec session 34218); no output or exit code had been returned. No rerun, workspace-wide check, build, install or live model test was performed. **Tests pending; no pass claimed.** Team leader owns authoritative verification.

## Decisions

1. Centralize ownership-first dispatch in the existing helper rather than duplicate checks across operations. Evidence: every ID-keyed method already delegates to `adapter(id)`. Reversible local change; required by decision 12.
2. Preserve the router's existing delete-before-cancel sequence and make its sink non-notifying contract explicit. Alternative: suppress router presentation, which loses the router's reason. Evidence: binding cross-lane contract and existing cancellation ordering. Reversible; ADAPTER2 owns the sink implementation.
3. Keep approval IDs wire-compatible through an indexed shared payload type rather than introduce branding/conversions in this lane. Evidence: shared payload and native reply schema cited above. Reversible when wire contracts are migrated together.
4. Retain separate normalizers rather than alter legacy path acceptance or weaken Codex validation. Evidence: differing validation, root and lexical-segment semantics cited above. Reversible with a separately scoped normalization migration.

