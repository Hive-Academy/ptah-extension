# Context: split the oversized memory-curator files

Merged on 2026-10-12 from TASK_2026_570 and TASK_2026_310 (both now `cancelled`, `duplicates` this task).
Full original scope: `../TASK_2026_570_fd05/` and `../TASK_2026_310/`.

## Files (line counts on 2026-10-12, lint max-lines 700)

| File | Lines | Was |
|---|---|---|
| `libs/backend/memory-curator/src/lib/memory.store.ts` | 1041 | >1000 (570) |
| `libs/backend/memory-curator/src/lib/memory-curator.service.ts` | 1049 | 861 (570) |
| `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts` | 1539 | 1088, six concerns (310) |

## Rules

- Facade rule: extract nameable collaborators; keep public class names, DI tokens and method signatures.
  `episode-tracker.ts` is the precedent for the trigger split.
- Start after TASK_2026_454 decides the agent-sdk import boundary, because that decision fixes the shape of
  the extracted port in the trigger service.
- Sequence the store split after TASK_2026_577 and TASK_2026_573 land, and after any TASK_2026_568 work that
  edits the store, to avoid conflicts.
- One PR per file is acceptable; the task closes when all three are under the limit.

## Retired sources (2026-10-30)

This task cites `TASK_2026_310`. That folder was retired from `.ptah/specs`. Read it in git history: `git show ff531866f:.ptah/specs/<folder>/<file>`.
