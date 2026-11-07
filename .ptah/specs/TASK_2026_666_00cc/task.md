---
id: TASK_2026_666_00cc
status: backlog
type: BUGFIX
title: Apply MCP schema bounds to ptah.session.handoff
depends_on: []
created: "2026-10-14T17:08:12.149Z"
updated: "2026-11-07T00:00:00.000Z"
description: >-
  The ptah.session.handoff execute_code namespace skips the handoffPath, prompt and label bounds
  that the ptah_session_handoff MCP tool enforces. Use one shared zod validator for both.
estimate: XS
labels:
  - follow-up
relates_to:
  - TASK_2026_655_handoff
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

The `ptah_session_handoff` MCP tool validates its input with `SessionHandoffArgsSchema`
(`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-args.schema.ts:89-99`:
absolute `handoffPath` up to 1000 chars, `prompt` up to `MAX_AGENT_MESSAGE_LENGTH`, optional
`label` up to 60 chars, strict object) before it calls the handoff service
(`session-tool-handlers.ts:449-455`). The `ptah.session.handoff` namespace of `execute_code` calls
the same service with the raw input
(`libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/session-namespace.builder.ts:157-160`).

Expected: both entry points use the same validator, and the namespace rejects bad input with a
prompt-free error. Add specs for both paths. Verify with
`npm run verify -- -p @ptah-extension/vscode-lm-tools`.

## Current state (2026-11-07)

- Not started. The namespace still forwards `{ ...input, callerSessionId }` without a schema check
  (`session-namespace.builder.ts:160`).

Full context, plan and discussion live in [./context.md](./context.md).
