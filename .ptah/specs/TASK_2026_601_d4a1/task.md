---
id: TASK_2026_601_d4a1
status: backlog
type: BUGFIX
title: Close the Cursor split-key and agy status-line gaps in CLI adapter output
depends_on: []
created: "2026-10-03T12:09:59.897Z"
updated: '2026-11-07T00:00:00.000Z'
description: >-
  Cursor redaction misses a key split across two assistant text deltas, and parseAgyModels (old
  tab-less format) still lists a status line such as "Please sign in" as a model.
executor: backend-developer
estimate: S
labels:
  - cli-agents
  - security
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Two known limits in `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/`:

1. **Cursor split key.** The Cursor adapter redacts the stored key on every emitted path, but
   assistant text is redacted per delta. A key split across two text deltas reaches the stream and
   the UI. Fix: hold back the last `maxSecretLength - 1` characters between deltas, redact the
   joined text, and flush the tail at turn end, on abort and on error.
2. **agy status line.** In the old tab-less format, `parseAgyModels` lists every non-empty line as
   a model unless it matches the status-word filters. "Please sign in" passes and can be saved and
   passed as `--model`. Fix: also require exit code 0 for the old format, and/or reject lines that
   do not look like a model label. Keep the old format working.

Acceptance: specs for a key split across 2 and 3 deltas (never in output or segments, full text
emitted once, in order), and for "Please sign in" and similar lines (not models, while the
old-format label case still lists models).

## Current state (2026-11-07)

- Both gaps are open.
- Cursor: `redactSegment` works per segment
  (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cursor-cli.adapter.ts:168,379-381`),
  with no buffer across deltas.
- agy: `AGY_STATUS_LINE_START` is `/^(error|warning|fetching|loading|usage|failed)\b/i`
  (`.../antigravity-cli.adapter.ts:235-236`), applied in `parseAgyModels` at `:255-272`. It does
  not match "Please sign in".

Full context, plan and discussion live in [./context.md](./context.md).
