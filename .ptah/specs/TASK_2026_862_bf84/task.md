---
id: TASK_2026_862_bf84
status: done
type: FEATURE
title: >-
  Use the user's installed Codex on every OS (unpin the Codex binary)
description: >-
  Prefer the installed codex when its version is at or above a minimum, else the bundled codex.
  Remove the SHA/platform pin and the parity-gate admission. Tolerant protocol reading, dynamic
  models, unknown-model pricing shows not priced. Plan automatic bundled-codex bumps.
depends_on: []
created: 2026-11-03T02:35:00.000Z
updated: 2026-11-07T00:00:00.000Z
---

## Description

Make Ptah use whatever Codex the user has, on every OS, so new OpenAI/Codex models work without a
Ptah release. Branch `feat/codex-binary-unpin`, worktree `.claude-worktrees/codex-binary-unpin`.
See `context.md` for the full user request and acceptance criteria.
