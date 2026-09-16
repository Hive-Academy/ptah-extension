# Task Context - TASK_2026_441_7825

## User Request

> in some point of time we stopped using our cli tools and we started using our own subagents, is there a
> particular reason for that?
>
> yep as u see fit i recall we have a task to do some updates to our new skill to utilize our cli more?
> until if they all reaches their limits

No such task existed. The closest are TASK_2026_431 (one `agent-lanes` skill), TASK_2026_433 (a lane can
take a role), TASK_2026_434 (two-way messaging) and TASK_2026_438 (lane completion contract). None of them
changes the default executor or handles lane limits.

## Task Type

REFACTORING (skills and prompts; some runtime support)

## Evidence

### The user's stated preference (workspace memory)

- "User prefers Ptah CLI agent execution (with modelTier='opus') over subagent delegation for batch tasks"
  (TASK_2026_375).
- "For TASK_2026_360 and similar complex implementation work, use CLI agents via ptah_agent_spawn, not
  subagents. Subagents hung three times in succession."
- Limits are the real reason to fall back: "Codex CLI hit usage limit on 2026-08-28 ... work re-dispatched to
  internal backend-developer subagents"; "Codex CLI agent hit usage limit 2026-08-27 mid-review ... continue
  with Claude sub-agents only"; TASK_2026_431's tribunal lost an Ollama lane to "weekly quota hit in round 2".
- Counter-evidence to keep: "Batch 5 attempted CLI lanes and experienced failures; Task 12.1 switched to
  sub-agents and all four completed". Lanes-first must include a real failure fallback, not only a quota
  fallback.

### What happened on 2026-09-14 (TASK_2026_440_834c)

- Gate 0.1 offered Auto / Disabled / Enabled + pinned. The orchestrator marked **Auto** as recommended.
  The orchestrator did not search memory for the user's execution preference first.
- In Auto mode, `lane-assignment.md` puts every phase on subagents and gives lanes only "focused sub-tasks".
  Result: architect, team-leader, Batch 1, Batch 3 and every review ran on subagents. Only Batch 2 (a
  50-line DTO and settings change) ran on codex.
- The Batch 1 logic review was **same-family**: a Claude subagent reviewed Claude subagent code, and
  `agent-lanes` §6 calls that the weaker signal. It was corrected afterward with a codex re-review.
- One more reason the orchestrator leaned on subagents: they notify on completion and lanes do not
  (TASK_2026_438).

## Scope

1. **Default executor = lanes.** In `orchestration` (Gate 0.1 options and recommendation,
   `lane-assignment.md`, `team-leader-modes.md`) and in the team-leader agent's executor heuristics:
   - Batches, reviews, tests and research go to a lane by default. The team-leader still decides whether a
     batch is lane-suitable, but a subagent needs a stated reason.
   - Code review goes to a lane from a **different family than the implementer**. Same-family review needs
     an explicit reason in the summary.
   - Plans the user approves may be written on a strong-reasoning lane (the "phase assigned to a lane" path),
     still behind Gate 1 and Gate 2.
   - Keep subagents for what lanes cannot do: interactive discovery, browser/visual review, git commits.
2. **Gate 0.1 reads memory first.** Before offering lane modes, search memory for the user's execution
   preference and pre-select it. Do not recommend a mode that contradicts a stored preference.
3. **Limit detection and ordered fallback** (`agent-lanes` §5 plus runtime):
   - Classify a lane failure as `usage-limit` / `quota` (with a reset time when the vendor reports one) versus
     auth, crash, timeout or bad output. Read the reset time from the CLI output where it exists (codex prints it).
   - On `usage-limit`, fall back in order: another lane of a different family with the same capability, then
     the same family on another provider or model, then a subagent. Say in the summary which fallback ran and
     why.
   - Record the exhausted lane with its reset time for the session (and optionally in memory), so later
     batches skip it instead of spending a failed spawn.
   - `ptah_agent_list` should report a lane as `limited until <time>` when the host knows it.
4. **Reliability fallback.** A lane that fails twice for a non-limit reason drops to the next lane and then to
   a subagent (today's §5 "same lane fails twice" rule, made the explicit path into subagents).
5. **Completion.** Lanes-first depends on the orchestrator learning that a lane finished. Until
   TASK_2026_438 ships, the skills must tell the orchestrator to arm a completion watcher (for example a
   deliverable-file watcher) for every lane it spawns, and to verify the deliverable exists.

## Acceptance criteria

1. A fresh orchestration run with lanes available and no pinned roster puts implementation batches and code
   reviews on lanes. The summary justifies every subagent executor.
2. No code review is same-family unless the summary says why.
3. With a stored memory preference for lanes, Gate 0.1 pre-selects the lanes-first option.
4. A simulated usage-limit reply from a lane routes the work to the next lane in the fallback order, the
   summary names the fallback and the reset time, and no later batch in the run spawns the exhausted lane.
5. The team-leader agent's executor heuristics and `batches.md` schema reflect the lanes-first default.

## Related

- TASK_2026_438_a942 (completion contract) — a hard dependency for fully unattended lanes-first runs.
- TASK_2026_431_39db, TASK_2026_433_d22a, TASK_2026_434_ce9e — the lane skill, roles and messaging this builds on.
