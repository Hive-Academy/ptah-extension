# Context
Source: TASK_2026_657_subagent_handoff/code-logic-review-e.md finding M4 (deferred, no data loss).
- `subagent-handoff-index.ts` `collect`: reads the cursor, awaits head reads, then updates it.
  Simultaneous prompts of one session start at the same window; a late visit can move the cursor
  back. Fix: serialize per cursor key, or reserve a disjoint window before awaiting. Test with a
  gated head read and concurrent calls.
