# Context: memory-curator hygiene

Merged on 2026-10-12 from TASK_2026_518 and TASK_2026_571 (both now `cancelled`, `duplicates` this task).
Full original scope: `../TASK_2026_518_f37c/` and `../TASK_2026_571_a3ad/`.

## Scope

1. From 518: four type errors in two `libs/frontend/memory-curator-ui` spec files pass under Jest because
   `tsconfig.spec.json:9` sets `isolatedModules: true`. Fix them, and add a spec type-check gate (for example
   `tsc -p libs/frontend/memory-curator-ui/tsconfig.spec.json --noEmit` in the lib's typecheck target).
2. From 571 (TASK_2026_563 review follow-ups):
   - Delete the dead `libs/backend/memory-curator/src/lib/curator-llm/resolve-prompt.ts` (no non-spec
     importer; the live copy is `libs/backend/agent-sdk/src/lib/curator-llm-adapter/resolve-prompt.ts`).
   - Fix the stale ratchet spec titles and the memory-rpc handler-count docstring.
   - Harden the extract-prompt spec `schemaBlock` slice.
   - Reword the resolve-prompt opener.
   The 2026-10-12 audit verified only the first item; re-check the other three first.

## Acceptance

- `nx typecheck memory-curator-ui` fails on a spec type error.
- No remaining 571 item, or a note saying why one is dropped.
