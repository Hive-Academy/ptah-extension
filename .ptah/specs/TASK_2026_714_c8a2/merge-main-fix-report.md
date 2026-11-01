# Merge main fix report

## A. Native session preparation spec

**Cause:** Main added policy-root validation, which calls `workspaceProvider.getWorkspaceFolders()`, and a `pendingLineage` map. The branch's native spec harness supplied neither a complete workspace provider nor that map. Main also put `pluginConfigAncestorRoots` in native resume config; Codex option validation rejects that Claude-specific key. The latter is a real production break, not merely a fixture issue.

**Fix:** `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.native.spec.ts:73,105-143,183-187` now uses real temporary folders, a complete workspace provider, the pending map, and the new store methods. `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1389-1398,2266-2290` passes `undefined` for the Claude-only lineage key in native Codex adapter configs; the Codex option classifier skips undefined fields. MCP fields remain in those configs.

**Spec cases repaired:** `accepts real start and resume configs with ambient user options false`; same with `true`; `prepares complete start inputs and launches through the injected adapter without legacy auth`; `resumes with the stored identity after a workspace provider switch`; `attaches the start stream when the model notice rejects`; `attaches the resumed stream when the model notice rejects`; `publishes after success and publishes nothing for a second busy launch on the same tab`; `does not publish a notice when resume fails`; `keeps a Claude session model and provider profile after switching the workspace to Codex`.

## B1. Persist native Codex policy lineage

**Cause:** `updateCodexExecution` built a new native row without lineage roots supplied by chat start. Its direct write path bypasses Claude `_saveInternal`, so child lineage was lost.

**Fix:** `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:698-711,998,1126-1130` carries validated start roots in an async scope and applies them on the first native metadata write. Existing roots remain immutable. `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1387-1398` wraps native start in that scope. A comment at the start site states that Codex does not consume Claude plugin-config roots by design. The Codex adapter is unchanged.

**Spec cases:** `persists native start lineage through the Codex write and keeps it immutable (async=%s)` and `keeps concurrent native start lineage scoped to each thread` in `libs/backend/agent-sdk/src/lib/session-metadata-store.spec.ts:2077,2104`; `passes child policy roots to the native metadata write without changing Codex options` in `chat-session.native.spec.ts:448`.

## B2. Guard legacy lineage upgrade

**Cause:** Before B1, a Codex row lacked roots and resume treated it as legacy, allowing derived roots to become permanent. A stale upgrade attempt could race with a native write.

**Fix:** `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:2346-2352` skips legacy upgrades for Codex rows. The store's existing immutable-lineage check returns already valid roots without writing them. New native rows have actual roots from B1, so resume reads valid lineage.

**Spec case:** `does not replace native roots when a stale legacy upgrade follows resume` in `libs/backend/agent-sdk/src/lib/session-metadata-store.spec.ts:2093`.

## B3. Clear pending lineage

**Cause:** Successful native starts did not clear the tab-keyed `pendingLineage` entry; the SDK session-ID callback does not fire for Codex.

**Fix:** `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1400` deletes the entry after native start returns its owned stream. The existing catch path still clears failed starts.

**Spec case:** `clears pending lineage after a native start owns its stream` in `chat-session.native.spec.ts:461`.

## Decisions

- Used the metadata store's async scope because the native adapter metadata port has no lineage parameter. Host wiring delegates native writes to the same store instance. This keeps the adapter unchanged and isolates concurrent starts.
- Kept lineage immutable: only the first native write with no existing roots can set it. The store still rejects ordinary direct writes of Codex runtime identity.
- No tests, typecheck, lint, diagnostics, Nx, or other verification commands ran, as lane rules prohibit them. The coordinator must verify. Windows-only main failures were untouched.
- No invocable CLI skill mechanism was exposed. Read the repository `agent-lanes` skill file for lane mechanics; no matching Codex backend skill was available through the CLI.

## Clarifications Needed

None.
