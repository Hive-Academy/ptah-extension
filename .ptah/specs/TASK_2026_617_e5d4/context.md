# TASK_2026_617 — Grok CLI as a system CLI lane

## Why

The user asked (2026-10-06) what it takes to add xAI's Grok CLI to Ptah's system CLIs.
Docs: https://docs.x.ai/build/cli/headless-scripting. Installed here: `grok 1.0.46 (2765805b9442) [stable]`
at `C:\Users\abdal\.grok\bin\grok`, signed in with grok.com (no `XAI_API_KEY`).

## Known from `grok --help` (not yet measured)

- Headless: `-p, --single <PROMPT>`, `--prompt-file`, `--prompt-json`; `-m, --model`; `--cwd`; `--always-approve`,
  `--permission-mode`; `-s, --session-id`, `-r, --resume`, `-c, --continue`, `--fork-session`; `--max-turns`;
  `--no-alt-screen`; `--output-format plain|json|streaming-json|streaming-messages-json`
  (`streaming-json` = one ACP session update per line; `streaming-messages-json` = Anthropic Messages wire format,
  `--include-partial-messages` adds deltas).
- `grok models` lists models (`grok-4.7` default). Auth: `XAI_API_KEY` or `grok login`.
- `grok agent stdio` = ACP (Agent Client Protocol) JSON-RPC over stdin/stdout. `grok agent` options: `-m`,
  `--reasoning-effort`, `--always-approve`, `--plugin-dir <DIR>` (per-process plugin; MCP servers activate without
  prompt), `--leader` / `--no-leader` (shared leader process, `~/.grok/leader.sock`).
- MCP config: `grok mcp add` writes `~/.grok/config.toml` (user) or `./.grok/config.toml` (project). The top-level
  command has no per-process MCP flag.

## Plan

### Phase 0 — probe (deliverable: `grok-probe.md`)

Measure, do not infer: `streaming-json` event shapes, session id field, exit codes (success, tool error, provider
error); ACP `initialize` / `session/new` (does it accept `mcpServers`?), `session/prompt`, `session/cancel`, and a
second `session/prompt` sent while a turn runs; whether `--plugin-dir` can carry the Ptah MCP entry; whether the
leader process captures per-process env/config (the opencode 2.x shared-server trap, TASK_2026_535).

### Phase 1 — design (`implementation-plan.md`, user gate)

Transport choice: one-shot `grok -p` per turn vs ACP over `grok agent stdio` (recommended pending the probe: per-session
MCP, `queue-next-turn`, `session/cancel` interrupt, completion from the `session/prompt` response rather than process
exit). Registration points, following the Pi adapter: `libs/shared/src/lib/types/agent-process.types.ts`,
`cli-adapters/index.ts`, `cli-detection.service.ts`, `lane-spawn-policy.ts`,
`rpc-handlers/.../cli-model-list.service.ts`, tribunal-panel discovery/run services; optional brand slug, settings
fixtures, harness-sync, plan-limit owner.

### Phase 2 — implement and review

## Out of scope

Changing other adapters; a generic ACP client for other CLIs (note it as a follow-up if the design produces one).
