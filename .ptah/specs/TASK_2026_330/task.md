---
id: TASK_2026_330
status: done
type: BUGFIX
title: >-
  Move the memory-curator Read observation from PreToolUse to PostToolUse so a
  cancelled hook cannot cancel the tool
depends_on: []
created: '2026-08-26T02:25:32.259Z'
updated: '2026-08-27T17:45:27.304Z'
description: >-
  Background subagents get Read cancelled with the canned "user doesn't want to
  take this action" text (toolDenialKind cancelled, 123 of 123 cases across 49
  transcripts). Read is the only tool with a pre-execution SDK hook in Ptah.
  Moving the observation to PostToolUse removes the only tool-blocking hook.
executor: backend-developer
estimate: S
labels:
  - agent-sdk
  - memory-curator
  - permissions
relates_to:
  - TASK_2026_323
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Background subagents get Read cancelled with the canned "user doesn't want to take this action" text (toolDenialKind cancelled, 123 of 123 cases across 49 transcripts). Read is the only tool with a pre-execution SDK hook in Ptah. Moving the observation to PostToolUse removes the only tool-blocking hook.

Full context, plan and discussion live in [./context.md](./context.md).
