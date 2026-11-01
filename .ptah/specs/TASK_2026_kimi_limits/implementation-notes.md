# Kimi Code plan usage implementation

## Files changed

- `libs/backend/auth-providers/src/lib/quota/readers/kimi-code-plan-usage.reader.ts` — validates the official `/coding/v1/usages` response, maps five-hour, weekly and optional monthly windows, checks owner identity, and refreshes rejected OAuth once.
- `libs/backend/auth-providers/src/lib/quota/readers/kimi-code-plan-usage.reader.spec.ts` — endpoint, mapping, malformed data, owner, refresh, timeout and failure tests.
- `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts` and `.spec.ts` — distinct direct lane key, shared provider key and shared CLI login owners, including missing and failed slot reads.
- `libs/backend/auth-providers/src/lib/quota/plan-usage.service.ts` and `.spec.ts` — reader registration and delegation of Kimi credential selection to the reader.
- `libs/backend/auth-providers/src/lib/di/register.ts` — passes the existing Kimi auth singleton to `PlanUsageService`.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-owner-read.ts` and `plan-owner-read.accounts.spec.ts` — main and lane Kimi read targets.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts` and `.spec.ts` — selected Kimi provider and enabled lane discovery with shared-owner deduplication.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-limit-lookup.service.ts` and `.spec.ts` — direct Kimi lane lookup before a remembered run.
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-lane-plan-limits.ts` and `.spec.ts` — spawn-time Kimi owner resolution.
- `apps/ptah-electron/src/di/container.smoke.spec.ts` — resolves plan usage with the registered Kimi auth singleton.

## Decisions

| Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- |
| Use the fixed `https://api.kimi.ai/coding/v1/usages` endpoint with redirects disabled. | Configured Kimi host or official fixed host. | Research report's official client contract and credential leak risk. | Yes. |
| Keep direct `ptahCli.<id>` key, shared provider key and shared OAuth login under separate owners; check the selected credential again before HTTP. | Merge by provider or distinguish by credential. | Existing `ProviderOwnerResolver` fingerprints and the research report's owner cases. | Yes. |
| Return `service-unavailable` for malformed or contradictory usage, leaving existing stale and ledger handling intact. | Display returned zero or suppress the reading. | Research report's false-zero issue and `PlanUsageService` failure behavior. | Yes. |
| Reuse existing RPC and display contracts. | Add Kimi-specific RPC/frontend fields or use `PlanLimitWindow`. | Existing snapshot and `lanePlanLimits` contract already represent these windows. | Yes. |

## Verification

All commands ran from this worktree. Output was tailed or read from the Nx terminal output cache; no workspace-wide command ran.

| Exact command | Result |
| --- | --- |
| `npm run verify -- -p auth-providers,cli-agent-runtime,ptah-electron` | Failed: 12/15 tasks succeeded. `auth-providers:test` had 3 failed suites and 6 failed tests (including an initial missing `reflect-metadata` import and an obsolete owner expectation, both corrected afterward); `auth-providers:lint` reported one unused dependency declaration; `ptah-electron:test` found an incomplete new test harness, corrected afterward. |
| `npm run verify -- -p auth-providers,cli-agent-runtime,ptah-electron -t test,typecheck` | Failed: 11/12 tasks succeeded. All changed-project typechecks, CLI and Electron tests passed. `auth-providers:test` had 1 failed suite, 1 skipped, 90 passed; 4 failed tests, 10 skipped, 2512 passed. All 4 failures were `EPERM` while removing Windows temp directories in the unrelated `translation-proxy.sdk.integration.spec.ts`. |
| `npm run verify -- -p auth-providers -t test -- --testPathPatterns=kimi-code-plan-usage.reader.spec.ts` | Passed: 1/1 task; 1 suite and 18/18 tests passed. |
| `npm run verify -- -p auth-providers,cli-agent-runtime,ptah-electron -t typecheck,lint` | Failed: 5/6 tasks succeeded, including all 3 typechecks. Only `auth-providers:lint` failed on unchanged `libs/backend/auth-providers/package.json:9`, an unused `@ptah-extension/persistence-sqlite` dependency declaration. It reported 10 unrelated warnings and no Kimi source errors. |
| `npm run verify -- -p ptah-cli,ptah-extension-vscode -t typecheck,test` | Passed: 44/44 Nx tasks succeeded (2 cached), including both host test and typecheck targets and their declared dependencies. |

`ptah_get_diagnostics` was called after edits, scoped to changed files, but its compiler remained unavailable after its 45-second budget. The scoped Nx typechecks above completed successfully.

## Open risks and unverified points

- The official source confirms OAuth Bearer access to `/usages`; acceptance of a stored Kimi API key by that endpoint remains unverified without an authorized live key.
- Kimi has reported false zero ratios. The reader rejects a zero ratio when positive legacy `usage.used` appears in the same response, but the frequency and exact semantics require live observation.
- The full `auth-providers:test` suite is blocked by unrelated Windows `EPERM` temp-directory cleanup, and project lint by the unchanged unused dependency declaration noted above.
