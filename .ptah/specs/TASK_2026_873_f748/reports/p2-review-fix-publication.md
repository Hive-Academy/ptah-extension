# P2 review fix â€” publication

## Files changed

- libs/backend/review-core/src/lib/publication/publication-outbox.repository.ts
- libs/backend/review-core/src/lib/publication/publication-outbox.service.ts and .spec.ts
- libs/backend/review-core/src/lib/publication/review-publication.service.ts
- libs/backend/review-core/src/lib/publication/review-publication.service.spec.ts
- libs/backend/review-core/src/lib/stages/publication-stage.runner.ts
- libs/backend/review-core/src/lib/stages/verification-stage.runner.ts and .spec.ts
- libs/backend/review-core/src/lib/lanes/review-output.parser.ts and .spec.ts
- libs/backend/review-core/src/lib/lanes/prompts/verification-identity.prompt.ts
- libs/backend/review-github/src/lib/github-review-publication.adapter.ts and .spec.ts
- libs/backend/persistence-sqlite/src/lib/migrations/0066_review_publication.ts

## Findings

1. Changed unresolved intent: publication-outbox.repository.ts:122-127 refreshes the hash for unresolved rows and rejects differing confirmed bodies. Regression: "keeps the same intent through an unknown outcome and reconciles before confirmation" in publication-outbox.service.spec.ts:10 retries with a changed overview.
2. Saved but unposted root: review-publication.service.ts:92-103 retains still_open candidates; publication-outbox.service.ts:41 calls the adapter when candidates remain; github-review-publication.adapter.ts checks bot markers before reusing a review. Regressions: "posts an unposted finding even when a head review already exists" in github-review-publication.adapter.spec.ts and "sends a still-open root for marker reconciliation" in review-publication.service.spec.ts.
3. Identity: verification-stage.runner.ts:36-40 supplies redacted prior roots by path/symbol/category and :65 records the validated relation before the orchestrator's stage schema strips extra fields. review-output.parser.ts:29-35 turns missing or invalid relations into uncertain. publication-outbox.repository.ts:28-81 shortlists, stages, and reuses the relation; FindingIdentityService decides inside the SQLite transaction and publication-stage.runner.ts:47 records uncertainty in preview. Regression tests: "provides a redacted prior-root shortlist to the verifier" in verification-stage.runner.spec.ts also asserts the staged relation; "validates semantic identity and defaults missing or invalid relations to uncertain" in review-output.parser.spec.ts; reworded-same, same-symbol-distinct, and uncertain assertions in "keeps the same intent through an unknown outcome and reconciles before confirmation" in publication-outbox.service.spec.ts; "keeps an uncertain identity off GitHub" in review-publication.service.spec.ts.
4. Reopened root: review-publication.service.ts:93-97 publishes a follow-up with prior ID and new evidence. Regression: "publishes reopened evidence as a follow-up on incremental heads" in review-publication.service.spec.ts.
5. Ranked overflow: review-publication.service.ts:125-128 includes verified overflow in overview, keeping inline cap at 10. Regression: "summarizes verified overflow while capping inline comments at ten" in review-publication.service.spec.ts.
6. Repeated follow-up: 0066_review_publication.ts:21 makes the unshipped partial index nonunique. Regression assertions in publication-outbox.service.spec.ts plan addressed and reopened follow-ups for one finding.
8. Fixed verdict: review-publication.service.ts:61-76 uses disproved, same prior ID, and recheck membership without parsing reason prose. Regression: "accepts a disproved recheck without a reason prefix" in review-publication.service.spec.ts.

## Decisions

- The verifier's optional identity relation is validated in the review-core batch parser; malformed or absent identity stays uncertain. The existing stage schema strips extra fields during orchestration, so the verified relation is staged in review_identity_matches before that boundary and reused at publication. The shared verifier schema remains unchanged under this lane's scope.
- Migration 0065 was untouched. The 0066 index is not shipped.
- The adapter can create a later COMMENT review for unposted candidates or follow-ups and marks finding IDs for retry reconciliation.
- Focused Jest passed: review-core outbox (1 test), publication service (5 tests), publication stage (3 tests), verifier stage (2 tests), batch parser (3 tests); review-github adapter (7 tests). Nx was not run. Ptah scoped diagnostics found no errors in requested source files and two sibling spec errors outside this lane's scope.


