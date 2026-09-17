# Context — TASK_2026_434

## Depends on

- TASK_2026_431 (`agent-lanes` skill is where the protocol is written).
- TASK_2026_402 **Batch 8** (empirical end-to-end acceptance run) — until it passes,
  no peer message has travelled end to end; skill text must not promise delivery.
- TASK_2026_433 is independent but compounds: role + live messaging is the full
  "CLI acts as a subagent" story.

## Tools available (origin/main, `tool-description.builder.ts`)

| Tool | Direction | Contract the skill must respect |
|---|---|---|
| `ptah_agent_message({ agentId, message })` | parent → lane | returns `mode`: `steer` / `interrupt-resume` (partial turn DISCARDED) / `queue-next-turn` / `unsupported` (nothing delivered, `detail` says why). Max 100KB. |
| `ptah_agent_report({ message, summary? })` | lane → parent | no agentId (identified by MCP URL); `delivered:false` + `reason` when it reached nobody; rate-limited; stdio lanes currently refuse with `unattributed-caller`. |
| `ListAgents` / `SendMessage` (Claude CLI peer channel) | Claude session ↔ Claude session | acceptance only, never delivery (402 research-report-addressing). |

## Where it pays off

1. **Clarification without exit.** Lane hits ambiguity → `ptah_agent_report` with the
   question → parent answers via `ptah_agent_message`. Replaces the
   `## Clarifications Needed` exit + respawn loop (orchestration SKILL.md clarification
   loop, `relay.md:147–150`). Fallback when `delivered:false`: current exit-to-ask.
2. **Council round 2 without respawn.** Lanes that report a live session take the
   anonymized packet as `queue-next-turn`; each keeps its own round-1 reasoning in
   context instead of receiving it back in a 50KB prompt. Fallback on `unsupported`:
   respawn with packet (today's behaviour). Anonymization rules unchanged.
3. **Crucible revise rounds.** Judge defects go to the executor lane as a message;
   the round cap and regression stop stay with the conductor.
4. **Mid-batch blockers in orchestration.** Developer lanes report a blocker early;
   team-leader decides to redirect (`message`) or stop (`ptah_agent_stop`).
5. **Progress summaries.** `summary` on reports replaces polling `ptah_agent_read` for
   liveness; still read full output before accepting a deliverable.

## Rules to write once (in `agent-lanes`)

- Always branch on `mode` / `delivered`. `interrupt-resume` discards partial work — do
  not use it to add a minor note to a lane mid-edit; prefer `queue-next-turn` semantics
  by waiting for the turn boundary.
- Reports are considered updates, not commentary (rate limit).
- A report is attribution, not authentication — the conductor still verifies claims
  against files/tests.
- Anonymization in tribunal: messages to a lane never carry another lane's vendor name.
- Cost: a message is still a paid turn; announce rounds as today.

## Out of scope

- Transport changes to the messaging feature itself (402 owns them).
- Setting `PTAH_MCP_HOST_AGENT_ID` for stdio lanes (402 follow-up).

## Acceptance

- Council run where round 2 is delivered by message to live lanes, recorded with the
  modes each lane reported.
- Orchestrated run where a developer lane asks a question mid-run and continues after
  the answer, no respawn.
- Every messaging instruction appears only in `agent-lanes`; workflow skills cite it.
