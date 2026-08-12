# Research: `opencode` CLI Adapter for Ptah (TASK_2026_160)

## Verdict

**Spawn-based, `--format json` structured-event flavor** (closer to Codex's segment richness than to Antigravity's plain-text heuristic parsing, but achieved via child-process spawn + JSONL parsing — NOT the `@opencode-ai/sdk` npm package). **Feasible.** No new npm dependency required. One real risk: Windows npm-shim breakage reported in upstream issues (see §10) — needs empirical verification before ship, with a Codex-style native-binary-resolution fallback ready if it reproduces.

---

## 1. Binary name & version command

- Binary on PATH: **`opencode`** (npm package name is `opencode-ai`, but it installs a bin shim called `opencode`).
- Install: `npm install -g opencode-ai@latest` (also available via Homebrew, Scoop, curl installer, or direct GitHub Release binaries).
- Version probe: `opencode --version` (or `-v`). Matches `probeCliVersion()`'s default `['--version']` — no override needed.
- `resolveCliPath('opencode')` via the existing `which`-based `resolveCliPath()` util should work identically to the other adapters.

Sources: https://opencode.ai/docs/cli/ , https://www.npmjs.com/package/opencode-ai

## 2. Headless one-shot execution

Base form:

```
opencode run "<prompt>"
```

Recommended production invocation (all flags before the trailing prompt, mirroring how `agy`/Codex adapters build argv — `run`'s prompt is a positional arg here, not a Go-style trailing string flag, so exact ordering is less brittle than Antigravity's `--print`):

```
opencode run --format json --auto --model <provider/model> --dir <workingDirectory> --session <resumeSessionId> "<prompt>"
```

(`--session` omitted when not resuming.)

**Output format**: `--format json` emits **JSONL — one JSON object per line** to stdout. This is a real structured event stream, not plain text like `agy`. Event `type` field values observed/documented: `step_start`, `tool_use`, `text`, `step_finish`, `error`. Every event carries `sessionID` and a Unix-ms `timestamp`; most carry a nested `part` object.

Sample lines (from official-docs-derived cheatsheet, https://littlebearapps.com/help/untether/opencode-stream-json-cheatsheet/ — third-party but event shapes are internally consistent with the CLI/config docs and GitHub issues referencing the same field names):

````json
{"type":"step_start","timestamp":1767036059338,"sessionID":"ses_494719016ffe85dkDMj0FPRbHK","part":{"id":"prt_...","sessionID":"ses_...","messageID":"msg_...","type":"step-start","snapshot":"71db24a..."}}
{"type":"tool_use","timestamp":1767036061199,"sessionID":"ses_...","part":{"id":"prt_...","sessionID":"ses_...","messageID":"msg_...","type":"tool","callID":"r9bQWsNLvOrJGIOz","tool":"bash","state":{"status":"completed","input":{"command":"echo hello","description":"Print hello to stdout"},"output":"hello\n","title":"Print hello to stdout","metadata":{"output":"hello\n","exit":0,"description":"Print hello to stdout"},"time":{"start":1767036061123,"end":1767036061173}}}}
{"type":"text","timestamp":1767036064268,"sessionID":"ses_...","part":{"id":"prt_...","sessionID":"ses_...","messageID":"msg_...","type":"text","text":"```\nhello\n```","time":{"start":1767036064265,"end":1767036064265}}}
{"type":"step_finish","timestamp":1767036064273,"sessionID":"ses_...","part":{"id":"prt_...","sessionID":"ses_...","messageID":"msg_...","type":"step-finish","reason":"stop","snapshot":"09dd05d...","cost":0.001,"tokens":{"input":671,"output":8,"reasoning":0,"cache":{"read":21415,"write":0}}}}
{"type":"error","timestamp":1767036065000,"sessionID":"ses_...","error":{"name":"APIError","data":{"message":"Rate limit exceeded","statusCode":429,"isRetryable":true}}}
````

Key semantics:

- `step_finish.part.reason` is `"tool-calls"` mid-turn (more steps coming) or `"stop"` for the final step of the turn — use `reason === "stop"` as the "turn complete" signal if needed, though process exit already tells you that.
- `tool_use` events are only emitted **on completion** (`state.status === "completed"`) per the cheatsheet notes — no separate "pending" event was documented, so treat each `tool_use` line as both call+result in one shot (unlike Codex's separate `item.started`/`item.completed`).
- No distinct "reasoning/thinking" event type was found in the documented cheatsheet (unlike Codex's `reasoning` item type). Models that support extended thinking probably surface it as `type: "reasoning"` inside `part` similar to `text`, but this was **not confirmed** in available docs — treat as an assumption; fall back gracefully (unknown `part.type` → drop into `text`/`info`) if it doesn't match.
- Known upstream bug risk (GitHub issues, not primary docs): `run --format json` has in the past (a) omitted echoing the user's own prompt as an event, and (b) in rare cases exited before flushing the final `step_finish`. Treat `done`/exit-code as authoritative for turn completion, not receipt of a specific event.

### `CliOutputSegment` mapping (implementation-ready)

| opencode JSONL event          | `CliOutputSegment.type`                                       | Notes                                                                                                                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text` (part.type `text`)     | `text`                                                        | `content: part.text`; opencode doesn't document incremental deltas per-line in `--format json` (unlike Codex SDK) — treat each `text` line as the current full/partial chunk, dedupe like Codex's `emitTextDelta` if the same `part.id` reappears with a longer string.             |
| `tool_use`                    | `tool-call` + `tool-result` (or `command` for `tool: "bash"`) | Use `part.callID` as `toolCallId`, `part.tool` as `toolName`, `part.state.input` as `toolArgs`/`toolInput`, `part.state.output` as `content`. For `tool: "bash"`, prefer `type: 'command'` with `exitCode: part.state.metadata.exit` to match Codex's `command_execution` handling. |
| `error` (top-level)           | `error`                                                       | `content: error.data.message`                                                                                                                                                                                                                                                       |
| `step_finish` (reason `stop`) | `info` (optional)                                             | Emit token/cost usage summary like Codex's `handleTurnCompleted`, using `part.tokens`/`part.cost`.                                                                                                                                                                                  |
| `step_start`                  | (skip / no segment)                                           | Structural marker only.                                                                                                                                                                                                                                                             |
| unrecognized `type`           | `info`                                                        | Defensive fallback — log raw JSON as info text rather than dropping silently.                                                                                                                                                                                                       |

## 3. SDK vs spawn — recommendation

`@opencode-ai/sdk` (npm, `createOpencode()` / `createOpencodeClient()`) is a **thin HTTP client for `opencode serve`** — it either spawns a local server itself or connects to a pre-existing one, then drives it via `session.create()` / `session.prompt()` / `event.subscribe()` (SSE). This is architecturally heavier for our single-shot-task model:

- Adds an npm dependency to the monorepo (contra CLAUDE.md preference for spawning bare binaries where a CLI already gives us what we need).
- Requires either (a) spawning `opencode serve` ourselves and lifecycle-managing a second long-lived HTTP server per agent run (port allocation, health-check, teardown — much more moving parts than a single child process), or (b) using `createOpencode()`'s auto-start, which likely just spawns `opencode serve` under the hood anyway — no functional gain over spawning `opencode run` directly.
- `event.subscribe()` SSE gives comparable granularity to `--format json`, but at the cost of the extra server process and an HTTP round trip.

**`opencode run --format json` already gives structured, typed JSONL events equivalent in richness to the Codex SDK's `item.*` events**, with zero extra dependencies, using the exact same `spawnCli()` / `resolveCliPath()` utilities every other adapter uses. This is the **Antigravity spawn shape, with Codex-grade structured segments** — best fit for `SdkHandle`. Recommend: **spawn `opencode run --format json ...`, parse JSONL line-by-line (buffered like Antigravity's line-buffering), emit `CliOutputSegment`s per the table above.** Do not add `@opencode-ai/sdk` to `package.json`.

## 4. Auto-approve / skip-permissions flag

- Flag: **`--auto`** on `opencode run`. Per official docs (`/docs/permissions/`): _"Most permissions default to `allow`. `doom_loop` and `external_directory` default to `ask`."_ `--auto` auto-approves anything that would otherwise `ask` (i.e., closes the `doom_loop`/`external_directory` gaps); explicit `"deny"` rules in config are still enforced.
- There is **no single `--yolo`/`--dangerously-skip-permissions` switch** (confirmed via multiple open feature requests asking for exactly that, e.g. `anomalyco/opencode#20864`, `#9070` — still unresolved as of research date). `--auto` is the closest and sufficient equivalent for our headless, single-task, auto-approve-by-default use case, since the two "ask" defaults (`doom_loop`, `external_directory`) are the only gaps and neither should trigger for a task confined to `workingDirectory`.
- Map `options.autoApprove !== false` → append `--auto` (same pattern as Antigravity's `--dangerously-skip-permissions`).
- No file-based folder-trust step is needed (see §10) — unlike Antigravity, there's no separate "trust this workspace" flow to pre-seed.
- Optional belt-and-suspenders: an `OPENCODE_PERMISSION` env var is referenced in some third-party docs as an inline-permissions-JSON override, but this was **not confirmed** in the primary `/docs/permissions/` page — treat as unverified; `--auto` alone should suffice and is the documented mechanism.

## 5. Model selection & listing

- Flag: **`--model` / `-m`**, format **`<provider>/<model>`** (e.g. `anthropic/claude-sonnet-4-5`, `openai/gpt-4o`). This means `CliCommandOptions.model` must already be a `provider/model` composite string for opencode — `listModels()` must return ids in that exact form so they round-trip directly into `--model`.
- Listing command: **`opencode models [provider]`** (optionally scoped to one provider), flags `--refresh`, `--verbose`. Exact stdout format (plain text vs JSON) was **not confirmed** in available docs/pages. Recommend implementing `listModels()` the same defensive way as `AntigravityCliAdapter.probeModels()`: spawn `opencode models`, capture stdout with an 8s timeout, split on newlines, strip ANSI, treat each non-empty trimmed line as a candidate. **Verify empirically** (`opencode models` on a dev machine) whether each line is already `provider/model` (ideal — id=name=line) or `provider  model  ...` columnar text requiring a regex split before use as `--model`'s value. If the real output turns out to be JSON (some CLIs support `--format json` globally), prefer that and `JSON.parse` instead — check for a `--format`/`--json` flag on `models` specifically before hand-parsing text.
- Config alternative: `model` and `small_model` keys exist in `opencode.json` (`"model": "anthropic/claude-sonnet-4-5"`) but that's for defaulting, not enumerating — not useful for `listModels()`.

## 6. Working directory & folder trust

- Flag: **`--dir <path>`** on `opencode run` ("Sets execution directory"). Pass both `spawnCli(..., { cwd: workingDirectory })` (matches every other adapter's pattern) **and** `--dir <workingDirectory>` explicitly, mirroring Antigravity's belt-and-suspenders `cwd` + `--add-dir`.
- **No first-run "trust this folder?" interactive prompt** was found in opencode's docs (unlike Antigravity/Claude Code). Permission handling is purely the per-tool `allow`/`deny`/`ask` model in §4 — `external_directory` (paths outside the working dir) defaults to `ask`, closed by `--auto`. **No `ensureFolderTrusted()`-equivalent pre-seed step is needed.**

## 7. Session ID: capture & resume

- **No mtime-scan recovery hack needed** (unlike Antigravity) — `--format json` mode prints the session ID directly and continuously: **every JSONL event includes a top-level `sessionID` field**, format `ses_XXXXXXXXXXXXXXXXXXXX` (e.g. `ses_494719016ffe85dkDMj0FPRbHK`). Capture it from the **first** parsed event, exactly like Codex's `capturedThreadId = event.thread_id` on `thread.started` — here just take `sessionID` off the first successfully-parsed JSON line.
- Resume flag: **`--session <sessionID>` / `-s`** on `opencode run` — "Continues specific session ID." Map directly to `options.resumeSessionId` → `args.push('--session', options.resumeSessionId)`.
- Related but distinct flags not needed for our case: `--continue`/`-c` (resumes the _last_ session, no explicit ID — not useful since we always have an explicit `resumeSessionId` when resuming) and `--fork` (branches a new session off an existing one — not part of Ptah's resume contract).
- Session listing/management also exists as `opencode session list [-n|--max-count] [--format]` and `opencode session delete <id>` if a cleanup path is ever wanted, but not required for the adapter contract.
- On-disk session storage location was not pinned down precisely in docs (would live under the XDG-style data dir alongside `auth.json` — see §9) — irrelevant since we don't need the mtime-scan fallback opencode's stream already gives us the ID directly.

## 8. MCP configuration

- `supportsMcp = true`. Uses the same "write a JSON config file, HTTP/remote transport, point at `http://localhost:<port>`" shape as Antigravity/Codex.
- Config key: `mcp` block inside `opencode.json` (also `.jsonc` supported). Shape for a remote (Streamable-HTTP) server:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "ptah": {
      "type": "remote",
      "url": "http://localhost:<mcpPort>",
      "enabled": true
    }
  }
}
```

(`headers` object also supported for auth, e.g. `{"Authorization": "Bearer <token>"}` — not needed for Ptah's local unauthenticated MCP server.)

- **Recommended scope: project-level config file at `<workingDirectory>/opencode.json`**, NOT the ambiguous global config path (see §9 for why global path is uncertain on Windows). Read-merge-write pattern identical to `AntigravityCliAdapter.configureMcpServer()`/`cleanupMcpEntry()`:
  1. Before spawn (if `options.mcpPort` set): read `<workingDirectory>/opencode.json` (if present, parse; else start `{}`), merge in `mcp.ptah = { type: 'remote', url: 'http://localhost:'+port, enabled: true }`, write back.
  2. After `done` resolves: re-read, delete `config.mcp.ptah`, drop the `mcp` key entirely if now empty, write back — exactly like `cleanupMcpEntry()`.
  - Risk: this touches the user's actual project-root config file (not a CLI-private directory like `~/.gemini/`), so a concurrent user edit during a run could be clobbered by our read-merge-write. Same class of risk Antigravity already accepts for its global config; acceptable, but worth a one-line comment in the adapter.
  - Config precedence note: docs state "remote config is loaded first ... project config overrides" — project-root `opencode.json` is the **highest-precedence local layer** other than machine-managed policy files, so writing there reliably wins.

Sources: https://opencode.ai/docs/mcp-servers/ , https://opencode.ai/docs/config/

## 9. Auth

- Interactive: `opencode auth login [--provider|-p] [--method|-m]` walks through provider OAuth/API-key entry and writes credentials to **`~/.local/share/opencode/auth.json`** (per official CLI docs — XDG data-home convention). `opencode auth list`/`opencode auth logout` manage it.
- Env-var / config-based (better fit for headless Ptah): providers can be configured via `opencode.json`'s `provider.<id>.options.apiKey` using `"{env:VAR_NAME}"` substitution, or simply by having the provider's standard env var set in the spawn environment (e.g. `ANTHROPIC_API_KEY`, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `CLOUDFLARE_API_TOKEN`, `NVIDIA_API_KEY`, `DIGITALOCEAN_ACCESS_TOKEN`, etc. — table of confirmed provider→env-var mappings in §5 source). OpenAI specifically favors browser OAuth over a bare env var per the provider docs.
- `ensureTokensFresh()` implementation: read `~/.local/share/opencode/auth.json` (resolve `$HOME`/`$USERPROFILE` first, mirroring `CodexCliAdapter.getAuthPath()`'s env-first pattern) and return `true` if it parses and contains at least one provider entry; **on Windows the actual on-disk path is unconfirmed** — XDG `~/.local/share/...` is not native to Windows, and community reports show real inconsistency between `~/.config/...` and `%APPDATA%\...` for opencode's _config_ directory specifically (see GitHub issues `NoeFabris/opencode-antigravity-auth#251/#265/#295`), so the _data_ dir (`auth.json`'s home) may follow the same ambiguity. **Recommend**: check `~/.local/share/opencode/auth.json` first, then fall back to `%APPDATA%\opencode\auth.json` on `win32`, and as a final fallback treat presence of any known provider API-key env var (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, etc.) in `process.env` as "tokens fresh" — same shape as `CodexCliAdapter.ensureTokensFresh()`'s file-or-fallback check, but this needs a quick empirical confirmation on a real Windows box before shipping.
- No refresh step is documented/needed beyond "credentials present" — like Codex, `ensureTokensFresh()` should just report presence, not attempt an active OAuth refresh.

## 10. Windows caveats

- **Binary/wrapper risk (real, upstream-tracked, not yet fully resolved as of research date)**: multiple `anomalyco/opencode` GitHub issues (`#2447`, `#5476`, `#631`, `#15159`) report that the npm-generated **`opencode.ps1`** wrapper invokes `/bin/sh.exe`, which doesn't exist on stock Windows (no Git Bash on PATH) — causing `'/bin/sh.exe' is not recognized`. The actual native binary ships inside the package at:
  ```
  node_modules/opencode-ai/node_modules/opencode-windows-x64/bin/opencode.exe
  ```
  This mirrors the exact problem `CodexCliAdapter.resolveCodexNativeBinary()` already solves for `@openai/codex-sdk`'s platform packages. **Mitigation plan, in priority order**:
  1. First try the existing `resolveCliPath('opencode')` + `spawnCli()` path unmodified (Ptah's `cross-spawn` invokes `.cmd`, not `.ps1`, via `cmd.exe`, which _may_ sidestep this specific bug — `.cmd` and `.ps1` are separate generated wrappers and the reported breakage is specific to `.ps1`). **Verify empirically on a Windows dev box before assuming this works.**
  2. If the `.cmd` path also breaks (i.e., the `.cmd`'s underlying JS entrypoint itself shells out to `/bin/sh` rather than directly exec-ing the platform `.exe`), add a Codex-style `resolveOpencodeNativeBinary()` helper that walks `require.resolve('opencode-windows-x64/package.json')` (or the ARM64 variant) to find the bundled `.exe` directly, bypassing the wrapper entirely — same resolution-order pattern as `resolveCodexNativeBinary()` in `codex-cli.adapter.ts:217-319`.
  - This is the single biggest feasibility risk in this integration and should be the first thing spiked/tested, since it gates whether Windows users get anything at all.
- ConPTY: no evidence opencode uses `node-pty`/ConPTY internally for its own shell tool execution (unlike Antigravity's `agy`), so the `needsConsole: true` / `NODE_PTY_USE_CONPTY=0` dance Antigravity needs is **probably unnecessary** — but worth a quick smoke test since opencode's `bash` tool does shell out internally and its behavior under Ptah's hidden/headless console isn't documented.
- Path separators: `--dir <workingDirectory>` — pass the Windows path as-is (no forward-slash normalization observed as required, unlike Antigravity's `trustedWorkspaces` array which needed backslash normalization); no evidence opencode is picky here, but worth defensive testing.
- Ctrl+C handling issue reported (`#15159`) is about interactive TUI mode, not `run`/headless mode — irrelevant to our spawn-and-wait model since we manage the child process lifecycle ourselves via `abortController`/`child.kill('SIGTERM')`.

---

## Implementation checklist (for the backend dev)

1. New file `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts`, class `OpencodeCliAdapter implements CliAdapter`, `name = 'opencode'`, `displayName = 'opencode'`, `supportsMcp = true`, `supportsSteer() = false`.
2. Add `'opencode'` to the `CliType` union in `libs/shared/src/lib/types/agent-process.types.ts:49-54`.
3. Register in `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/index.ts` (barrel export) and `cli-detection.service.ts` (`this.adapters.set('opencode', new OpencodeCliAdapter())`, plus update the init log line at `cli-detection.service.ts:44`).
4. `runSdk()`: build args `['run', '--format', 'json']`, `--auto` if `autoApprove !== false`, `--model <model>` if set, `--dir <workingDirectory>`, `--session <resumeSessionId>` if resuming, then the built prompt (`buildTaskPrompt(options)`) as the trailing positional arg. Spawn via `spawnCli(binary, args, { cwd: workingDirectory })`. Buffer stdout by line (like Antigravity), `JSON.parse` each line in a `try/catch` (skip non-JSON/partial lines defensively), dispatch per the table in §2, capture `sessionID` from the first parseable event.
5. `listModels()`: spawn `opencode models`, parse stdout defensively (verify real format first — see §5).
6. `ensureTokensFresh()`: check `~/.local/share/opencode/auth.json` → Windows `%APPDATA%\opencode\auth.json` fallback → provider env var fallback (see §9).
7. MCP wiring: `configureMcpServer(port)` / `cleanupMcpEntry()` against `<workingDirectory>/opencode.json`'s `mcp.ptah` key, called around the spawn exactly like `AntigravityCliAdapter` (§8).
8. **Before merging**: spike-test on a real Windows machine that `resolveCliPath('opencode')` + `spawnCli()` actually launches successfully (the `.ps1`-vs-`.cmd` question in §10) — this is the one open risk that could block Windows support entirely and should be resolved first, ideally before writing the rest of the adapter.

## Primary sources

- https://opencode.ai/docs/sdk/ — SDK overview (`createOpencode`, `createOpencodeClient`, session/config/auth/event methods)
- https://opencode.ai/docs/cli/ — full CLI command/flag reference
- https://opencode.ai/docs/config/ — `opencode.json` schema, config precedence, MCP/provider/permission keys
- https://opencode.ai/docs/mcp-servers/ — MCP `local`/`remote` server config shape
- https://opencode.ai/docs/permissions/ — permission defaults, `--auto` semantics
- https://opencode.ai/docs/providers/ — model ID format, provider env vars
- https://www.npmjs.com/package/opencode-ai — npm package name confirmation
- https://github.com/anomalyco/opencode/issues/2447 , #5476, #631, #15159 — Windows wrapper/`.ps1`/`/bin/sh.exe` breakage reports (community-reported, not primary docs — treat as risk signal, verify empirically)
- https://github.com/anomalyco/opencode/issues/20864 , #9070 — confirms no single `--yolo` flag exists
- https://littlebearapps.com/help/untether/opencode-stream-json-cheatsheet/ — third-party JSONL event shape cheatsheet for `--format json` (cross-checked against GitHub issues referencing the same field names — `#26855`, `#29997` — for internal consistency; treat exact field list as best-effort, verify against a live run before finalizing the segment-mapping table)
- https://github.com/NoeFabris/opencode-antigravity-auth/issues/251 , #265, #295 — Windows config-path ambiguity (`~/.config` vs `%APPDATA%`) reports
