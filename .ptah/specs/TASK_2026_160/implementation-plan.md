# Implementation Plan — TASK_2026_160: opencode + PI CLI adapters

Derived from `research-opencode.md` and `research-pi.md`. Both adapters are
**spawn + JSONL** (no new npm dependency), following the `AntigravityCliAdapter`
template with Codex-grade structured `CliOutputSegment` mapping.

## Batch 1 — Shared types (foundation)

**File**: `libs/shared/src/lib/types/agent-process.types.ts`

- Extend `CliType` union: add `'opencode'` and `'pi'`.

**File**: `libs/shared/src/lib/types/rpc/rpc-agents.types.ts`

- Add the two new CLIs anywhere `CliType` is enumerated for RPC (verify — likely
  no change if it just references `CliType`; check for hardcoded literal unions).

## Batch 2 — opencode adapter

**New**: `cli-adapters/opencode-cli.adapter.ts` → `OpencodeCliAdapter`

- `name='opencode'`, `displayName='opencode'`, `supportsMcp=true`, `supportsSteer()=false`.
- `detect()`: `resolveCliPath('opencode')` + `probeCliVersion`.
- `runSdk()`: `opencode run --format json [--auto] [--model <m>] --dir <cwd> [--session <id>] "<buildTaskPrompt>"`.
  Line-buffer stdout, `JSON.parse` per line in try/catch, map:
  - `text` → `text`; `tool_use` → `tool-call`+`tool-result` (bash → `command` w/ exitCode);
    `error` → `error`; `step_finish(stop)` → optional `info` usage; unknown → `info`.
  - Capture `sessionID` from first parseable event.
- `listModels()`: spawn `opencode models`, parse defensively (verify line format at impl).
- `ensureTokensFresh()`: `~/.local/share/opencode/auth.json` → win32 `%APPDATA%\opencode\auth.json` → provider env-key fallback.
- MCP: `configureMcpServer(port)`/`cleanupMcpEntry()` against `<cwd>/opencode.json` `mcp.ptah = {type:'remote',url,enabled:true}` (read-merge-write like Antigravity).
- Windows: try `resolveCliPath` first; if `.ps1` bug reproduces, add Codex-style `resolveOpencodeNativeBinary()` walking `opencode-windows-x64/bin/opencode.exe`. (Guard behind empirical check; ship the straightforward path first.)

**New**: `opencode-cli.adapter.spec.ts` (mirror `antigravity-cli.adapter.spec.ts`).

## Batch 3 — PI adapter

**New**: `cli-adapters/pi-cli.adapter.ts` → `PiCliAdapter`

- `name='pi'`, `displayName='Pi'`, `supportsMcp=false`, `supportsSteer()=false`.
- `detect()`: `resolveCliPath('pi')` + `probeCliVersion`.
- `runSdk()`: `pi --mode json -a [--model <m>] [--thinking <effort>] [--session <id>] "<buildTaskPrompt>"`.
  First stdout line = session header → `getSessionId()`. Map:
  - `message_update` text_delta → `text`; thinking_delta → `thinking` (verify variant);
    `tool_execution_start` → `tool-call`; `tool_execution_end` (isError?) → `tool-result`/`tool-result-error`;
    stderr/nonzero exit → `error`.
  - Ignore `options.mcpPort` (unsupported). `autoApprove` is a no-op (no gate).
- `listModels()`: spawn `pi --list-models`, parse defensively.
- `ensureTokensFresh()`: `~/.pi/agent/auth.json` presence + env-key fallback.

**New**: `pi-cli.adapter.spec.ts` (mirror antigravity spec).

## Batch 4 — Wiring

**File**: `cli-adapters/index.ts` — export `OpencodeCliAdapter`, `PiCliAdapter`.
**File**: `cli-detection.service.ts`

- `this.adapters.set('opencode', new OpencodeCliAdapter())`
- `this.adapters.set('pi', new PiCliAdapter())`
- update init log line; add `'opencode'` to `refreshCliTokens()` loop (pi optional).
  **Files**: `apps/ptah-extension-vscode/.../agent-rpc.handlers.ts` &
  `apps/ptah-electron/.../agent-rpc.handlers.ts` — add the two CLIs wherever the
  existing list enumerates known CLIs (display metadata / iteration). Verify what
  the current uncommitted antigravity change touched and mirror it.

## Batch 5 — Verify

- `nx test cli-agent-runtime` (new specs) + affected shared tests.
- `npm run typecheck:all` (or `nx affected -t typecheck`).

## Known limitations (surface in PR)

- PI: no tool-approval gate (`autoApprove:false` unsupported); no MCP bridging.
- opencode: Windows `.ps1` wrapper risk — verify on a real Windows box; native-binary fallback ready.
