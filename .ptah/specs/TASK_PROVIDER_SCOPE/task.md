---
id: TASK_PROVIDER_SCOPE
status: in_review
type: BUGFIX
title: >-
  Isolate provider and model selection per workspace
depends_on: []
created: '2026-10-09T19:29:54.000Z'
updated: '2026-10-10T18:07:51.000Z'
description: >-
  One-shot LLM work and path-bearing wizard and background workflows used the process-wide authEnv and the active workspace's selected model, causing cross-workspace provider and model mismatches. Add a workspace LLM resolver that resolves provider, model and credentials for a target path and give every chat session its own workspace provider snapshot. Open as PR #688 (branch fix/workspace-provider-scope-isolation, head fe309a5c6), review required.
labels:
  - providers-settings
  - agent-sdk
  - workspace
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

One-shot LLM work and path-bearing wizard and background workflows used the process-wide authEnv and the active workspace's selected model, causing cross-workspace provider and model mismatches. Add a workspace LLM resolver that resolves provider, model and credentials for a target path and give every chat session its own workspace provider snapshot. Open as PR #688 (branch fix/workspace-provider-scope-isolation, head fe309a5c6), review required.
