# Decisions - TASK_2026_662_3eea (orchestrator)

| # | Date | Stage | Decision | Evidence | Reversible |
| --- | --- | --- | --- | --- | --- |
| O1 | 2026-10-18 | Batch 4 | Widen batch 4 ownership to `SS/skill-lifecycle.reachability.integration.spec.ts` (spec only). Update it to the new write path (NULL grade via the batch-3 event store), not a duplicated candidate-store write. | Same project as batch 4; batch gate `nx test skill-synthesis` cannot pass without it (TS2353 at :593). D4: a batch that hits a missed consumer is fixed in place. Lane recommended a follow-up owner, rejected because it leaves the batch red. | Yes |
| O2 | 2026-10-18 | PR 759 | Replace the lane's hard-coded `ptah-content-brand.md` in packaged skills with a generic "one authoritative document" selection rule. | Packaged skills ship to other projects; the rule still resolves to `ptah-content-brand.md` here. Commit `8f56815e4` on `docs/skills-rubric-sweep`. | Yes |
| O3 | 2026-10-18 | Batch 9 | Keep the batch-9 lane's choice to omit the auth error message from the enhancer warn log (`skill-enhancer.service.ts:853`); revert the orchestrator's fix-1 request and add a comment with the reason. | Batch-9 report line 30: auth errors can contain credentials; project rule "never log secrets". The warn still records slug and provider, so the failure is not silent. Spec asserts no `error` field. | Yes |
