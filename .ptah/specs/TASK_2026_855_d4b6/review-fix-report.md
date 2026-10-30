# Review-fix report — TASK_2026_855_d4b6

## Findings

1. **Blocking: Windows directory mode.** `libs/backend/rpc-handlers/src/lib/chat/session/session-folder.ts:49` now checks `isDirectory()` without Unix permission masks and still calls `fs.access` for the supplied and physical roots with `R_OK | X_OK`. Test added: `session-folder.spec.ts:100` supplies mode `0o40666` and expects success.
2. **Serious: slash lineage and policy storage.** `chat-session.service.ts:1393-1440` restores and validates lineage before slash routing, returns the message path's `SESSION_FOLDER_UNAVAILABLE` shape on `RpcUserError`, forwards the validated roots, and upgrades legacy metadata after a successful route. `chat-slash-command-router.service.ts:333` carries those roots in the SDK `sessionConfig`. `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:1104-1116` treats missing ancestor storage as policy unknown while keeping absent local storage's existing behavior. Tests added: `chat-continue-slash-before-resume.spec.ts:289` refuses an unavailable ancestor before any router or SDK query; the legacy slash case at `:690` verifies `[workspaceId]` reaches `sessionConfig` with no resume; `plugin-loader.service.capabilities.spec.ts:302` checks null ancestor storage fails closed.
3. **Minor: post-start legacy upgrade.** `chat-session.service.ts:2122,2154` keeps the upgrade after `resumeSession` and `streamEventsToWebview` and logs a warning if it throws or reports malformed. The already-running resume still returns `{ justResumed: true }`. Test added: `chat-continue-slash-before-resume.spec.ts:380` covers both failure forms and asserts the resume stream started and the continue result succeeded.
4. **Minor: unused option and rejection logging.** `session-folder.ts:16,85` removes `fileSystemProvider` from `ResolveSessionFolderOptions` and logs a rejection code and message, including the underlying filesystem cause when available. Minimal call sites updated at `chat-history-read.service.ts:50`, `agent-rpc.handlers.ts:1503`, and `session-rpc.handlers.ts:1207`; affected constructor fixtures were adjusted. Test added: none for this low-impact cleanup; existing `session-folder.spec.ts` rejection cases and the scoped project test run cover the response behavior.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use `fs.access` and `isDirectory()` without mode masks. | Keep Unix masks; use platform-independent access checks. | Windows directory mode `0o40666` has no Unix execute bit; the new regression passes. | Yes. |
| Validate every slash path before the router and pass roots through its typed params. | Add a second resume; validate then route once. | The slash-before-resume tests preserve zero `resumeSession` calls and one SDK query while the new cases validate ancestors. | Yes. |
| Keep the legacy upgrade after stream startup and treat upgrade failure as a warning. | Move it before startup; catch it after startup. | Existing startup order is preserved, and a failed durability write cannot retroactively stop an active stream. | Yes. |
| Require storage for requested ancestors only. | Treat null as empty; treat it as policy unknown. | Missing ancestor storage can hide a disable; the new loader test observes a `CapabilityPolicyUnknownError`. | Yes. |

## Verification

Command: `set -o pipefail; npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/agent-sdk 2>&1 | tail -n 80` (the shell captured `PIPESTATUS[0]`).

Exit code: **0**.

NX summary line: `NX   6 tasks: 6 succeeded, 2 cached`.

`ptah_get_diagnostics` was attempted after edits but its TypeScript check remained unavailable after 45 seconds. The scoped verify run completed lint, test, and typecheck for both requested projects.
