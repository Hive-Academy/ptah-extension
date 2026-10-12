# Epic: Memory code health (P3)

Created 2026-10-12 by the memory and skills backlog triage (code audit against `main`, codex cross-review).

## Children, in suggested order

| Pri | Task | Problem today (evidence) | Size | Depends on |
|---|---|---|---|---|
| P3 | TASK_2026_642 | Dead `memory-curator/src/lib/curator-llm/resolve-prompt.ts` (live copy is in agent-sdk); four spec type errors hidden by `isolatedModules` (`memory-curator-ui/tsconfig.spec.json:9`). Merged from 518 + 571. | S | - |
| P3 | TASK_2026_573 | Quarantine specs never force the node:sqlite fallback, and no spec pins "a failed unpin of a quarantined pinned row stays pinned after restore". | S | - |
| P3 | TASK_2026_454 | Owner decision: move the three `NetworkBackoff` imports from agent-sdk behind a port, or change the memory-curator CLAUDE.md rule. | S | - |
| P3 | TASK_2026_643 | Split `memory.store.ts` (1041), `memory-curator.service.ts` (1049) and `memory-trigger.service.ts` (1539); lint max 700. Merged from 570 + 310. Land after 577 and 573 touch the store. | L | 454 |
