# Batch 2 report — TASK_2026_876_4949

Runtime stop, kept-lane reparent, durable handoff chain, and tool reply text for components 1, 2 (backend), 4, and 7.

## Files changed

- `libs/backend/cli-agent-runtime/src/lib/session-children/session-handoff.service.ts` — arm and remember only after a kept `guardAndStart`; stop the caller tab after flush; bind a pending SDK edge.
- `libs/backend/cli-agent-runtime/src/lib/session-children/session-handoff.service.spec.ts` — kept-stop, refusal, late start, and chain-bind cases.
- `libs/backend/cli-agent-runtime/src/lib/session-children/session-handoff.port.ts` — `IHandoffTurnFlush` and `HandoffTurnFlushNotice`.
- `libs/backend/cli-agent-runtime/src/lib/session-children/session-handoff-chain.port.ts` — `ISessionHandoffChain` (new).
- `libs/backend/cli-agent-runtime/src/lib/session-children/session-handoff-chain.store.ts` — workspace-scoped durable document (new).
- `libs/backend/cli-agent-runtime/src/lib/session-children/session-handoff-chain.store.spec.ts` — reload, order, readiness, and scope (new).
- `libs/backend/cli-agent-runtime/src/lib/session-children/index.ts` — export the chain port, store, and flush port.
- `libs/backend/cli-agent-runtime/src/lib/di/tokens.ts` — `HANDOFF_TURN_FLUSH` and `SESSION_HANDOFF_CHAIN`.
- `libs/backend/cli-agent-runtime/src/lib/di/register.ts` — one singleton per class, aliased with `useToken`.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts` — emit `agent:reparented` only on the kept branch.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts` — kept emit and reverted silence.
- `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts` — broadcast reparent and `sessionHandoff:linked`.
- `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.spec.ts` — both broadcasts and a missing chain token.
- `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts` — optional flush hook after the three terminal flushes.
- `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.spec.ts` — hook timing and no `session:turnEnded` wiring.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-handlers.ts` — success reply says the caller was stopped and its history was kept.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tools.spec.ts` — asserts `stopped` and `history`.
- `plugins/ptah-core/skills/session-handoff/SKILL.md` — section 3 matches that reply.

## New symbols and tokens

- `CLI_AGENT_RUNTIME_TOKENS.HANDOFF_TURN_FLUSH` = `Symbol.for('HandoffTurnFlush')` — same `SessionHandoffService` instance as `SESSION_HANDOFF`.
- `CLI_AGENT_RUNTIME_TOKENS.SESSION_HANDOFF_CHAIN` = `Symbol.for('SessionHandoffChain')` — same `SessionHandoffChainStore` instance as the class token.
- `IHandoffTurnFlush.onCallerTurnFlushed`, `HandoffTurnFlushNotice`.
- `ISessionHandoffChain.append`, `read`, `onLinkWritten`; `SessionHandoffLinkWritten`.
- `SessionHandoffChainStore`, `HANDOFF_CHAIN_STORAGE_KEY` = `ptah.handoffChain`, link cap 256.
- Registration: `registerSingleton(SessionHandoffChainStore)` then `registerSingleton(SessionHandoffService)`, then `container.register(token, { useToken: Class })` for the three tokens. This tsyringe build has no `useExisting`. `useToken` resolves the class singleton, so the tool and the broadcaster share one armed set.

## Tests and acceptance criteria

| Criterion | Test |
| --- | --- |
| 1–2. Arm only on a kept handoff. `endSession` gets the caller tab id after flush, not the SDK id. | `session-handoff.service.spec.ts`: "arms only after a kept success and endSession uses the caller tab id after flush"; "matches a flush that names only the caller SDK id". Child `terminalStatus` stays unset; lane status stays running via `settleLaneAdoption(..., 'kept')`. |
| 1–2. Hook runs only after `flush()`, and `handleTurnEnded` does not call it. | `chat-stream-broadcaster.service.spec.ts`: "calls the hook only after flush resolves, and after chat:complete"; "calls the hook after the error flush, not before it"; "is not wired to session:turnEnded" (source of `session-lifecycle-notifier.ts` has no `onCallerTurnFlushed`). |
| 4. Kept lanes emit reparent; revert emits nothing; the lane stays running. | `agent-process-manager.service.spec.ts`: "emits agent:reparented once when the adoption is kept and leaves the lane running"; "does not emit agent:reparented when the adoption is reverted". `agent-events.spec.ts`: "broadcasts agent-monitor:reparented and sessionHandoff:linked". |
| 5. Timeout, refusal, and a late `start()` do not arm, remember, or write an edge. | Existing deadline tests plus "keeps the caller reserved until a late success, then does not record it" (rewritten: after the late start, a new handoff succeeds and `append` is not called for the late one). "does not arm on refusal". |
| 8–9. Reload, A→B→C and a later hop on every member, branch order, other workspace isolated, async `whenReady` before `update`, no sync `get` on an async store. | `session-handoff-chain.store.spec.ts`: "appends an edge and a new instance reads the same document, root first"; "lists a later hop on every member and a branch by link time"; "does not call get, and does not call update before whenReady"; "keeps a whenReady rejection in memory and does not call update"; "does not write workspace A into workspace B or the active store when A has no scope". |
| 10. Tool text and skill. | `session-tools.spec.ts` expects `/stopped/` and `/history/` and rejects "close this session" and "Handed off". `SKILL.md` section 3 matches. |
| 13. Pending key is the successor tab id. Document `from`/`to` are resolved SDK ids. No metadata row and no `session:list` field. | "appends the resolved SDK ids for the handoff workspace"; "stops a caller with no SDK id and writes no edge"; "drops a pending bind when the successor tab is gone". Chain store never calls a metadata API. |

Also covered: duplicate pair, bad id, listener throw, cap drops the oldest link once and logs once, malformed document reads empty, rejected `update` stays in memory and retries, `forceIdle` throw still calls `endSession`, rejected `endSession` is logged and the flush hook does not throw, missing chain token does not throw.

## Verification

Commands, one at a time. PowerShell has no `tail`; the last 40 lines were taken with `Select-Object -Last 40`. Full logs were kept beside that filter.

1. `npm run verify -- -p @ptah-extension/cli-agent-runtime` — exit 1. Lint passed. Typecheck passed. Test: 3 suites failed, 125 passed; 7 failed, 2867 passed. The four batch suites passed (`session-handoff.service.spec.ts`, `session-handoff-chain.store.spec.ts`, `agent-process-manager.service.spec.ts`, `agent-events.spec.ts`). Failures are outside this batch:
   - `acp-process-transport.spec.ts` — three 10–15s timeouts. Passed when that file was run alone (50s).
   - `child-worktree.provisioner.integration.spec.ts` — 120s timeout on real `git rev-parse` during the full run. Passed alone (210s).
   - `claude-approval.reader.spec.ts` — real-git cases. Under load, `createGitRunner`'s 2s timeout becomes `outcome: 'failed'`, so `read` returns `status: 'error'`. Re-ran alone: still 3 failed (one assertion, two 5s timeouts). Not touched by this batch.
2. `npm run verify -- -p @ptah-extension/vscode-lm-tools` — exit 0. Lint, test, and typecheck passed (7m 30s, lock 553.8s).
3. `npm run verify -- -t test -p @ptah-extension/rpc-handlers -- --testPathPatterns=chat-stream-broadcaster` — exit 0 (1m 27s). Lint and typecheck were not run, so `assertManifestInvariants` for `session:handoffChain` was not exercised here.

This worktree has no `node_modules`. `jest.preset.js` maps `marked` to `<worktree>/node_modules/marked/lib/marked.umd.js`, so a direct Jest run failed 74 suites before that path existed. A directory junction `worktree/node_modules` → `D:\projects\ptah-extension\node_modules` was added so the mapper resolves. It is gitignored. Node already walked up to the parent install; the junction only satisfies that absolute mapper path.

An earlier typecheck failed on `register.ts` `{ useExisting }` (TS2769). Replaced with `{ useToken }`. The later typecheck passed.

## Open items for batch 3 and 4

Batch 3 (not edited here): `SessionHandoffChainRpcHandlers`, Zod schema, manifest owner `{ key: 'sessionHandoffChain', methods: ['session:handoffChain'], requires: [] }`, handler export, Electron and CLI `rpc-surface.spec.ts`, scenario-sanitizer allow-list. `assertManifestInvariants` still fails a full rpc-handlers typecheck until that owner exists.

Batch 4 (frontend, parallel, not edited): inspector linked-sessions, wire parsers, `agent:reparented` store handling, `handleSessionEnded` → `markIdle`.

`register-rpc-surface.ts` still only calls `wireAgentEventListeners`. The chain listener is inside that function, so no extra startup resolve of `SessionHandoffService` was added.

## Decisions

1. **Caller id is `SessionId.from(callerTabId)`.** Options: `SessionId.fromTrusted` (named in the plan) or `SessionId.from`. Evidence: `fromTrusted` is not on `SessionId`; tab ids are `SessionId.create()` values and `from` accepts them. `endSession` assertions compare the branded string to the caller tab id. Reversible.

2. **Remember and arm only after `guardAndStart` sees `result.ok` inside the deadline.** Options: leave `remember` inside `start()`, or move it to the kept branch. Evidence: `start()` can resolve after the 30s deadline, and a remember there persisted a handoff the caller was told had failed. The old spec "keeps the caller reserved until a late success, then does not record it" was rewritten to require a later handoff to succeed. Reversible.

3. **Pending map value is `{ callerSdkId, workspaceRoot }`.** Options: SDK id only, or SDK id plus the `resolvePaths` root. Evidence: `SessionIdResolvedCallbackRegistry` can notify after `endSession`, when the caller record is gone, and `append` needs the workspace path. The map key stays the successor tab id. `previousSessionId` is not a key. An empty `realSessionId` drops the bind. A missing `lifecycle.find(successorTabId)` on a later flush or later handoff drops it. A null caller SDK id still stops and writes no edge. Reversible.

4. **Broadcaster does not import `@ptah-extension/cli-agent-runtime`.** Options: import `CLI_AGENT_RUNTIME_TOKENS.HANDOFF_TURN_FLUSH`, or a local `Symbol.for('HandoffTurnFlush')` plus a local hook interface. Evidence: `chat-stream-broadcaster.service.spec.ts` mocks that package down to `SDK_PTAH_CLI_REGISTRY`. The symbol string matches `tokens.ts`. Reversible.

5. **Alias registration uses `useToken`, not `useExisting` or a second `useClass`.** Options: Angular-style `useExisting` (does not typecheck), `useClass` (second instance, separate armed set), or `useToken` onto the class singleton (used by `UserLayerMirrorService` in agent-generation). Evidence: `dependency-container.d.ts` and `registerSingleton` in tsyringe  implement `useToken`; a transient alias still calls `resolve` on the class singleton. Reversible.

6. **Chain readiness copies the session-metadata pattern without editing that file.** Async storage uses `getAsync` and never `get`. `whenReady` is awaited before `update` when the storage exposes readiness. A missing per-workspace store does not fall through to the active store. Failures log a real `Error`, keep the edge in that workspace's memory, and do not throw into `onLinkWritten`. Reversible.
