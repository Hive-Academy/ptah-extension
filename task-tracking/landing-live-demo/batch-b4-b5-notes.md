# Batch B4+B5 Notes — Dev-only Electron Replay Recorder & Offline Scenario Sanitizer

## 1. Files Created and Modified

| File | Role |
| --- | --- |
| `apps/ptah-electron/esbuild.config.cjs` | Added `__PTAH_REPLAY_RECORDER__: isProd ? 'false' : 'true'` to `define` (`esbuild.config.cjs:71`) |
| `apps/ptah-electron/src/replay/replay-define.d.ts` | Global declaration for build-time constant `__PTAH_REPLAY_RECORDER__: boolean` |
| `apps/ptah-electron/src/replay/replay-recorder.ts` | `ReplayRecorder` class, `createReplayRecorderIfEnabled(deps)` 5-way gate factory, and `isValidReplayOutputPath(outPath)` validator |
| `apps/ptah-electron/src/ipc/ipc-bridge.ts` | Minimal tap hooks guarded by `if (__PTAH_REPLAY_RECORDER__ && this.recorder)` |
| `apps/ptah-electron/src/replay/scenario-sanitizer.ts` | Pure `sanitizeScenario(raw, options)` and `scanScenarioPrivacy(value)` mirroring B2's privacy rules without importing `scope:web` |
| `apps/ptah-electron/scripts/sanitize-replay-scenario.mjs` | Build-free CLI wrapper loading `scenario-sanitizer.ts` via `jiti` |
| `apps/ptah-electron/src/replay/replay-recorder.spec.ts` | Unit tests for all 5 gate conditions, raw capture format, `rpcCases`, `rpcErrors`, batch preservation, ordering, and `rpc:response` exclusion |
| `apps/ptah-electron/src/replay/scenario-sanitizer.spec.ts` | Unit tests with canary secrets/PII, allow-list enforcement, idempotency, determinism, and CLI execution |

## 2. Recorder Gate (`createReplayRecorderIfEnabled`)

Recording is enabled **only** when all 5 conditions hold simultaneously:

1. Build-time define `__PTAH_REPLAY_RECORDER__ === true` (`apps/ptah-electron/esbuild.config.cjs:71` defines `'false'` when `process.env.NODE_ENV === 'production'`, `'true'` otherwise).
2. `!app.isPackaged` (never runs in a packaged Electron build).
3. `process.env.NODE_ENV === 'development'`.
4. `process.env.PTAH_REPLAY_RECORD === '1'`.
5. `process.env.PTAH_REPLAY_RECORD_OUT` is an explicit **absolute** file path (`isValidReplayOutputPath`) that does **not** traverse `..` and does **not** contain any `dist` or `public` path segment.

Every tap site in `apps/ptah-electron/src/ipc/ipc-bridge.ts` is guarded by `if (__PTAH_REPLAY_RECORDER__ && this.recorder)` so production minification strips all tap branches.

## 3. Tap Points (`apps/ptah-electron/src/ipc/ipc-bridge.ts`)

- **Constructor initialization** (`apps/ptah-electron/src/ipc/ipc-bridge.ts:184-189`): initializes `this.recorder` via `createReplayRecorderIfEnabled()` when `__PTAH_REPLAY_RECORDER__` is true (or accepts an explicit `recorder` in tests) and registers a `will-quit` flush hook on `app`.
- **Ordinary host-to-renderer push** (`apps/ptah-electron/src/ipc/ipc-bridge.ts:231-234`): right after `win.webContents.send('to-renderer', message)` in `sendToRenderer()`, calls `this.recorder.recordPush(message)`.
- **Single and batched stream pushes** (`apps/ptah-electron/src/ipc/ipc-bridge.ts:349-362`): right after `win.webContents.send('to-renderer', ...)` in `flushStreamQueue()`, records either the single unwrapped stream event or the `{ type: 'batch', payload: { events } }` envelope in exact delivery order.
- **Accepted RPC request** (`apps/ptah-electron/src/ipc/ipc-bridge.ts:482-484`): after sender validation (`senderRole`) and display-window allowlist checks, calls `this.recorder.recordRpcCall(method, params, correlationId)` before `this.rpcHandler.handleMessage(...)`.
- **RPC response** (`apps/ptah-electron/src/ipc/ipc-bridge.ts:505-507`): after `this.flushStreamQueue()` and `event.sender.send('to-renderer', { type: MESSAGE_TYPES.RPC_RESPONSE, ... })`, calls `this.recorder.recordRpcResult(correlationId, response)` (storing into `rpc` / `rpcCases` / `rpcErrors`, never into `timeline`).
- **Shutdown / dispose flush** (`apps/ptah-electron/src/ipc/ipc-bridge.ts:809-811`): in `dispose()`, after `this.flushStreamQueue()`, calls `this.recorder.flush()`.

## 4. Formats

### Raw Capture Format (`RawReplayCapture`)

```jsonc
{
  "recordedAt": "2026-10-31T20:00:00.000Z",
  "timeBase": 1793476800000,
  "rpc": {
    "<method>": "<first/default response.data>"
  },
  "rpcCases": {
    // Populated ONLY when the same method returned different data for different params
    "<method>": [
      { "match": { /* request params */ }, "data": "<response.data>" }
    ]
  },
  "rpcErrors": {
    "<method>": { "error": "message", "errorCode": "OPTIONAL" }
  },
  "timeline": [
    // `at` = Math.round(performance.now() - startPerfNow), monotonic >= 0
    // Preserves `batch` envelopes; never contains `rpc:response`
    { "at": 120, "message": { "type": "chat:chunk", "payload": { } } }
  ]
}
```

### Sanitized Scenario Format (`SanitizedScenario`)

Matches `implementation-plan.md` ("Scenario format") and `libs/web/landing/src/lib/live-demo/scenario/replay-scenario.types.ts`:

```jsonc
{
  "id": "chat-tool-call",
  "title": "PtahCode chat and tool call",
  "timeBase": 1793476800000,
  "config": {
    "initialView": "chat",
    "workspaceRoot": "/workspace/acme-app",
    "workspaceName": "acme-app"
  },
  "rpc": { /* allow-listed & sanitized RPC responses */ },
  "rpcCases": { /* optional, omitted when empty */ },
  "rpcErrors": { /* optional, omitted when empty */ },
  "bootMessages": [ /* optional, preserved and sanitized when present */ ],
  "timeline": [
    { "at": 200, "message": { "type": "chat:chunk", "payload": { } } }
  ]
}
```

## 5. Sanitizer & Privacy Scan Rule Set

`apps/ptah-electron/src/replay/scenario-sanitizer.ts` mirrors B2's `libs/web/landing/src/lib/live-demo/scenario/privacy-scan.ts` without importing from `libs/web/landing` (`scope:web`) and reuses `isSecretFieldName()` / `redactSecrets()` from `apps/ptah-electron/src/services/diagnostics/log-redaction.ts`:

1. **RPC & Push Allow-Lists (Fail Closed)**:
   - Only methods in `DEFAULT_ALLOWED_RPC_METHODS` (verified subset of `RPC_METHOD_NAMES`, excluding key/token/credential setters and raw settings export) and push types in `DEFAULT_ALLOWED_PUSH_TYPES` (verified subset of `MESSAGE_TYPES`, excluding `rpc:response` and `rpc:call`) are permitted.
   - Unknown or disallowed entries are dropped and listed in `report.droppedRpcMethods` / `report.droppedPushTypes`, or throw in `--strict` mode.
2. **Workspace & Home Path Replacement**:
   - Replaces recorded workspace roots (`workspace:getInfo`, `config.workspaceRoot`, `options.workspacePaths`), Linux homes (`/home/<user>/...`), macOS homes (`/Users/<user>/...`), Windows homes (`C:\Users\<user>\...`), and any other absolute POSIX/Windows path (`/tmp/...`, `/var/...`, `/etc/...`, `C:\...`) with `/workspace/acme-app`.
   - Enforces canonical `workspace:getInfo` (`folders: ['/workspace/acme-app']`, `root: '/workspace/acme-app'`, `activeFolder: '/workspace/acme-app'`, `name: 'acme-app'`).
3. **PII, Email, Username, Hostname, IP & URL Credential Replacement**:
   - Emails (`/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi`) and email fields (`email`, `authorEmail`, `committerEmail`) -> `'demo@example.invalid'`.
   - Usernames extracted from home paths, `options.usernames`, and username fields (`username`, `userName`, `accountName`, `accountLabel`, `authorName`, `committerName`, `osUsername`) -> `'demo-user'`.
   - URLs (`/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi`): strips `username`/`password` credentials and rewrites any non-`ptah.live` / `*.ptah.live` host to `https://ptah.live`.
   - Hostnames (`/\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|dev|live|app|co|ai|xyz|edu|gov)\b/gi`) and host fields (`hostname`, `host`) outside `ptah.live` / `*.ptah.live` -> `'ptah.live'`.
   - IPv4 (`/\b(?:\d{1,3}\.){3}\d{1,3}\b/g`) and IPv6 (`/(?:^|[\s[(/])(?=[a-f\d:]*:[a-f\d:]*:)(?:[a-f\d]{0,4}:){2,}[a-f\d]{0,4}(?=$|[\s\]/),])/gi`) -> `'ptah.live'`.
4. **Secret-Shaped Field & String Redaction**:
   - Field keys matching `isSecretFieldName(key)` (`log-redaction.ts`), `/(?:^|[_-])(api[_-]?key|token|secret|password|authorization|cookie)(?:$|[_-])/i`, or `/(?:apiKey|Token|Secret|Password|Authorization|Cookie)$/` are omitted from the output object and recorded in `report.redactedFields`, except safe boolean flags (`hasApiKey`, `hasOpenRouterKey`, `hasAnyProviderKey`) which are forced to `false`.
   - String values pass through `redactSecrets(text)` (`log-redaction.ts`) plus explicit redaction for:
     - Bearer / Basic tokens (`/\b(?:Bearer|Basic)\s+\S+/gi`)
     - JWTs (`/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g`)
     - Anthropic keys (`/\bsk-ant-[A-Za-z0-9_-]{8,}/g`)
     - OpenAI / `sk-` / `pk-` / `rk-` keys (`/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g`)
     - GitHub tokens (`/\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{8,}/g`)
     - AWS access key IDs (`/\b(?:AKIA|ASIA)[A-Z0-9]{8,}/g`)
     - Slack tokens (`/\bxox[baprs]-[A-Za-z0-9_-]{8,}/g`)
     - PEM blocks (`/-----BEGIN [A-Z0-9 ]*-----[\s\S]*?-----END [A-Z0-9 ]*-----/g` and `/-----BEGIN [A-Z ]*(?:PRIVATE KEY|CERTIFICATE)-----/g`)
     - Cookie headers (`/\b(?:Set-Cookie|Cookie)\s*[:=]\s*[^\r\n;"']+/gi`)
     - Long base64 strings (`/(?:[A-Za-z0-9+/]{201,}={0,2}|[A-Za-z0-9_-]{201,})/g`)
5. **Tool Results, Diffs, File Contents & CLI Output Replacement**:
   - Unless associated with a file path listed in `options.allowFiles` (`--allow-file`), `tool_result` outputs are replaced with `'[sanitized tool output]'`, file content fields (`file:read`, `file:viewContent`, `git:showFile`, `tool_start.toolInput.content`, etc.) with `'[sanitized file content]'`, diff/patch fields (`git:diffFile`, `git:reviewFile`, `diff`, `patch`, etc.) with `'[sanitized diff]'`, and CLI outputs (`agent-monitor:output`, `session:cli-output-page`) with `'[sanitized cli output]'`.
6. **Timestamp Normalization**:
   - Shifts epoch millisecond timestamps onto `DEFAULT_SCENARIO_TIME_BASE` (`1793476800000`) while keeping relative offsets clamped to `[0, 86_400_000]`. Shifts ISO-8601 timestamps by `targetTimeBase - sourceTimeBase`.
7. **Deterministic UUID v4 Remapping**:
   - Consistently remaps every UUID in first-seen traversal order to deterministic fake UUID v4 values (`11111111-1111-4111-8111-111111111111` .. `99999999-9999-4999-8999-999999999999`, then `00000000-0000-4000-8000-00000000000a` ...). Also maps any non-UUID `tabId`/`sessionId` field (except the runtime's `$activeTabId` token on `chat:chunk`) to a deterministic UUID v4.
8. **Final Privacy Scan Assertion**:
   - Runs `scanScenarioPrivacy(scenario)` (mirroring B2's `scanScenarioPrivacy`) and throws if any finding remains.

## 6. How to Record and Sanitize a Scenario (Developer Commands — Do Not Run in CI)

```bash
# 1. Record a raw session in development Electron (outside dist/ and public/):
NODE_ENV=development \
PTAH_REPLAY_RECORD=1 \
PTAH_REPLAY_RECORD_OUT=/tmp/ptah-replay-raw.json \
npx nx run ptah-electron:serve

# 2. Sanitize the raw capture offline into a publishable scenario JSON:
node apps/ptah-electron/scripts/sanitize-replay-scenario.mjs \
  --in /tmp/ptah-replay-raw.json \
  --out libs/web/landing/src/lib/live-demo/scenarios/chat-tool-call.json \
  --id chat-tool-call \
  --title "PtahCode chat and tool call" \
  --allow-file src/main.ts \
  --strict
```

## 7. Verification Results

- CLI smoke check (`node apps/ptah-electron/scripts/sanitize-replay-scenario.mjs --in libs/web/landing/src/lib/live-demo/scenarios/chat-tool-call.json --out /tmp/ptah-b5-sample-check.json --id chat-tool-call --title "PtahCode chat and tool call" --allow-file src/main.ts --strict`): passed (`exit 0`).
- `npm run verify -- -p ptah-electron`: passed (`exit 0`, 9/9 targets succeeded: `lint`, `test`, `typecheck` and 6 dependent worker/main build targets; 80/81 test suites passed, 1 skipped, 1428 tests passed).
