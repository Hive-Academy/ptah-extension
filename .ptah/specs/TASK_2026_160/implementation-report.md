# Implementation Report — TASK_2026_160: opencode + PI CLI adapters

Integrated **opencode** and **Pi** as new spawn-based CLI agent providers,
mirroring the existing Codex/Cursor/Antigravity adapters. Both are spawn +
structured-JSONL (no new npm dependency).

## Verification

- `npx nx test cli-agent-runtime` → **27 suites / 386 tests passed** (includes the
  two new specs).
- `npx nx run-many -t typecheck -p shared cli-agent-runtime cli-engine ptah-extension-vscode ptah-electron`
  → **clean across all 5 projects**.
- `npx nx lint cli-agent-runtime` → **0 errors** (26 pre-existing warnings, all in
  other/existing files; the two new adapters and specs are warning-free).

## Files created

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts`
  — `OpencodeCliAdapter` (`name='opencode'`, `displayName='opencode'`,
  `supportsMcp=true`, `supportsSteer()=false`). `opencode run --format json
[--auto] [--model] --dir <cwd> [--session] "<prompt>"`; line-buffered JSONL
  parse; segment mapping (`text` w/ per-part.id delta dedup, `tool_use` →
  `command` for bash / `tool-call`+`tool-result` otherwise, `step_finish` stop →
  `info` usage, `error` → `error`, unknown → `info`, `step_start` skipped);
  `sessionID` captured from the first parseable event; `listModels()` via
  `opencode models`; `ensureTokensFresh()` (`~/.local/share/opencode/auth.json` →
  `%APPDATA%\opencode\auth.json` on win32 → provider env-key fallback); MCP
  configure/cleanup against `<cwd>/opencode.json` `mcp.ptah`
  (`{type:'remote',url,enabled:true}`); Codex-style `resolveOpencodeNativeBinary()`
  Windows fallback (guarded: only when no explicit binaryPath and a bundled
  `opencode-windows-x64/bin/opencode.exe` exists).
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/pi-cli.adapter.ts`
  — `PiCliAdapter` (`name='pi'`, `displayName='Pi'`, `supportsMcp=false`,
  `supportsSteer()=false`). `pi --mode json -a [--model] [--thinking <effort>]
[--session] "<prompt>"`; first line = session header → `getSessionId()`;
  segment mapping (`message_update` text_delta → `text`, thinking_delta →
  `thinking`; `tool_execution_start` → `tool-call`; `tool_execution_end` →
  `tool-result`/`tool-result-error`); `mcpPort` ignored; `autoApprove` no-op with
  an in-code comment (Pi has no approval gate); `listModels()` via
  `pi --list-models`; `ensureTokensFresh()` (`~/.pi/agent/auth.json` presence +
  env-key fallback).
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.spec.ts`
  — detect, listModels, argv construction, JSONL→segment mapping (text/delta-dedup/
  bash-command/generic-tool/step_finish/error/non-JSON), session capture, exit
  codes, abort, and MCP config read-merge-write.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/pi-cli.adapter.spec.ts`
  — detect, listModels, argv (incl. autoApprove no-op + mcpPort ignored),
  session-header capture, event→segment mapping, `ensureTokensFresh` paths, exit
  codes, abort.

## Files modified

- `libs/shared/src/lib/types/agent-process.types.ts` — added `'opencode'` and
  `'pi'` to the `CliType` union.
- `libs/shared/src/lib/types/rpc/rpc-agents.types.ts` — added `opencodeModel` /
  `piModel` to `AgentOrchestrationConfig` and `AgentSetConfigParams`; added
  `opencode` / `pi` to `AgentListCliModelsResult`.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/index.ts` —
  barrel-export both new classes.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts` —
  imported + registered both adapters, updated the init log line, and added
  `'opencode'` + `'pi'` to the `refreshCliTokens()` loop (both have meaningful
  auth checks).
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`
  — added `opencode: 'opencodeModel'` and `pi: 'piModel'` to `MODEL_CONFIG_KEYS`
  so configured models actually flow through to spawns.
- `apps/ptah-extension-vscode/src/services/rpc/handlers/agent-rpc.handlers.ts` —
  mirrored the antigravity shape: `opencodeModel`/`piModel` in getConfig +
  setConfig, and `opencode`/`pi` in `agent:listCliModels` (result + debug log).
- `apps/ptah-electron/src/services/rpc/handlers/agent-rpc.handlers.ts` — same
  mirroring as the VS Code handler.

## Deviations / notes beyond the plan

- **`cli-engine` handler also updated** (not named in the plan's wiring list):
  `libs/backend/cli-engine/src/lib/rpc/cli-agent-rpc.handlers.ts` constructs the
  same `AgentListCliModelsResult` (a third copy of the antigravity shape). Because
  the new fields are required on that interface, this file had to be updated in
  lockstep or `typecheck:all` would fail. Applied the identical mirroring.
- **`MODEL_CONFIG_KEYS` wiring added** (beyond the plan's explicit steps) so the
  new `opencodeModel`/`piModel` settings are honoured at spawn time — matches how
  Antigravity's model config flows.
- **PI reasoning effort not wired into the shared UI reasoning setting.** The
  adapter accepts `options.reasoningEffort` → `--thinking`, but
  `AgentProcessManager.resolveReasoningEffort()` still only drives codex/copilot
  (left unchanged to stay in scope). PI honours an explicitly-passed
  `reasoningEffort` but does not yet pick up a UI-driven effort. Low-risk,
  follow-up if desired.
- **Frontend settings UI not touched** (out of scope). `opencodeModel`/`piModel`
  are optional config fields, so the Angular
  `agent-orchestration-config.component.ts` still compiles; adding UI selectors is
  a separate follow-up.
- **Windows empirical checks still pending** (as the research flagged): the
  opencode `.ps1`-vs-`.cmd` wrapper behaviour and native-binary fallback, and PI's
  bash-shell dependency, were implemented defensively but not verified on a live
  Windows opencode/pi install (neither binary is installed in this environment).
- **opencode skill-sync intentionally not added** — `CliTarget`
  (`cli-skill-sync.types.ts`) remains `copilot|codex|cursor|antigravity`; skill
  installation for opencode is out of scope for this task.

## Frontend completion

Added opencode + Pi model selectors to `libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts`, mirroring the existing antigravity pattern:

- Added `opencodeModels` and `piModels` signals (`signal<CliModelOption[]>([])`) next to `antigravityModels`.
- In `loadCliModels()`, added `this.opencodeModels.set(result.data.opencode)` and `this.piModels.set(result.data.pi)`.
- Widened the `cli` param union in both `onModelSelect(...)` and `setAgentModel(...)` to include `'opencode' | 'pi'`.
- Extended the `setAgentModel` key ternary with `cli === 'opencode' ? 'opencodeModel'` and `cli === 'pi' ? 'piModel'` branches.
- Added two template `@if` selector blocks after the antigravity block:
  - `@if (cli.cli === 'opencode')` — Model select bound to `agentConfig()?.opencodeModel`, `(change)="onModelSelect('opencode', $event)"`, with a helper note that model ids use `provider/model` format (e.g. `anthropic/claude-sonnet-4-5`) and a "Full auto — opencode runs headless with `--auto`" permissions hint.
  - `@if (cli.cli === 'pi')` — Model select bound to `agentConfig()?.piModel`, `(change)="onModelSelect('pi', $event)"`, with a permissions hint stating Pi has no approval gate and no MCP support (always runs tools with full process permissions).
- Updated the headless-agents descriptor `<p>` to also list "opencode, Pi".

Typecheck: `npx nx typecheck chat` reports only the two PRE-EXISTING, unrelated monaco-loader errors (`libs/frontend/editor/src/lib/services/monaco-loader.service.ts:79-80`). No new errors introduced by these changes.

## PI RPC upgrade

Upgraded the Pi CLI adapter from one-shot `--mode json` to a persistent-during-run `--mode rpc` subprocess with a JSON-RPC-over-stdin channel, delivering mid-run **steering** and **continuation**. Deliberately NOT the in-process `@earendil-works/pi-coding-agent` SDK (in-process agent SDKs fail to load under Node/Electron ESM — see `copilot-sdk.adapter.ts:5-13`).

### Files changed

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts`
  - Added the additive, optional `readonly steer?: (message: string) => void` member to `SdkHandle`. Other adapters simply don't implement it (no breakage).
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`
  - `steer()` (now ~line 683): after the `adapter?.supportsSteer()` guard and before the `!tracked.process` throw, added the `tracked.sdkHandle?.steer` branch — routes SDK-based steering to the handle, returns early. Legacy `tracked.process.stdin` path preserved as the fallback.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/pi-cli.adapter.ts`
  - Rewrote `runSdk()` to RPC mode mirroring `copilot-sdk.adapter.ts`: emitOutput/emitSegment machinery, a mutable `activeChild`, and a `runTurn(message, resumeSessionId?)` closure. Spawns `pi --mode rpc -a [--model] [--thinking] [--session]`, keeps stdin open (no `stdin.end()`), writes the initial `{"type":"prompt","message,id:"p1"}` then `{"type":"get_state","id":"s0"}`.
  - Session id captured from the `session` header line AND the `get_state` response (`data.sessionId`); `sessionFile` also captured for a documented `switch_session` fallback.
  - Turn resolves on the RPC-only **`agent_settled`** event (NOT `agent_end`; `agent_end.willRetry` is ignored). On settle/abort/fatal-error the child is torn down best-effort (`{"type":"abort"}` write then `child.kill('SIGTERM')`) so no persistent process leaks past `agent_settled` — the manager's `stop()` won't kill a non-running agent.
  - Handle exposes `steer` (writes `{"type":"steer","message}` to the live `activeChild.stdin` only when writable — never a bare `prompt` mid-run), `getSessionId`, `supportsContinuation` (true once a session id is captured), and `continue` (re-spawns via `runTurn(message, capturedSessionId)`, re-pointing `activeChild` so steering works on the continued turn).
  - `detect()`/`supportsSteer()` now report `supportsSteer: true`. `supportsMcp=false`, `mcpPort` ignored, `autoApprove` no-op — all unchanged limitations, comments retained.
  - Reused the existing event→segment mapping (message_update text_delta/thinking_delta, tool_execution_start/end, stderr) verbatim; added `response`, `agent_settled`, `agent_end`, and a defensive `error`-event case.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/pi-cli.adapter.spec.ts`
  - Rewrote for RPC mode: fake child now has a writable stdin (`{ writable: true, write, end }`). New coverage: `--mode rpc` arg construction (no positional prompt); initial `prompt` + `get_state` written to stdin with stdin left open; session id capture from both the header and the `get_state` response; `agent_settled` resolves `done` and kills the child (with the best-effort `abort` envelope); `agent_end{willRetry}` does NOT settle; `steer()` writes a `steer` envelope; `continue()` re-spawns with `--session` and re-points steering to the new child; abort writes an `abort` envelope + kills. Retained detect/listModels/ensureTokensFresh/parseOutput coverage.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts`
  - Added a case under `steer() on SDK agent`: when the adapter reports `supportsSteer()` true and the handle exposes `steer`, `manager.steer()` routes to `sdkHandle.steer(instruction)` instead of throwing.

### Deviations / unverified assumptions

- **No live `pi` in this environment** (same defensive posture as the antigravity adapter). The following are documented-from-protocol but not empirically verified:
  - That `--mode rpc` honours the `--model` / `--thinking` / `--session` CLI flags (documented in Pi's flag table for interactive/json modes). If `--session` is not honoured in rpc mode, continuation must instead send `{"type":"switch_session","sessionFile":<path>}` after spawn — the captured `sessionFile` is retained for exactly that fallback. Both the header doc-comment and the `--session` arg carry an `UNVERIFIED` note.
  - Passing model/thinking as spawn flags rather than via the `set_model` / `set_thinking_level` RPC requests (chosen per the plan's "spawn flags" instruction; the request-based alternative remains available if the flags prove unsupported).
- Kept `-a` (project-local `.pi/` config trust) in rpc mode for parity with the json-mode adapter; harmless if unrecognized, preserves repo-level Pi skill respect.
- Resolve semantics: `agent_settled` resolves the turn with exit code `0`; an unexpected process `close` before settle resolves with the child's exit code (error segment emitted for non-zero, non-aborted exits); `child.on('error')` resolves `1`.

### Verification

- `npx nx test cli-agent-runtime` — 392/392 pass (the pi spec + the manager steer-routing case). One flaky, pre-existing failure in the already-modified `cli-skill-sync/workspace-skill-installer.spec.ts` appeared on one run and passed on re-run; it is unrelated to this change (no PI/steer surface).
- `npx nx run-many -t typecheck -p shared cli-agent-runtime cli-engine ptah-extension-vscode ptah-electron` — clean across all 5 projects.

## PI reasoning-effort parity

Added a **Reasoning Effort** setting for the Pi CLI agent, mirroring
`codexReasoningEffort` / `copilotReasoningEffort` end-to-end. The Pi RPC adapter
already forwarded `options.reasoningEffort` → `--thinking <effort>`; this wiring
makes the UI setting reach it. Pi's `--thinking` scale
(`off|minimal|low|medium|high|xhigh|max`) is passed through raw — no `max`→`xhigh`
coercion — since Pi supports the full scale. opencode was intentionally left
model-only (no effort concept), consistent with Cursor/Antigravity.

### Files changed

- `libs/shared/src/lib/types/rpc/rpc-agents.types.ts` — added `piReasoningEffort?: string` to `AgentOrchestrationConfig` (with `--thinking` scale doc comment) and to `AgentSetConfigParams`.
- `apps/ptah-extension-vscode/src/services/rpc/handlers/agent-rpc.handlers.ts` — getConfig builds `piReasoningEffort` via `getCfg`; setConfig persists `params.piReasoningEffort`.
- `apps/ptah-electron/src/services/rpc/handlers/agent-rpc.handlers.ts` — getConfig builds `piReasoningEffort` via `getAgentCfg`; setConfig persists it via `setAgentCfg`.
- `libs/backend/cli-engine/src/lib/rpc/cli-agent-rpc.handlers.ts` — getConfig builds `piReasoningEffort` via `getAgentCfg`; setConfig persists it via `setAgentCfg`.
- `libs/backend/platform-core/src/file-settings-keys.ts` — registered `agentOrchestration.piReasoningEffort` in `FILE_BASED_SETTINGS_KEYS` and added default `''` to `FILE_BASED_SETTINGS_DEFAULTS`.
- `libs/backend/agent-sdk/src/lib/types/settings-export.types.ts` — added `agentOrchestration.piReasoningEffort` to `KNOWN_CONFIG_KEYS` (settings export/sync).
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts` — added a `pi` branch to `resolveReasoningEffort()` reading `piReasoningEffort` config and returning it raw into `CliCommandOptions.reasoningEffort`.
- `libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts` — added a "Reasoning Effort" `<select>` in the `@if (cli.cli === 'pi')` block (reusing `reasoningEffortOptions`, `[selected]` on `piReasoningEffort`, `(change)="onReasoningEffortSelect('pi', $event)"`); widened `onReasoningEffortSelect` to accept `'pi'` and map it to `piReasoningEffort`.

Intentionally NOT touched: the one-shot `migrateAgentOrchestrationSettings` KEYS_TO_MIGRATE lists (electron + cli-engine) — Pi is a brand-new setting with no legacy IStateStorage value to migrate.

### Verification

- `npx nx run-many -t typecheck -p shared cli-agent-runtime cli-engine ptah-extension-vscode ptah-electron chat` — clean across all 6 projects (the previously-noted monaco-loader error did not surface).
- `npx nx test cli-agent-runtime` — 392/392 pass.

## Review fixes applied

Two reviewers (`code-logic-review.md`, `code-style-review.md`) flagged the opencode+PI integration. The following fixes A–D were applied; item E is deferred (see below).

### A. BLOCKING — registered the 3 per-CLI model keys (both reviewers' #1)

`antigravityModel`/`opencodeModel`/`piModel` were wired through the RPC handlers + UI but never registered as file-based/export keys, so on VS Code the write fell through to `vscode.workspace.getConfiguration('ptah').update(...)` on an unregistered key and threw (and diverged storage on Electron/CLI). Mirrored exactly how `cursorModel`/`piReasoningEffort` are registered:

- `libs/backend/platform-core/src/file-settings-keys.ts` — added `'agentOrchestration.antigravityModel'`, `'agentOrchestration.opencodeModel'`, `'agentOrchestration.piModel'` to `FILE_BASED_SETTINGS_KEYS`, and `''` defaults for each to `FILE_BASED_SETTINGS_DEFAULTS`.
- `libs/backend/agent-sdk/src/lib/types/settings-export.types.ts` — added the same three keys to `KNOWN_CONFIG_KEYS`.

### B. SHOULD — PI steer late-write crash safety (logic Serious Issue 2)

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/pi-cli.adapter.ts` — after spawn in `runTurn()` (next to the `stdout`/`stderr` `setEncoding` calls), attached a defensive no-op `child.stdin?.on('error', () => {})` so an async EPIPE/`ERR_STREAM_DESTROYED` on a write into a dying child cannot crash the host process via an unhandled stream `'error'` event.
- Same file — inside `finish()`, after `killChild(child)`, set `activeChild = undefined` (with an explanatory comment) so a late `steer()` (guarded on `if (activeChild)`) is a guaranteed no-op rather than writing to a just-killed child. Verified `onAbort` (reading undefined `activeChild` is a safe no-op) and `continue()` (its `runTurn` re-assigns `activeChild` on re-spawn) still behave.

### C. SHOULD — PI reasoning-effort UI can now express off/max (both reviewers)

- `libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts` — added a Pi-specific `piReasoningEffortOptions` array (`'' | off | minimal | low | medium | high | xhigh | max`) rather than extending the shared `reasoningEffortOptions` (which Codex/Copilot rely on and whose `mapEffortToCli` only handles minimal..xhigh), and switched the Pi reasoning-effort `<select>` `@for` to iterate `piReasoningEffortOptions`. The backend passes the value through raw to `--thinking`, so `off`/`max` flow through unmodified.

### D. CHEAP — test coverage (style Serious Issue 3)

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts` — added table-driven cases to the reasoning-effort describe block asserting `resolveReasoningEffort('pi')` returns the configured `piReasoningEffort` value RAW (`max`/`off`/`high`, no `max→xhigh` coercion, and un-influenced by the Codex/Copilot UI driver), plus an "undefined when unset" case; and a new `model resolution` describe block asserting `pi`/`opencode`/`antigravity` model resolution reads `piModel`/`opencodeModel`/`antigravityModel` via `MODEL_CONFIG_KEYS`.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/pi-cli.adapter.spec.ts` — added an `on: jest.fn()` member to the fake child's `stdin` mock (a real Writable stream has `.on`) so the new defensive stdin error listener from fix B is exercised without the mock throwing.

### Verification (review fixes)

- `npx nx run-many -t typecheck -p shared cli-agent-runtime cli-engine ptah-extension-vscode ptah-electron chat platform-core agent-sdk` — clean across all 8 projects (only a pre-existing NG8102 warning in `confirmation-dialog.component.ts`, unrelated to these changes; the known `editor/monaco-loader.service.ts` error did not surface).
- `npx nx test cli-agent-runtime` — 399/399 pass (392 prior + 7 new).

## Deferred follow-ups

The following item E was explicitly NOT implemented and is restated here verbatim for tracking:

- opencode `opencode.json` MCP read-merge-write races across concurrent same-directory agents (Tribunal FORGE/multi-tile) — needs ref-count/coordination (logic Issue 3).
- opencode Windows `resolveOpencodeNativeBinary()` fallback is unreachable because the manager always sets `options.binaryPath` (logic Issue 4) — needs empirical Windows verification before changing the gate.
- PI `killChild()` uses bare `child.kill('SIGTERM')`, not a process-tree kill — orphaned bash children possible (logic Issue 5; matches existing antigravity/opencode pattern).
- Extract a shared `createBufferedEmitter<T>()` into `cli-adapter.utils.ts` (6x duplicated emit/subscribe boilerplate) (style Serious Issue 2).
- Frontend nits: install-help box roster stale; `onReasoningEffortSelect`/`setAgentModel` nested ternaries → a `Record` lookup (style Minor 3).
