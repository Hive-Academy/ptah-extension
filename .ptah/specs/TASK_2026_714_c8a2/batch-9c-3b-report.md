# Batch 9c-3b — gateway turn extraction

Behavior-preserving split of style finding 2 in `code-style-review-p9.md`. `GatewayChatBridge.runTurn` still sequences the turn, the watchdog, the seal, and cleanup. Identity resolution, SDK/profile preparation, text reconciliation, and the native resume predicates moved to siblings under `libs/backend/gateway-chat-bridge/src/lib/`. The public bridge surface, constructor tokens, and `di/` registration are unchanged. The collaborator is constructed in the bridge constructor from the instances the bridge already injects.

No matching skill covers this extraction. `angular-frontend-patterns`, `nestjs-backend-patterns`, and `nx-workspace-architect` do not apply to this tsyringe host class. Ptah MCP tools (`ptah_code_search_symbols`, `ptah_agent_report`) were not in the connected tool list. File search and reads used ripgrep and the editor.

## What moved

| Old (`gateway-chat-bridge.ts`, pre-split, 1357 lines) | New |
| --- | --- |
| `GatewayTextDelta` 252–257, `GatewayTurnText` 268–311 | `gateway-turn-text.ts` 17–22 and 24–67 |
| `SdkSessionContext` 211–214, `TurnProvider` 224–228, `TurnPreparation` 231–234 | `gateway-turn-preparation.ts` 28–51 |
| `asError` 178–180 | `gateway-turn-preparation.ts` 81–83 |
| `readBoundSessionIdentity` 1068–1107 | `GatewayTurnPreparation.readBoundSessionIdentity` 96–142 |
| `prepareTurn` 841–873 | `GatewayTurnPreparation.prepareTurn` 153–184 |
| `resolveSdkContext` 882–929 (only caller was `prepareTurn`) | `gateway-turn-preparation.ts` 192–241 |
| `resolveModel` 1109–1114 (only caller was `prepareTurn`) | `gateway-turn-preparation.ts` 243–248 |
| `isGatewayResumeProfileChanged` 168–176 | `gateway-native-resume-policy.ts` 17–26 |
| Inline `boundIdentity?.runtime === 'codex-app-server'` checks in the `runTurn` catch, `openStream` resume catch, and `tryFallbackStart` | `isNativeCodexBinding` 28–33 and `isNativeResumeProfileRefusal` 38–45 |

`GatewayTurnText`, `GatewayTurnPreparation`, and the policy functions are imported by the bridge only. `src/index.ts` does not export them.

## Line counts

| File | Lines |
| --- | --- |
| `gateway-chat-bridge.ts` | 1357 → 1104 |
| `gateway-turn-preparation.ts` | 249 |
| `gateway-turn-preparation.spec.ts` | 231 |
| `gateway-turn-text.ts` | 67 |
| `gateway-turn-text.spec.ts` | 57 |
| `gateway-native-resume-policy.ts` | 45 |

`runTurn` remains about lines 376–702. It still owns ordering: workspace gate, typing, identity, preparation deadline, stream, D14a reply, fallback, watchdog, seal, session end, outcome.

## What stayed, and why

`openStream`, `resumeConfig`, `startNew`, `tryFallbackStart`, and `pumpStream` stayed on the bridge.

The native policy itself is three predicates and moved cleanly. The calls around those predicates did not. `openStream` resumes or starts a session on `IAgentAdapter` and builds the resume config from the permission level. `tryFallbackStart` checks the watchdog flag, discards the outbound buffer, starts a new session, and pumps it. `pumpStream` binds the session id and appends the reconciled body. Pulling those methods out would move watchdog and delivery state with them. The bridge now asks `isNativeCodexBinding` / `isNativeResumeProfileRefusal` and then does the same I/O as before.

Also unchanged: queueing, interrupted-turn notices, permission-prompt notices, typing heartbeat, `failTurnBeforeSession`, `sendError` / `sendErrorQuietly`, `bindSession`, `endSessionAfterTurn`, and the permission-level allowlist.

## Specs

Existing `gateway-chat-bridge.spec.ts` and `gateway-chat-bridge.native.spec.ts` were not edited. They still drive `GatewayChatBridge`.

`gateway-turn-text.spec.ts` covers append (stream, missing source, hook), history/complete replace, an empty complete replacement, an empty join, and message order from the first `noteMessage` with blocks sorted by `blockIndex`.

`gateway-turn-preparation.spec.ts` covers legacy Claude when no lookup is bound, legacy Claude when lookup returns `undefined`, a non-empty invalid id, a lookup that throws, a native identity passed through by reference, an absent or empty binding, a new-session prepare that omits `existingIdentity`, and a native prepare that forwards the identity and takes the model from the Codex seed.

## Behavior risks

- Log strings, reply text, binding writes, and the order of identity-then-profile are the same call sequence as before.
- `existingIdentity` is still spread onto the profile request only when it is present, so a new session does not send the key.
- The D14a check still tests the native binding before it inspects the error, so a Claude failure does not run the profile-changed classifier.
- `readSelectedModel` runs when `prepareTurn` runs, which is when `resolveModel` used to run.
- A late preparation rejection is still logged on the same promise, and the deadline race is still in `runTurn`.

Not run here, by lane rule: Jest, `tsc`, ESLint, and `ptah_get_diagnostics`. The coordinator verifies. All touched files are UTF-8, no BOM, LF.
