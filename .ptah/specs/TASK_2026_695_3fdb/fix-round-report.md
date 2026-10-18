# Fix round report — TASK_2026_695_3fdb

## Fixes and tests

1. Provider metadata failures are best effort on resume, new-session init, and slash-command relaunch. Each catch logs a real `Error` through the injected logger and carries a `degradation-audit: reported` comment: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1320`, `:1460`, `:1720`. Regression tests prove the resume ID still emits, new-session ID still resolves, and slash relaunch still calls `beginRun` and reaches stream transformation: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts:3848`, `:1358`, `:2408`.
2. `create()` now applies a supplied non-empty provider ID to an existing record while preserving the current ID for empty input: `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:1382`; test: `libs/backend/agent-sdk/src/lib/session-metadata-store.spec.ts:144`.
3. `updateProvider()` now returns without saving or emitting when the ID is unchanged: `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:1430`; test: `libs/backend/agent-sdk/src/lib/session-metadata-store.spec.ts:177`.
4. A concurrent `save` and `updateProvider` retains both total cost and the provider ID; test: `libs/backend/agent-sdk/src/lib/session-metadata-store.spec.ts:195`. The serialized write and provider-preserving merge are in `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:1427` and `:645`.

## Checks

- Prettier: completed on all four changed files.
- Scoped `ptah_get_diagnostics`: 0 errors, 0 warnings.
- `nx typecheck agent-sdk`: passed.
- `nx lint agent-sdk`: passed, 0 errors and 52 warnings. Targeted ESLint on the four changed files found three warnings, none on changed lines (`sdk-agent-adapter.spec.ts:449`, two existing file-length warnings).
- `nx test agent-sdk -- --maxWorkers=2`: 163 suites passed, 2 skipped; 3,497 tests passed, 3 skipped.
- Degradation audit: 294 unsuppressed sites, unchanged.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep the restored tab provider refresh finding for frontend ownership. | Change frontend now; report for a frontend batch. | Review says `tab.providerId` can remain stale after a provider switch (`code-logic-review.md:27,70`); this fix round explicitly limits edits to agent-sdk files. | Yes |
| Retain the provider update on `activate:true` resume. | Record the provider of the launched query; preserve the historical ID until a message. | Approved plan chooses the latest provider that launched the root turn (`implementation-plan.md:42,52`); the review could not confirm when SDK `init` fires (`code-logic-review.md:28`). | Yes |
| Catch and log awaited metadata writes. | Catch awaited writes; schedule writes after critical steps. | Existing callbacks already await metadata writes; catching keeps their ordering while allowing run setup and resolution to continue. | Yes |

## Not done

- Frontend tab refresh is outside this fix round's file ownership.
- The SDK `init` timing for `activate:true` resume remains unconfirmed; current behavior follows the approved latest-root-provider policy.
