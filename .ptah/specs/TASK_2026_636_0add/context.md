# Epic: Memory quality, measured (P2)

Created 2026-10-12 by the memory and skills backlog triage (code audit against `main`, codex cross-review).

Goal: search returns the right memories, the corpus stops growing with duplicates and sediment, and each
quality claim has a benchmark number behind it.

## Children, in suggested order

| Pri | Task | Problem today (evidence) | Size | Depends on |
|---|---|---|---|---|
| P1 | TASK_2026_565 | The cross-encoder rerank is inert: softmax over a single-logit model scores every pair 1, so rerank keeps RRF order (`embedder-worker.ts:260-265`, `:284-293`). | S | - |
| P2 | TASK_2026_624 | Bench recordings and the first scored run (TASK_2026_620 shipped the bench without recordings). Needs approval for paid live recordings. | L | - |
| P2 | TASK_2026_619 | Re-scoped to phase 2 only: fix the code-intelligence and memory tools that miss their prompt claims. Phase 1 (benchmark) is covered by 620 and 624. A reproduced correctness defect can start without 624. | XL | 624 (for bench-guided fixes) |
| P2 | TASK_2026_566 | Owner decision: tier-2 merge candidates when tier 1 is empty, option A (20/23 at up to one extra call per pass) or B (shipped, 7/23). `merge-candidate-collector.ts:187`. | M | - |
| P2 | TASK_2026_577 | No job consolidates the existing corpus; merge runs only on write (`merge-candidate-collector.ts:157`). Idle-gated, reversible. | XL | 572 (users can restore before bulk quarantine) |
| P3 | TASK_2026_568 | Research a reviewed, content-level sediment classifier (about 2,500 rows). Add the 572 dependency only if it grows into bulk quarantine. | L | - |

Closed in this triage: TASK_2026_569 (superseded by the TASK_2026_620 frozen judged suites).
