# Batch 1 report — TASK_2026_876_4949

Shared contracts for the durable handoff chain and the two new host pushes. No handler, runtime, or frontend code.

## Files changed

- `libs/shared/src/lib/types/rpc/rpc-session.types.ts` — param, entry, and result types for `session:handoffChain`.
- `libs/shared/src/lib/types/rpc.types.ts` — registry entry next to `session:getOrganization`, and the matching `RPC_METHOD_ENTRIES` line. `export *` from `rpc-session.types` already publishes the types through `libs/shared/src/index.ts`.
- `libs/shared/src/lib/types/messages/message-constants.ts` — `SESSION_HANDOFF_LINKED` and `AGENT_MONITOR_REPARENTED`.
- `libs/shared/src/lib/types/messages/session-handoff.ts` — `SessionHandoffLinkedPayload`.
- `libs/shared/src/lib/types/messages/agent-monitor.ts` — `AgentMonitorReparentedPayload` (new file).
- `libs/shared/src/lib/types/messages/index.ts` — exports `agent-monitor.ts`. `libs/shared/src/index.ts` already re-exports `./lib/types/messages`.
- `libs/shared/src/lib/types/messages/payload-map.ts` — `MessagePayloadMap` entries for both new message strings.

The RPC manifest stays in `libs/backend/rpc-handlers`. The plan does not put it in shared.

## Types and constants

`SessionHandoffChainParams`

```ts
{ sessionId: string }
```

`SessionHandoffChainEntry`

```ts
{ sessionId: string; label: string | null }
```

`SessionHandoffChainResult`

```ts
{ sessions: readonly SessionHandoffChainEntry[] }
```

`RpcMethodRegistry['session:handoffChain']` is `{ params: SessionHandoffChainParams; result: SessionHandoffChainResult }`. `RPC_METHOD_NAMES` includes `'session:handoffChain'`.

`MESSAGE_TYPES.SESSION_HANDOFF_LINKED` = `'sessionHandoff:linked'`.

`SessionHandoffLinkedPayload`

```ts
{ readonly fromSessionId: string; readonly toSessionId: string }
```

`MESSAGE_TYPES.AGENT_MONITOR_REPARENTED` = `'agent-monitor:reparented'`.

`AgentMonitorReparentedPayload`

```ts
{ readonly agentIds: readonly string[]; readonly parentSessionId: string }
```

`MessagePayloadMap` maps those two strings to those payload interfaces.

## Verification

Command: `npm run verify -- -p @ptah-extension/shared` (PowerShell has no `tail`; the log was limited with `Select-Object -Last 40`).

Result: exit 0. Nx ran lint, test, and typecheck for `@ptah-extension/shared`. All three targets passed (3/3). Duration about 1m 47s after a 196s lock wait. Nx hid per-task logs (`Output of 3 successful tasks were not shown`), so individual Jest pass/fail counts are not in the filtered output. `ptah_get_diagnostics` on the edited files reported 0 errors.

Node printed pre-existing `Failed to load the ES module` warnings for many `jest.config.ts` files, including projects this batch did not touch. They did not fail the run.

## Left for later batches

- Batch 2: chain store, `ISessionHandoffChain`, tokens, `agent-events.ts` broadcasts of `agent-monitor:reparented` and `sessionHandoff:linked`, caller stop, tool reply, and skill text. Not in `libs/shared`.
- Batch 3: `SessionHandoffChainRpcHandlers`, Zod schema, manifest owner `{ key: 'sessionHandoffChain', methods: ['session:handoffChain'], requires: [] }`, handler exports, Electron and CLI `rpc-surface.spec.ts`, and the scenario-sanitizer allow-lists (`session:handoffChain`, `sessionHandoff:linked`, `agent-monitor:reparented`).
- `assertManifestInvariants` (`libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`) requires every `RPC_METHOD_NAMES` entry to have a manifest owner. `manifest.spec.ts` calls it with `RPC_METHOD_NAMES`. Until batch 3 adds the owner, that spec will throw `RPC manifest is missing an owner for ... session:handoffChain`. This batch did not edit rpc-handlers and did not run that project.
- Batch 4: inspector client, `parseSessionHandoffLinkedPayload`, `parseAgentMonitorReparented`, and the linked-sessions section. Those parsers stay hand-written and do not import Zod.

## Decisions

1. The two new pushes have payload interfaces and `MessagePayloadMap` entries.
   Options: constants only; interfaces without the map; interfaces plus map entries.
   Evidence: `sessionHandoff:opened` is already a mapped payload in `session-handoff.ts`. The plan states `{ agentIds, parentSessionId }` and `{ fromSessionId, toSessionId }`. `broadcastMessage` accepts `unknown`, and the webview parsers in later batches narrow `unknown` themselves. The map still gives `createStrictMessage` a type. `message-validator.service.ts` has a `default` arm, so the new keys do not require a vscode-core case to compile.
   Reversible: yes.

2. The reparent payload is `agent-monitor.ts`, not a field on the handoff payload file.
   Options: add it to `session-handoff.ts`; add `agent-monitor.ts`.
   Evidence: `SessionHandoffOpenedPayload` is the tab-open push. Reparent is an agent-monitor message beside `AGENT_MONITOR_SPAWNED`. `messages/index.ts` already exports that folder, and `libs/shared/src/index.ts` already exports messages.
   Reversible: yes.

3. `host-source-registry.baseline.ts` is unchanged.
   Options: regenerate the baseline; leave it.
   Evidence: `host-source-registry.contract.spec.ts` only fails names matching `turn|recap|ptah-?ui|change-?set|host-?source|turn-?tests|usage`. None of `session:handoffChain`, `sessionHandoff:linked`, or `agent-monitor:reparented` match. The baseline file says a change needs a Gate 2 exception (TASK_2026_610).
   Reversible: yes.

4. No new shared unit spec.
   Options: add a contract spec; add none.
   Evidence: the plan names handler, store, and inspector specs in later batches. It does not name a spec under `libs/shared`. The batch instruction says to add a shared spec only when the plan names one.
   Reversible: yes.
