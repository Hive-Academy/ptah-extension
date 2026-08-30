# TASK_2026_326 — Agent manager and host shutdown gaps

Source: regression review of TASK_2026_323 (B10/B11, commits b32551e9a, e049d59f8,
8f64cf668).

## Findings to fix

1. **ptah-cli never disposes agents or proxy leases on SIGINT/SIGTERM/exit.**
   `apps/ptah-cli/src/main.ts:61-82` calls only `disposeDiagnostics()`.
   Required: in the signal handler (before exit) and in the `exit` path, resolve
   `AgentProcessManager` and `PtahCliRegistry` if registered and call
   `disposeAll()` — agents FIRST, then proxies. Note `libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts`
   already has `shutdownAgentProcesses`; reuse it or route both through one helper.
   Spec: a fake container with both registered → signal handler calls both in order.

2. **VS Code `deactivate()` disposes proxies before agents.**
   `apps/ptah-extension-vscode/src/main.ts:125-144`. Required: agents first, then
   proxies, matching Electron `apps/ptah-electron/src/main.ts:355-388` and the comment.

3. **`ChatPtahCliService.handleStart` leaks the proxy lease on spawn failure.**
   `libs/backend/rpc-handlers/src/lib/chat/ptah-cli/chat-ptah-cli.service.ts:93-151`.
   `getProfile(agentId, leaseKey)` at line 94; the session entry is set at line 139
   after `ensureRegisteredForSubagents()` and `startChatSession()` which can throw.
   Required: try/catch around the two calls; on throw call `releaseProfile(leaseKey)`
   then rethrow. Spec: make `startChatSession` reject → `releaseProfile` called once.

4. **`killProcess` has no kill and a ref'd timer for handles without `getPid`.**
   `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:1540-1552`.
   The ptah-cli `SdkHandle` (`ptah-cli-registry.ts:777-801`) has no `getPid`.
   Required: (a) route the 500 ms wait through `this.unrefTimer(...)`; (b) add
   `getPid` to the ptah-cli handle if the underlying SDK exposes the child pid, else
   document in the handle why abort is sufficient and add a bounded `done` wait.
   Spec: a handle without `getPid` → no ref'd timer remains after `killProcess`.

5. **`sdkIdleReleaseMs` has no runtime floor.** `:1315-1324` `getSdkIdleReleaseMs()`.
   `package.json` declares `minimum: 10000`. Required: clamp to `>= 10000` in code,
   fall back to the default for non-number or `<= 0`. Spec for both.

6. **`readOutput().lineCount` describes the raw buffer, not the returned string.**
   `:663-689`. Required: compute `lineCount` from the string actually returned
   (after `parseOutput` and `tail`), and keep a separate `bufferedLineCount` if any
   consumer needs the old number (grep `lineCount` in libs/ and apps/ first).

## Constraints

- Do not touch `session-metadata-store.ts` or `agent-events.ts` (TASK_2026_324).
- Do not touch `ipc-bridge.ts` (TASK_2026_329).
- All timers through `unrefTimer`.

## Verify

```bash
npx nx run-many -t test -p @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers ptah-cli
npx nx run-many -t typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers ptah-cli ptah-extension-vscode ptah-electron
```
