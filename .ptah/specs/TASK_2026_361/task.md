---
id: TASK_2026_361
status: in_review
type: BUGFIX
title: >-
  Setup wizard: honest phase and generation outcomes, on-disk enhanced prompt,
  resumable analysis, git-tracked .claude harness dirs
depends_on: []
created: '2026-08-31T01:05:00.000Z'
updated: '2026-08-31T01:05:00.000Z'
description: >-
  A 15-minute phase timeout is recorded as "completed" with a lossy text
  stub, the 10-minute generation watchdog reports failure while the
  orchestrator keeps writing files, the enhanced prompt lives only in
  globalState, and the wizard cannot resume after a termination. Fix the
  outcome reporting, write enhanced-prompt.md beside the analysis phases,
  make analysis and generation checkpoint-resumable, and track
  .claude/{agents,commands,skills,output-styles} in git.
estimate: L
labels:
  - setup-wizard
  - agent-generation
  - rpc-handlers
  - enhanced-prompts
  - gitignore
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Setup wizard: honest phase and generation outcomes, on-disk enhanced prompt, resumable analysis, git-tracked .claude harness dirs.

Full context, plan and discussion live in [./context.md](./context.md).
