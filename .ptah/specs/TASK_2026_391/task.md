---
status: backlog
type: BUGFIX
title: >-
  Stop the curator from reading an unparseable final message as an empty extraction
description: >-
  `extract()` returns `extracted` with zero drafts when the final message is prose or broken
  JSON, because `parseDrafts` returns `[]` for both "no JSON" and "Zod rejected it". The trigger
  then marks the session's observations processed. Return a distinct input-preserving outcome.
parent: TASK_2026_635_5ea5
labels:
  - P1
relates_to:
  - TASK_2026_567_90d4
updated: 2026-11-07T00:00:00.000Z
---

# TASK_2026_391

Defect chain, failure scenario, required fix and acceptance criteria are in
`context.md`. Origin: TASK_2026_376 independent gate review, Blocker 1.

## Description

File: `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts`.
Remaining work:

- Make `parseDrafts` (:684-698) tell apart "no JSON object found", "envelope failed Zod" and "a
  valid envelope with zero memories".
- In the fall-through arm (:448), return an input-preserving outcome (for example `no-output`
  or a new `unparseable` status) for the first two cases. Keep `extracted` with `[]` only for a
  valid empty envelope.
- Update the spec that pins the old behavior as intended, and add specs for prose-only and
  truncated-JSON final messages.

## Current state (2026-11-07)

- Partly done: the `tools-only` and `silent` outcomes now return `no-output`, and the caller
  keeps the session's observations (:420-446, TASK_2026_376 R1).
- Not done: a text final message with no JSON, or with JSON that fails the schema, still returns
  `{ status: 'extracted', drafts: [] }` (:448, :686-688).
