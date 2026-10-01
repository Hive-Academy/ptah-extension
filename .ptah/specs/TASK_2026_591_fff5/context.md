# TASK_2026_591 — two-way messaging for the opencode lane

## Why

`ptah_agent_list` shows the opencode lane as `messaging: none`, so `ptah_agent_message` returns `unsupported` for
it. Every other installed lane can at least queue a message for its next turn. This came up on 2026-10-01 during
TASK_2026_555, when the user put an opencode lane (`opencode-go/kimi-k2.7-code`) on implementation batches and could
not send it a correction mid-run.

The gap is in the adapter, not in opencode:

- `OpencodeCliAdapter.capabilities()` returns `{ steer: false, interrupt: false, continuation: false }`
  (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts`, `capabilities()`).
- The adapter spawns one `opencode run --format json [--auto] [--model] [--standalone] [--session <id>] <prompt>` per
  turn and closes stdin immediately (`runSdk`, the `args` block and `child.stdin?.end()`).
- It already captures the session id from the JSON events (`setSessionId`) and already resumes with `--session`,
  so `resume_session_id` works today. What is missing is a `continue()` on the returned handle.

## Evidence already gathered (do not repeat)

- `TASK_2026_465_a25a/opencode-serve-probe.md` (opencode 2.0.11, win32, measured): `opencode serve` has a per-session
  inbox with `delivery: "steer"` (default; delivered at the next step boundary inside the running execution) and
  `delivery: "queue"` (delivered after the request's last step), plus `POST /interrupt` (aborts, partial step lost).
  HTTP Basic auth, user `opencode`, password printed at start. Its section "What this means for the adapter" says a
  server-backed adapter is **a separate task** — this one.
- `TASK_2026_402_a5c7/steering-research.md` §1.5: classification of the one-shot shape (nothing deliverable).
- `TASK_2026_525_dbb1`: opencode 2.x background-service behaviour (cold start, empty `opencode models`).
- Installed here on 2026-10-01: opencode **v2.0.12**; `opencode run --help` lists `--session`, `--continue`, `--fork`,
  `--format json`, `--standalone`, `--server <url>`.

## Scope

### Phase 1 — queue-next-turn on the existing `run` transport (implement)

- Add `continue(message)` to the opencode run handle: after the current turn ends, spawn
  `opencode run --format json --session <capturedSessionId> …same flags… <message>` and stream it into the same
  output/segment emitters, as the Codex / Copilot / Cursor adapters do.
- `capabilities()` returns `continuation: true` (so `bestMessagingCapability` gives `queue`); no session id captured
  yet → the message is held until one is, or refused with a clear reason (decide and pin with a spec).
- Keep `OPENCODE_CONFIG_CONTENT` (MCP) and `--standalone` per follow-up turn; keep the Windows native-binary path and
  tree-kill on abort.
- Run the adapter against the port contract tests and the messaging router specs; update the agent-lanes skill /
  `ptah_agent_list` text only where they state opencode has no messaging.

### Phase 2 — steer and interrupt through `opencode serve` (design first, user gate)

Open questions from the probe: per-lane vs shared server, the Basic credential handling, SSE parsing in place of
line parsing, completion = `session.execution.succeeded` instead of process exit, how MCP config reaches a
server-hosted session (no per-process `OPENCODE_CONFIG_CONTENT`), version floor by probing the surface. Produce an
`implementation-plan.md` and stop for approval before any code.

## Acceptance criteria (Phase 1)

1. `ptah_agent_list` shows opencode with `messaging: queue`.
2. `ptah_agent_message` to a running opencode lane returns `mode: queue-next-turn`, and the message is answered as a
   further turn in the same opencode session (live check recorded in a report).
3. Specs: continue spawns `run --session <id>` with the same flags; no session id → defined behaviour; abort during a
   continued turn tree-kills it; output of the continued turn reaches the same emitters.
4. Scoped `typecheck,test,lint` for `cli-agent-runtime` green.

## Out of scope

Other adapters; changing `opencode run` flags for the first turn; the model picker (TASK_2026_525).
