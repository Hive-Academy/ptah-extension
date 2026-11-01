# Batch 8k-3 report

## Summary

Implemented D11 approval wire identities, D12 host-side terminal cleanup, D10 native session validation, and Ptah tool presentation. Changed only the six assigned source/spec files plus this requested report. Verification is deferred to the coordinator; no tests, diagnostics, lint, typecheck, build, installation, or git commands were run.

## Task 1 — D11 approval wire contract

- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:103`: pending entries are keyed by wire UUID and retain their native correlation key; a second map resolves correlation keys to wire IDs. Settlement deletes both entries and releases the host attention notice using the original payload timestamp.
- Same file, `:289`: every presentation generates a fresh UUID, settles the previous presentation for its correlation, uses `presentCodexApproval`, forwards native tool item ID and expiry, and omits a fallback tab ID equal to the session ID.
- Same file, `:332`, `:342`, `:357`: dismiss resolves through the correlation map; cancellation and responses settle wire-keyed entries. A subsequent dismiss is a no-op. Failed delivery declines the matching native request and settles its wire ID; a late failure from an older presentation cannot decline its replacement.

## Task 2 — D12 terminal cleanup

- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts:551`: parameterized `turn-ended` / `disposed` specs model sink cancellation followed by dismissal. They assert exactly one cancellation message with the wire ID, exactly one host notice release with its original timestamp, and no native response from a late renderer reply.
- Same file, `:570`: re-presentation gets a distinct UUID, releases the old notice, rejects its stale reply, and dismisses/releases the replacement.

## Task 3 — D10 native session validation

- `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:125`: local persisted thread schema validates version, context, process generation, workspace, fingerprint, and state, matching the core thread-record shape.
- Same file, `:1059`: after workspace authorization, native execution plus a valid thread record returns `{ exists: true }` without a file path and logs at debug. The existing Claude transcript path follows unchanged.
- Resume evidence: `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1088` calls auto-resume from chat continuation; `:1747` calls the adapter's `resumeSession`. `libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.ts:116` delegates resume through `adapter`; `:216` selects the native adapter for persisted `codex-app-server` identity, reaching `CodexChatAdapter.resumeSession`. This is source evidence, not runtime verification.

## Task 4 — Projection tool names

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-events.ts:195`: tool starts pass their existing input-record conversion into `presentCodexTool`. Only this case and its helper import changed.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-events.spec.ts:131`: commandExecution now asserts Bash presentation with its command while retaining the stable native tool ID and failed-result coverage.

## Task 5 — Regression specs

- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts:355`: real shared `parsePermissionRequest` accepts both real-tab and fallback-tab payloads; assertions cover UUID, tool item ID, expiry, readable command description, Bash input, and omission of fallback tab IDs. The agent-sdk test mock uses the real presentation helper.
- Same file, `:450`: delayed rejection of an older delivery leaves its replacement actionable. Existing response and failed-delivery tests retain their terminal cleanup checks; failed delivery now asserts the precise notice key/timestamp.
- `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.spec.ts:2032`: valid native metadata skips disk access; missing/invalid thread records fall through; thread metadata without native execution keeps the Claude lookup. Existing Claude transcript success tests remain in place.

## Decisions

1. **Late replies return false after settlement.** Options: retain consumed-ID tombstones, or remove both maps and use existing unknown-ID behavior. Chosen: remove both maps and return false. Evidence: the existing permission bridge explicitly falls through on unknown IDs; no native approval is called and no retained tombstones are needed. Reversible: yes.
2. **Validate native thread metadata locally.** Options: change the public SDK barrel, deep-import its internal parser, or validate needed persisted fields in the assigned handler. Chosen: local schema. Evidence: `session-metadata-store.ts:136` exports its parser at module level, but `agent-sdk/src/index.ts:50` does not re-export it; changing that barrel is outside ownership. The schema mirrors the existing persisted record constraints. Reversible: yes, when the parser becomes a public package export.
3. **Dismiss after cancellation/response is a no-op.** Options: retain a correlation record solely for a later redundant dismissal, or erase both records immediately. Chosen: immediate cleanup. Evidence: sink terminal paths call cancel then dismiss; cancellation already removes the renderer prompt and settlement releases the notice. Reversible: yes.

## Not done

- No verification was run, per the batch instruction; coordinator must run the changed specs and applicable host checks.
- No live Electron/renderer exercise or native process run.
- No changes to other lanes' adapters, stream lifecycle, runtime, task state, or SDK exports.

