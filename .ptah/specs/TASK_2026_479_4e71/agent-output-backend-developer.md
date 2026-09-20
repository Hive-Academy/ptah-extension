# Agent Output: Backend Developer — TASK_2026_479_4e71

## 1. OWNERSHIP
**Verdict: (b) The `claude.EXE` subprocess that Ptah spawns, which reads `.mcp.json` itself.**

### Evidence
1. **The MCP Server Declaration**:
   `D:/projects/ptah-extension/.mcp.json:1-12`:
   ```json
   {
     "mcpServers": {
       "firecrawl": {
         "command": "npx",
         "args": ["-y", "firecrawl-mcp"]
       }
     }
   }
   ```
2. **Absence of Stdio MCP Client Spawner in Ptah**:
   Ptah contains no client-side runner that reads `.mcp.json` and executes `npx` or child stdio MCP processes.
   - The only stdio server code in Ptah is `libs/backend/vscode-lm-tools/src/lib/mcp-stdio/mcp-stdio-server.ts:31`, which is Ptah *serving* its own tool capabilities to external consumers over stdio, not consuming external servers.
3. **Execution Path via Claude Agent SDK**:
   - Ptah initializes an interactive or headless session in `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:910-985`, passing `options.cwd` to `@anthropic-ai/claude-agent-sdk`.
   - The Claude Agent SDK spawns `claude.exe`.
   - On startup, `claude.exe` inspects the working directory (`cwd`), automatically reads `.mcp.json`, and on Windows executes `cmd.exe /d /s /c "npx -y firecrawl-mcp"`, which in turn executes `node.exe`.
   - When a connection fails or exceeds the 30000ms `CONNECT_TIMEOUT`, `claude.exe` internally abandons the connection attempt without issuing a tree-kill or using Windows Job Object termination on the spawned `cmd.exe` / `node.exe` subtree.
   - Ptah only holds the process handle for `claude.exe`. The grandchildren (`cmd.exe` and `node.exe`) are detached and orphaned when `claude.exe` gives up on them.
4. **Conclusion**:
   Process-tree reaping of grandchildren spawned by `claude.exe` cannot be performed cleanly within Ptah's process hierarchy because Ptah neither spawns them nor receives their PIDs. Ptah's mitigation is back-off and server suppression to stop `claude.exe` from repeatedly launching failed servers.

---

## 2. WHAT YOUR CHANGE ACTUALLY DOES
Created `McpServerBackoffService` (`libs/backend/agent-sdk/src/lib/helpers/mcp-server-backoff.service.ts`):
- **Triggers**:
  1. Stderr stream monitoring: `checkStderrForFailure(data)` parses stderr from `claude.exe` matching patterns such as `([a-zA-Z0-9_-]+)\s*\((?:CONNECT_TIMEOUT|CONNECTION_FAILED|ECONNREFUSED|ENOTFOUND)\)` or `Failed to connect to MCP server "([a-zA-Z0-9_-]+)"`. When `firecrawl (CONNECT_TIMEOUT)` is observed, `recordFailure('firecrawl')` is recorded.
  2. Lifecycle callback events: Listens to `SessionMcpStatusCallbackRegistry.register()`; when an MCP event reports `status === 'failed'`, `recordFailure(serverKey)` is recorded.
- **Duration**:
  Exponential back-off starting at 1 minute (60,000 ms), doubling on each consecutive failure (2 min, 4 min, 8 min...) up to a capped maximum of 30 minutes (1,800,000 ms). While back-off is active, `isServerBackingOff(serverName)` returns `true`.
- **Reset**:
  - `recordSuccess(serverName)` immediately clears back-off state upon a successful connection (`status === 'connected'`).
  - Natural expiry: Once the duration elapses, the server is permitted to attempt connection again on the next session start.
- **Consultation & Call Site**:
  - `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`:
    - Lines 909–915: In `build()`, calls `this.mcpBackoffService?.getBackingOffServers() ?? []`.
    - Line 932: Passes `backingOffServers` into `buildFlagSettingsArg(sessionConfig, 'accept', this.logger, autoCompact, backingOffServers)`.
    - `buildFlagSettings` (lines 405–413) populates `disabledMcpjsonServers` and `deniedMcpServers` in the flag-tier settings.
    - Line 995: Invokes `this.mcpBackoffService?.checkStderrForFailure(data)` in the `stderr` callback.
  - When `disabledMcpjsonServers: ['firecrawl']` is passed to `claude.exe`, `claude.exe` skips spawning the server from `.mcp.json`, preventing both the 30-second hang and the creation of leaked child processes.

---

## 3. DOES IT KILL ANY PROCESS?
**No.** It does not kill any process.

**Explanation**:
As proven in Question 1, the `firecrawl` processes are grandchildren spawned directly by `claude.exe`, not by Ptah. Ptah does not have the PIDs of these grandchild processes. Killing them from within Ptah would require an unconstrained operating-system process scan (e.g., searching all system processes for command lines matching `firecrawl` and killing them), which violates system safety constraints and the instruction: *"No sweeping system processes on a timer"*. The root-cause process tree termination on connect timeout belongs upstream in `claude.exe` (using Windows Job Objects or `taskkill /pid ... /T /F`).

---

## 4. THE ~/.claude.json DUPLICATE-KEY DEFECT
**No. Ptah does not own `~/.claude.json`.**

**Evidence**:
- Ptah only reads `~/.claude.json` via `libs/backend/cli-agent-runtime/src/lib/mcp-directory/claude-user-mcp.reader.ts:28-115`. This is strictly a **read-only** discovery reader.
- There is no code in the entire Ptah repository that writes or mutates `~/.claude.json`.
- The duplicate drive-letter casing (`D:/projects/ptah-extension` vs `d:/projects/ptah-extension`) is written directly by the Anthropic `claude` CLI.
- Ptah's reader already handles drive-letter normalization defensively on read: `libs/backend/cli-agent-runtime/src/lib/mcp-directory/claude-user-mcp.reader.ts:133-145` applies `resolveProjectPath(targetPath)` which normalizes the drive letter to lowercase on `win32` / `darwin` and deduplicates server keys in a Map.

---

## CHANGED FILES
1. `libs/backend/agent-sdk/src/lib/helpers/mcp-server-backoff.service.ts` — Added back-off tracking service with exponential backoff (1m–30m), stderr error parsing, and status registry integration.
2. `libs/backend/agent-sdk/src/lib/di/tokens.ts` — Added DI token `SDK_MCP_SERVER_BACKOFF_SERVICE`.
3. `libs/backend/agent-sdk/src/lib/di/register.ts` — Registered singleton `SDK_MCP_SERVER_BACKOFF_SERVICE`.
4. `libs/backend/agent-sdk/src/index.ts` — Exported `McpServerBackoffService`.
5. `libs/backend/agent-sdk/src/lib/helpers/index.ts` — Exported `McpServerBackoffService`.
6. `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` — Injected back-off service; added `disabledMcpServers` to `buildFlagSettings` / `buildFlagSettingsArg`; suppressed backing-off servers in `build()`; wired `stderr` failure detection.
7. `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.output-style.spec.ts` — Updated wiring guard test to include `backingOffServers`.
8. `.ptah/specs/TASK_2026_479_4e71/task.md` — Updated `status: backlog` to `status: blocked`.

---

## RESIDUAL RISK
1. **Existing Leaked Processes Are Not Reaped**:
   Any orphaned `cmd.exe` / `node.exe` processes spawned prior to back-off suppression will remain running until terminated manually or on machine reboot.
2. **First-Connect 30s Timeout Still Occurs Once**:
   The first time an unreachable stdio MCP server is encountered, `claude.exe` will attempt connection, take 30 seconds to timeout, and orphan one child process tree before stderr emits the failure and Ptah places it into back-off.
3. **Upstream CLI Dependency**:
   True process tree lifecycle management on connection timeout requires `@anthropic-ai/claude-agent-sdk` / `claude.exe` to manage child processes using a Windows Job Object (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) or an explicit recursive kill (`taskkill /T /F`) upon `CONNECT_TIMEOUT`.
