# TASK_2026_465 — messaging for the antigravity and opencode lanes

## Why

TASK_2026_402 made `ptah_agent_message` choose a delivery mode from each adapter's
`capabilities()`. Two adapters declare nothing:

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts:205`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:272`

Both run a one-shot process per turn and close stdin, so a message sent to a running lane
returns `mode: unsupported` (observed live 2026-09-17 on antigravity).

## Evidence gathered

- `agy --help` on agy 1.2.5 (this machine, 2026-09-17):
  `--input-format  Input format for print mode (text, stream-json). stream-json reads one NDJSON
  message per line from stdin and runs a turn for each; it requires --output-format stream-json`.
  Also `--conversation <id>` resumes a conversation by id.
  One turn per line means `queue-next-turn`, not `steer`.
- The NDJSON message schema for `stream-json` input is NOT documented in `--help`. Probe it
  before designing (write one line, read the output stream).
- opencode: not installed here. Vendor docs describe `opencode serve` (HTTP + SSE).
  Whether a message sent mid-turn is queued or rejected is open
  (anomalyco/opencode#11424, see `TASK_2026_402_a5c7/steering-research.md:298`).

## Scope

### Phase A — antigravity (implement)

1. Probe the `stream-json` input schema and output events on agy 1.2.5; record the transcript.
2. Keep one `agy --print --input-format stream-json --output-format stream-json` process per
   lane, stdin open; send the task as the first line.
3. Parse stream-json output instead of text; keep the existing MCP config write/restore rules
   (`libs/backend/cli-agent-runtime/CLAUDE.md`, "Ptah's own MCP server at spawn time").
4. Handle exposes `continue` → `capabilities()` returns `continuation: true`;
   `ptah_agent_list` then shows `messaging: queue` for antigravity.
5. Lane completion: close stdin after the last queued message is consumed and the turn settles,
   so the process exits and the agent reaches `completed`.
6. Version floor: older agy without `--input-format` falls back to the current one-shot path and
   reports `unsupported`.

### Phase B — opencode (probe only)

Install opencode in a sandbox, run `opencode serve`, send a message during a turn, and record
whether it queues, aborts, or fails. Write `opencode-serve-probe.md`. No adapter change.

## Acceptance criteria

1. On agy ≥ the probed version, `ptah_agent_message` to a running antigravity lane returns
   `queue-next-turn` and the message runs as the next turn in the same conversation.
2. `ptah_agent_list` capability cell for antigravity matches the mode returned (Req 5.2 of 402).
3. The lane still reaches `completed` and its output is readable with `ptah_agent_read`.
4. The fallback path on an agy without `stream-json` still works and reports `unsupported`.
5. Specs for the adapter; `npx nx run-many -t test -p @ptah-extension/cli-agent-runtime` passes.
6. `opencode-serve-probe.md` answers the queue question with a recorded transcript.
