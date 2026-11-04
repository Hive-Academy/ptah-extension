# P2 publication review fix round 2

## Findings

1. Confirmed prior roots: `review-publication.service.ts:98` checks a confirmed finding publication before incremental selection. `publication-outbox.service.ts:54` records the IDs represented by a confirmed review in the existing publication row, and `publication-outbox.repository.ts:31-41` queries that proof. `review-publication.service.ts:132` includes overflow findings in that proof. Regression: `review-publication.service.spec.ts:62`. Unconfirmed roots continue through marker reconciliation.
2. Timeout follow-ups: `publication-outbox.repository.ts:171` plans the follow-up inside the same SQLite transaction as the status change. `review-publication.service.ts:71,93` restores pending addressed and reopened follow-ups on retry. Regressions: `publication-outbox.service.spec.ts:67` and `review-publication.service.spec.ts:68,74`.
3. Reopened rechecks: `sqlite-review.repository.ts:44` includes reopened failures in incremental scope; `review-publication.service.ts:67` passes their actual status to the recheck. Regressions: `sqlite-review.repository.spec.ts:44` and `review-publication.service.spec.ts:80`.
5. Dry-run and pause: `publication-stage.runner.ts:58-59` persists verified findings when publication policy rejects a write, even with `ReviewPublicationService` injected. Regression: `publication-stage.runner.spec.ts:104`, exercising the injected publisher in dry-run mode.

Finding 4 concerns files outside this lane's allowed scope; it was not changed.

## Verification

Review-core full suite: **25 suites, 108 tests passed**. The first requested command hit a Jest worker `spawn EPERM`; rerunning through `scripts/verify.mjs` with `--runInBand` exited 0. `npx tsc -p libs/backend/review-core/tsconfig.lib.json --noEmit` and `tsconfig.spec.json --noEmit` both exited 0. The spec type check initially found two pre-existing settings mocks missing live-gate methods; fixed in `review-orchestrator.service.spec.ts:64` and `testing/dry-run-fixture.spec.ts:91`.

Only review-core files and this report were changed in this round. Review-github and persistence-sqlite suites were not required because their files were not touched.
