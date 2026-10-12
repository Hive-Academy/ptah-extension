# Epic: Skills content and synthesis (P2)

Created 2026-10-12 by the memory and skills backlog triage (code audit against `main`, codex cross-review).

## Children, in suggested order

| Pri | Task | Problem today (evidence) | Size | Depends on |
|---|---|---|---|---|
| P2 | TASK_2026_644 | Two residues in the same skill files: decide whether `auto` makes lanes the default phase executor (`orchestration/references/lane-assignment.md:55-59`), and give Council cross-critique rounds the messaging tools (`tribunal/references/council.md`). Merged from 441 + 434. | S | - |
| P3 | TASK_2026_435 | Publish the prompt-authoring rubric in skill-creator, then trim the heavy skills (ptah-cli-usage 104 KB, ui-ux-designer 128 KB, angular crafters 156/168 KB) with before/after trigger-time size. | L | 644 (same files) |
| P3 | TASK_2026_245 | The replay gate still has no producer (`skill-synthesis/.../stage-handlers.service.ts:235`). TASK_2026_578 (done) now creates a candidate only when the user accepts a suggestion, which removes the auto-promotion risk; run the gate on accepted candidates. | M | - |
| P4 | TASK_2026_536 | Run skill-synthesis archaeology and judging on CLI lane sessions (`trajectory-extractor.ts` reads Claude JSONL only). | L | 535 (lane outcome ledger) |
