# Lane A: backend identity and Codex quota

## Files changed

- `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts` and `.spec.ts`: neutral, reason-specific unknown labels for missing Claude email, unread Codex identity, absent API key, and unresolved daemon routes. Owner references retain the existing strict persisted shape.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts` and `.spec.ts`: suppress a missing-email Claude route when the current SDK process has exactly one verified Claude account; keep two verified accounts and ambiguous unknowns. Add `unknownReason` to known snapshots.
- `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts` and `.spec.ts`: quota is available after account and rate-limit reads even if activity fails; select `rateLimitsByLimitId.codex` first; retain the hashed owner key after later read failures; log only stage, error class, and status. Added activity-failure, absent-email, and bucket tests.
- `libs/backend/auth-providers/src/lib/providers/codex/codex-account.schemas.ts`: accept an omitted ChatGPT email.
- `libs/shared/src/lib/types/plan-limit.types.ts`: additive `PlanLimitOwnerSnapshot.unknownReason?: 'missing-account-email' | 'codex-not-read' | 'unrouted-daemon' | 'missing-api-key' | 'unresolved-route'` for the frontend lane. Known snapshots carry it; read snapshots retain reason-specific neutral owner labels.

## Verification

- `npx jest -c libs/backend/auth-providers/jest.config.ts <changed specs> --coverage=false --maxWorkers=1`: blocked before execution; 2 suites, 0 tests. Tail: `Could not locate module marked as ... worktree/node_modules/marked/lib/marked.umd.js`; `Test Suites: 2 failed, 2 total`; `Tests: 0 total`.
- `npx nx typecheck @ptah-extension/auth-providers --parallel=1`: `NX Successfully ran target typecheck for project @ptah-extension/auth-providers` (exit 0).
- `npx nx typecheck @ptah-extension/cli-agent-runtime --parallel=1`: `NX Successfully ran target typecheck for project @ptah-extension/cli-agent-runtime` (exit 0).
- The TypeScript diagnostics tool timed out; the scoped Nx checks above completed.

## Decisions

- Discovery uses the one SDK process's native Claude configuration and requires exactly one verified account before suppressing a missing-email route. It never compares quota percentages. The current owner-key-only ledger path already skips unknown owners, so no ledger migration was needed for the card.
- The strict persisted `QuotaOwnerRef` parser rejects extra fields. Reason text therefore uses safe labels on live references, while the additive structured reason lives on known owner snapshots. Read snapshots have the neutral label but no structured reason until their construction path can be extended.
- The current Codex service owns a short-lived app-server process per read and exposes no persistent notification lifecycle. `account/rateLimits/updated` ingestion was not added.
- Runtime diagnostics for the reported installation were unavailable in this worktree. The reconciliation rule is conservative when two verified Claude accounts are present.
