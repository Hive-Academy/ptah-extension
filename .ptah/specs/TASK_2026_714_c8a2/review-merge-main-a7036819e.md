# Review: merge of origin/main a7036819e into feat/codex-runtime-integration

Verdict: REVISE
Score: 6/10
Review family: claude vs codex

## Defects

1. **High** - Native Codex start does not persist or consume policy lineage.
   - Location: `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1324-1325` (roots placed in start config), `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:1111-1117` (`updateCodexExecution` builds the record from `...existing` plus Codex fields only, with no roots).
   - Scenario: a child Codex session starts under a parent with roots `[A]`. The Codex adapter (`libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts`, no reference to `pluginConfigAncestorRoots`) ignores the roots, and the stored row has no `pluginConfigAncestorRoots`. A later resume or grandchild capture reads state `legacy`, not `valid`.
   - Fix: persist the roots on native Codex metadata at start (through `updateCodexExecution` or a sibling write), and make the Codex adapter or its launch wiring consume the roots, or state in code that Codex has no policy roots by design.

2. **High** - Legacy upgrade on resume locks in derived lineage for native Codex sessions.
   - Location: `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:2154-2156` (`restoreLineage` call), `:2289-2290` (`upgradeLegacyLineage` after a successful resume), and `:1526` (slash path). `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:2027-2040` (`upgradeLegacyPluginConfigAncestorRoots` writes the roots once and is immutable afterwards).
   - Scenario: a native Codex session created by `updateCodexExecution` has no roots, so `restoreLineage` returns `legacy: true` and derives `[workspaceId]` (or `[]`). The first resume writes that derived value permanently. Later resumes never correct it, even if the true parent lineage was `[A, B]`.
   - Fix: do not run the legacy upgrade for `execution.runtime === 'codex-app-server'`, or first write the real roots at native start (defect 1), so the upgrade path is not reached for Codex rows.

3. **Low** - Native Codex start never clears its `pendingLineage` tab entry.
   - Location: `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1365` (set by tab id), `:371` (cleared on session-ID-resolved, keyed by tab), `:1401` (cleared only when the adapter start throws).
   - Scenario: the session-ID-resolved callback is emitted by the SDK adapter. No Codex code path was found that emits it, so a successful native Codex start keeps its tab entry for the life of the process. The session-end cleanup at `:599` deletes by session id, which does not match a tab key. Impact is a small map leak per Codex start. Not confirmed at runtime.
   - Fix: clear the tab entry when the native start succeeds and the stream is owned by the session, or key the Codex entry by session id.

No defect found in the remaining checks below.

## Checked

- `apps/ptah-electron/src/activation/bootstrap.ts`: `DISPLAY_WINDOW_HOST` is registered once (`:620`). The Codex binding (`:588-612`) precedes it, and failures are logged and do not stop startup. Main's `affc0a33f` display-window change is present. The `HEAD -> staged` diff adds only the display-window import and registration. The main-side formatting changes are whitespace only.
- `apps/ptah-electron/src/di/container.smoke.spec.ts`: main's git-root-watch import, token and `GitWatchRpcHandlers` assertions are present. The branch's runtime-default `describe` and its token imports are present. No duplicate `describe` blocks were found.
- `libs/backend/agent-sdk/src/lib/session-metadata-store.ts`:
  - Codex direct-write guard (`:1166-1180`) and binding guards are kept.
  - Main's `pluginConfigAncestorRoots` schema, migration split (`:444`), and read helpers (`:244-272`) are present.
  - `_saveInternal` keeps existing roots unless `allowLineageUpgrade` is set (`:1234-1235`), so ordinary saves do not rewrite lineage.
  - `updateCodexExecution` (`:1111-1127`) and `incrementCodexMessageCount` spread `...existing` / `...current`, so roots survive native writes.
  - Native writes skip `_saveInternal`. This is the intended path and the spread preserves lineage.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session-agent-child.spec.ts`: all `it`/`describe` titles from HEAD and from main are present in the staged file. The staged file adds the typed Codex adapter-failure test and the real temporary-root fixture (`:97`).
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`:
  - Codex failure mapping (`:833`) and the `codexFailure` call sites are present (count matches HEAD).
  - Main's `validatedLineage`, `captureLineage`, `restoreLineage` and `upgradeLegacyLineage` are present once each. There is one `sessionIdResolvedEvents` registration (`:370`).
  - `pluginConfigAncestorRoots` reaches both the start config (`:1324`) and the resume config (`:2222`), so both runtimes receive it at the adapter call.
  - Pending child lineage is set (`:1365`) and cleared once in the catch (`:1401`). There is no duplicate inline adapter config from main.
  - Native resume delivery (`:2271-2298`) and streamless follow-up state (`:1575-1597`) are present.
- MCP wiring: no MCP strip was found in the five files. `mcpServersOverride` and `mcpServerRunning` remain in the start and resume configs.
- Not checked: `session-query-executor.service.ts`, `chat-slash-command-router.service.ts`, and the Codex adapter bodies. Only their references to lineage were searched. No tests, typecheck or lint were run, per the lane rules.
