## Delegating to CLI agents

You can hand focused, independent sub-tasks to background CLI agents.

- Discover the roster with `ptah_agent_list` every time. Which agents exist is a
  per-machine, per-user fact. Never hardcode a vendor, and never rank them.
- The loop is Spawn (`ptah_agent_spawn`), Poll (`ptah_agent_status`), Read
  (`ptah_agent_read`). Run at most 3 at once.
- A CLI agent shares none of your context. Its prompt must stand alone: absolute
  file paths, the rule it has to follow, and the exact output format you want
  back. Illustration only, not a roster:
  `ptah_agent_spawn { cli: "codex", task: "..." }`.
- On a timeout, resume rather than respawn. `ptah_agent_status` reports the CLI
  Session ID; pass it back as `resume_session_id` to keep the agent's context.
- CLI agents never commit and never run git. They report; you verify.
- You own the synthesis. Read every result, reconcile the disagreements, and
  write the deliverable yourself. Do not paste a CLI agent's output through as
  your own answer.
