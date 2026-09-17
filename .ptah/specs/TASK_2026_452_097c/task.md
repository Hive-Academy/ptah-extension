---
id: TASK_2026_452_097c
status: done
type: BUGFIX
title: Make the initial session name consistent across metadata, --name and CLI agents
depends_on:
  - TASK_2026_449
created: '2026-09-15T15:00:00.000Z'
updated: '2026-09-15T15:00:00.000Z'
description: >-
  A new session's name reaches four stores (tab, SessionMetadataStore, SDK
  title, registry --name). The fallbacks disagree when no name is given
  (Session date vs chat vs New Chat), and Ptah CLI agents store a metadata
  name that differs from the --name source. Unify both, and investigate
  cross-workspace ptahTitle and the auto-title timing.
executor: backend-developer
estimate: S
labels:
  - peer-sessions
  - agent-messaging
relates_to:
  - TASK_2026_449
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Unify initial session-name fallbacks and the CLI-agent metadata name.

Full context, plan and discussion live in [./context.md](./context.md).
