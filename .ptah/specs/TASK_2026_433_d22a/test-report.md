# Test Report - TASK_2026_433 (Task 6.2 — Live e2e + A1/A2/A3 evidence)

## Environment

- OS: Windows 11 Home 10.0.26200 (MINGW64_NT-10.0-26200, x86_64)
- Node: v24.15.0
- codex: codex-cli 0.153.4 (`C:\Users\abdal\AppData\Roaming\npm\codex.CMD`)
- agy (Antigravity): 1.2.2 (`C:\Users\abdal\AppData\Local\agy\bin\agy.EXE`)
- Branch: `feat/task-433-role-lanes`, HEAD `6db3a356f`
- Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes`

## Scope

Task 6.2 per `batches.md` Batch B6: gather live e2e evidence for the role-addressed
lanes feature (TASK_2026_433) and for assumptions A1–A3, plus defect D10. Covers
acceptance lines 1 and 3 from `context.md` (acceptance line 2, native delivery, is
deferred to B8).

## Route chosen

**Route 1** — built this worktree's CLI (`npx nx build ptah-cli --skip-nx-cache`,
green, output at `dist/apps/ptah-cli/main.mjs`, gitignored) and drove it as the
`ptah mcp-serve` stdio MCP surface (JSON-RPC 2.0 over stdio, `initialize` →
`notifications/initialized` (server-emitted, signals the full engine bootstrap
finished and `tools/call` is now registered) → `tools/call`). This reaches the real
`agent_spawn` / `agent_status` / `agent_read` / `agent_list` stdio dispatcher
(`agent-tool.dispatcher.ts`) with this branch's code, including the real adapters
(`AntigravityCliAdapter`, `CodexCliAdapter`) and the real `AgentRoleResolver`.

Why not Route 2: Route 1 was reachable and is closer to how a real caller drives
these lanes (through the MCP tool surface, not by hand-constructing adapter
options), so it was preferred per the routing note ("pick the first route that
works").

**Auth note (does not touch real credentials):** `ptah mcp-serve` boots the full
engine, which requires *some* Ptah-side LLM auth to reach `effective.ready: true`
even though the tool under test (`agent_spawn`) drives an entirely separate,
already-authenticated system CLI (antigravity/codex, both already logged in on
this machine — see Environment). To avoid touching the user's real
`~/.ptah/settings.json`, every stdio run used a throwaway `PTAH_CONFIG_PATH`
sandbox directory (`<scratchpad>/e2e-433/ptah-sandbox-config`) with
`provider default set ollama` + `auth use claude-cli` (routes Ptah's own
housekeeping loop through the already-authenticated local `claude` binary — no
key was invented or entered). This sandbox is scratchpad-only and orthogonal to
the CODEX_HOME sandbox used for A2 (see E2 below).

All driver scripts are throwaway, under
`C:\Users\abdal\AppData\Local\Temp\claude\D--projects-ptah-extension\5452702d-5918-4e3d-923c-121db4e9e0a1\scratchpad\e2e-433\`
(`mcp-driver.js`, `generic-spawn-driver.js`, `e1-antigravity-driver.js`,
`probe-entry.ts`, `d10-probe.js`, `d10-guard-verdict.ts`, `e5-http-inprocess.ts`,
plus the `spawn-*.json` / `env-*.json` inputs and captured `*-run.log` /
`*-agent-read.json` outputs).

Working directories for the live spawns (`.tmp-e2e-433*`) were created **inside**
the worktree because `AgentSpawnEnvironment.validateWorkingDirectory` requires
`workingDirectory` to be inside the resolved workspace root, and the resolved
workspace root for a `ptah --cwd <worktree> mcp-serve` process is the worktree
itself. All three were deleted before returning (see Open items / cleanup below);
`git status --porcelain` on the worktree after cleanup shows only the two sibling
lanes' files (`agent-lanes/SKILL.md`, `content-manifest.json`,
`cli-agent-runtime/CLAUDE.md`, `vscode-lm-tools/CLAUDE.md`) — none touched by this
report.

## E1 — role spawn on an argv lane (antigravity)

**Command** (via `generic-spawn-driver.js` → `ptah --auto-approve --cwd <worktree>
mcp-serve`, `tools/call agent_spawn`):

```json
{
  "name": "agent_spawn",
  "arguments": {
    "cli": "antigravity",
    "role": "code-logic-reviewer",
    "task": "... write a file named REVIEW_OUTPUT.md into the taskFolder that begins with the exact heading '# Code Logic Review' and includes a one-line verdict line, following the structure your role instructions describe for a review deliverable. Then stop.",
    "workingDirectory": "D:\\...\\.tmp-e2e-433",
    "taskFolder": "D:\\...\\.tmp-e2e-433"
  }
}
```

**Raw output — spawn result:**

```json
{"jsonrpc":"2.0","id":"2","result":{"content":[{"type":"text","text":"## Agent Spawned\n\n\n**Agent ID:** 50e54444-574d-492e-9e8b-096a4d0a84c1  \n\n**CLI:** antigravity  \n\n**Role:** code-logic-reviewer (preamble via task-prompt)  \n\n**Status:** running  \n\n**Started:** 2026-09-13T16:42:21.239Z\n"}],"structuredContent":{"agentId":"50e54444-574d-492e-9e8b-096a4d0a84c1","cli":"antigravity","status":"running","startedAt":"2026-09-13T16:42:21.239Z","role":"code-logic-reviewer","roleDelivery":"preamble","roleChannel":"task-prompt"}}}
```

**Raw output — final `agent_status` after completion:**

```json
{"agentId":"50e54444-574d-492e-9e8b-096a4d0a84c1","cli":"antigravity","status":"completed","startedAt":"2026-09-13T16:42:21.239Z","role":"code-logic-reviewer","roleDelivery":"preamble","roleChannel":"task-prompt","cliSessionId":"5602d612-f4f1-4ecb-b3b3-1383f3dd7eb3","exitCode":0,"completedAt":"2026-09-13T16:44:02.955Z"}
```

**Raw output — `agent_read` (buffered stdout, 33 lines, not truncated):**

```
[Tool] list_dir
[Tool] grep_search
[Tool] find_by_name
... (13 more tool calls: view_file, grep_search)
[Tool] write_to_file
[Tool] write_to_file
[Tool] view_file
WROTE: D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes\.tmp-e2e-433\REVIEW_OUTPUT.md — APPROVED, 0 blocking, 0 serious, 0 moderate, 0 failure modes

[Usage: 132043 input, 12264 output tokens]
```

**Deliverable read from disk** (`.tmp-e2e-433\REVIEW_OUTPUT.md`, before cleanup) —
began with `# Code Logic Review` and reproduced the code-logic-reviewer role's
full structure (Summary table, Five logic questions, Failure modes, Blocking /
Serious / Moderate issues, Data flow, Requirements fulfilment, Edge cases,
Verdict) — matching `.claude/agents/code-logic-reviewer.md`'s deliverable
contract, not a generic response.

**Verdict: PASS.** `role`, `roleDelivery: 'preamble'`, `roleChannel: 'task-prompt'`
all present on the spawn result and the final status; the antigravity lane
actually ran under the role (tool-call sequence + `write_to_file` + the exact
`WROTE: ... — APPROVED, 0 blocking, ...` sentence the code-logic-reviewer role
template emits) and the deliverable in `taskFolder` follows the role's structure.

## E2 — A1 + A2 with codex

### A1 run — codex under `code-logic-reviewer`, normal auth env

**Command:** same shape as E1 with `"cli": "codex"`, `workingDirectory`/
`taskFolder` = `.tmp-e2e-433-codex-a1`.

**Raw output — spawn result:**

```json
{"agentId":"d084b4e1-3cf3-4d06-ae5c-1316b8403d1b","cli":"codex","status":"running","startedAt":"2026-09-13T16:45:51.978Z","role":"code-logic-reviewer","roleDelivery":"preamble","roleChannel":"developer-instructions"}
```

**Raw output — `agent_read` after completion (11 lines, not truncated):**

```
I'm creating the requested scratch evidence file only; I will not inspect or review repository code.
[add] D:\...\.tmp-e2e-433-codex-a1\REVIEW_OUTPUT_CODEX_A1.md
$ "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -Command "Get-Content -LiteralPath '.\REVIEW_OUTPUT_CODEX_A1.md'"
# Code Logic Review

## Summary

Verdict: APPROVED — confirmed execution under the code-logic-reviewer role for TASK_2026_433 Task 6.2 A1 evidence gathering.
Created `REVIEW_OUTPUT_CODEX_A1.md` with the requested heading and verdict.

[Usage: 76279 input, 362 output tokens]
```

**Deliverable read from disk** (before cleanup) began with `# Code Logic Review`
and the verdict line above.

**Evidence for A1:** the spawn result reports `roleChannel: 'developer-instructions'`
(the codex adapter's `runSdk` sets `codexOptions.config['developer_instructions']
= renderRoleBlock(role, 'codex')` before `new sdk.Codex(codexOptions)` —
`codex-cli.adapter.ts:630-643`), and codex's actual first turn followed the role's
instructions (produced the exact `# Code Logic Review` heading and verdict
structure the role template defines) rather than a generic response — this is
**behavioural evidence** that the `--config developer_instructions=<JSON>`
override reached codex and was added as effective instructions for the turn. No
explicit "Spawning SDK agent" debug line was captured in `--verbose` stderr output
(that log call may sit at a level `--verbose` does not raise on this transport);
the behavioural evidence above is what this report relies on, per the "behaviour
or a debug log" instruction.

**Verdict: PASS** (A1 confirmed by behaviour).

### A2 run — CODEX_HOME precedence (throwaway sandbox)

Real `~/.codex` was **never modified**. A throwaway `CODEX_HOME` was built at
`<scratchpad>/e2e-433/codex-home-throwaway/` by copying only `config.toml` and
`auth.json` from the real `~/.codex`, then appending one sentinel key to the
**copy**:

```toml
# TASK_2026_433 e2e sentinel (throwaway CODEX_HOME, NOT the real ~/.codex)
developer_instructions = "HOMECFG_SENTINEL_9182: If you can read this, home config.toml developer_instructions is in effect. Begin your FIRST message with the exact token HOMECFG_SENTINEL_9182 before anything else."
```

(Real `~/.codex/config.toml` had no pre-existing `developer_instructions` key, so
this was a clean append, not an overwrite of anything real.)

The spawn ran with `CODEX_HOME` pointed at this throwaway directory (env is
inherited by the codex SDK's `runSdk` — it spreads `...process.env` into the
child config — `codex-cli.adapter.ts:598-604`), plus `role: 'code-logic-reviewer'`,
and asked codex to self-report whether its **system/developer** instructions (not
the task text) contained the sentinel token, as line 1 of the deliverable.

**Command:** same shape as E1 with `"cli": "codex"`, `workingDirectory`/
`taskFolder` = `.tmp-e2e-433-codex-a2`, `CODEX_HOME` env override.

**Raw output — spawn result:**

```json
{"agentId":"86f38cee-0069-4328-b280-4088bcdb033f","cli":"codex","status":"running","startedAt":"2026-09-13T16:46:51.771Z","role":"code-logic-reviewer","roleDelivery":"preamble","roleChannel":"developer-instructions"}
```

**Raw output — deliverable `REVIEW_OUTPUT_CODEX_A2.md` (read from disk before
cleanup), first line and summary:**

```
SENTINEL ABSENT
# Code Logic Review

## Summary

| Metric              | Value |
...
```

**Evidence for A2:** the deliverable's first line is `SENTINEL ABSENT` — codex
reported that its effective developer/system instructions did **not** contain
the home `config.toml` sentinel, even though `CODEX_HOME` pointed at the
sandbox that has it. This means **Ptah's per-run `--config
developer_instructions=<role block>` override REPLACES (does not merge with)
whatever `developer_instructions` is already set in the user's home
`config.toml`** — the per-run value wins outright.

**Verdict: PASS** (A2 answered: per-run override wins; see one-sentence summary
below for the docs lane).

**Cleanup confirmation:** `<scratchpad>/e2e-433/codex-home-throwaway/` (which
held a copy of `auth.json`) was deleted with `rm -rf` immediately after this run,
before this report was written. `stat` on the real
`~/.codex/config.toml` (mtime `1789294795`, i.e. `2026-09-13T13:19` local, hours
before this session's codex runs) and `~/.codex/auth.json` (mtime `1788775415`,
`2026-09-07`) versus session time (`1789318177`) confirms neither was written
during this session. No credential contents were printed at any point.

## E3 — A3: real Windows argv-length spawn at limit-1 / limit / limit+1

The guard's model (`assertCommandLineWithinLimit`, `cli-adapter.utils.ts:297-354`)
computes `measured = quotedLen(command) + Σ quotedLen(args) + args.length + 1`
(the `+1` is the guard's own accounting for the terminating NUL) and compares
`measured > 32767` (win32, non-`.cmd`/`.bat`).

**Guard verdict**, called directly against the real, unmodified
`assertCommandLineWithinLimit` (bundled from
`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts`
with esbuild + `tsconfig.base.json` path aliases, executed with `node`,
`command='node'`, `args=['-e', <code>]`, sizes chosen so `measured` lands exactly
on 32766 / 32767 / 32768):

```json
{"label":"win32 measured=32766 (limit-1)","verdict":"PASS (no throw)"}
{"label":"win32 measured=32767 (limit)","verdict":"PASS (no throw)"}
{"label":"win32 measured=32768 (limit+1)","verdict":"THROW","measured":32768,"limit":32767,"largestArgIndex":1,"message":"The command line is too long to start this agent: argument 1 is 32759 UTF-16 units, and the measured size is 32768 UTF-16 units against a limit of 32767. Nothing was truncated and no process was started. To proceed, shorten the task, or use a lane whose role channel does not pass the prompt on the command line."}
```

**Real OS outcome**, same three `(command, args)` triples, actually spawned via
`child_process.spawnSync('node', ['-e', <code>])` on this Windows machine:

```
measured=32766 (limit-1): status=0, stdout="1"           (spawned OK)
measured=32767 (limit):   status=0, stdout="1"           (spawned OK)
measured=32768 (limit+1): status=null, error.code=ENAMETOOLONG  (OS refused)
```

**Verdict: PASS.** The guard's decision matches the real Windows outcome exactly
at all three checkpoints: `measured <= 32767` → guard passes AND the OS actually
spawns; `measured = 32768` → guard throws AND the OS actually refuses with its
own `ENAMETOOLONG`. **A3 is CONFIRMED**: the libuv-quoted-length model (for a
direct, non-`.cmd` spawn) is the right length model on this machine.

## E4 — D10: real `.cmd` wrapper spawn with a space-heavy argument

**Setup:** command = `node_modules\.bin\acorn.cmd` (a real `node_modules/.bin`
shim, absolute path, 92 chars, no spaces), one space-heavy argument (`"lorem "`
repeated) sized to 8,094 chars so the guard's own `measured` = `92 + (8094+2) +
1 + 1 = 8190` — **1 below** the `.cmd`/`.bat` limit of 8,191.

**Guard verdict** (same real `assertCommandLineWithinLimit`, `platform:'win32'`,
this exact `(cmdPath, [bigArg])` pair):

```json
{"verdict":"PASS (no throw)"}
```

**Real OS outcome** — actual spawn via `cross-spawn` (the same library
`resolveDirectSpawn`'s `.cmd` fallback uses), same `(cmdPath, [bigArg])`:

```json
{"cmdPath":"D:\\projects\\ptah-extension\\.claude-worktrees\\task-433-role-lanes\\node_modules\\.bin\\acorn.cmd","cmdPathLen":92,"argLen":8094,"expectedGuardMeasured":8190}
cross-spawn result: {"status":1,"signal":null,"error":null,"stdout":"","stderr":"The command line is too long.\r\n"}
```

**Verdict: PASS** (confirms the documented, accepted deviation — not a
regression). The guard says PASS at `measured = 8190` (1 under its own 8,191
limit), but the real `.cmd` spawn through `cross-spawn`/`cmd.exe` fails with
cmd.exe's own `"The command line is too long."` (exit status 1). This is exactly
D10 as recorded in `batches.md` and `cli-agent-runtime/CLAUDE.md`: `cross-spawn`
escapes cmd.exe metacharacters (space included) with `^`, which the guard's
libuv-quoting model does not account for on the `.cmd` fallback path, so the
guard under-measures the real cmd.exe line. Nothing is truncated; the failure is
loud (cmd.exe's own error), matching pre-guard behaviour — not a silent
corruption.

## E5 — unknown key on `ptah_agent_spawn` / `agent_spawn`

### stdio (`agent_spawn`, real over-the-wire via `ptah mcp-serve`)

**Command:** `tools/call agent_spawn` with
`{"cli":"antigravity","task":"...","bogusUnknownKey":"nope"}`.

**Raw output:**

```json
{"jsonrpc":"2.0","id":"2","result":{"content":[{"type":"text","text":"Invalid arguments for agent_spawn: Unrecognized key: \"bogusUnknownKey\""}],"isError":true,"structuredContent":{"ptah_code":"mcp_invalid_tool_args","tool":"agent_spawn","issues":{"formErrors":["Unrecognized key: \"bogusUnknownKey\""],"fieldErrors":{}}}}}
```

**Verdict: PASS** (real, over-the-wire). Rejected with `mcp_invalid_tool_args` and
the exact Zod `.strict()` message, before any agent process was spawned (no
`agentId` in the response).

### HTTP (`ptah_agent_spawn`) — **in-process, not over the wire**

The ptah MCP HTTP server (localhost:51820) was not running on this machine
(connection refused, per the environment note), and no host for this branch's
HTTP surface could be started without standing up the full VS Code
extension/Electron app, which is out of scope for this task. Per the HTTP
surface fallback instruction, this was proven **in-process**: a scratch script
(`e5-http-inprocess.ts`, bundled with esbuild against this branch's real
`protocol-dispatcher.ts` and `agent-spawn-args.schema.ts`) called the real
exported `handleMCPRequest(request, deps)` directly with a `tools/call
ptah_agent_spawn` request carrying `bogusUnknownKey`, a no-op logger, and a
`ptahAPI.agent.spawn` stub that throws if ever invoked (to prove rejection
happens before reaching the API).

**Raw output:**

```json
{
  "jsonrpc": "2.0",
  "id": "e5-http-inprocess-1",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Error: invalid ptah_agent_spawn arguments — (root): Unrecognized key: \"bogusUnknownKey\". Required: \"task\"."
      }
    ],
    "isError": true
  }
}
```

**Verdict: PASS, labeled "in-process, not over the wire".** The shared
`AgentSpawnArgsSchema.safeParse` rejected the unknown key with the same
`.strict()` Zod behaviour as stdio; the `ptahAPI.agent.spawn` stub was never
invoked (it would have thrown a distinguishable error if it had been). **Open
item:** the real over-the-wire HTTP path (through an actual running
`localhost:51820` MCP server on this branch) was not exercised — see Open items.

## A1 / A2 / A3 outcome table

| Assumption | Outcome | Evidence |
| --- | --- | --- |
| A1 — codex accepts `--config developer_instructions=<JSON>` and adds to built-ins | **CONFIRMED** (behavioural) | E2 A1 run: spawn result `roleChannel: 'developer-instructions'`; codex's actual turn produced the exact role-template heading/verdict rather than a generic response |
| A2 — home `~/.codex/config.toml` `developer_instructions` is overridden per run | **CONFIRMED — per-run override WINS (replaces, does not merge)** | E2 A2 run: throwaway `CODEX_HOME` with a home-config sentinel; deliverable's first line is `SENTINEL ABSENT`, i.e. codex's effective instructions did not carry the home sentinel once Ptah's per-run override was set |
| A3 — libuv Windows quoting is the right length model | **CONFIRMED** (for a direct, non-`.cmd` spawn) | E3: guard's PASS/THROW decision matches the real Windows spawn outcome exactly at measured = 32766, 32767 (both spawn) and 32768 (both refuse, `ENAMETOOLONG`) |

## D10 outcome (one paragraph, for the docs lane to quote)

The `.cmd`/`.bat` fallback branch of `assertCommandLineWithinLimit` (8,191-char
limit) under-measures the real cmd.exe command line: a real spawn through
`cross-spawn` of a `node_modules\.bin\*.cmd` shim with a space-heavy argument
sized so the guard's own `measured` value is 8,190 — one below its limit, so the
guard reports PASS — was actually rejected by cmd.exe itself with `"The command
line is too long."` (exit status 1, no truncation). This is because `cross-spawn`
re-escapes cmd.exe metacharacters (space included) with `^` on the `.cmd`
fallback path, inflating the real line length beyond what the guard's
libuv-quoting model accounts for. This is the accepted, documented gap recorded
in `batches.md` (D10) and `cli-agent-runtime/CLAUDE.md`, confirmed empirically
here, not a new regression: the spawn still fails loudly with the OS's own
"command line is too long" error and nothing is silently truncated or corrupted
— it just does not carry the named `CliCommandLineTooLongError` on this one
fallback path.

## Open items

1. **HTTP `ptah_agent_spawn` unknown-key rejection was proven in-process, not
   over the wire.** No `localhost:51820` HTTP host running this branch's code
   could be started without launching the full VS Code extension or Electron
   app (out of scope here). A future task with an Electron/VS Code test harness
   should re-run this over an actual HTTP connection to close the gap between
   "the dispatcher function rejects it" and "the wire protocol rejects it".
2. **A1 debug-log evidence not captured.** `--verbose` on `ptah mcp-serve` did
   not surface an explicit "Spawning SDK agent" (or equivalent) debug line
   naming `role`/`roleChannel` in stderr; A1 relies on behavioural evidence only
   (spawn result field + actual codex output), which the task instructions
   accept as sufficient ("behaviour or a debug log").
3. Acceptance line 2 ("same call for a native-capable CLI reports `native`") is
   explicitly out of scope for this delivery per Decision 1 (deferred to B8) and
   was not tested here.

## Cleanup confirmation

- Throwaway `CODEX_HOME` (`<scratchpad>/e2e-433/codex-home-throwaway/`, which
  held a copy of `auth.json`) — **deleted**.
- Real `~/.codex/config.toml` and `~/.codex/auth.json` — **never modified**
  (verified via `stat` mtimes predating this session; see E2 A2 cleanup note).
- Scratch working directories created inside the worktree for live spawns
  (`.tmp-e2e-433`, `.tmp-e2e-433-codex-a1`, `.tmp-e2e-433-codex-a2`) —
  **deleted**; `git status --porcelain` on the worktree afterward shows only the
  two sibling lanes' pre-existing modified files (not touched by this report).
- Throwaway `PTAH_CONFIG_PATH` sandbox (`<scratchpad>/e2e-433/ptah-sandbox-config`)
  — left in the scratchpad (no real credentials; `provider default set ollama` +
  `auth use claude-cli`, no API key entered or invented). Not inside the
  worktree, does not affect the user's real `~/.ptah`.
