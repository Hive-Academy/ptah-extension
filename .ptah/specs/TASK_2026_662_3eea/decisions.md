# Decisions - TASK_2026_662_3eea (orchestrator)

| # | Date | Stage | Decision | Evidence | Reversible |
| --- | --- | --- | --- | --- | --- |
| O1 | 2026-10-18 | Batch 4 | Widen batch 4 ownership to `SS/skill-lifecycle.reachability.integration.spec.ts` (spec only). Update it to the new write path (NULL grade via the batch-3 event store), not a duplicated candidate-store write. | Same project as batch 4; batch gate `nx test skill-synthesis` cannot pass without it (TS2353 at :593). D4: a batch that hits a missed consumer is fixed in place. Lane recommended a follow-up owner, rejected because it leaves the batch red. | Yes |
| O2 | 2026-10-18 | PR 759 | Replace the lane's hard-coded `ptah-content-brand.md` in packaged skills with a generic "one authoritative document" selection rule. | Packaged skills ship to other projects; the rule still resolves to `ptah-content-brand.md` here. Commit `8f56815e4` on `docs/skills-rubric-sweep`. | Yes |
