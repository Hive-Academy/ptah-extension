# Context — TASK_2026_438_a942

## User intent

After a tribunal run, the user saw that all three CLI lanes had finished and that the
orchestrator never reacted. They asked whether a rule already existed for lanes to report
completion. It did not. They asked for this to be filed as an important task "in a wider
range" — the whole completion contract, not one defect.

## How this was found (2026-09-14)

A Council tribunal on the Thoth subsystem spawned three read-only lanes in parallel:
codex (P1), antigravity (P2) and an Ollama Cloud ptah-cli lane (P3), each told to write a
deliverable file and reply `WROTE: <path>`.

1. **Nothing woke the orchestrator.** The `agent-lanes` skill (§4) says to poll
   `ptah_agent_status` about every 8 s. The orchestrator instead armed a background
   `sleep 420` shell as its wake-up. The Claude Code session ended before it fired, the
   shell died with it, and all three lanes finished with nobody watching. The user
   noticed first. The skill rule was right, but it depends on the orchestrator's
   discipline, and there is no way for a lane to signal "done".
2. **A lane reported success without a deliverable.** All three lanes ended `completed`,
   `Exit Code: 0`. P1 and P3 wrote their files. P2 (antigravity) did 25 read and search
   calls, used 129,373 input and 7,528 output tokens, and exited **without writing
   `round1-P2.md`**. Its stdout shows only tool calls and a usage line — no
   `WROTE:` reply, no error. The status tool could not tell success from a silent
   failure.

## What exists today (verified)

- **Poll only.** `ptah_agent_spawn` → `ptah_agent_status` → `ptah_agent_read`. No wait, no
  callback, no push into the parent.
- `background_agent_completed` (`libs/shared/src/lib/types/execution/stream-background.ts:64`)
  is a webview stream event for SDK subagents that updates the chat UI.
  `libs/frontend/chat/src/lib/services/chat-store/turn-end-handler.service.ts:134` records
  that it "has no producer anywhere in the repository". It never reaches an orchestrator
  model.
- `ptah_agent_message` / `ptah_agent_report` (PR #497) carry messages between sessions. A
  lane calls `ptah_agent_report` only if its task tells it to, the report is attribution
  rather than proof, and it can return `delivered: false`.
- Lane records already carry `parentSessionId`
  (`libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts:312`), so the host knows
  which session a lane belongs to.

## Relationship to TASK_2026_429_ba4e

429 files three **defects** in lifecycle reporting: a finished lane vanishes ("Agent not
found"), a finished lane never exits, and a stuck lane looks like a working one. This task
is the **contract** those defects violate, widened to cover what 429 does not: the
orchestrator is never told, and "completed" does not mean "delivered". Ship 429's fixes as
part of, or before, this contract. Do not duplicate them.

## Scope — the completion contract

### 1. Terminal states that mean something

- Add a distinct terminal outcome for "exited cleanly but did not deliver":
  `completed-no-deliverable` (name open). It applies when the spawn named a
  deliverable (`**Deliverable**:` path in `task`, or a `taskFolder`/files contract) and
  that path does not exist, or did not change, at exit.
- Record the deliverable check on the lane record (`expected`, `exists`, `mtime`,
  `bytes`) and print it in `ptah_agent_status`.
- A missing `WROTE:` reply when the contract asked for one is a warning on the record,
  not by itself a failure — the file is the proof.

### 2. A blocking wait

- `ptah_agent_wait({ agentIds, mode: 'any' | 'all', timeoutMs })` returns when the named
  lanes reach a terminal state, with each lane's final status and deliverable check.
- It must be safe for the MCP call timeout: bounded server-side, returns the partial
  result on timeout, and can be called again.
- The `agent-lanes` skill switches its run loop from "poll every ~8 s" to "wait", with
  poll kept as the fallback.

### 3. Push into the parent session

- When a lane reaches a terminal state, the host delivers a short, structured
  completion notice to the parent session (`parentSessionId`) through the same
  queue-next-turn path PR #497 uses: agent id, lane, status, deliverable check, first
  line of the reply.
- Delivery must work when the parent is idle (it becomes the next turn) and when it is
  mid-turn (queued, never interrupting).
- The notice is a signal, not proof: it links to `ptah_agent_status` / the file.

### 4. Survival across orchestrator restarts

- Completion records persist, so a new or resumed orchestrator session can list "lanes
  that finished while you were away" (for example `ptah_agent_status({ since })` or
  pending notices replayed on resume).
- Defines the retention window 429 Defect 1 asks for.

### 5. Every lane family, every host

- System CLIs (codex, antigravity, copilot, cursor, opencode, pi) and ptah-cli providers.
- VS Code, Electron and the headless CLI host (`cli-engine`). The contract lives in
  `cli-agent-runtime` behind platform-core ports, not in one host.
- An adapter that cannot detect completion states that limit in status output (429
  Defect 2, AC 2).

### 6. Docs and skills

- `agent-lanes` skill: §4 (run), §5 (recover — `completed-no-deliverable` resumes with
  "write the deliverable now"), §6 (verify).
- `tribunal` and `orchestration` references that describe polling.
- The `ptah_agent_*` tool descriptions.

## Acceptance criteria

1. A lane that exits 0 without its named deliverable is reported as
   `completed-no-deliverable`, never `completed`. Pinned by a spec that runs a fake lane
   which exits cleanly and writes nothing.
2. `ptah_agent_wait` returns within 1 s of the last named lane reaching a terminal state,
   and returns a partial result at `timeoutMs` without error.
3. With the parent session idle, a lane's completion produces a notice in that session
   without any tool call from the orchestrator. With the parent mid-turn, the notice is
   queued for the next turn and never interrupts.
4. After the orchestrator session is closed and a new one started in the same workspace,
   it can list lanes that finished in between, with their deliverable checks.
5. The behaviour holds for at least one system CLI and one ptah-cli lane, on Electron and
   on the headless CLI host.
6. The `agent-lanes` skill no longer relies on poll discipline as the only wake-up path.

## Deliberately not in scope

- Lane output quality (whether a deliverable is good) — that is the review step.
- The jest handle leak and `copy-wasm` worktree defect — `TASK_2026_427_f669`.
- Anything the Thoth tribunal itself found — that work is separate.
