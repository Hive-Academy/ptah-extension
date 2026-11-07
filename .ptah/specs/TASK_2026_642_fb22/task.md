---
id: TASK_2026_642_fb22
status: backlog
type: REFACTORING
title: >-
  memory-curator hygiene: delete dead resolve-prompt.ts, fix hidden spec type errors, gate specs
depends_on: []
created: "2026-10-12T19:39:48.932Z"
updated: "2026-11-07T00:00:00.000Z"
description: >-
  Delete the dead memory-curator resolve-prompt.ts, fix spec type errors that isolatedModules hides
  in memory-curator-ui, and add a spec type-check to its typecheck target.
parent: TASK_2026_638_7a8e
estimate: S
labels:
  - memory
  - P3
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

1. Delete `libs/backend/memory-curator/src/lib/curator-llm/resolve-prompt.ts`. No file imports it.
   The live copy is `libs/backend/agent-sdk/src/lib/curator-llm-adapter/resolve-prompt.ts`.
2. Fix the spec type errors in `libs/frontend/memory-curator-ui` that pass under Jest because
   `libs/frontend/memory-curator-ui/tsconfig.spec.json:9` sets `isolatedModules: true`. The
   2026-10-12 audit counted four errors in two spec files; count them again first.
3. Add a spec type-check to the lib's `typecheck` target
   (`libs/frontend/memory-curator-ui/project.json:14-18`), for example
   `tsc -p libs/frontend/memory-curator-ui/tsconfig.spec.json --noEmit`.
4. Re-check the other TASK_2026_571 follow-ups before you do them: stale ratchet spec titles, the
   memory-rpc handler-count docstring, the extract-prompt spec `schemaBlock` slice, and the
   resolve-prompt opener. Drop an item with a note if it no longer applies.

Acceptance: the memory-curator-ui `typecheck` target fails on a spec type error, and each 571 item
is done or dropped with a reason.

## Current state (2026-11-07)

- Not started. The dead `resolve-prompt.ts` still exists and has no importer in
  `libs/backend/memory-curator/src`.
- The `typecheck` target still runs only `ngc --noEmit --project .../tsconfig.lib.json`
  (`libs/frontend/memory-curator-ui/project.json:17`), so spec files are not type-checked.

Merged on 2026-10-12 from TASK_2026_518 and TASK_2026_571.

Full context, plan and discussion live in [./context.md](./context.md).
