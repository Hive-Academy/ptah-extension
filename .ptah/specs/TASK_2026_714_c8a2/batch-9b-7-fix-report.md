# Batch 9b-7 fix report

Review: `.ptah/specs/TASK_2026_714_c8a2/review-9b-7.md` (REVISE 6/10). Two resume defects in the gateway chat bridge.

## Defect 1 — bound sessions got a start-time runtime decision

`prepareTurn` called `resolveExecutionProfile` with only the workspace root, so a bound conversation took the new-session branch.

What changed:

- `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:182-193` — local `legacyClaudeRuntimeIdentity`. When lookup is absent or returns no metadata, the turn uses `{ version: 1, sessionId, runtime: 'claude-sdk', providerId: 'claude-cli', workspaceId }` (the workspace root for that turn). Same shape as `storedChatRuntimeIdentity` with empty metadata. No import from `rpc-handlers` (`gateway-chat-bridge/package.json` does not depend on it).
- `gateway-chat-bridge.ts:511-536` — `readBoundSessionIdentity` runs before `prepareTurn`. The same `boundIdentity` is passed into `prepareTurn` (`:536`), `openStream` (`:617`), the D14a check (`:631`), and `tryFallbackStart` (`:657`).
- `gateway-chat-bridge.ts:793-805` — `prepareTurn` forwards `existingIdentity` only when the turn has one. A fresh conversation omits the field.
- `gateway-chat-bridge.ts:954` and `:1126` — native vs legacy fallback uses that already-resolved identity. The second `resolveSessionRuntimeIdentity` call (`boundSessionIsNative`) is gone.

## Defect 2 — identity lookup failure failed open

A throw from `resolveSessionRuntimeIdentity` used to become `boundSessionIsNative === false`, which allowed `startNew` and could rebind the conversation.

What changed:

- `gateway-chat-bridge.ts:1018-1039` — `readBoundSessionIdentity`:
  - lookup service absent (`sessionIdentities === undefined`): legacy Claude identity; fallback to `startNew` still allowed.
  - lookup returns `undefined`: same legacy Claude identity; fallback still allowed.
  - lookup throws (including `SessionRuntimeRoutingError` for missing or mismatched metadata): `{ ok: false, error }` with a real `Error`.
- `gateway-chat-bridge.ts:515-529` — on that failure the turn stops typing, drops the active route, logs via the injected logger with the `Error`, and sends exactly one reply through `failTurnBeforeSession` (`Ptah could not complete this request. Please try again.`). It does not call `prepareTurn`, `resumeSession`, or `startNew`. The binding is not written.

## New specs

Added to `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.native.spec.ts`. The profile double at `:341` follows the resolver branch order (stored native identity resumes native; a fresh turn starts native only when the gateway capability is on; a Claude identity stays on Claude) so the assertions observe the path the bridge takes.

- `:625` Bound legacy Claude session (lookup returns `undefined`), gateway capability on. `resolveExecutionProfile` receives `existingIdentity.runtime === 'claude-sdk'`. Resume uses the Claude model and provider profile. `startChatSession` is not called.
- `:654` Bound native session while the host capability would not start Codex. `resolveExecutionProfile` receives the stored native identity. Resume uses the native model and no provider profile.
- `:684` Throwing lookup (binding with no identity, so `resolveSessionRuntimeIdentity` throws). No `resolveExecutionProfile`, no `resumeSession`, no `startChatSession`, one generic reply, `setPtahSessionId` not called, `conversation.ptahSessionId` unchanged.
- `:716` Lookup service absent. Legacy Claude identity is passed, resume is attempted, and `startChatSession` runs once on the Claude path.
- `:739` Fresh conversation. The profile request has no `existingIdentity` property. Resume is not called.

`gateway-chat-bridge.spec.ts` was not edited. Those tests omit the lookup service, so they stay on the absent-lookup path, and they do not assert the profile-request object.

## Decisions

### Synthesize the legacy identity in this lib

- Decision: private `legacyClaudeRuntimeIdentity` in `gateway-chat-bridge.ts`, not `storedChatRuntimeIdentity` from `rpc-handlers`.
- Options: import the chat helper; duplicate the four-field object locally.
- Evidence: `libs/backend/gateway-chat-bridge/package.json` dependencies do not include `@ptah-extension/rpc-handlers`. The task forbids a new dependency edge.
- Reversible: if that dependency is added later, the helper can delegate to `storedChatRuntimeIdentity`.

### Fail closed before any session or profile resolve

- Decision: a throwing lookup aborts in `runTurn` via `failTurnBeforeSession` and returns. It does not resume and then suppress fallback.
- Options: abort before `prepareTurn`; resume anyway and only block `startNew` after a second read.
- Evidence: the review's failure is a failed read followed by `startNew` and a rebind. Resolving once, before the profile call, also stops a Claude proxy from starting for a session whose runtime is unknown. One identity then drives the profile and the fallback decision.
- Reversible: the abort can move later without changing the stored identity shape.

### Absent lookup and empty metadata stay on the legacy fallback

- Decision: both synthesize a Claude identity and still allow `startNew` after a resume failure. Only a throw fails closed.
- Options: treat a missing lookup service as fail-closed; treat `undefined` metadata as fail-closed; keep today's fallback for both.
- Evidence: the task's decided policy. `undefined` means no native metadata (legacy Claude). An absent service means the host has no native lookup.
- Reversible: the three branches are one method (`readBoundSessionIdentity`).

### Non-UUID bindings are unchanged

- Decision: a bound id that fails `SessionId.validate` still has no `existingIdentity`, and fallback stays allowed.
- Options: fail closed; synthesize an identity without a `SessionId` (the type does not allow that).
- Evidence: `SessionRuntimeIdentity.sessionId` is a `SessionId`. The review scenarios are UUID sessions. This edge was not in the new specs.
- Reversible: the `validate` guard in `readBoundSessionIdentity` can start failing closed.

## Not done

- Jest, `tsc`, lint, Nx, and diagnostics were not run. The lane rules forbid them, so the new specs are unexecuted.
- No commit, push, or PR.
- No matching skill for this host-bridge defect was in the session skill list. Ptah code-search tools were not in the connected tool list (`search_tool` returned no `ptah_*` tools; the connected MCP server is `tasks`). Reads used the native file tools.
- `gateway-chat-bridge.spec.ts` was left as-is, as scoped.
