# Implementation Plan - TASK_2026_617 (Grok CLI lane over a vendor-neutral ACP layer)

Status: DESIGN ONLY. Nothing here is approved until the user answers "Decisions for the user".

Scope, after the user's scope change (2026-10-06, relayed by the coordinator):

- **In:** a vendor-neutral ACP (Agent Client Protocol) client layer built on `@agentclientprotocol/sdk`, a Grok
  vendor profile, a `GrokCliAdapter`, and the registration needed to make `grok` a system CLI lane.
- **Out:** every opencode change. opencode stays on its `opencode run` transport (PR #658, branch
  `fix/task-591-opencode-messaging`). The TASK_2026_591 `opencode serve` Phase 2 plan is **not** replaced by this
  task, and its User Decisions stay with TASK_2026_591. Follow-up only: *opencode on ACP = one new vendor profile
  against this layer, gated on a probe that `opencode acp` honours `session/new.mcpServers`.*
- Keep the set of changed files small. The only files outside `cli-adapters/acp/` and the Grok adapter are the
  registration and settings sites that stop compiling once `'grok'` joins `SYSTEM_CLI_TYPES`.

Line references below are to the worktree `D:\projects\ptah-extension\.claude-worktrees\task-591-opencode-messaging`.
It is `origin/main` (`dd8ead802`) merged with PR #658 (`139970be6`). Every file this plan touches is identical on
`main`, except the opencode adapter, which this plan does not touch. Absolute paths in the file lists are written
against `D:\projects\ptah-extension\`; implement them in the task worktree
`D:\projects\ptah-extension\.claude-worktrees\task-617-grok-acp\` (branch `feat/task-617-grok-acp`) at the same
relative paths.

## Inputs and constraints

- Requirements used: `context.md`, `task.md`, `grok-probe.md`, `acp-landscape.md`, `acp-local-probe.md`,
  `acp-shared-client-analysis.md` (all in `D:\projects\ptah-extension\.claude-worktrees\task-617-grok-acp\.ptah\specs\TASK_2026_617_e5d4\`);
  `TASK_2026_591_fff5\implementation-plan.md` and `context.md`, read for precedent only.
- User decisions honoured, and not reopened:
  - adopt `@agentclientprotocol/sdk`;
  - two layers: a neutral runner plus per-vendor profiles;
  - Grok starts with `interrupt: false`;
  - messaging is continuation through a further `session/prompt` on the live session;
  - permissions use the narrowest rule that matches auto-approve, with a fallback.
- Corrections applied:
  1. The prompt describes the app builds as "CJS esbuild bundles". They are not. All three hosts bundle as **ESM**:
     `format: ["esm"]` and `main.mjs` in `apps/ptah-extension-vscode/project.json:23-26`,
     `apps/ptah-electron/project.json:27-31` and `apps/ptah-cli/project.json:28-32`. Only the library's own
     standalone `build` target is CJS (`libs/backend/cli-agent-runtime/project.json` `"format": ["cjs"]`); the
     apps bundle the library from source. The one CJS consumer that matters is **Jest** (`tsconfig.spec.json` uses
     `"module": "commonjs"`). Decision 1 covers it.
  2. `acp-shared-client-analysis.md` §2 recommended an in-house client. That recommendation is superseded by the
     user's SDK decision.
- Design handoff used: none (no UI).
- Missing decision-critical input:
  - Whether Grok's `search_tool`/`use_tool` indirection works with the full Ptah MCP server. This decides whether
    the lane can call `ptah_agent_report`. It is resolved by probe P1 (Batch 0).
  - Grok behaviour without `--always-approve` across every tool type. This decides the permission policy. It is
    resolved by probe P2.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| `SdkHandle` has: `abort`, per-turn `done`, `onOutput`/`onSegment`, `getSessionId`, `onSessionResolved`, `supportsContinuation`/`continue`, `steer`, `interrupt`/`supportsInterrupt`, `getPid` | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts:97-147` | No contract change is needed. ACP fills a subset of it. |
| `AgentMessagingCapabilities {steer, interrupt, continuation}`; `bestMessagingCapability` picks steer > interrupt > continuation | `cli-adapter.interface.ts:155-182` | Grok declares `{false, false, true}`, which yields `messagingMode: 'queue'`. |
| `CliAdapter` requires `capabilities()` and `roleChannel` (a compile error if either is missing) | `cli-adapter.interface.ts:188-247` | `GrokCliAdapter` implements the full interface. |
| Router: a running turn with `steer` gets `handle.steer`; with `interrupt` it gets `interruptAndResume`; with `continuation` it is parked if running, else a new turn starts | `cli-agents/agent-message-router.service.ts:122-161` | A handle that has neither `steer` nor `interrupt` is parked by the router while it runs and continued when idle. The router needs no edit. |
| Capabilities are read from the HANDLE first, and from the adapter only when the handle is gone | `agent-message-router.service.ts:336-359` | The handle must not expose `interrupt`/`supportsInterrupt` at all. |
| `interruptAndResume` tells the caller that partial work is "DISCARDED" | `agent-message-router.service.ts:202-208` | This is why the user chose `interrupt: false`. |
| `flushPending` delivers ONE parked message per settle through `continueConversation` | `agent-message-router.service.ts:271-316` | Mid-turn messages arrive as idle-time `session/prompt`s. Grok's native mid-turn queue is never used. |
| `continueConversation` refuses a `running` record as `busy`, marks the turn boundary, resets the lane guard, and wires the new `done` to `handleExit` | `cli-agents/agent-process-manager.service.ts:1771-1888` (busy check at `:1814-1819`, boundary at `:1853`) | `continue()` must return a fresh per-turn `done`, while the process outlives the turn. |
| The manager reads `getSessionId()` right after `runSdk` resolves, then on every segment; `onSessionResolved` updates `cliSessionId` | `agent-process-manager.service.ts:709-719`, `:924-929`, `:942-948` | The session id becomes known after `session/new`, which runs inside the first turn. It is pushed through `onSessionResolved`. |
| `trackSdkHandle` wires `done` to `handleExit`, then sets `currentTurnDone` | `agent-process-manager.service.ts:949-973` | `done` must always resolve and never reject (Cursor/Pi convention). |
| Lane-budget guard: a handle without `steer` is logged and skipped, and the stop threshold still applies; a continuation-capable handle keeps its guard across turns | `agent-process-manager.service.ts:1047-1072`, `:2310-2315` | This is the expected Grok behaviour. No edit. |
| Idle release: only continuation-capable handles get it; release = abort + `killProcess` | `agent-process-manager.service.ts:2204-2218`, `:2256-2297` | One long-lived `grok agent` process per lane, reaped by the existing idle timer. |
| `killProcess`: `abort()`, then `killProcessTree(getPid())` if a pid exists, else a bounded settle wait | `agent-process-manager.service.ts:2544-2585` | `getPid()` must return the live `grok` pid, so the manager's tree-kill (taskkill /T /F on Windows) reaps the MCP and shell grandchildren. |
| Pi: a long-lived stdin RPC child; JSON written only if `stdin.writable`; a no-op `stdin` error listener; kill = graceful request, then `whenSpawned` → `killProcessTree` | `cli-adapters/pi-cli.adapter.ts:321-349`, `:399` | Closest precedent for the process transport. |
| Pi: `detect()` = `resolveCliPath` + `probeCliVersion`, with `messagingMode` on every branch | `pi-cli.adapter.ts:166-197` | Same shape for `GrokCliAdapter.detect()`. |
| Cursor: the vendor handshake (`Agent.create/resume`) runs INSIDE the first turn; a failure becomes an `error` segment plus `done` 1 | `cli-adapters/cursor-cli.adapter.ts:353-439` | The ACP runner runs `initialize` + `session/new` inside the first turn too. `runSdk` stays fast and never throws for vendor failures. |
| ESM-only vendor SDKs load through a cached, string-literal dynamic `import()`, with only successes cached | `cli-adapters/codex-cli.adapter.ts:187-204`, `cursor-cli.adapter.ts:148-157` | `@agentclientprotocol/sdk` follows the same pattern (Decision 1). |
| The ESM SDK import is marked `external` in Electron/CLI/TUI, and declared in their `package.json` | `apps/ptah-electron/project.json:37-41`, `apps/ptah-electron/package.json:13-15`, `apps/ptah-cli/project.json:43-46`, `apps/ptah-tui/project.json:33-35`; VS Code bundles third-party code (`apps/ptah-extension-vscode/project.json:27,36`) | Same wiring for the ACP SDK. TASK_2026_394 shows an undeclared external breaks the published CLI. |
| Electron `validate-deps` scans the built `main.mjs` for undeclared externals | `apps/ptah-electron/scripts/validate-deps.js:1-13`; target `apps/ptah-electron/project.json:413-417` | This is the verification command for the Electron wiring. |
| Jest precedent for an ESM-only package: `transformIgnorePatterns: ['node_modules/(?!marked/)']`, with ts-jest transpiling and `allowJs` in `tsconfig.spec.json` | `libs/backend/tool-output-reducers/jest.config.ts:15-16`; `libs/backend/tool-output-reducers/tsconfig.spec.json` (`allowJs: true`) | Same change in `cli-agent-runtime` so specs can drive the real SDK. |
| `cli-agent-runtime` Jest uses ts-jest with `tsconfig.spec.json` (`module: commonjs`, `moduleResolution: node10`) | `libs/backend/cli-agent-runtime/jest.config.ts`, `tsconfig.spec.json:5-6` | A STATIC import of the ESM SDK would break every spec suite (in any lib) that loads the adapters barrel. Only a dynamic import is safe. |
| `@nx/dependency-checks` lint applies to the library's `package.json` | `libs/backend/cli-agent-runtime/eslint.config.mjs:6-17` | `@agentclientprotocol/sdk` must be declared in `libs/backend/cli-agent-runtime/package.json`. |
| `zod` is 4.6.5 (root, the library and the apps), and it exports `./v4` for both `require` and `import` | root `package.json:205`; `libs/backend/cli-agent-runtime/package.json`; `node_modules/zod/package.json` exports `./v4` | Satisfies the SDK peer `zod ^3.25.0 \|\| ^4.0.0` and its `import "zod/v4"`. |
| `spawnCli` returns a `SpawnedProcessHandle` (`stdin`/`stdout`/`stderr` as Node streams, `whenSpawned`, `pid`); an off-thread spawner is optional | `cli-adapters/cli-adapter.utils.ts:93-130`, `:296-330`; `platform-core/src/interfaces/process-spawner.interface.ts:101-127` | The transport wraps these Node streams into Web streams for the SDK. `Readable.toWeb` cannot be used, because the type is `NodeJS.ReadableStream`, not `stream.Readable`. |
| `createBufferedEmitter`, `buildTaskPrompt(…, resumeRestoresContext)`, `resolveDirectSpawn`, `classifyCliStderr`, `ptahMcpServerUrl` | `cli-adapter.utils.ts:37-58`, `:533-559`, `:673`; `cli-stderr-severity.ts`; `ptah-mcp-url.ts` | Reused unchanged. |
| `SYSTEM_CLI_TYPES` is the single source for `CliType`; the MCP spawn enum, zod enums and CLI `--cli` derive from it | `libs/shared/src/lib/types/agent-process.types.ts:58-81` | Adding `'grok'` registers the lane everywhere that derives from it. |
| Exhaustive consumers of `SystemCliType` | `libs/frontend/chat/src/lib/settings/ptah-ai/cli-matrix-rows.ts:7,116-123` (`Record<SystemCliType, …>` with a required `modelKey`); `libs/frontend/tribunal-panel/src/lib/services/tribunal-run.service.ts:418-439` (switch must return); `libs/shared/src/lib/types/rpc/rpc-agents.types.ts:176-183` (`AgentListCliModelsResult`) | These must change in the same batch as `SYSTEM_CLI_TYPES`, or typecheck fails. |
| Adapter registration, the startup log string, and the credential-check list | `cli-agents/cli-detection.service.ts:72-77`, `:242` | Grok is added here. |
| Effort mapper per CLI | `cli-agents/lane-spawn-policy.ts:165-178` | Add `mapEffortToGrok`, clamping onto Grok's measured `low\|medium\|high\|xhigh` (`grok-probe.md` §5 initialize). |
| Model/effort setting keys (Partial records) | `cli-agents/agent-spawn-environment.service.ts:57-65`, `:108-113` | Add `grok: 'grokModel'` to the model keys. No effort key (Cursor/Antigravity precedent). |
| `resolveAutoApprove` returns `undefined` for every CLI except Copilot | `agent-spawn-environment.service.ts:141-149` | Grok lanes always run with `autoApprove !== false`, i.e. approving. |
| Model-only settings key precedent (`antigravityModel`) | `platform-core/src/file-settings-keys.ts:193,513`; `agent-sdk/src/lib/types/settings-export.types.ts:77`; `shared/.../rpc-agents.types.ts:118,231`; `shared/.../rpc-auth.types.ts:461`; `rpc-handlers/.../agent-rpc.handlers.ts:354,525-526`; `frontend/core/.../providers-settings.types.ts:68`, `providers-settings-state.service.ts:768`, `providers-commit.service.ts:193`; `webview-e2e-harness/.../settings.fixtures.ts:176` | The exact file set for a `grokModel` setting. |
| Model list aggregation | `rpc-handlers/src/lib/services/cli-model-list.service.ts:40-46`, `:74-84` | Add `grok`. |
| Tribunal vendor list | `tribunal-panel/src/lib/services/tribunal-discovery.service.ts:53-67` | Add a Grok row. |
| `CliOutputSegment` vocabulary: text, thinking, tool-call, tool-result, tool-result-error, error, info, command, file-change | `libs/shared/src/lib/types/agent-process.types.ts:401-439` | Target of the update mapper. No new type. |
| Budget guard treats tool names `write/edit/multiedit/delete/notebookedit/apply_patch` as file edits | `cli-agents/lane-budget-guard.ts:25-32`, `:151-153` | The mapper must make ACP `kind: edit/delete` visible as `edit`/`delete` tool names. |

SDK facts, from `@agentclientprotocol/sdk@1.7.0` (the npm tarball, read for this plan):

- Packaging: `"type":"module"`, import-only `exports` (no `require` condition), Apache-2.0,
  `peerDependencies.zod "^3.25.0 || ^4.0.0"` (`npm view`).
- `ClientSideConnection(toClient, stream)` is declared at `dist/acp.d.ts:1001,1017`.
- `ndJsonStream(output: WritableStream<Uint8Array>, input: ReadableStream<Uint8Array>, {maxMessageBytes})` is at
  `dist/acp.d.ts:28`.
- The `Client` interface at `dist/acp.d.ts:1384` has `requestPermission`, `sessionUpdate`, optional
  `extMethod`/`extNotification`.
- Agent methods: `initialize`/`newSession`/`loadSession`/`resumeSession` (`dist/acp.js:1484-1576`). `prompt`
  sends a request with **no response validation** (`dist/acp.js:1692`). `cancel` is a notification.
- `session/update` params are zod-validated (`dist/acp.js:681`). A notification-handler failure is
  `console.error`'d and the connection survives (`dist/jsonrpc.js:779-790`).
- An unhandled incoming request gets `-32601` (`dist/jsonrpc.js:775`). An unhandled incoming notification is
  silently dropped.
- A connection close rejects every pending request (`dist/jsonrpc.js:585-595`).
- A non-JSON stdout line gets a parse-error reply, not a crash (`dist/stream.js`).
- The default max message size is 32 MiB (`dist/stream-limits.js:1`).
- `zStopReason` is `end_turn|max_tokens|max_turn_requests|refusal|cancelled`. `zToolKind` includes
  `edit|delete|execute|…`. `zPermissionOptionKind` is `allow_once|allow_always|reject_once|reject_always`.
  `RequestPermissionOutcome` is `{outcome:'cancelled'} | {outcome:'selected', optionId}`.

## Architecture decision

- **Chosen approach.** A new folder `cli-adapters/acp/` holds the vendor-neutral layer:
  - an SDK loader;
  - a process transport;
  - a pure update mapper;
  - a pure permission policy;
  - a `AcpVendorProfile` contract;
  - `createAcpSessionHandle`, the runner that turns one long-lived ACP agent process into an `SdkHandle`.

  A Grok profile and a thin `GrokCliAdapter` live beside it. The Grok process is
  `grok agent [-m <model>] [--reasoning-effort <e>] --no-leader stdio`. It is spawned once per lane. Each turn is
  one `session/prompt`, and turn completion is the prompt response's `stopReason`.
- **Rationale.**
  - The handle surface already expresses everything ACP offers (Evidence rows 1-6). The router and manager need
    no edit, because they are capability-driven.
  - The probe measured every Grok mechanism this design uses (`grok-probe.md` §4-5).
  - The profile seam keeps vendor quirks out of the runner, so opencode, Copilot or Codex-ACP can be added later
    as a profile only.
- **Rejected alternatives.**
  - One-shot `grok -p` per turn. It has no per-process MCP flag; project config is blocked by folder trust; the
    session id arrives only at the end (`grok-probe.md` §1, §4).
  - An in-house JSON-RPC client. The user chose the SDK. It stays the named fallback in Decision 1 if the SDK
    cannot load.
  - Declaring `steer: true` by sending `session/prompt` mid-turn. Grok **queues** it FIFO and starts it only after
    the running prompt ends (`grok-probe.md` §5 timeline 7736 → 12746). ACP v1 has no inject method.
    - The router would then tell the caller the message was "Injected into the turn already running… without
      losing its current work" (`agent-message-router.service.ts:136-138`), which is false.
    - The queued prompt's response would also be a turn the manager never tracked: no
      `markTurnBoundary`, no `done`, no lane-guard reset (`agent-process-manager.service.ts:1840-1887`).
    - So steer is not possible, and Grok's native queue is deliberately unused. The router's own park plus
      `flushPending` provides the queue.
  - `interrupt: true` (cancel + resume). Excluded by user decision. The probe also shows queued prompts auto-start
    after a cancel (§5 finding 3).
  - `--leader`. The MCP child inherits the leader's env and cwd (`grok-probe.md` §3). `--no-leader` is mandatory
    and pinned by a spec.
  - `--plugin-dir` for MCP. `session/new.mcpServers` is the ACP-standard route, and it is measured to work with
    http + headers (§4). The plugin dir is kept only as a fallback for probe P1.
  - Forwarding permission prompts to the frontend (the Copilot bridge). No Ptah UI answers rival-lane prompts
    today. Auto-answering matches the existing auto-approve behaviour.
- **Assumptions** (each resolved by a named check):
  - A1: the Ptah MCP server works through Grok's `search_tool`/`use_tool` (P1).
  - A2: answering `allow_once` covers every Grok permission request, including MCP `use_tool` (P2).
  - A3: `session/resume` restores context without replay (P2).
  - A4: Grok's real `session/update` traffic passes the SDK's zod validation (P3, and the fixture spec in
    Component 3).
  - A5: the SDK loads in the VS Code, Electron and CLI bundles (Batch 1 verify).
- **Effect on existing code.**
  - No existing adapter changes. The router and manager are unchanged.
  - Additive edits only, at registration and settings sites.
  - One new runtime dependency.

### Decision 1 - loading the ESM-only SDK

- Production: a cached dynamic `import('@agentclientprotocol/sdk')` with a string literal, exactly like
  `getCodexSdk` (`codex-cli.adapter.ts:197-204`).
  - The VS Code bundle inlines it (`thirdParty: true`).
  - Electron, CLI and TUI keep it external. It is declared in `apps/ptah-electron/package.json` and
    `apps/ptah-cli/package.json`, and added to the `external` arrays in `apps/ptah-electron/project.json`,
    `apps/ptah-cli/project.json` and `apps/ptah-tui/project.json`, beside `@openai/codex-sdk`.
  - Only type-only imports (`import type`) are allowed outside the loader. A spec pins this (Component 1).
- Jest: `cli-agent-runtime/jest.config.ts` gains `transformIgnorePatterns: ['node_modules/(?!@agentclientprotocol/)']`,
  and `tsconfig.spec.json` gains `allowJs: true`, following the `tool-output-reducers` precedent. Under ts-jest
  `module: commonjs`, the dynamic import compiles to a lazy `require`. Only specs that run the ACP path load it,
  so other libraries' specs that import the adapters barrel are unaffected.
- Fallback, if Batch 1's builds or Jest cannot load the SDK cleanly:
  1. If Jest is the only failure, map the specifier with a `moduleNameMapper` to a ts-jest-transformed copy.
  2. If a host bundle fails, replace the loader's body with a thin in-house client. It would implement the same
     narrow `AcpConnectionApi` interface that Component 1 exports (initialize, newSession, resumeSession,
     loadSession, prompt, cancel, plus the client handlers). Every other component depends on that interface,
     not on the SDK classes. This swap is the reason the interface exists. It is a real boundary (an external
     dependency), not a speculative layer.

## Component specifications

All new files are under `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\` (`ADP` below).
None of them imports `@ptah-extension/vscode-core`, not even as a type. Diagnostics leave through segments and
callbacks.

### 1. AcpSdkLoader

- Purpose: the only module that touches the SDK's runtime values.
- Responsibilities:
  - export `loadAcpSdk()`: a cached dynamic import, caching successes only;
  - export `AcpConnectionApi`, the narrow structural interface of the `ClientSideConnection` members Ptah calls;
  - export `connectAcp(stream, client)` → `AcpConnectionApi`, built through `ndJsonStream` with
    `maxMessageBytes: 8 MiB`;
  - map a load failure to `AcpUnavailableError` with an actionable message.
- Verified contracts: `ClientSideConnection` and `ndJsonStream` signatures (SDK facts above); the cached-import
  pattern (`codex-cli.adapter.ts:187-204`).
- Dependencies: `@agentclientprotocol/sdk`, as a type import plus the dynamic runtime import only.
- Integration points: Component 5.
- Failure behaviour: a rejected import → `AcpUnavailableError("The ACP client library could not be loaded: …")`.
  The runner turns it into one `error` segment and `done` 1. The import is retried on the next lane.
- Verification seam: a spec that loads the real SDK under Jest (proves the transform config), plus a spec that
  greps the folder to assert no static runtime import of the SDK outside this file.
- Files:
  - CREATE `ADP\acp\acp-sdk-loader.ts` and `.spec.ts`
  - MODIFY `D:\projects\ptah-extension\package.json`
  - MODIFY `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\package.json`
  - MODIFY `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\jest.config.ts`
  - MODIFY `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\tsconfig.spec.json`
  - MODIFY `D:\projects\ptah-extension\apps\ptah-electron\package.json`
  - MODIFY `D:\projects\ptah-extension\apps\ptah-electron\project.json`
  - MODIFY `D:\projects\ptah-extension\apps\ptah-cli\package.json`
  - MODIFY `D:\projects\ptah-extension\apps\ptah-cli\project.json`
  - MODIFY `D:\projects\ptah-extension\apps\ptah-tui\project.json`

### 2. AcpProcessTransport

- Purpose: run one agent child and present it as an SDK byte stream plus lifecycle.
- Responsibilities:
  - `spawnAcpProcess({command, args, cwd, env, spawner, onStderrLine})` returns
    `{ stream, getPid(), exited: Promise<{code, signal}>, kill() }`.
  - Spawn with `spawnCli(..., { detached: true, spawner })` after `resolveDirectSpawn`, so the pid is the real
    binary on Windows.
  - Bridge Node `stdout` into a `ReadableStream<Uint8Array>` and a `WritableStream<Uint8Array>` into `stdin`.
    Writes happen only while `stdin.writable`, with a no-op `stdin` `error` listener (Pi `:321-332`, `:399`).
  - Close the readable on `close`/`end`.
  - Split stderr by line, strip ANSI, and hand each non-empty line to `onStderrLine`.
  - `getPid()` returns the pid only until exit or error. This follows PR #658's live-only rule, because an exited
    pid can be reused by another process.
  - `kill()` = end stdin, then `whenSpawned` → `killProcessTree` (Pi `:338-349`). It is idempotent.
- Verified contracts: `spawnCli`/`SpawnedProcessHandle` (`cli-adapter.utils.ts:93-130`, `:296-330`);
  `killProcessTree` from `@ptah-extension/platform-core`; `resolveDirectSpawn` (`:673`).
- Dependencies: `cli-adapter.utils`, `platform-core`. It knows nothing about ACP messages.
- Integration points: called by Component 5 through an injectable `AcpTransportFactory`, so specs can substitute
  an in-memory transport.
- Failure behaviour:
  - A spawn `error` settles `exited` with `{code: null, signal: 'error'}` and closes the stream. The pending
    `session/*` requests then reject (SDK close semantics).
  - A stderr line over 64 KiB without a newline is truncated, with a marker.
- Quality: one child, two listeners and no timers per lane. Every listener is removed on exit.
- Verification seam: a spec with a real `node -e` child that echoes NDJSON and writes stderr. It asserts framing,
  stderr lines, `getPid` cleared after exit, and tree-kill on `kill()` (`killProcessTree` mocked).
- Files: CREATE `ADP\acp\acp-process-transport.ts` and `.spec.ts`

### 3. AcpSessionUpdateMapper (pure)

- Purpose: map one standard `session/update` payload to output text and `CliOutputSegment`s.
- Mapping:

  | ACP `sessionUpdate` | Effect |
  | --- | --- |
  | `agent_message_chunk` (text) | `text` segment + output delta. Non-text content becomes `info` `[<type> content]`. |
  | `agent_thought_chunk` | `thinking` |
  | `tool_call` | `tool-call` with `toolCallId`, `toolInput` = `rawInput` when it is an object, `toolArgs` = its JSON, `toolName` = `edit`/`delete` for those kinds (guard visibility, `lane-budget-guard.ts:25-32`), otherwise `title`. The kind is remembered per id. |
  | `tool_call_update` with `status: completed` | Kind `execute`: `command` segment (`toolName` = the remembered title or command, `exitCode` from the profile's `extractExitCode(rawOutput)`). Other kinds: `tool-result`. Content = the concatenated text of the update's content blocks, else stringified `rawOutput`, capped at 64 KiB. |
  | `tool_call_update` with `status: failed` | `tool-result-error` |
  | any `diff` content block | `file-change` (`changeKind` `added` when `oldText` is absent, else `modified`; content = path) |
  | `plan` | `info` listing the entries |
  | `user_message_chunk`, `available_commands_update`, `current_mode_update`, `config_option_update`, `session_info_update`, `usage_update`, every other kind | none |

- Rule: **no `session/update` ever produces an `error` segment.** Only the prompt response decides failure. This
  carries over the intent of PR #658's recovered-error handling: a provider error the agent retried past must not
  look like a failed lane.
- Verified contracts: segment type at `agent-process.types.ts:401-439`; update kinds from the SDK `zSessionUpdate`;
  Grok shapes from `grok-probe.md` §1, §5.
- Dependencies: `@ptah-extension/shared` types; SDK types (`import type`).
- Failure behaviour: a missing field means no segment. The mapper never throws.
- Verification seam:
  - a fixture spec over the Grok transcripts captured in Batch 0, at
    `ADP\acp\__fixtures__\grok-*.ndjson`;
  - the same fixtures replayed through the real SDK `ClientSideConnection` (Component 5 spec), which proves A4.
- Files: CREATE `ADP\acp\acp-session-update-mapper.ts` and `.spec.ts`, and `ADP\acp\__fixtures__\` (transcripts, secrets scrubbed)

### 4. AcpPermissionPolicy (pure)

- Purpose: answer `session/request_permission` with the narrowest auto-approve-equivalent option.
- Rule: with `autoApprove !== false`:
  1. select the first `allow_once` option;
  2. else select the first `allow_always` option, emitting an `info` that a persistent grant was the only allow
     option;
  3. else select `reject_once`;
  4. else return `{outcome:'cancelled'}`.

  With `autoApprove === false`: select `reject_once`, else `cancelled`, plus an `info` naming the tool title that
  was refused. There is no Ptah UI to ask, and hanging until the inactivity watchdog fires is worse.
- Why this is the narrowest rule. Grok sends a permission request only for actions its own policy marks "ask".
  Actions it denies are never offered. Answering `allow_once` therefore approves exactly what `--always-approve`
  would, while still respecting the user's deny rules and persisting nothing (`grok-probe.md` §5 Permissions). The
  same rule matches opencode's `--auto` for the future profile.
- Fallback: if P2 shows a Grok permission path that does not arrive as a JSON-RPC request, or `allow_once`
  misbehaves for MCP `use_tool`, the Grok profile sets `alwaysApproveFlag: true` and spawns with
  `--always-approve`. The policy stays as a safety net.
- Verified contracts: option and outcome shapes (SDK `zPermissionOptionKind`, `zRequestPermissionOutcome`); Grok
  options `always-allow/allow-once/reject-once/reject-always` (`grok-probe.md` §5).
- Verification seam: a table-driven unit spec.
- Files: CREATE `ADP\acp\acp-permission-policy.ts` and `.spec.ts`

### 5. AcpVendorProfile contract + `createAcpSessionHandle` (the runner)

- Purpose: turn one ACP agent process into an `SdkHandle`. This is the only stateful unit of the layer.
- Profile contract (`acp-vendor-profile.ts`), data plus small functions only:
  - `vendor` (a `CliType`) and `displayName`;
  - `buildSpawn(binary, options) → {args, env?}`;
  - `buildMcpServers(options) → McpServer[]`;
  - `sessionMeta?(options)`;
  - `isExtensionNotification(method) → boolean` (Grok: `_x.ai/*` and `x.ai/*`);
  - `extractExitCode?(rawOutput)`;
  - `describeError?(err) → string` (auth and model hints);
  - `alwaysApproveFlag: boolean`;
  - `resumeStrategy: 'resume-then-load' | 'load' | 'none'`.
- Runner lifecycle:
  1. `runSdk` (in the adapter) builds the profile spawn, then calls `createAcpSessionHandle({profile, options,
     transportFactory, loadSdk})`. The runner spawns the process synchronously and returns the handle at once
     (Cursor/Pi convention). `done` is the first turn.
  2. First turn: `loadAcpSdk` → `connectAcp` → `initialize({protocolVersion: 1, clientCapabilities: {fs:
     {readTextFile:false, writeTextFile:false}, terminal:false}, clientInfo})`.
     - A returned `protocolVersion !== 1` gives the error "unsupported ACP protocol version N" and `done` 1.
  3. Session.
     - With `options.resumeSessionId`: if `agentCapabilities.sessionCapabilities.resume` is present, call
       `session/resume`. Else, if `loadSession` is true, call `session/load`; every `session/update` that arrives
       before the load response resolves is dropped (replay suppression, `grok-probe.md` §5).
     - On failure, or with no support, fall back to `session/new`, emit an `info` ("could not resume <id>:
       <reason>; started a new session"), and build the prompt with `resumeRestoresContext: false`.
     - Without a resume id: `session/new({cwd, mcpServers, _meta?})`.
     - The session id is stored, then emitted through a buffered `onSessionResolved` emitter. `getSessionId()`
       returns `captured ?? options.resumeSessionId`, the same fallback as PR #658.
  4. Prompt: `buildTaskPrompt({...options, resumeRestoresContext: resumed}, profile.vendor)`, then
     `session/prompt({sessionId, prompt:[{type:'text', text}]})`. The `done` code comes from `stopReason`:

     | `stopReason` | `done` | Segment |
     | --- | --- | --- |
     | `end_turn` | 0 | none |
     | `max_tokens`, `max_turn_requests` | 0 | `info` naming the limit |
     | `refusal` | 1 | `error` |
     | `cancelled` while the handle is aborted | 1 | silent |
     | `cancelled` otherwise | 1 | `error` "turn cancelled by the agent" |
     | unknown string | 1 | `error` naming it |

     A JSON-RPC error gives 1 plus `error` = `profile.describeError(err)`. A rejection from connection close
     gives 1 plus `error` "<displayName> exited (code N) during the turn".
     `done` never rejects.
  5. `continue(message)`: rejects if the connection is closed, no session id exists, or a prompt is in flight.
     The manager's busy check makes the last case unreachable (`agent-process-manager.service.ts:1814`).
     Otherwise it returns `{done}` for a new `session/prompt` with the message as the whole prompt.
  6. `supportsContinuation()` = connection open, session id known, and not aborted. No `steer`, no `interrupt`,
     no `supportsInterrupt`.
  7. Abort (stop, timeout, idle release):
     - if a prompt is in flight, send `session/cancel({sessionId})` (best effort, fire and forget);
     - then `transport.kill()`.

     The manager also tree-kills through `getPid()` (`:2561-2565`). `session/close` is never sent, so the session
     stays loadable for `resume_session_id`.
  8. Process exit while idle: the handle marks itself closed (`supportsContinuation` → false). No `done` is
     pending, so nothing is emitted. The next message gets `continueConversation`'s `unsupported`, and the caller
     resumes by session id.
  9. Stderr lines go to `output` as `[stderr] …` and to `segment` through `classifyCliStderr` (opencode adapter
     precedent).
  10. Client handlers:
      - `sessionUpdate` → Component 3, filtered to our session id;
      - `requestPermission` → Component 4;
      - `extNotification` → ignored when `profile.isExtensionNotification(method)`, else logged once as `info`
        at most per method;
      - `extMethod` → throws so the SDK answers `-32601` (unsupported requests are explicitly rejected; ACP
        landscape guidance).
- Handshake timeout: 30 s for `initialize` + session setup, so a hung agent is not left to the inactivity
  watchdog. On timeout: `error` "<displayName> did not complete the ACP handshake in 30 s", `kill()`, `done` 1.
  Prompts have no timeout; the manager's inactivity watchdog (`:1844`) owns that.
- `SdkHandle` mapping summary: `abort` → cancel + kill; `done` → the first prompt's `stopReason`; `continue` →
  a further `session/prompt`; `getSessionId`/`onSessionResolved` → the `session/new|resume|load` result;
  `getPid` → the live child only; `steer`/`interrupt` → absent; `onOutput`/`onSegment` → buffered emitters.
- Verified contracts: `SdkHandle` (`cli-adapter.interface.ts:97-147`); manager expectations (Evidence rows 5-11);
  SDK method set and close semantics (SDK facts).
- Dependencies: Components 1-4 and their interfaces; `cli-adapter.utils` (`createBufferedEmitter`,
  `buildTaskPrompt`). No vendor code.
- Quality:
  - One process and one connection per lane.
  - The only timer is the handshake timer, cleared on completion.
  - Listeners are released on exit and abort.
  - Ptah secrets never pass through ACP: the MCP URL carries only port, workspace and agent id
    (`ptah-mcp-url.ts`).
- Verification seam: `acp-session-handle.spec.ts` drives the real SDK against a **fake ACP agent over in-memory
  `TransformStream`s**. The test helper `ADP\acp\__fixtures__\fake-acp-agent.ts` is a scripted raw-JSON-RPC peer
  that can emit vendor extension notifications, replay history on load, send permission requests, hold a prompt
  open, answer cancel with `cancelled`, and close mid-turn. Scenarios:
  - first turn `end_turn` gives 0 and the session id is resolved;
  - `continue` gives a second `session/prompt` and a separate `done`;
  - the stop-reason table;
  - permission request answered with `allow-once`;
  - `_x.ai/*` notifications ignored with no error output;
  - load replay suppressed;
  - resume falls back to new with an `info`;
  - an unsupported protocol version;
  - handshake timeout (fake timers);
  - transport close mid-turn gives 1 plus an error;
  - abort sends `session/cancel` then kills;
  - `getPid` undefined after exit;
  - `supportsInterrupt`/`steer` absent.
- Files:
  - CREATE `ADP\acp\acp-vendor-profile.ts`
  - CREATE `ADP\acp\acp-session-handle.ts` and `.spec.ts`
  - CREATE `ADP\acp\__fixtures__\fake-acp-agent.ts`
  - CREATE `ADP\acp\index.ts` (folder barrel; type exports plus `createAcpSessionHandle`)

### 6. GrokAcpProfile + GrokCliAdapter

- Purpose: the Grok lane.
- `grok/grok-acp-profile.ts`:
  - `buildSpawn` → `['agent', ...(model ? ['-m', model] : []), ...(effort ? ['--reasoning-effort', effort] : []),
    ...(alwaysApproveFlag ? ['--always-approve'] : []), '--no-leader', 'stdio']`.
    - Options precede the subcommand (`grok agent --help`, run for this plan).
    - `--no-leader` is mandatory (`grok-probe.md` §3).
  - `buildMcpServers` → when `mcpPort` is set,
    `[{type:'http', name:'ptah', url: ptahMcpServerUrl(port, workingDirectory, agentId), headers: []}]`
    (measured shape, §4); otherwise `[]`.
  - `isExtensionNotification` → `/^_?x\.ai\//`.
  - `extractExitCode` → `rawOutput.exit_code` when it is numeric. The probe found the real code is not preserved,
    so this is informational.
  - `describeError` maps the "unknown model id" text to "Grok rejected model '<m>' (from <modelSource>); run
    `grok models`". Auth failures (unmeasured) map to "Grok is not signed in: run `grok login` or set
    XAI_API_KEY".
  - `resumeStrategy: 'resume-then-load'`; `alwaysApproveFlag: false`, pending P2.
- `grok-cli.adapter.ts` (`name 'grok'`, `displayName 'Grok'`, `roleChannel 'task-prompt'`, `supportsMcp true`,
  constructor `(spawner?: IProcessSpawner)`):
  - `detect()`: Pi shape, with `resolveCliPath('grok')` and `probeCliVersion`.
  - `capabilities()` → `{ steer: false, interrupt: false, continuation: true }`.
  - `listModels()`: run `grok models` (8 s timeout, never throws). Parse the line after `Default model:` and the
    `  <marker> <id>[ (default)]` rows under `Available models:` (§6). Return an empty list on failure.
  - `ensureTokensFresh()`: true when `~/.grok/auth.json` exists and parses, or `XAI_API_KEY` is set (§6 auth
    methods name that file).
  - `runSdk()`: `resolveDirectSpawn(options.binaryPath ?? 'grok')`, then `createAcpSessionHandle` with the profile.
- Effort: `mapEffortToGrok` clamps `minimal → low`, keeps `low|medium|high|xhigh`, maps `max → xhigh`, and gives
  `undefined` for anything else.
- Verified contracts: Pi adapter shape (`pi-cli.adapter.ts:150-261`); `grok agent --help` flags; probe-measured
  ACP shapes.
- Failure behaviour:
  - not installed → `installed: false`;
  - `grok models` failure → `[]`;
  - every runtime failure goes through Component 5's single path.
- Verification seam:
  - the adapter spec pins exact argv: `--no-leader` always present and `stdio` last, `--leader` never present,
    no `--always-approve` while the flag is false, model and effort flags;
  - capabilities;
  - the `grok models` parser against the probe output;
  - `mcpServers` for set and unset `mcpPort`;
  - a handle smoke test with the fake agent.
- Files: CREATE `ADP\grok\grok-acp-profile.ts` and `.spec.ts`, `ADP\grok-cli.adapter.ts` and `.spec.ts`

### 7. Grok registration (atomic with the `SYSTEM_CLI_TYPES` change)

- Purpose: make `grok` a selectable system CLI lane and keep every exhaustive consumer compiling.
- Responsibilities, with each edit beside its existing precedent:
  - add `'grok'` to `SYSTEM_CLI_TYPES` (`agent-process.types.ts:70-77`);
  - export `GrokCliAdapter` from `ADP\index.ts`;
  - register it, update the init log, and add it to `refreshCliTokens` (`cli-detection.service.ts:72-77`, `:242`);
  - add `case 'grok': return mapEffortToGrok` (`lane-spawn-policy.ts:165-178`);
  - add `grok: 'grokModel'` to `MODEL_CONFIG_KEYS` (`agent-spawn-environment.service.ts:57-65`);
  - add `grok: CliModelOption[]` to `AgentListCliModelsResult` (`rpc-agents.types.ts:176-183`), plus
    `grokModel?: string` in the config and set-config types (`:118`, `:231` siblings);
  - add `grok` to `cli-model-list.service.ts:74-84` and to its fallback object at `:40-46`;
  - add a Grok row (`cliModelKey: 'grok'`) to the tribunal discovery list (`tribunal-discovery.service.ts:53-67`),
    and `case 'grok': return \`cli: "grok"${modelArg}\`` to the tribunal run service (`tribunal-run.service.ts:432-435`);
  - add a `grok` row to the frontend matrix: `{ name: 'Grok', provider: 'xAI', modelKey: 'grokModel', effortKey: null }`,
    plus `'grokModel'` in `CliModelSettingKey` (`cli-matrix-rows.ts:7`, `:116-123`);
  - add the `grokModel` settings key along the `antigravityModel` path:
    - `file-settings-keys.ts:193,513`;
    - `settings-export.types.ts:77`;
    - `rpc-auth.types.ts:461`;
    - `agent-rpc.handlers.ts:354` and `:525-526`;
    - `providers-settings.types.ts:68`;
    - `providers-settings-state.service.ts:768`;
    - `providers-commit.service.ts:193`;
    - `settings.fixtures.ts:176`.
- Out of this task, and left to their defaults (`undefined`/absent):
  - harness-sync targets;
  - plan-limit owner (`lane-owner.resolver.ts:89-97`);
  - `LANE_SUCCESS_BILLING`;
  - capability toggles;
  - brand marks;
  - `ROLE_TRANSFORM_TARGETS`;
  - a Grok effort setting.
- Failure behaviour: not applicable (declarations only).
- Verification seam: typecheck across the touched projects; the existing detection, tribunal and settings-matrix
  specs, updated for one more row.
- Files (MODIFY, under `D:\projects\ptah-extension\`):

  | Area | Files |
  | --- | --- |
  | shared | `libs\shared\src\lib\types\agent-process.types.ts`, `libs\shared\src\lib\types\rpc\rpc-agents.types.ts`, `libs\shared\src\lib\types\rpc\rpc-auth.types.ts` |
  | cli-agent-runtime | `ADP\index.ts`, `libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-detection.service.ts`, `libs\backend\cli-agent-runtime\src\lib\cli-agents\lane-spawn-policy.ts`, `libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-spawn-environment.service.ts` |
  | platform-core | `libs\backend\platform-core\src\file-settings-keys.ts` |
  | agent-sdk | `libs\backend\agent-sdk\src\lib\types\settings-export.types.ts` |
  | rpc-handlers | `libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.ts`, `libs\backend\rpc-handlers\src\lib\services\cli-model-list.service.ts` |
  | tribunal-panel | `libs\frontend\tribunal-panel\src\lib\services\tribunal-discovery.service.ts`, `libs\frontend\tribunal-panel\src\lib\services\tribunal-run.service.ts` |
  | chat | `libs\frontend\chat\src\lib\settings\ptah-ai\cli-matrix-rows.ts` |
  | core | `libs\frontend\core\src\lib\services\providers-settings.types.ts`, `libs\frontend\core\src\lib\services\providers-settings-state.service.ts`, `libs\frontend\core\src\lib\services\providers-commit.service.ts` |
  | webview-e2e-harness | `libs\frontend\webview-e2e-harness\src\lib\scenarios\settings\settings.fixtures.ts` |

  Specs are added beside each file only where an existing spec enumerates the CLIs.

## Batch 0 - probes before any code (report: `acp-batch0-probe.md` in the task folder, plus fixtures)

Run against `grok 1.0.46` on win32, against a live Ptah host with its MCP HTTP server running. Write no
repository code. Capture raw NDJSON transcripts, scrub tokens and ids, and commit them in Batch 3 as
`ADP\acp\__fixtures__\grok-*.ndjson`.

| Probe | Steps | Pass | Fail → fallback |
| --- | --- | --- | --- |
| P1 Ptah MCP through `search_tool`/`use_tool` (A1) | `grok agent --no-leader stdio`; `session/new` with `mcpServers:[{type:'http', name:'ptah', url: ptahMcpServerUrl(port, cwd, <test agent id>), headers:[]}]`; prompt it to (a) find and call a read-only Ptah tool and (b) call `ptah_agent_report` with a short status. Record `_x.ai/mcp_initialized.mcpToolCount`, model calls, and wall time. | `mcpToolCount` equals the server's tool count (~59). Both calls reach the Ptah server (its log shows `tools/call` on the `/agent/<id>` route), and the report is attributed. At most 2 extra model calls on the first use. | (1) Add one sentence to the task prompt through the profile naming the exact tools (`ptah__ptah_agent_report` via `use_tool`). Re-run, and pass if (a) and (b) succeed. (2) If still failing, ship Grok with `supportsMcp = false` (Pi precedent `pi-cli.adapter.ts:155`) and report it. The lane works but cannot `ptah_agent_report`. Decision 2 asks the user to confirm. |
| P2 Permissions and resume (A2, A3) | Without `--always-approve`: a turn that runs a shell command, edits a file, and calls a Ptah MCP tool; answer every `session/request_permission` with the `allow_once` option; one run answering `reject_once`. Then kill the process, spawn a new one, call `session/resume` with the id, and prompt for a remembered token; repeat with `session/load`. Also cancel mid-shell (a 45 s `node` sleep) and check with `Get-Process` whether the grandchild survives. | Every gated action arrives as a JSON-RPC request; `allow_once` lets it run; `reject_once` yields a refused tool and the turn still ends `end_turn`. `session/resume` restores context with no replayed `user_message_chunk`. | Permissions: set `alwaysApproveFlag: true` (spawn with `--always-approve`). Resume: set `resumeStrategy: 'load'` (replay suppression). A surviving grandchild is recorded as a risk only; the manager's tree-kill on stop/release still reaps it. |
| P3 Transcripts and failures (A4) | Capture full transcripts for: a plain turn; a tool turn; a permission turn; cancel; load replay; `-m nonexistent-model` on `grok agent`; and, if reachable, a signed-out run (`HOME` pointed at an empty dir). | The transcripts exist and the error texts are recorded. Replaying them through the SDK client in a scratch Node script produces no "Error handling notification" for standard kinds. | Any rejected standard update gets a pre-processing note in Component 3's spec. The SDK keeps the connection alive regardless (`dist/jsonrpc.js:779-790`). If replay fails broadly, Decision 1's fallback (in-house client) is taken. |

## Integration architecture

- **Data flow.**
  1. `ptah_agent_spawn {cli:'grok'}` → `AgentProcessManager` (model and effort policy, MCP port, agent id) →
     `GrokCliAdapter.runSdk` → profile argv.
  2. `spawnAcpProcess` starts the child, and the handle is returned.
  3. First turn: `initialize` → `session/new` with the Ptah MCP entry (or `session/resume` or `session/load`) →
     `onSessionResolved` → `session/prompt`.
  4. Each `session/update` → mapper → buffered emitters → manager output buffer and lane guard.
  5. The prompt response's `stopReason` → `done` → `handleExit` → idle-release timer and `flushPending`.
  6. `ptah_agent_message` while running → router park. On settle: `continueConversation` → `handle.continue` → a
     new `session/prompt`. While idle → `continueConversation` directly.
  7. Stop, timeout or idle release → `abort` → `session/cancel` (if busy) → kill, plus the manager's tree-kill.
- **State or persistence.** The child, connection, session id, the in-flight prompt and the tool-kind map live in
  the handle closure for the lane's life. Grok persists the session itself under `~/.grok/sessions/<cwd>/`, so
  `resume_session_id` works after release. Nothing new is stored in Ptah.
- **External boundaries.**
  - Agent stdout: NDJSON, size-capped and zod-validated by the SDK for updates.
  - Permission requests are answered only by the policy.
  - Agent-initiated requests other than permission are refused with `-32601`.
  - argv arrays only, no shell strings (`spawnCli`).
  - `--no-leader` prevents env/cwd capture by a shared process.
- **Failure and rollback.**

  | Failure | Behaviour |
  | --- | --- |
  | SDK load failure | error segment, `done` 1, retried on the next lane |
  | Handshake failure or timeout | error segment, kill, `done` 1 |
  | Mid-turn exit | pending prompt rejects, error segment, `done` 1 |
  | Idle exit | handle closes; the next message is told to resume |
  | Permission | always answered, so never a hang |

- **Observability.**
  - Every failure path emits exactly one `error` segment that names the vendor and cause.
  - Stderr is surfaced as classified segments.
  - A resume fallback is an `info`.
  - Unknown non-Grok extension notifications produce one `info` per method.
  - The SDK's own `console.error` for invalid notifications lands in the host log.

## Architecture-level quality requirements

- **Functional.**
  - `ptah_agent_list` shows `grok` with `messaging: queue`.
  - A spawned Grok lane runs, streams text, thinking and tool segments, completes with exit 0 on `end_turn`, and
    can call `ptah_agent_report` (subject to P1).
  - `ptah_agent_message` to a running lane returns `queue-next-turn` and is answered as the next turn in the same
    Grok session.
  - After idle release, a spawn with `resume_session_id` restores the conversation.
- **Performance.** One `grok` process per lane; no polling; no per-segment timers. Later turns skip process
  start-up.
- **Security.**
  - `--no-leader` is pinned by spec.
  - Permissions use the narrowest auto-approve-equivalent rule.
  - No secrets appear in argv, `_meta` or logs.
  - The MCP URL carries no credential.
- **Maintainability.**
  - The ACP folder imports nothing from `vscode-core`. The library keeps its `scope:extension` / `type:feature`
    tags.
  - The router and manager stay CLI-agnostic.
  - Vendor specifics live only in the profile.
  - Only the loader touches SDK runtime values.
- **Testability.**
  - The runner is tested against the real SDK and a fake in-memory peer.
  - Pure units are tested table-driven or from fixtures.
  - No spec spawns a real `grok`.

## Team-leader handoff

- **Recommended executors.** backend-developer for Components 1-7, which are all Node/TypeScript in backend libs.
  Component 7's three frontend files are one-line registry additions, so they do not need a frontend-developer.
  Batch 0 goes to a researcher-expert or the senior-tester, since it is live probing plus a report.
- **Complexity.** MEDIUM-HIGH. There is a new runtime dependency loaded across four build targets, a new
  long-lived process lifecycle, and a cross-library registration change.
- **Dependencies and ordering** (component level):
  - Batch 0 precedes Component 6's final flags and Component 3's fixtures.
  - Component 1 precedes 5.
  - Components 2, 3 and 4 precede 5.
  - Component 5 precedes 6.
  - Component 6 precedes 7. Component 7 must land as one atomic change, because `SYSTEM_CLI_TYPES` breaks every
    exhaustive site at once.
- **Parallel-safe work.** Components 2, 3 and 4 are file-disjoint.
- **Suggested batches** (the team-leader re-derives them). Every verify command is scoped:

| Batch | Content | Verify |
| --- | --- | --- |
| 0 | Probes P1-P3, `acp-batch0-probe.md`, raw transcripts | report review; stop and ask the user if P1 lands on fallback (2) |
| 1 | Component 1 + dependency/build wiring | `npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-agent-runtime`; `npx nx run ptah-extension-vscode:build-esbuild`; `npx nx run ptah-electron:validate-deps`; `npx nx run ptah-cli:build-esbuild` |
| 2 | Components 2, 3, 4 (+ fixtures from Batch 0) | `npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-agent-runtime` |
| 3 | Component 5 + the fake ACP agent | same as Batch 2 |
| 4 | Component 6 (not yet registered) | same as Batch 2 |
| 5 | Component 7 (atomic) | `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/cli-agent-runtime @ptah-extension/platform-core @ptah-extension/agent-sdk @ptah-extension/rpc-handlers @ptah-extension/tribunal-panel @ptah-extension/chat @ptah-extension/core @ptah-extension/webview-e2e-harness ptah-cli` |
| 6 | Live verification report (spawn, report, message mid-turn → queued next turn, stop, idle release → resume) and the one-word agent-lanes skill touch if wanted, then `npm run manifest:generate` / `manifest:check` | manual report + `npm run manifest:check` |

- **Files affected.**
  - CREATE: `ADP\acp\{acp-sdk-loader, acp-process-transport, acp-session-update-mapper, acp-permission-policy,
    acp-vendor-profile, acp-session-handle, index}.ts`, the `.spec.ts` files beside them,
    `ADP\acp\__fixtures__\{fake-acp-agent.ts, grok-*.ndjson}`, `ADP\grok\grok-acp-profile.ts` (+spec), and
    `ADP\grok-cli.adapter.ts` (+spec).
  - MODIFY: the dependency and build files in Component 1, plus the registration files in Component 7.
  - REWRITE: none. No opencode file is touched.
- **Verification points.**
  - `SdkHandle` at `cli-adapter.interface.ts:97-147`.
  - Router selection at `agent-message-router.service.ts:122-161`.
  - Manager `continueConversation` at `:1771-1888` and `killProcess` at `:2544-2585`.
  - SDK 1.7.0 `ClientSideConnection` / `ndJsonStream` at `dist/acp.d.ts:1001,1017,28`.
  - Before Batch 5: confirm that `-p @ptah-extension/cli-agent-runtime` resolves (the short form
    `-p cli-agent-runtime` used in earlier plans may not match the scoped project name).

Follow-up (not this task): opencode on ACP = an `opencode` profile against this layer, gated on a probe that
`opencode acp` honours `session/new.mcpServers`. Until then PR #658's `run` transport stands, and the
TASK_2026_591 `serve` plan is unaffected.

## Decisions for the user

1. **Grok model setting.** Adding `'grok'` to `SYSTEM_CLI_TYPES` forces a row in the settings matrix
   (`Record<SystemCliType, …>`, `cli-matrix-rows.ts:116`), and that row needs a model key.
   - (Recommended) Add a model-only `grokModel` setting, following the `antigravityModel` path (about 10 small
     edits, all in Component 7).
   - Alternatively, make the matrix row's `modelKey` optional for Grok. That changes the matrix component
     contract and leaves Grok without a configurable default model.
2. **If probe P1 fails even with the prompt hint.**
   - (Recommended) Ship Grok with `supportsMcp = false` and say so in `ptah_agent_list`. The lane works but cannot
     `ptah_agent_report`.
   - Alternatively, hold the Grok lane until xAI exposes MCP tools directly.

## User Decisions (2026-10-06)

1. Add a model-only `grokModel` setting.
2. If probe P1 fails (Grok cannot use the full Ptah MCP server even with the exact-tool prompt hint), STOP after Batch 0 and redesign. Do not ship with `supportsMcp=false`.
3. Scope is Grok only; opencode stays on `opencode run` (PR #658).
