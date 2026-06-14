# Handoff — CLI agent turns go text-only (tools never dispatch)

> **Mission:** The Ptah **CLI** (`ptah session start` / `ptah interact`) produces
> **text-only** agent turns — the model announces intent ("I'll create the file
> now.") then the turn ends with **no `tool_use`**, no file written. The exact
> same shared core **works in the Electron app**. Find the divergence via a
> **one-to-one comparison of the Electron (working) path vs the CLI (broken)
> path** and fix the CLI.

Created 2026-06-14. Author: prior session (Opus 4.8). Status: **root cause NOT
found; bug fully characterized + localized.**

---

## 1. Confirmed symptom + reproduction

On the `claude-cli` route, a tool-requiring task returns text only:

```bash
# Broken (CLI). Use an isolated config dir so ~/.ptah is untouched.
cd D:/projects/ptah-extension
CFG=/tmp/cfg-$$; mkdir -p "$CFG"; SC=/tmp/sc-$$; mkdir -p "$SC"
node dist/apps/ptah-cli/main.mjs --config "$CFG" config set authMethod claude-cli
node dist/apps/ptah-cli/main.mjs --config "$CFG" config set model.selected sonnet
PTAH_LOG_LEVEL=debug node dist/apps/ptah-cli/main.mjs --quiet --config "$CFG" session start \
  --task "Use the Write tool to create a file named PING.txt containing exactly PONG in the current working directory. Then confirm." \
  --once --auto-approve --cwd "$SC" 1>"$SC/out.ndjson" 2>"$SC/err.log"
grep -oE '"method":"(agent\.(tool_use|tool_result|message)|task\.(complete|error))"' "$SC/out.ndjson" | sort | uniq -c
ls "$SC"/PING.txt   # → does NOT exist
```

**Observed event spine:** `session.ready → system.schema.version → agent.message (×4) → task.complete`.
No `agent.tool_use`, no `agent.tool_result`, exit 0, `task.complete` (silent
"success"). Same on `ptah interact` task.submit.

**Two concrete anomalies in the stream (the best leads):**

1. A `type:"user"` message with **`isReplay:true`** is emitted on a `--once`
   **first** turn (logged by `SdkMessageTransformer` as "Unknown message type").
   Replay normally means _resume_ — why is a fresh turn replaying?
2. The assistant text is **doubled**: streamed deltas (`"I"`, `"'ll create the
file now."`) **plus** a full replayed copy, so the `task.complete` summary
   reads `"I'll create the file now.I'll create the file now."` This doubling
   also appears in the TUI and is a backend stream/replay artifact (distinct
   from the TUI `<Static>` issue already fixed).

---

## 2. Already ruled OUT (do not re-investigate)

- **Model**: fails on `opus[1m]` AND plain `sonnet`. Not model-specific, not the
  `[1m]` suffix.
- **The `'default'` model bug**: separate, already fixed (see §6).
- **Plan mode**: `permissionMode` defaults to `'default'` (sdk.d.ts:1586), not
  `'plan'`/`'dontAsk'`.
- **Tools not configured**: `tools: { type:'preset', preset:'claude_code' }` is a
  valid SDK option meaning "use all default Claude Code tools"
  (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1320`). `maxTurns:200`,
  `canUseTool` wired, `includePartialMessages:true`.
- **The binary itself**: `claude -p --allowedTools Write "create a file"` writes
  the file directly — the claude CLI can tool-call; the break is in Ptah's
  wrapper.
- **HEAD vs published**: the ONLY cli/agent-sdk commit since the `cli-v0.2.5` tag
  is the `'default'`→opus fix. **HEAD ≡ v0.2.5** for this path — the bug is live
  in both. Reproduced on a fresh `nx build ptah-cli` HEAD build.

---

## 3. THE strategy: one-to-one Electron (works) vs CLI (broken)

The model-facing pieces are **shared** across runtimes:

- Chat handler: `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`
- SDK adapter: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`
- Query options builder: `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`
- Query runner: `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts`
- Stream transform: `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts`

So the divergence is almost certainly in **the app/platform layer** — what each
runtime _injects/configures around_ that shared core. Compare these between
`ptah-electron` (works) and `ptah-cli` (broken):

### 3a. The literal SDK query options at spawn

Instrument **`sdk-query-runner.service.ts` ~line 278-281** (just before
`queryFn(options)` is called) to dump the FULL options object. Run the broken
CLI repro AND a working Electron turn, then **diff** the two option objects.
Prime suspects to compare: `cwd`, `env`, `settingSources`, `pathToClaudeCodeExecutable`,
`permissionMode`, `canUseTool` presence, `mcpServers`, `tools`, `resume`,
`includePartialMessages`, `model`.

### 3b. Warm-query / prewarming (LEADING HYPOTHESIS)

The `isReplay:true` on a first turn + the doubled text strongly suggest a
**prewarmed/warm SDK query** is being consumed for turn 1 in a degenerate state.

- Find the WarmQuery service in `agent-sdk` (grep `WarmQuery` / `warm` / `prewarm`
  under `libs/backend/agent-sdk/src/lib`). See memory
  `project_sdk_warm_query_cwd_locked_to_spawn` — a warm query's cwd is locked at
  spawn and must be discarded on workspace switch; a stale warm query can run
  rooted at `process.cwd()` (the install dir).
- Determine: does the **CLI** consume a warm/prewarmed query for the first turn?
  Does **Electron**? If only the CLI does (or does it differently), that's the
  divergence. A warm query spawned with empty/replayed state would explain the
  `isReplay` + a tool-less degenerate turn.
- Also see `project_background_workspace_streaming` (sanitize = intentional
  cold-start guard, "don't resume") — confirm the CLI isn't accidentally
  resuming/replaying.

### 3c. Permission / `canUseTool` wiring

- CLI: `apps/ptah-cli/src/cli/session/approval-bridge.ts` +
  `cli-fire-and-forget-handler.ts` provide the permission round-trip.
- Electron: its own permission handler.
- A model that never _attempts_ a tool isn't a permission denial (that would emit
  a `tool_use` + a deny event — see sdk.d.ts:3308 "auto-denied" event). But verify
  the `canUseTool` callback isn't throwing during init in a way that nukes tools,
  and that the CLI path actually passes the same `permissionMode`/callback Electron does.

### 3d. DI / bootstrap phase differences

Diff the platform adapter registration and app bootstrap:

- `libs/backend/platform-cli/` vs `libs/backend/platform-electron/` (workspace
  provider, secret storage, file system, the claude-cli path resolver/`IModelDiscovery`).
- `apps/ptah-cli/src/di/container.ts` + `apps/ptah-cli/src/cli/bootstrap/with-engine.ts`
  vs the Electron `phase-0-platform … phase-4-app` bootstrap.
- Look for anything the CLI registers as a **stub/no-op** that Electron registers
  for real (e.g. an MCP/tool server, code-exec tools, a capability flag) that
  would strip the model's tools. Note: `vscode-lm-tools` provides the in-process
  code-exec MCP — is it wired identically in CLI vs Electron?

### 3e. `settingSources` / `pathToClaudeCodeExecutable` / cwd

`SdkModelService.fetchModelsViaSdk` sets `settingSources` and
`pathToClaudeCodeExecutable` (the cli.js path via `SdkModuleLoader.getCliJsPath`).
Confirm the CLI resolves the SAME `cli.js` and the SAME `settingSources` the
Electron path uses for the chat query. A wrong `settingSources` (e.g. missing
`'project'`/`'user'`) or a different bundled cli.js could disable tools.

---

## 4. Concrete next steps (suggested order)

1. **Build HEAD CLI**: `nx build ptah-cli` (note: the dev build is missing
   `embedder-worker.mjs` — a separate bundle like `tui.mjs`; harmless BM25
   fallback, ignore the `MODULE_NOT_FOUND` stderr).
2. **Instrument** `sdk-query-runner.service.ts:~278` to JSON-log the full options,
   and `stream-transformer.ts` (~310-452) to count raw `tool_use` blocks the SDK
   emits. Rebuild.
3. **Capture the broken CLI run** (repro in §1) → save options + raw stream.
4. **Capture a working Electron run**: `npm run electron:serve`, ask it the same
   "create PING.txt with Write" task, capture the same instrumented logs.
5. **Diff** the two option objects + raw streams. The first meaningful difference
   is the bug.
6. If the diff points at warm-query/replay, look at how the CLI starts turn 1 vs
   Electron (warm consume vs cold start) and fix the CLI to match Electron.
7. Re-run the CLI repro → expect `agent.tool_use` + `PING.txt` created.
8. (Optional, deferred) surface empty/no-content turns as `task.error` instead of
   silent `task.complete` — see memory `project_claude_cli_default_model_fable_empty_turn`.

---

## 5. Environment / gotchas

- **Isolated config** for tests: `--config /tmp/cfg` overrides the data dir
  (default `~/.ptah`) so you never touch the user's real settings. claude-cli auth
  lives in `~/.claude` (shared) and works regardless. Set `authMethod=claude-cli`
  - `model.selected=sonnet` (or `opus[1m]`) in the isolated dir.
- **Do NOT mutate** the user's `~/.ptah/settings.json` or global `~/.claude/settings.json`.
  (A prior subagent already changed the global claude default `fable-5[1m]`→`opus[1m]`
  and the user's `anthropicProviderId` is `null` from a `set-anthropic-route default`
  command — leave both unless the user asks.)
- **Concurrent WIP**: the working tree has an in-flight `settings-core` refactor
  (`scope/` dir, `computed-setting-handle.ts`, registration files) + `docs/video-content-plan.md`
  that belong to the user/a sibling agent. **Do not touch or stage them.** Use
  explicit per-file `git add`.
- `PTAH_AUTO_APPROVE=true` / `--auto-approve` for unattended runs; logger output is
  on **stderr**, JSON-RPC on **stdout** (parse separately).

---

## 6. Already done this session (don't redo)

| Fix                                                                       | Branch                         | Commit      |
| ------------------------------------------------------------------------- | ------------------------------ | ----------- |
| TUI `<Static>` → bounded viewport (chat escaped frame, dup, settings OOM) | `fix/tui-message-list-static`  | `1e1d87c1`  |
| Map literal `'default'` model → `opus` on Anthropic-native routes         | `fix/claude-cli-default-model` | `6d5775da1` |
| `anthropicProviderId` default `'openrouter'` → `''`                       | `fix/claude-cli-default-model` | `2cf4390e0` |

Neither model nor settings fix addresses THIS tool-dispatch bug — they're
adjacent correctness fixes. PRs for these two branches are pending.

## 7. Relevant memory (read first)

- `project_cli_claude_cli_tooluse_textonly` — this bug, full detail.
- `project_sdk_warm_query_cwd_locked_to_spawn` — warm-query cwd/replay pitfalls.
- `project_background_workspace_streaming` — cold-start sanitize / don't-resume.
- `project_claude_cli_default_model_fable_empty_turn` — adjacent empty-turn/model issue.
- `project_di_architecture_invariants` — per-runtime child containers + load-bearing service-locator sites (relevant to the CLI-vs-Electron DI diff).

---

## 8. Key code map (gathered this session)

- `apps/ptah-cli/src/cli/commands/interact.ts:423-487` — `task.submit` → `chat:start`/`chat:continue` (no model/tools passed; relies on server-side config).
- `apps/ptah-cli/src/cli/session/chat-bridge.ts:~281-300` — demuxes SDK chunk events into `agent.*` notifications (would forward `tool_use` if it arrived).
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` — shared `chat:start/continue` handler; builds session config.
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:~465-627` — `startSession`/`continueSession`; `sessionConfigWithProfileModel`, `model: config?.model ?? 'default'`.
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:495-627` — builds SDK options: `permissionMode='default'` (497), `maxTurns` (615), `tools: claude_code preset` (617-620), `mcpServers` (621), `permissionMode` (625), `canUseTool` (626), `includePartialMessages` (627).
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:~278-281` — invokes `queryFn(options)` ← **instrument here**.
- `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:~310-452` — SDK message → flat events; `isResultMessage` block; the `isReplay` user message is logged "Unknown message type" by `SdkMessageTransformer`.
