---
id: TASK_2026_598_e8df
status: backlog
type: BUGFIX
title: "Confirm before an active-provider key change or login ends running chat sessions"
depends_on: []
created: "2026-10-03T12:09:56.581Z"
updated: "2026-10-30T03:38:08.921Z"
description: "PR #720 already keeps sessions when the changed key belongs to a provider no session uses. Still open: an active-provider key change and the Copilot, Codex, Kimi, saveSettings and workspace-scope login handlers reset the SDK adapter with no session-count confirm."
executor: backend-developer
estimate: M
labels:
  - settings
  - providers
  - needs-decision
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

ConfigWatcher ends every live session on any ptah.auth.* secret write (Replace/Delete key, Cursor credential, Ptah instance key) without a confirm; decide confirm vs. in-place refresh and implement it.

Full context, plan and discussion live in [./context.md](./context.md).
