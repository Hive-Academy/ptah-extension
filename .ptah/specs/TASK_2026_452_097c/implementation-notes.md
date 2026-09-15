## F1

`SdkAgentAdapter.startChatSession` now resolves the initial name once at `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:678`: the first nonblank value of `config.sessionName` or `config.name` is preserved exactly, otherwise the value is `New Chat`. The resolved value is placed on `sessionConfig.sessionName` at `sdk-agent-adapter.ts:686`, so `SdkQueryOptionsBuilder` uses it for the registry `--name` role and the new-session SDK `Options.title`; the same value is passed to the metadata callback at `sdk-agent-adapter.ts:722`.

The fallback is `New Chat` because it is human-readable, stable across locale and time, and already is the frontend's last-resort initial name (`libs/frontend/chat/src/lib/services/message-sender.service.ts:377-380`). This replaces the locale-date metadata-only fallback. `buildSessionName`'s `chat` fallback remains unchanged and is still used when a supplied/resolved name slugifies to nothing, such as an emoji-only title (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1053-1072`). The resume path remains unchanged and still resolves its name from stored metadata (`sdk-agent-adapter.ts:822-826`). Session importer naming was not touched.

Specs at `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts:964` cover missing, empty, and whitespace-only names and prove that metadata receives the exact `sessionConfig.sessionName`; `sdk-agent-adapter.spec.ts:998` proves a user-supplied name is preserved exactly. `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.spec.ts:381` proves the resolved fallback reaches both the raw SDK title and the slugged registry name.

## F2

The two reported call sites are both Ptah-CLI-backed child metadata, but they are not the same launch path:

- `AgentRpcHandlers.resumePtahCliSession` resumes a headless agent through `PtahCliRegistry.spawnAgent` (`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:884-893`). This is the path whose `--name` role is `agentConfig.name` (`libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:721-724`). `spawnAgent` returns that same configured value as `agentName` (`ptah-cli-registry.ts:897-899`). Its metadata callback now writes `spawnResult.agentName` directly, without the mismatching `CLI Agent: ` prefix (`agent-rpc.handlers.ts:899-908`). The failure callback also narrows `unknown` and logs at warn without affecting the session. The regression spec is at `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.resume-parent-session.spec.ts:234`.
- `ChatStreamBroadcaster` handles an interactive frontend `chat:start` routed through `ChatPtahCliService.getProfile` (`libs/backend/rpc-handlers/src/lib/chat/ptah-cli/chat-ptah-cli.service.ts:94`) and then `SdkAgentAdapter.startChatSession` with the frontend conversation `name` (`chat-ptah-cli.service.ts:153-163`). It does not call `PtahCliRegistry.spawnAgent`, so the `agentConfig.name`-based `--name` at `ptah-cli-registry.ts:721` does not name that session. Changing its title to the configured agent name would instead disagree with this interactive session's actual `--name` role. The broadcaster was therefore not changed under F2. Its existing `CLI Agent: <agentId>` child title remains a separate interactive-path issue; fixing it safely would require threading the resolved conversation name into the broadcaster or exposing it from `ChatPtahCliService`, both outside the permitted files for this task.

No vendor name was added to any user-data title.

## F3 findings

`PeerSessionDirectory.readPtahTitles` currently calls `SessionMetadataStore.getAll()` once (`libs/backend/agent-sdk/src/lib/peer-sessions/peer-session-directory.service.ts:167-177`). `SessionMetadataStore.getAll()` reads the injected ambient `WORKSPACE_STATE_STORAGE` (`libs/backend/agent-sdk/src/lib/session-metadata-store.ts:655-666`), so in a multi-workspace host it sees only the active delegate.

An existing port already supports reads for every workspace registered in the current host: `IWorkspaceScopedStateStorage.getStorageForWorkspace` and `getAllWorkspacePaths` (`libs/backend/platform-core/src/interfaces/workspace-scoped-state-storage.interface.ts:30-51`). It is deliberately structural on the existing `WORKSPACE_STATE_STORAGE` token, so no new platform port is needed. Electron already demonstrates the aggregation pattern in `apps/ptah-electron/src/services/gateway/metadata-gateway-session-lister.ts:41-82`: enumerate registered workspace paths, obtain each delegate, read `ptah.sessionMetadata`, validate entries, and deduplicate by session id.

Recommendation: in a follow-up, add a read-only aggregate metadata reader that probes `isWorkspaceScopedStateStorage`, reads all delegates for workspaces open in the current host, validates records, and deduplicates by session id. Keep `SessionMetadataStore`'s ambient write behavior unchanged. This can solve multiple Electron workspaces in one process. It cannot see a workspace known only to another process/window: the port documents only OPEN WORKSPACE registrations (`workspace-scoped-state-storage.interface.ts:1-19`), while VS Code and CLI register one concrete current-workspace store (`libs/backend/platform-vscode/src/registration.ts:66-70`, `libs/backend/platform-cli/src/registration.ts:71-73`). Reading closed or other-process workspace stores would require global indexing or platform-specific storage discovery, which is explicitly outside this task.

## F4 findings

No concrete initial divergence was found. `MessageSenderService` computes `autoName` from the current user title or `deriveSessionTitle(content)`, falling back to `New Chat` (`libs/frontend/chat/src/lib/services/message-sender.service.ts:376-380`). It then appends the same first user content synchronously before awaiting `chat:start` (`message-sender.service.ts:399-417`). `appendUserMessageAndResetStreaming` derives the tab title from that first user's `rawContent` with the same `deriveSessionTitle` function and applies it synchronously (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:1507-1537`). For a user-named tab, the derivation predicate is false and both surfaces retain the existing name.

`applyNewConversationDraft` can also derive a title (`tab-manager.service.ts:1379-1401`), but repository references show no production caller; only its colocated intent-mutator spec invokes it. It therefore cannot mutate the title after this `chat:start` path sends its name.

Recommendation: no frontend change in this task. If a future draft flow begins calling `applyNewConversationDraft`, pass its resolved name forward to `chat:start` or make the draft mutation occur before the RPC payload is built. Frontend/backend boundaries remain unchanged.

## Files changed

- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts`
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.resume-parent-session.spec.ts`
- `.ptah/specs/TASK_2026_452_097c/implementation-notes.md`

`sdk-query-options-builder.ts`, `chat-stream-broadcaster.service.ts`, and `session-importer` files were not changed.

## Verification

- `npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/rpc-handlers` — first completed run printed `Running target test for 2 projects` and failed because `sdk-agent-adapter.spec.ts` did not compile: TS2353 at lines 976/1006 and TS18048 at lines 979/991/1009. No individual test failed; the suite failed to run. At that point rpc-handlers had 101/101 suites and 3001 tests passing (33 skipped), while agent-sdk had 109 passing suites, 1 failed-to-run suite, 2 skipped suites, and 1898 tests passing (3 skipped). The spec typing was corrected.
- `npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/rpc-handlers --outputStyle=static` — PASS; header confirmed 2 projects. rpc-handlers: 101/101 suites, 3001 passed, 33 skipped. agent-sdk: 110 passed suites, 2 skipped suites, 1956 passed tests, 3 skipped. Nx reported one project result came from its valid cache (the rpc-handlers result had already passed with the changed spec in the preceding two-project run).
- `npx nx run-many -t typecheck -p @ptah-extension/agent-sdk @ptah-extension/rpc-handlers @ptah-extension/cli-agent-runtime --outputStyle=static` — PASS; 3/3 project typecheck targets succeeded.
- `npx eslint "libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts" "libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts" "libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.spec.ts" "libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts" "libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.resume-parent-session.spec.ts"` — PASS with 0 errors and 2 warnings. Both warnings are the repository's soft `max-lines` ceiling: `sdk-agent-adapter.ts` (901 lines) and `agent-rpc.handlers.ts` (859 lines).
- `git diff --check` — PASS with no whitespace errors.

## Revise round 1

### Defect 1

`AISessionConfig` now has the additive optional `sessionTitle` field at `libs/shared/src/lib/types/ai-provider.types.ts:164`. `SdkAgentAdapter.startChatSession` separates a caller-supplied nonblank name from the resolved session name at `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:678-689`: a supplied `sessionName` or `name` is preserved exactly, while a nameless start receives the previous human-readable, date-bearing fallback `Session <localeDate>`. That one resolved value is sent to metadata at `sdk-agent-adapter.ts:723-725` and remains the `sessionName` input from which the registry `--name` role is built.

Only the caller-supplied value is copied to `sessionTitle`. `SdkQueryOptionsBuilder` now emits SDK `Options.title` only from that field (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1010-1012`). Consequently, gateway starts that supply no name keep SDK automatic title generation, while metadata and the registry role still share the same date-bearing fallback. The gateway bridge was not changed: its existing start data has no meaningful conversation title without adding a lookup or changing its contract, and omitting `Options.title` is the intended behavior for that path.

Adapter coverage at `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts:965-1028` proves missing/empty/blank starts use the same resolved fallback for query configuration and metadata with no `sessionTitle`, while a supplied user name reaches `sessionName`, `sessionTitle`, and metadata unchanged.

### Defect 2

The duplicate builder test was replaced at `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.spec.ts:388` with the new contract: a resolved fallback still produces the registry `--name`, but leaves SDK `Options.title` undefined. The supplied-name test at `sdk-query-options-builder.spec.ts:381-386` now provides both `sessionName` and `sessionTitle`, proving that only the explicit caller title controls `Options.title`.

### Defect 3

`ChatPtahCliService` now retains the exact nonblank interactive conversation name alongside its session entry after passing that same `name` to `startChatSession` (`libs/backend/rpc-handlers/src/lib/chat/ptah-cli/chat-ptah-cli.service.ts:155-177`) and exposes it through `getSessionName` (`chat-ptah-cli.service.ts:314-315`). `ChatStreamBroadcaster` uses that value for child metadata at `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts:206-216`, falling back to `Session <localeDate>` only when the caller supplied no usable name. This removes the mismatching `CLI Agent: <agentId>` title without changing the agent-id-to-SDK-session mapping.

The SDK init callback invokes `SessionMetadataStore.create` asynchronously (`libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:394-399`, `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:924-950`), while the broadcaster awaits `createChild` for the same streamed init event. Both writes now carry the same conversation name, so either order is consistent. If `createChild` wins first, the later `create` preserves the existing record and name (`libs/backend/agent-sdk/src/lib/session-metadata-store.ts:1128-1136`). If `create` wins first, `createChild` overwrites it with the same name and marks it as a child; the internal merge also preserves an existing child marker on later non-child saves (`session-metadata-store.ts:454-460`, `session-metadata-store.ts:1166-1184`). Specs cover retention at `libs/backend/rpc-handlers/src/lib/chat/ptah-cli/chat-ptah-cli.service.spec.ts:206-222` and the broadcaster metadata write at `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.spec.ts:174-190`.

### Files changed

- `libs/shared/src/lib/types/ai-provider.types.ts`
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts`
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.spec.ts`
- `libs/backend/rpc-handlers/src/lib/chat/ptah-cli/chat-ptah-cli.service.ts`
- `libs/backend/rpc-handlers/src/lib/chat/ptah-cli/chat-ptah-cli.service.spec.ts`
- `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts`
- `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.resume-parent-session.spec.ts`
- `.ptah/specs/TASK_2026_452_097c/implementation-notes.md`

### Verification

- `npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/rpc-handlers @ptah-extension/gateway-chat-bridge @ptah-extension/shared --outputStyle=static` — PASS; header confirmed 4 projects. `@ptah-extension/agent-sdk`: 110 passed suites, 2 skipped suites; 1,956 passed tests, 3 skipped, 0 failed. `@ptah-extension/rpc-handlers`: 101 passed suites; 3,003 passed tests, 33 skipped, 0 failed. `@ptah-extension/gateway-chat-bridge`: 2 passed suites; 66 passed tests, 0 skipped, 0 failed. `@ptah-extension/shared`: 58 passed suites; 1,520 passed tests, 0 skipped, 0 failed. The first parallel attempt had three unrelated five-second timeouts in `voice-rpc.handlers.spec.ts`, `skills-sh-source-root.service.spec.ts`, and `skills-sh-legacy-adoption.spec.ts`; `npx nx test @ptah-extension/rpc-handlers --outputStyle=static` then passed all 101 suites and Nx identified that target as flaky. The required four-project command was rerun and passed.
- `npx nx run-many -t typecheck -p @ptah-extension/agent-sdk @ptah-extension/rpc-handlers @ptah-extension/gateway-chat-bridge @ptah-extension/cli-agent-runtime @ptah-extension/shared` — PASS; 5/5 project targets passed, 0 failed or skipped.
- `npx eslint "libs/shared/src/lib/types/ai-provider.types.ts" "libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts" "libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts" "libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts" "libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.spec.ts" "libs/backend/rpc-handlers/src/lib/chat/ptah-cli/chat-ptah-cli.service.ts" "libs/backend/rpc-handlers/src/lib/chat/ptah-cli/chat-ptah-cli.service.spec.ts" "libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts" "libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.spec.ts" "libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts" "libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.resume-parent-session.spec.ts"` — PASS with 0 errors and 3 existing soft `max-lines` warnings (`sdk-query-options-builder.ts`, `sdk-agent-adapter.ts`, and `agent-rpc.handlers.ts`).
- `git diff --check` — PASS with no whitespace errors.
