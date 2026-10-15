# Decisions — TASK_2026_677_efcd

| # | Decision point | Decision and evidence |
| --- | --- | --- |
| 1 | Gate 0.1 lanes | Enabled, review only; approval mode lane-review. Source: user instruction (Claude implements the frontend, CLI lanes only review). Reviewer: codex (confirmed room). |
| 2 | Classification | FEATURE, Full depth: new inspector surface + replacement of the compact turn view (parity-inventory.md required). |
| 3 | Testing | User postponed testing: no new spec-writing batches; T2 (R9 parity tests) postponed. Existing suites, typecheck and lint of every changed project still run (CLAUDE.md). |
| 4 | Scope | Follow-up T1 of TASK_2026_629 widened with the user's clean-turn view and the "This session" inspector (screenshots in reference/). PM and designer run in parallel because the screenshots fix the target. |
| 5 | Prototype source | The screenshot prototype is not in the repository (grep "Desktop shell redesign" / "Worked for 4m 12s": no match), so the designer rebuilds it from the screenshots on the repo's design system. |
