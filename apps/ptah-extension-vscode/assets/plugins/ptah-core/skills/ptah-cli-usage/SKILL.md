---
name: ptah-cli-usage
description: How to drive the Ptah CLI (`@hive-academy/ptah-cli`) for headless agent workflows, A2A bridges, CI pipelines, and scripted refactors. Triggers on user mentions of "ptah cli", "ptah session start", "ptah interact", "ptah auth", "ptah provider", "JSON-RPC stdio", or any headless Ptah usage including openclaw/nemoclaw bridges.
---

# Ptah CLI Usage

## When to use this skill

`@hive-academy/ptah-cli` ships the same DI graph used by the Ptah VS Code
extension and Electron app, exposed as a single `ptah` binary that speaks
JSON-RPC 2.0 NDJSON over stdio. Reach for it whenever Ptah has to run
**headless**: agent-to-agent bridges, CI pipelines, scripted refactors,
batch operations, daemon integrations, or serving Ptah's tools to another
MCP host. If a human needs to click something, use the VS Code extension
or the Electron app instead — the CLI has no UI and exits when stdin
closes.

| Need                                                     | Use                           |
| -------------------------------------------------------- | ----------------------------- |
| Interactive coding inside an editor                      | VS Code ext                   |
| Standalone desktop app with chat UI                      | Electron                      |
| Headless agent driving Ptah from another process         | **CLI**                       |
| CI / GitHub Actions / scheduled jobs                     | **CLI**                       |
| A2A bridge (OpenClaw / NemoClaw / external orchestrator) | **CLI**                       |
| Scripted refactor or bulk task execution                 | **CLI**                       |
| Anthropic-compatible HTTP proxy in front of Ptah         | **CLI** (`ptah proxy start`)  |
| Serving Ptah's tools to another MCP client               | **CLI** (`ptah mcp-serve`)    |
| A terminal UI with keyboard navigation                   | `ptah tui` (needs a real TTY) |

The CLI runs the agent backend **in-process** — there is no IPC boundary,
just `stdin`/`stdout` carrying JSON-RPC 2.0 envelopes and `stderr`
carrying logger output and OAuth URLs.

### Top-level command map

| Command                                         | Does                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| `init`, `doctor` (alias `diagnose`)             | First-run setup plan; readiness report.                                    |
| `session`, `interact`, `execute-spec`           | Run agent turns — one-shot, persistent loop, or a stored spec.             |
| `run`                                           | DEPRECATED alias for `session start --task`.                               |
| `auth`, `provider`, `license`                   | Credentials, provider selection + model tiers, license key.                |
| `config`, `settings`                            | Read/write settings; export/import portable bundles.                       |
| `agent`, `agent-cli`                            | Agent packs; rival-CLI detection and orchestration.                        |
| `harness`, `wizard`, `setup`, `analyze`         | Harness presets, Setup Wizard internals, workspace analysis.               |
| `spec`                                          | Task specs in `.ptah/specs` (new / status / show / list / check / doctor). |
| `mcp`, `mcp-serve`                              | Browse/install MCP servers; serve Ptah AS an MCP server.                   |
| `plugin`, `skill`, `skill-synthesis`, `prompts` | Plugins, skills, synthesized-skill candidates, Enhanced Prompts.           |
| `memory`, `cron`, `gateway`                     | Memory Curator, scheduled jobs, messaging gateway.                         |
| `git`, `workspace`, `quality`, `websearch`      | Git + worktrees, workspace folders, quality dashboard, search provider.    |
| `proxy`                                         | Anthropic-compatible HTTP proxy (start / stop / status).                   |
| `tui`                                           | Interactive terminal UI. Requires a real TTY.                              |

Every one of these has subcommands; run `ptah <command> --help` (or read
the reference files below) rather than guessing flags.

---

## Install

```bash
npm i -g @hive-academy/ptah-cli     # provides the `ptah` binary
ptah --version
```

A fresh install has **no default provider and no credentials**, so every
streaming command exits `3` (`auth_required`) until you finish setup. Run
`ptah init` (machine mode emits an ordered `init.plan`) or `ptah doctor`
(emits `doctor.report` with `effective.ready`) and act on what they say.
Full walkthrough, config directory and env vars: `references/setup.md`.

---

## One-shot vs interactive session

This is the core decision.

**One-shot** — bootstrap DI, run the work, emit notifications plus a
terminal `task.complete` / `task.error`, drain stdout, exit. Use for
fire-and-forget invocations and scripted batch jobs. `ptah session start
--task`, `ptah analyze`, `ptah setup` and `ptah execute-spec` all behave
this way.

```bash
ptah session start --task "explain this repo" --once
```

`--once` makes `session start` exit at the end of the turn instead of
keeping the session alive. **Always pass `--once` for a one-shot.**

> `ptah run --task "…"` is a DEPRECATED alias for `ptah session start
--task` and prints a deprecation notice on stderr. Do not write new
> scripts against it.

**Interactive session** — `ptah interact` opens a persistent JSON-RPC 2.0
stdio loop. The process stays alive across many `task.submit` requests,
supports permission round-trips, and is the right entry point for any A2A
bridge or daemon. Capabilities are advertised via `session.ready` at
startup.

```bash
echo '{"jsonrpc":"2.0","id":"1","method":"task.submit","params":{"task":"explain this repo"}}' \
  | ptah interact
```

Only one `task.submit` may be in flight per process; a concurrent submit
returns `-32603 'turn already in flight'`. Serialize, or open a second
`interact` process.

---

## Hard rule: NDJSON on stdout, human text on stderr

**Stdout carries JSON-RPC 2.0 NDJSON and nothing else.** One JSON object
per line, `\n`-terminated. Logger output, OAuth URLs, deprecation
notices, and every `--human` pretty-print go to **stderr**. This is an
invariant, not a default:

- Never parse stderr as protocol, and never assume a stdout line is
  anything but a JSON-RPC envelope.
- Never assume `process.stdout.isTTY`. Set `PTAH_NO_TTY=1` if a
  downstream library tries to detect TTYs.
- Never pipe non-NDJSON into `interact`. Malformed lines emit
  `-32700 parse error` on stderr.
- Never mix `--human` with pipelines or `jq`. `--human` is for terminal
  debugging only.
- On Windows, `process.stdout.write` is async on pipes — wait for the
  `task.submit` response and drain before tearing the child down.

---

## Hard rule: global flags go BEFORE the subcommand

These nine are registered on the ROOT program in
`apps/ptah-cli/src/cli/router.ts`, and commander requires them before the
subcommand name:

```
--json  --quiet  --human  --verbose  --auto-approve  --reveal
--cwd <dir>  --config <dir>  --no-color
```

```bash
ptah --json session start --task "..." --once      # CORRECT
ptah session start --json --task "..."             # WRONG — commander will not see --json
```

Subcommand-local options (`--task`, `--once`, `--out`, `--in`,
`--overwrite`, `--key`, `--value`, `--preset`, `--allow-tools`, …)
correctly come AFTER the subcommand. When both appear, they straddle the
subcommand name:

```bash
ptah --json settings export --out ./bundle.json
ptah --quiet --auto-approve session start --task "run the suite" --once
```

---

## Hard rule: secrets

- API keys and license keys travel in **flags or on stdin** and land in
  the platform secret storage (`~/.ptah/secrets.enc.json`, encrypted
  envelopes). They are **never** written to `settings.json`.
- Never hand-edit `~/.ptah/secrets.enc.json`. Use `ptah provider
set-key`, `ptah license set`, or `ptah websearch set-key`.
- As an agent, **never invent a key**. Ask the human to run the
  credential command themselves so the raw secret never passes through
  you.
- **`ptah settings export` output is secret-bearing.** With `--out` the
  CLI writes the file `0o600` for you; with no `--out` the bundle goes to
  stdout and YOU must chmod the destination. Treat it like a credential
  file either way.

---

## Hard rule: unattended approval

Ptah asks for permission before gated tool calls. In an unattended run
there is nobody to answer, so the request hangs for 5 minutes and then
exits `3` (`auth_required`).

- `--auto-approve` auto-allows every permission request. Per
  `router.ts`, it applies to **`run` / `execute-spec` only**.
- `PTAH_AUTO_APPROVE=true` in the environment is the general escape
  hatch — it is honored by the approval bridge for every surface,
  including `interact`, `mcp-serve` and `proxy start`, and it sidesteps
  the flag-placement question entirely. Prefer it in CI and in
  `.mcp.json` env blocks.
- In `interact`, the alternative is to answer properly: respond to every
  `permission.request` and `question.ask` outbound request.

---

## Where to read next

| Read `references/…`     | When you need to …                                                                                                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setup.md`              | Install, run first-time setup, understand `ptah init` / `ptah doctor`, the `~/.ptah` data dir, `PTAH_CONFIG_PATH`, env vars, or debug `sdk_init_failed` / Windows spawn problems.                                           |
| `auth-and-providers.md` | Wire up credentials — `ptah auth`, `ptah provider` (set-key, default, model tiers), `ptah license`, per-vendor recipes, and `ptah settings export` / `import`.                                                              |
| `jsonrpc.md`            | Speak the wire: schema `0.2`, request / response / notification shapes, `session.ready`, `system.schema.version`, `PTAH_HOST_SCHEMA_VERSION`, exit codes, `ptah_code` error codes, and the spawn / bridge / proxy patterns. |
| `agent-cli.md`          | Orchestrate rival CLIs — `ptah agent-cli detect / config / models / stop / resume`, the `--cli` selector vocabulary, and where spawn / read / steer live.                                                                   |
| `harness.md`            | Drive `ptah harness` — init, scan, presets, design-agents, generate-document, chat, and the `doctor` / `remove` filesystem verbs.                                                                                           |
| `internal-mcp.md`       | Know the built-in `ptah_*` tool surface: 51 tools with every namespace on, the namespace toggles, and what each tool returns.                                                                                               |
| `mcp-serve.md`          | Serve Ptah to another MCP host — `.mcp.json` wiring, the 7 MVP tools, `--allow-tools`, cost attribution, cancellation and drain.                                                                                            |

---

## Quick don'ts

- **Don't** use `ptah` for interactive UI — that's the VS Code extension
  or the Electron app.
- **Don't** put a global flag after the subcommand (see above).
- **Don't** issue concurrent `task.submit` on the same session.
- **Don't** hardcode a roster of CLI agents. They are DISCOVERED at
  runtime — `ptah agent-cli detect` from the shell, `ptah_agent_list`
  from inside an agent.
- **Don't** pass `--cli glm`. It is a deprecated alias for
  `--cli ptah-cli`; GLM is a provider, not a binary.
- **Don't** pass `--ptah-cli-id` with a system CLI; it exits `2`.
- **Don't** call `agent-cli resume` without a non-empty `--task`; it
  exits `2`.
- **Don't** write new scripts against `ptah run` — use
  `ptah session start --task`.

---

## Authoritative sources

Verify behavior here when in doubt:

- `apps/ptah-cli/CLAUDE.md` — architecture overview
- `apps/ptah-cli/README.md` — full command reference, flags, env vars, exit codes
- `apps/ptah-cli/docs/jsonrpc-schema.md` — wire schema for every notification + request
- `apps/ptah-cli/docs/migration.md` — migration from the legacy Ink TUI
- `apps/ptah-cli/src/cli/router.ts` — commander wiring (source of truth for flags)
- `apps/ptah-cli/src/cli/commands/*.ts` — per-command handlers
- `libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts` — DI bootstrap modes
- `apps/ptah-cli/src/cli/jsonrpc/types.ts` — `JSONRPC_SCHEMA_VERSION`, `ExitCode`, `PtahErrorCode`
