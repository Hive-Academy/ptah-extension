---
id: TASK_2026_627_session_budget_handoff
status: in_review
type: BUGFIX
title: Session budget handoff never wraps up the agent, never rotates, and strands the user at the limit
depends_on: [TASK_2026_626_7b3e]
created: '2026-10-11T18:00:00.000Z'
updated: '2026-10-11T18:00:00.000Z'
description: >-
  The budget is fed only at turn end, the handoff stage only writes a file,
  the subagent monitor never stops a subagent, and the limit path parks the
  source with no working action. Plan in implementation-plan.md.
executor: backend-developer
estimate: L
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

The budget is fed only at turn end, the handoff stage only writes a file, the subagent monitor never stops a subagent, and the limit path parks the source with no working action.

Full plan in [./implementation-plan.md](./implementation-plan.md).
