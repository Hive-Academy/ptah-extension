---
id: TASK_2026_390
status: in_review
type: bugfix
title: >-
  Codex/Cursor SDK failures: bound the forwarded error text and name the usage
  limit instead of dumping the subprocess output
depends_on: []
created: '2026-09-07T00:00:00.000Z'
updated: '2026-09-07T00:00:00.000Z'
description: >-
  When a spawned Codex agent failed, @openai/codex-sdk rejected with an Error
  whose .message embedded the last ~500 lines of the child's own output
  ("Codex Exec exited with code 1: ... Total output lines: 500 Output: <dump>").
  CodexCliAdapter.runSdk forwarded that message verbatim to both output.emit and
  segment.emit, so hundreds of lines of unrelated grep results landed in the
  chat bubble as one error block, and a quota failure ("You've hit your usage
  limit ... try again at 5:05 PM") was never recognised as one. The same
  verbatim forward existed in CursorCliAdapter. Both now go through
  summarizeCliSdkError, which names the usage-limit case and otherwise keeps
  only the SDK's own headline capped at 500 characters; the full text goes to
  the injected Logger.
executor: backend-developer
estimate: S
labels:
  - cli-agent-runtime
  - codex
  - error-handling
relates_to: []
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Bounded, actionable error text for the two in-process vendor SDK adapters (Codex, Cursor). See [./context.md](./context.md).
