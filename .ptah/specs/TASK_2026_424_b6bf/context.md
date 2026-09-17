# TASK_2026_424 — Context

## Origin

Reported (not changed) by the TASK_2026_421 developer while scanning the other
SDK-based adapters for the Codex defect.

## Evidence

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cursor-cli.adapter.ts`
  ~347: the `for await` over `run.stream()` returns 0 only when the iterator
  ends — the pattern TASK_2026_421 removed from `CodexCliAdapter.runTurn`.
- `@cursor/sdk` runs in process (`Agent.create` / `send`); there is no
  `codex exec`-style child owning the iterator, so the Codex failure mode may
  not apply.
- Its `SDKMessage` union has a `status` message with
  `FINISHED | ERROR | CANCELLED | EXPIRED` (`messages.d.ts` ~62-68), and the
  transport exposes `isTerminalLocalRunStreamEvent`.
- Not measured: whether `stream()` reliably ends after a terminal status.

## To do

1. Measure a real Cursor agent run: does `ptah_agent_status` reach
   `completed` promptly after the final status message?
2. If not, return from the loop on a terminal `status` message (0 for
   `FINISHED`, 1 otherwise) and pin it with a never-ending-stream spec, the
   same way `codex-cli.adapter.spec.ts` does after TASK_2026_421.
