# Research: Integrating "Pi" (pi.dev) as a Ptah CLI Adapter — TASK_2026_160

## 0. Headline Verdict

**pi.dev is a real, fully-fledged agentic coding CLI** — not an inference API, not the OSIsoft/AVEVA "PI System SDK", not Pi Network crypto. It is **Pi Coding Agent** by **Earendil Inc.** (open source, MIT, `earendil-works/pi` on GitHub), a terminal coding agent in the same category as Codex CLI / Claude Code / Antigravity, with a genuine multi-provider model backend (Anthropic, OpenAI, Google, DeepSeek, Mistral, Groq, xAI, OpenRouter, Bedrock, Vertex, Azure).

**Feasibility: HIGH.** It fits the `CliAdapter` contract cleanly — better than Antigravity, in fact, because Pi ships a **documented, versioned JSONL event stream mode** (`pi --mode json`) whose first line is a session header containing the session UUID, and whose event union (`tool_execution_start/update/end`, `message_update` with `text_delta`/streaming deltas, `turn_end`, `agent_end`) maps almost 1:1 onto `CliOutputSegment`. This makes Pi closer to the **Codex flavor** (structured JSONL events) than the Antigravity flavor (heuristic plain-text line classification) — except delivered via spawn+stdout parsing rather than an in-process SDK import, which is simpler and lower-risk to implement.

**Recommended approach: spawn the `pi` binary with `--mode json <prompt>` and parse the JSONL event stream from stdout.** Do NOT take a hard dependency on the `@earendil-works/pi-coding-agent` npm SDK (`createAgentSession()`) as the primary path — it exists and is genuinely in-process (like the Codex SDK), but its public TypeScript surface is thinly documented outside the source tree (no published `.d.ts` reference equivalent to what `codex-cli.adapter.ts` relies on), so nailing exact types would require vendoring/reading the actual package source at implementation time. The spawn+JSONL path uses only documented, stable CLI contracts.

**One critical behavioral fact for the headline:** Pi has **no tool-approval/permission-gating system at all** — "Pi has no permission popups by design" (its own security docs). Tools execute with the OS-level permissions of the process, always, in every mode (interactive TUI, `-p`, `--mode json`, `--mode rpc`). This means there is **no `--dangerously-skip-permissions`-equivalent flag to pass** — headless execution is the _default and only_ behavior. This is a real difference from Codex (`approvalPolicy: 'never'`) and Antigravity (`--dangerously-skip-permissions`) and must be called out to the user/product owner as a security consideration, not just an implementation detail.

Sources: https://pi.dev/docs/latest/sdk , https://github.com/earendil-works/pi , https://pi.dev/docs/latest/usage , https://pi.dev/docs/latest/json , https://pi.dev/docs/latest/security , https://pi.dev/docs/latest/sessions , https://pi.dev/docs/latest/providers , https://pi.dev/docs/latest/quickstart , https://pi.dev/docs/latest/models , https://pi.dev/docs/latest/settings , https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/windows.md , https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/session-format.md , https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/json.md , https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/rpc.md

---

## 1. What is PI? (vendor / product / CLI binary)

- **Vendor**: Earendil Inc. (`earendil-works` on GitHub/npm).
- **Product**: "Pi" — an AI agent toolkit split into packages: `@earendil-works/pi-ai` (unified multi-provider LLM API), `@earendil-works/pi-agent-core` (agent runtime/tool-calling loop), `@earendil-works/pi-coding-agent` (the CLI + SDK we care about), `@earendil-works/pi-tui` (terminal UI lib).
- **License**: MIT, open source, actively released (247 releases, latest v0.80.10 as of July 2026 per GitHub).
- **CLI binary**: `pi`, installed globally via:
  ```
  npm install -g --ignore-scripts @earendil-works/pi-coding-agent
  ```
  Version check: `pi -v` / `pi --version`. Detect via `pi -h`/`pi --help`.
- **Disambiguation warning** (for the record, since "PI" is ambiguous): this is NOT OSIsoft/AVEVA's industrial "PI System SDK", NOT Pi Network (crypto), and NOT a bare inference API. It genuinely is a coding-agent CLI comparable to Codex/Claude Code.

## 2. Headless one-shot execution

Three non-interactive modes, all documented as NOT showing an interactive trust prompt:

- **Print mode** — plain text out, one-shot: `pi -p "Summarize this codebase"` (also accepts piped stdin: `cat README.md | pi -p "Summarize this text"`).
- **JSON event stream mode** (recommended for the adapter):
  ```
  pi --mode json "Your prompt"
  ```
  Outputs one JSON object per line to stdout. First line is a session header:
  ```json
  { "type": "session", "version": 3, "id": "uuid", "timestamp": "2024-12-03T14:00:00.000Z", "cwd": "/path/to/project" }
  ```
  Followed by the event stream (`AgentSessionEvent` = `AgentEvent | queue_update | compaction_start/end | auto_retry_start/end`), where `AgentEvent` is:
  ```ts
  type AgentEvent = { type: 'agent_start' } | { type: 'agent_end'; messages: AgentMessage[] } | { type: 'turn_start' } | { type: 'turn_end'; message: AgentMessage; toolResults: ToolResultMessage[] } | { type: 'message_start'; message: AgentMessage } | { type: 'message_update'; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent } | { type: 'message_end'; message: AgentMessage } | { type: 'tool_execution_start'; toolCallId: string; toolName: string; args: any } | { type: 'tool_execution_update'; toolCallId: string; toolName: string; args: any; partialResult: any } | { type: 'tool_execution_end'; toolCallId: string; toolName: string; result: any; isError: boolean };
  ```
  Sample sequence (from docs):
  ```json
  {"type":"agent_start"}
  {"type":"turn_start"}
  {"type":"message_start","message":{"role":"assistant","content":[],...}}
  {"type":"message_update","message":{...},"assistantMessageEvent":{"type":"text_delta","delta":"Hello",...}}
  {"type":"message_end","message":{...}}
  {"type":"turn_end","message":{...},"toolResults":[]}
  {"type":"agent_end","messages":[...]}
  ```
  `AssistantMessageEvent` is a delta union (`text_delta` confirmed with `{ type, contentIndex, delta }`; a `thinking_delta` variant almost certainly exists by symmetry with `text_delta` — **not independently confirmed in the fetched docs; verify against the installed package's shipped `.d.ts` or a live `pi --mode json` run before wiring the thinking-segment mapping**).
- **RPC mode** (not recommended — adds a stdin protocol layer for no benefit over `--mode json` for one-shot execution): `pi --mode rpc`, JSONL requests/responses over stdin/stdout (`{"id":"req-1","type":"prompt","message":"..."}` → immediate `{"id":"req-1","type":"response","command":"prompt","success":true}` ack, then async events). Session id retrievable via a `get_state` RPC response (`{"sessionId":"abc123","sessionFile":"/path/..."}`).

### Mapping to `CliOutputSegment`

| Pi JSON event                                                                     | CliOutputSegment                                                               |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `message_update` w/ `assistantMessageEvent.type === "text_delta"`                 | `{ type: 'text', content: delta }`                                             |
| `message_update` w/ `assistantMessageEvent.type === "thinking_delta"` (to verify) | `{ type: 'thinking', content: delta }`                                         |
| `tool_execution_start`                                                            | `{ type: 'tool-call', toolName, toolArgs: JSON.stringify(args), toolCallId }`  |
| `tool_execution_end` (isError: false)                                             | `{ type: 'tool-result', content: JSON.stringify(result), toolCallId }`         |
| `tool_execution_end` (isError: true)                                              | `{ type: 'tool-result-error', content: ..., toolCallId }`                      |
| top-level session header (`type:"session"`)                                       | captured session id (`getSessionId()`), not emitted as a segment               |
| stderr / non-zero exit                                                            | `{ type: 'error', content: ... }` (same pattern as Antigravity/Codex adapters) |

This is directly analogous to `codex-cli.adapter.ts`'s `handleStreamEvent`/`handleItemStarted`/`handleItemCompleted` dispatch — the adapter would parse line-delimited JSON from `child.stdout` instead of iterating an SDK `AsyncGenerator`, but the segment-emission logic is nearly a port of the existing Codex handler.

## 3. SDK shape — spawn vs SDK-dep recommendation

- **npm package**: `@earendil-works/pi-coding-agent` (TypeScript/Node.js). It is a **local, self-hosted agent runtime**, not a client to a remote Pi-operated server — Pi itself talks directly to model providers (Anthropic/OpenAI/etc. APIs) using the caller's own credentials. There is no "Pi cloud API" in the way Cursor/Copilot have hosted backends.
- **In-process SDK surface** (from `docs/sdk.md`):

  ```ts
  import { createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent';

  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(), // or SessionManager.create(cwd)
    cwd,
    model,
    thinkingLevel,
    tools,
    customTools,
    resourceLoader,
    settingsManager,
  });
  session.subscribe((event) => {
    /* same AgentEvent union as --mode json */
  });
  await session.prompt('task text'); // fire a turn
  await session.steer('text'); // interrupt-and-redirect
  await session.followUp('text'); // queue after current turn
  await session.abort(); // cancel — maps to SdkHandle.abort
  ```

  Tool execution: **"Tools execute automatically without requiring approval callbacks"** — confirms point 4 below at the SDK layer too.

- **Recommendation**: **spawn-binary, not SDK-dep**, for the initial adapter. Rationale:
  1. The `runSdk` contract already explicitly permits (and the Antigravity adapter already does) "adapters that wrap a binary CLI spawn it internally and adapt its output to an SdkHandle" — spawning `pi --mode json` is the intended shape for exactly this case.
  2. `--mode json`'s event schema is publicly documented and versioned (`"version":3` in the session header signals the authors treat it as a stable contract), unlike the SDK's internal types which are not published as a standalone `.d.ts` reference — the Codex adapter's confidence in exact types comes from OpenAI publishing `@openai/codex-sdk` with real `.d.ts`; Pi's SDK docs are comparatively thin and some fields (e.g. full `AssistantMessageEvent` union, `CreateAgentSessionOptions` completeness) are not fully enumerated in public docs.
  3. Spawn avoids bundling/version-pinning a second large agent-runtime dependency into Ptah's esbuild bundle (Codex's SDK is already a special case requiring native-binary path resolution gymnastics — see `resolveCodexNativeBinary`; adding a second in-process SDK compounds that maintenance surface for uncertain benefit).
  4. If a future iteration wants tighter control (steer/follow-up while running, no subprocess overhead), the SDK route can be revisited — `session.steer()`/`session.followUp()` map naturally to a `supportsSteer(): true` adapter, which spawn-based `--mode json` cannot offer (stdin isn't part of the JSON-mode contract for mid-run steering; RPC mode would be needed for that, see §11 below).

## 4. Auto-approve / skip-permissions

**There is no such flag, because there is no tool-approval gate to skip.** Per Pi's Security docs: _"Pi runs with the permissions of the user account that starts it... Built-in tools can read files, write files, edit files, and run shell commands with the permissions of the pi process."_ And explicitly: _"Pi has no permission popups by design... you can run it in a container or build your own confirmation flow with extensions."_ This holds in `-p`, `--mode json`, and `--mode rpc` identically — none show a trust/approval prompt for tool calls.

Adapter implication: `options.autoApprove` has **no corresponding CLI flag to map to** — tool execution is unconditionally auto-approved by Pi itself. The adapter should simply not emit any approval-related flag (there's nothing to pass). This should be surfaced as a product/security note: Ptah's `autoApprove: false` (require confirmation) semantics **cannot be honored** for the Pi adapter — flag this as a known limitation in the PR description, not silently ignore it.

What Pi _does_ gate is **project-local config trust** (loading `.pi/` settings/extensions from the repo, not tool execution) — see §6.

## 5. Model selection + listModels()

- **Selection flag**: `--model <pattern>`, supports `provider/id` (e.g. `openai/gpt-4o`) and an optional thinking suffix `:<level>` (e.g. `sonnet:high`). Separate `--provider <name>` flag also exists (anthropic, openai, google, etc.) but `--model` alone with a `provider/id` pattern is sufficient.
- **Thinking effort**: separate `--thinking <level>` flag: `off | minimal | low | medium | high | xhigh | max`. This is the natural mapping target for `CliCommandOptions.reasoningEffort` (note Pi's scale has both `off` and `max` beyond Codex's `minimal..xhigh`).
- **listModels()**: `pi --list-models [search]` — "Current behavior: `/model`, `--list-models`, and the interactive footer display entries by model `id`." **Exact stdout format was not available in the fetched docs (no sample output shown) — verify at implementation time** by running `pi --list-models` and adapting the Antigravity pattern (`probeModels()` spawning `agy models` and parsing lines) — likely one model per line, id-labeled, possibly grouped by provider. Custom/local models (Ollama, LM Studio, vLLM) are configured in `~/.pi/agent/models.json`:
  ```json
  {
    "providers": {
      "provider-name": {
        "baseUrl": "http://endpoint/v1",
        "api": "openai-completions",
        "apiKey": "key-or-placeholder",
        "models": [{ "id": "model-identifier" }]
      }
    }
  }
  ```
  (Only `id` required per model for local providers — this file reloads live, no restart needed.)

## 6. Working directory flag + folder-trust suppression

- **No `--cwd` flag documented.** Working directory is simply the process's own `cwd` — exactly like every other spawn-based adapter (`spawnCli(binary, args, { cwd: options.workingDirectory })`), no extra flag needed. (No `--add-dir` equivalent either — Pi doesn't have Antigravity's multi-root "add-dir" concept; it operates on a single project rooted at `cwd`.)
- **Folder/project trust** (loading `.pi/` project config, not tool gating): controlled by `-a`/`--approve` ("Trust project-local files for this run") vs `-na`/`--no-approve` ("Ignore project-local files for this run"), and a persistent `/trust` interactive command. Default behavior (`defaultProjectTrust` global setting in `~/.pi/agent/settings.json`, default `"ask"`) means **non-interactive runs without `-a` will silently ignore project-local `.pi/` config** rather than hang — so passing `-a` isn't strictly required to avoid a hang (unlike Antigravity's trust prompt, which blocks), but IS required if Ptah wants Pi to respect any `.pi/` project-level settings/extensions/skills in the target repo. **Recommendation: always pass `-a`/`--approve`** in the adapter (analogous to Antigravity's `ensureFolderTrusted`, but simpler — a flag, not a settings-file mutation) so project-local skills/extensions aren't silently dropped.

## 7. Session ID: printed / resume / on-disk recovery

- **Printed on headless run**: **YES**, in `--mode json` — the session header is literally the first stdout line: `{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"..."}`. This is strictly better than both reference adapters (Codex gets it from a `thread.started` event mid-stream; Antigravity has to recover it post-hoc via mtime scanning) — parse this first line directly for `getSessionId()`.
- **Resume flag**: `--session <path|id>` (use specific session file or UUID) — this is the flag to map `CliCommandOptions.resumeSessionId` to: `args.push('--session', options.resumeSessionId)`. Also available: `-c`/`--continue` (most recent session, no id needed) and `-r`/`--resume` (interactive picker, not usable headlessly) and `--fork <path|id>` (branch into a new session, preserving `parentSession` lineage).
- **On-disk session persistence path** (fallback/mtime-recovery pattern, not actually needed given §7's stdout header, but documented for completeness / defense-in-depth):
  ```
  ~/.pi/agent/sessions/--<cwd-with-slashes-as-dashes>--/<timestamp>_<uuid>.jsonl
  ```
  Each session is a JSONL tree-structured file; entries carry `id`/`parentId` for branching. Custom root via `--session-dir <dir>` / `sessionDir` setting.

## 8. MCP config file path + JSON shape

**Not supported. `supportsMcp: false`.** Confirmed independently from both the extensions docs and the settings docs: _"Pi does not appear to support MCP (Model Context Protocol) servers... Pi's extensibility model relies on: Custom tool registration via `pi.registerTool()`, Provider registration via `pi.registerProvider()`, Event subscriptions via `pi.on()`."_ and _"There is no MCP server configuration documented."_ No config path, no JSON shape — there is nothing to configure. This means the adapter's `runSdk()` must ignore `options.mcpPort` entirely (no Ptah MCP tool bridging possible for Pi-run agents, same posture as Cursor per the interface doc's own note about external CLIs that "cannot" access MCP).

## 9. Auth: API key vs OAuth

- **API key env vars** (set before spawn, read directly by Pi):
  | Provider | Env var |
  |---|---|
  | Anthropic | `ANTHROPIC_API_KEY` |
  | OpenAI | `OPENAI_API_KEY` |
  | DeepSeek | `DEEPSEEK_API_KEY` |
  | Google Gemini | `GEMINI_API_KEY` |
  | Mistral | `MISTRAL_API_KEY` |
  | Groq | `GROQ_API_KEY` |
  | xAI | `XAI_API_KEY` |
  | OpenRouter | `OPENROUTER_API_KEY` |
  | Azure OpenAI | `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_BASE_URL` |
  | Bedrock | `AWS_PROFILE` or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` or `AWS_BEARER_TOKEN_BEDROCK` |
  | Cloudflare | `CLOUDFLARE_API_KEY` + `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_GATEWAY_ID` |
  | Vertex AI | `gcloud auth application-default login` + `GOOGLE_CLOUD_PROJECT` |
- **OAuth / subscription login** (ChatGPT Plus/Pro, Claude Pro/Max, GitHub Copilot subscription, xAI, Radius): interactive-only `/login` slash command inside the TUI — **not scriptable headlessly**, same category limitation as any adapter relying on browser-based OAuth. Tokens land in `~/.pi/agent/auth.json` (mode `0600`), auto-refreshed by Pi itself once present:
  ```json
  { "anthropic": { "type": "api_key", "key": "sk-ant-..." }, "openai": { "type": "api_key", "key": "sk-..." } }
  ```
- **`ensureTokensFresh()` implication**: mirror `CodexCliAdapter.ensureTokensFresh()` — read `~/.pi/agent/auth.json` (env-first `$HOME`/`$USERPROFILE` resolution per the codebase's established pattern), return `true` if any provider entry or a relevant `*_API_KEY` env var is present. Pi manages its own token refresh internally (no manual refresh call needed from Ptah, unlike some OAuth-only adapters) — so `ensureTokensFresh` here is a presence check, not an active refresh trigger, again matching Codex's actual implementation (which also just checks presence, doesn't refresh).

## 10. Windows caveats

**Significant — this is the main integration risk, not the API surface.**

- Pi's own `docs/windows.md` states: **"Pi requires a bash shell on Windows."** It probes for bash in this order: (1) custom `shellPath` in `~/.pi/agent/settings.json`, (2) Git Bash at `C:\Program Files\Git\bin\bash.exe`, (3) `bash.exe` on PATH (Cygwin/MSYS2/WSL). Git for Windows is called out as sufficient for most users. Given this workspace already assumes Git Bash is present (per this very tool's own environment), that dependency is likely already satisfied for Ptah's dev/CI machines but **is not guaranteed for end users** — worth a detection-time warning if bash isn't found, similar in spirit to how the Codex adapter has extensive native-binary path resolution for Windows.
- Known open GitHub issues (as of research date) around Windows installs:
  - `npm`/`pnpm` global install can fail silently on fresh Windows installs (#4399).
  - A regression where `resolveSpawnCommand()` mis-detects the extensionless `npm` bash shim before `npm.cmd`, causing `spawn ... ENOENT` for npm-invoking sub-tools (#4665) — reportedly fixed in a later release; **pin to a recent `pi` version** if bundling install guidance.
  - First-run tool bootstrapping (Pi downloads helper binaries like `fd`) can fail on Windows because it assumes `unzip`/`tar` are on the shell PATH, which isn't guaranteed outside Git Bash.
- Practically for the adapter: use `resolveCliPath('pi')` + `spawnCli` (cross-spawn) exactly like the other adapters — no special `.cmd`-wrapper handling should be needed beyond what `cli-adapter.utils.ts` already provides, since `npm install -g` on Windows produces the standard `.cmd` shim that `cross-spawn`/`resolveDirectSpawn` already handle. The bash-shell requirement is Pi's own internal dependency for _its_ shell-tool execution, not a spawn-mechanics issue for Ptah's side.

## 11. Steering / `supportsSteer()`

Set `supportsSteer(): false` for the initial (spawn + `--mode json`) implementation — matching Codex and Antigravity. `--mode json` is a single fire-and-forget prompt per process invocation; there's no documented way to send additional stdin input mid-run in that mode (unlike Cursor/Copilot's SDK-level continuation). Note: `session.steer()`/`session.followUp()` exist in the **RPC mode** and **in-process SDK** — if steering becomes a requirement later, that would justify revisiting the SDK-dep or RPC-mode approach discussed in §3, but is out of scope for a first cut matching the Codex/Antigravity pattern (Codex's adapter does support `continue()`/multi-turn via `resumeThread`, which is the closer analogy — Pi's `--session <id>` resume flag gives the same capability across separate process invocations, just not mid-stream).

## 12. Concrete adapter skeleton (spec, not code to copy verbatim)

```
class PiCliAdapter implements CliAdapter {
  name = 'pi' as const;
  displayName = 'Pi';
  supportsMcp = false;            // §8

  detect() -> resolveCliPath('pi') + probeCliVersion            // §1
  supportsSteer() -> false                                       // §11
  parseOutput(raw) -> stripAnsiCodes(raw)

  listModels() -> spawn `pi --list-models`, parse stdout          // §5 (verify format at impl time)
  ensureTokensFresh() -> read ~/.pi/agent/auth.json presence      // §9

  runSdk(options):
    args = ['--mode', 'json'];
    args.push('-a');                                              // §6 trust project config
    if (options.model) args.push('--model', options.model);
    if (options.reasoningEffort) args.push('--thinking', options.reasoningEffort);
    if (options.resumeSessionId) args.push('--session', options.resumeSessionId);
    args.push(buildTaskPrompt(options));                          // prompt as trailing positional
    spawnCli(binary, args, { cwd: options.workingDirectory });
    // parse stdout line-by-line as JSON (first line = session header -> getSessionId());
    // dispatch remaining AgentEvent lines per the table in §2.
    // options.mcpPort: ignored (unsupported, §8).
    // options.autoApprove: no-op, always-on (§4) — surface as known limitation.
}
```

Register in `cli-detection.service.ts` (adapters map + constructor log line) and add `'pi'` to the `CliType` union in `libs/shared/src/lib/types/agent-process.types.ts` (currently `'codex' | 'copilot' | 'cursor' | 'antigravity' | 'ptah-cli'`).

## 13. Open items to verify at implementation time (not blocking, but flagged)

1. Exact `thinking_delta` / other `AssistantMessageEvent` variant shapes — only `text_delta` was directly confirmed in fetched docs.
2. Exact `--list-models` stdout format (line-per-model? JSON? grouped by provider?).
3. `AgentMessage.content` block shape for non-delta paths (item.completed-style fallback, mirroring how Codex handles items without deltas) — needed for the "some CLI versions emit full messages instead of deltas" defensive path.
4. Confirm current `pi` version behavior against a real Windows install in this repo's dev environment before shipping (per the open GitHub issues in §10) — pin a known-good version in install guidance if issues persist.

None of these block writing the adapter — they follow the exact same "best-effort, verify against a live run" posture the existing Antigravity adapter already takes for its own heuristics (see its own doc comments admitting "best-effort only").
