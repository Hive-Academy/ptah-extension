## Summary

When Ptah's `SubagentBudgetMonitor` stops a subagent at its budget (`compaction.subagentHandoffTokens`
or the cost guard), the parent must get the subagent's work. On `main` a failed handoff is lost.
This branch makes the handoff survive failures (TASK_2026_657).

- Near-budget warning: the subagent is asked to write progress notes before it is stopped.
- Durable handoff record: before the handoff stop, Ptah writes one immutable record to
  `.ptah/subagent-handoffs/` (hidden temp name, then an exclusive hard-link publish). No record
  means no handoff stop. The owner session is a hash in the file name.
- Delivery: the handoff still goes to the parent through the tool result or a user turn, with
  bounded retries. The in-memory pending record, retry cap and undelivered notice are removed.
- Discovery: on every main-thread prompt (UserPromptSubmit hook), Ptah names pending records:
  at most 10 per prompt, rotating, rescanned every 60 s, paths only, bounded by a deadline.
  Records of other or ended sessions carry takeover text.
- Agent rule (shared renderer, `.claude/agents/*.md`, orchestration skill): read a pending
  record, continue from it, then set `status: consumed` (or `dismissed` if the work will not
  continue or the subagent finished normally). A stub in the orchestration task folder names it.
- Cleanup: only consumed or dismissed records older than 7 days are deleted.

## Reviews

- Codex code-logic reviews R1-R4 on the earlier retry design; R4 found two defects in the
  retry code, which led to this design (user decision, option E).
- Codex plan reviews r1-r4 of `implementation-plan-e.md`; the last required change was applied
  as written.
- Codex code-logic review of 3404ddca4: NEEDS_REVISION -> fix round (ac1898c22) -> re-review
  NEEDS_REVISION -> two small orchestrator corrections (18e69cd67, 7b3085486), each reviewed ->
  **APPROVED 8/10** (`code-logic-review-e-r4.md`).

## Known gaps and accepted limits

- The cost-guard stop still stops without a record when the record cannot be written (user
  decision). The handoff can then be lost only if the disk write and the send both fail.
- Concurrent prompts of one session can name the same window of records again (discovery delay
  only; review M4).
- Hard links are not supported on FAT32/exFAT and some network shares: there every record write
  fails, so the handoff stop does not happen (the subagent keeps running; nothing is lost).
- A failing prompt callback is logged by its built-in error class only (no message, name or code).
- The workspace filesystem is trusted (no handle-safe path primitive); cleanup of 7-day-old
  resolved records can race a reader.

## Test plan

- [x] `nx run-many -t typecheck,lint -p agent-sdk shared --parallel=1`
- [x] `nx run-many -t test -p agent-sdk shared --parallel=1 --maxWorkers=2` (agent-sdk re-run after
      each later commit, with typecheck and lint)
- [x] `libs/backend/task-specs` contract guard spec (179/179)
- [x] agent-generation renderer specs (308/308, implementer run)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
