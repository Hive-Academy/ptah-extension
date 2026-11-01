# Code Logic Review A2

Review family: claude (in-process subagent); implementer: codex

Scope: static review of the 6-file uncommitted diff plus callers. No tests run (as instructed).

Score: 6/10. Verdict: REVISE.

## Defects

1. SERIOUS - silent fallback remains on the `resolveClaudeExecution` path.
   `libs/backend/rpc-handlers/src/lib/chat/session/chat-runtime-profile.service.ts:49-70` (callers `chat-session.service.ts:1464,2410`, `chat-slash-command-router.service.ts:335`) calls
   `WorkspaceProviderProfileResolver.resolveProviderProfileForWorkspace` (`workspace-provider-profile-resolver.ts:360`) -> `buildProfile`, which still builds the Codex proxy
   profile for `openai-codex` (`requiresProxy`, ~line 492). The A2 guard sits only in `resolveExecutionProfile`. Any host with no bound `runtimeProfile` (the `: await resolveClaudeExecution(...)` branch) still runs a Codex chat through the Claude SDK + translation proxy.
   That breaks D31(1). The report acknowledges this and defers it, but D31(1) is A2's requirement.
   Fix: put the Codex rejection (same `AuthRequiredError`) at the top of `resolveProviderProfileForWorkspace` and `buildProfileForPath` (or in `buildProfile`) so every route is covered. Add a spec for it.

2. SERIOUS - `RoutingAgentAdapter.startChatSession` guard is unreachable on exactly the hosts D31(1) targets.
   `register.ts:1061-1080` returns `null` for the routing adapter when `native` or `admission` is unbound, and `wireAgentAdapterAliases` (`register.ts:1135-1142`) then aliases `AGENT_ADAPTER` to the raw `SdkAgentAdapter`.
   So VS Code, CLI, TUI and non-admitted hosts never reach `routing-agent-adapter.ts:96-100`. The new throws only fire on hosts that have a native adapter.
   Enforcement on those hosts therefore depends entirely on the resolver (defect 1). Fix: close defect 1, and add a spec or assertion for the no-routing-adapter composition (a Codex provider must be rejected before the legacy adapter).

3. SERIOUS - `adapter(id)` now throws for teardown and read-only calls on a stored legacy Codex identity.
   `routing-agent-adapter.ts` `adapter()` (the added `identity?.providerId === 'openai-codex' && runtime !== 'codex-app-server'` throw) is the shared selector for `endSession`, `isSessionActive`, `getSessionToken`, `endSessionIfTokenMatches`, `interruptSession`, `interruptCurrentTurn`, `listSessionModels`.
   Opening or closing a historic Codex-via-Claude session therefore throws from cleanup and status paths, not just from resume and send. The result is leaked sessions and uncaught errors in tab close.
   Fix: keep the throw for `resumeSession`, `sendMessageToSession`, `executeSlashCommand` and `setSession*` only. Route cleanup and status calls (`endSession`, `isSessionActive`, `getSessionToken`, `endSessionIfTokenMatches`, `interrupt*`) to legacy, or make them no-ops.

4. MODERATE - unconditional `if (!this.admission)` at the top of `startChatSession` (`routing-agent-adapter.ts:96`) is dead code (the constructor type is non-null) and misleading.
   It would throw the Codex message for a Claude chat if ever null. The same applies to the `!this.native` checks (lines ~102, ~110, ~126, adapter()).
   Fix: remove them, or move the admission check inside the Codex branches.

5. MODERATE - `oauth-proxy.strategy.ts` `configureCodexOAuth` (non-native branch) no longer calls `stopProxyIfRunning(this.copilotProxy, 'Copilot')`.
   After a Copilot -> Codex switch that fails, a stale Copilot proxy keeps running until teardown. It is cleaned up on teardown, so the impact is small. Fix: keep the stop call before returning the error.

6. MINOR - the resolver guard calls `resolveActiveAuthForPath` a second time. The error's `recoveryHint` ('Use a host with native Codex support.') is vague.
   Suggest a hint that names the Electron desktop app with native Codex enabled.

## Requirement check

1. D31(1): PARTIAL. The resolver (`resolveExecutionProfile`) and routing paths are fine; the gaps are defects 1-2.
2. Native start/resume/controls unchanged: OK. The native identity or ownership branch returns before the new throws (`owns()` first), and `resumeNative`/`startNative` run before the guard. Only two `resolveExecutionProfile` callers exist (`chat-runtime-profile.service.ts:130`, `gateway-turn-preparation.ts:159`) and both are chat-start. No model list, title or slash-command caller uses it.
3. Non-Codex providers: OK. Copilot and Kimi code unchanged; the guard is keyed on `openai-codex`.
4. Teardown: OK. The stop and `clearCache` paths are retained, and the native return never started the watcher. Removing `startWatchingAuthFile` on configure leaks nothing.
5. Errors and strictness: no swallowed errors seen, no `any` or non-null assertions seen. No degradation-audit suppressions were added.
6. Spec coverage: non-admitted fails (yes), native unchanged (yes), non-Codex unchanged (yes). Missing: specs for defects 1-3.
7. MCP config: untouched. OK.

## Round 1

Static re-review; no tests, typecheck or lint run. Verdict: APPROVE (with one follow-up). Score: 8/10 (was 6/10).

| # | Status | Evidence |
| --- | --- | --- |
| 1 | FIXED | `workspace-provider-profile-resolver.ts:471` rejects `openai-codex` at the top of `buildProfile`, before its try/catch and before the shared-env fallback in `resolveProviderProfileForWorkspace` (:354-375). Both public legacy entry points (`resolveProviderProfileForWorkspace` :359, `buildProfileForPath` :423) reach it. `resolveExecutionProfile` also guards at :268-275, after the native start/resume returns, so native Electron start/resume never reach it. Spec `.spec.ts:645-667` covers both methods with shared env set to Codex. Chat callers (`chat-session.service.ts:1464,2410`, router :335, `chat-runtime-profile.service.ts:49-68`) already result-shape `AuthRequiredError`. |
| 2 | FIXED | Raw-SDK hosts are covered through the resolver guard (`resolveClaudeExecution` -> `resolveProviderProfileForWorkspace` -> `buildProfile`). Spec at `.spec.ts:647`. |
| 3 | FIXED | `routing-agent-adapter.ts` `adapter(id, startsOrChangesChat)`: the legacy-Codex throw runs only for resume, send, slash command and `setSession*`. `endSession`, `isSessionActive`, `getSessionToken`, `endSessionIfTokenMatches`, `interrupt*` and `listSessionModels` call `adapter(id)` without the flag and route to legacy. Spec `routing-agent-adapter.spec.ts:196`. |
| 4 | FIXED (partly) | The Codex message no longer fires for Claude: the `!native` checks sit in the Codex branches and a generic "admission unavailable" error covers a null port (`routing-agent-adapter.ts:96-132`). The `!this.admission` / `!this.native` checks remain dead code under the non-null constructor types. Cosmetic only. |
| 5 | FIXED | `oauth-proxy.strategy.ts:281` stops the Copilot proxy before returning the explicit failure. Spec `.spec.ts:483`. |
| 6 | FIXED | The hint now names the Ptah desktop app (Electron) with native Codex enabled (`workspace-provider-profile-resolver.ts:516-524`). The second `resolveActiveAuthForPath` call at :268 remains but is harmless. |

Checks:
- Native Electron start, resume and slash commands: the native branch of `resolveExecutionProfile` returns before the guards. `codex-chat-host-ports.ts` uses only `resolveExecutionProfile`. No model-list or title caller uses the guarded resolvers.
- Cleanup and status of historic Codex sessions no longer throw (defect 3).
- Non-Codex providers: the guards are keyed on `openai-codex`, so they are unchanged.
- Strict TS: no `any` or non-null assertions seen. `rejectLegacyCodexProfile(): never` is correct.

New defects:

7. SERIOUS - `workspace-provider-profile-resolver.ts:471` (via `buildProfileForPath` :419-427) makes Codex one-shot flows degrade silently.
   `WorkspaceLlmResolver.resolveForPath` (`workspace-llm-resolver.ts:89-107`) catches the throw, logs a warning and returns a snapshot with no `auth`. Commit-message, enhanced-prompts, wizard, harness, cron and curator callers then "ride the process-wide auth". With a Codex-active workspace that is either no auth or another provider's credentials, because the Codex proxy no longer configures shared auth. Before A2 these worked through the isolated Codex proxy profile.
   This is a silent provider switch or failure, not the explicit failure D31(1) wants. D31(1) concerns chat. If one-shots are meant to stop supporting Codex, the user gets no clear error.
   Fix: in `WorkspaceLlmResolver`, rethrow `AuthRequiredError` or return an explicit Codex-unsupported snapshot, so one-shot callers fail visibly. Alternatively move the Codex guard out of `buildProfileForPath` and decide one-shot policy explicitly. Add a spec.

8. MINOR - dead `!this.admission` / `!this.native` checks (see defect 4) can be dropped.

Remaining headline: defect 7, a follow-up that does not block the A2 chat-path requirements.
