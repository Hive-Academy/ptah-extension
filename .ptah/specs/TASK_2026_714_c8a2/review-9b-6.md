# Review 9b-6 — Codex prompt lifecycle forward

## Verdict

APPROVE 9/10

The public publisher delegates to the existing isolated emitter, Claude still calls that emitter directly, `resolveSessionRuntimeIdentity` is a value export, and Electron's Codex host-port dependency resolves the same singleton `SdkPermissionHandler` the gateway bridge subscribes to.

## Findings

1. **Low** — `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts:446` proves the composition closure forwards an event to whatever `SDK_PERMISSION_HANDLER` is on the container passed into `bindElectronCodexChat`. It does not resolve `GatewayChatBridge` or call `onPromptLifecycle`. Failure scenario: a later change that publishes through a child container which re-registers `SDK_PERMISSION_HANDLER` would still pass this spec while gateway notices, subscribed on the root singleton, would never see the Codex event. Production wiring does not do that today (see Checked). Not a batch failure.

No medium or high findings.

## Checked

### 9b-6.1 Publisher and Claude behavior

- `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:229` `publishPromptLifecycle` is public and calls `this.emitLifecycle(event)` only.
- `emitLifecycle` (`:233`) is unchanged: it walks `lifecycleListeners` and isolates each listener in its own try/catch, logging `[SdkPermissionHandler] prompt lifecycle listener threw` with the error message. A throw does not stop later listeners and does not escape the publisher.
- Claude still emits through the private method, not the new public method: requested at `:936`, resolved at `:1018`. The diff adds the public method between `onPromptLifecycle` and `emitLifecycle` and does not change those call sites, the event shape, or the catch path.
- `libs/backend/agent-sdk/src/lib/sdk-permission-handler.spec.ts:85` delivers one published event to a listener registered with `onPromptLifecycle`. The next test registers a throwing listener first, then a second listener, and asserts the second is called, the publish does not throw, and `logger.warn` receives the listener message. That matches current isolation.

### 9b-6.2 Export

- `libs/backend/agent-sdk/src/index.ts:174` value-exports `resolveSessionRuntimeIdentity` from `./lib/codex-app-server/session-runtime-identity`. The function is the existing lookup (`session-runtime-identity.ts:31`), not a new stub.

### 9b-6.3 Same handler instance

- Registration is singleton, not transient: `libs/backend/agent-sdk/src/lib/di/register.ts:322` registers `SDK_TOKENS.SDK_PERMISSION_HANDLER` as `useClass: SdkPermissionHandler` with `Lifecycle.Singleton` inside `registerSdkServices`.
- Electron phase 2 calls `registerSdkServices(container, logger)` (`apps/ptah-electron/src/di/phase-2-libraries.ts:219`) and, on that same container, `registerGatewayChatBridge(container, logger)` (`:486`), which is `registerSingleton` of `GatewayChatBridge` (`libs/backend/gateway-chat-bridge/src/lib/di/register.ts:19`).
- The bridge injects that token (`gateway-chat-bridge.ts:244`) and `start()` subscribes with `this.permissionHandler.onPromptLifecycle` (`:258`). Electron starts that method from `startMessagingGateway` (`apps/ptah-electron/src/activation/start-messaging-gateway.ts:114`) after `post-window.ts:140` resolves the bridge from the activation container.
- `bootstrap.ts:593` passes that same activation container into `bindElectronCodexChat`. `createElectronCodexBindingContext` stores it by reference (`codex-runtime-composition.ts:318`). It is not a child scope.
- Codex runtime scopes do create a child (`:471`, `container: scope.container` on the scope object). `createElectronCodexAdapterPorts` does not publish through that child. It closes over `context.container` (`:492`) and resolves `SDK_TOKENS.SDK_PERMISSION_HANDLER` at publish time (`:547`). That is the container the gateway singleton was constructed from, so `publishPromptLifecycle` hits the instance whose `lifecycleListeners` set the bridge registered.
- Resolve-on-publish is after `bridge.start()`, so a Codex prompt that happens once the window is up reaches a listener that is already subscribed. An event fired before `start()` would be dropped; that is the same rule Claude already has, and binding the closure at boot does not snapshot an empty listener list.
- `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts:444` registers a `useValue` handler on the container passed to `bindElectronCodexChat`, reads the deps object given to `createCodexChatHostPorts`, calls `promptLifecycle.publish`, and expects `publishPromptLifecycle` with the same event. The factory mock delegates to the real `createCodexChatHostPorts`. The real factory (`codex-chat-host-ports.ts:282`) calls `deps.promptLifecycle?.publish` inside its own try/catch, so a resolve failure cannot skip the native reply. Listener throws are already swallowed inside `emitLifecycle`, so that outer catch does not change isolation.

### Other hosts

- Production calls of `createCodexChatHostPorts(` are only in `apps/ptah-electron/src/di/codex-runtime-composition.ts`. The other call sites are rpc-handlers unit specs. VS Code (`apps/ptah-extension-vscode`) and the CLI do not build these ports, so they have nothing to bind in this batch. When either host grows a `createCodexChatHostPorts` composition, it needs the same `promptLifecycle.publish` → root `SdkPermissionHandler.publishPromptLifecycle` binding.

### Review limits

- Read-only. No test, lint, typecheck, build, nx, or diagnostics. `git diff -- libs/backend/agent-sdk apps/ptah-electron` only. Uncommitted `libs/backend/gateway-chat-bridge` edits were not reviewed as part of this diff; the bridge subscribe path was read to trace the listener.
- Skill: read `ptah-review-logic` command text and applied the task contract. No skill-runner tool was available. Ptah MCP `ptah_agent_report` is not in the connected tool catalog (only the `tasks` server is connected); native git diff, ripgrep, and file reads were the fallback.
