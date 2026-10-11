# PR #697 fixes

## CI and review disposition

| Item | Result | Location | Regression spec |
| --- | --- | --- | --- |
| `degradation-audit:lint` catch-return-sentinel | Fixed: documented optional Grok login probe with accepted `optional-capability` suppression and reason; baseline unchanged. | `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts:185` | Existing `plan-limit-owner-discovery.service.spec.ts`; audit lint |
| `degradation-audit:lint` promise-catch-sentinel | Fixed: log rejected Codex owner read through injected Logger; no literal catch result. | `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts:454` | Existing `plan-limit-owner-discovery.service.spec.ts`; audit lint |
| `@ptah-extension/platform-cli:test` | Skipped source change: isolated spec passed 13/13, and this PR has no platform-cli change; CI failure did not reproduce. | `libs/backend/platform-cli/src/implementations/cli-workspace-watcher.spec.ts` | Same isolated spec |
| `main` aggregate | No direct change; aggregates the two jobs above. | CI workflow | Above checks |
| CodeRabbit 4242120733 | Fixed: absent Grok session marks `no-open-session` only for `no-usage-source`; transient failures can use stale windows. | `libs/backend/auth-providers/src/lib/quota/plan-usage.service.ts:296` | `plan-usage.service.spec.ts:452` |
| CodeRabbit 4242120751 | Fixed: quota 403 continues through endpoints and operations; only 401 clears token and retries. If every quota route is forbidden, result remains `no-usage-source`. | `libs/backend/auth-providers/src/lib/quota/readers/antigravity-oauth-plan-usage.reader.ts:185` | `antigravity-oauth-plan-usage.reader.spec.ts:174` |
| CodeRabbit 4242120754 | Fixed: local usage closed tile displays `t.value`. | `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tile.component.ts:123` | `plan-limit-tile.component.spec.ts` local tile assertion |
| CodeRabbit 4242120759 | Fixed: aged and not-confirmed closed tiles display their window chip. | `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tile.component.ts:208` | `plan-limit-tile.component.spec.ts` parameterized state test |
| CodeRabbit 4242120762 | Fixed: reset-usage-unknown uses `resetPassage().nextResetAt`, with `Reset unknown` fallback. | `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tiles.ts:244` | `stats-limit-view-model.spec.ts:558,570` |
| CodeRabbit 4242120766 | Fixed: no-source notice when no local accounting; local-only notice when local accounting exists. | `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts:789` | `provider-account-card.component.spec.ts:616,631` |

`gh pr view 697 --comments` contained the CodeRabbit summary and walkthrough, with no additional actionable summary-level comment.

## Verification output tails

- `npx nx lint degradation-audit --parallel=1`: `libs/backend/cli-agent-runtime: 0 ok (baseline 1)`; `TOTAL 294 unsuppressed site(s)`. The audit's "directory not found by this scan" suffix means this directory had zero counted violations; baseline was not raised.
- `npx jest -c libs/backend/platform-cli/jest.config.ts libs/backend/platform-cli/src/implementations/cli-workspace-watcher.spec.ts --coverage=false --maxWorkers=2`: `Test Suites: 1 passed`; `Tests: 13 passed`.
- Auth providers changed specs: `Test Suites: 2 passed`; `Tests: 44 passed`.
- CLI agent runtime limits specs: `Test Suites: 5 passed`; `Tests: 110 passed`.
- Chat UI plan-limits folder: initial run `1 failed, 4 passed` due placeholder encoding; corrected component spec: `1 passed`, `7 passed`; view-model spec after adding next-reset case: `1 passed`, `39 passed`.
- Dashboard provider-account-card spec: final run `Test Suites: 1 passed`; `Tests: 41 passed`.
- `npx nx typecheck @ptah-extension/{auth-providers,cli-agent-runtime,chat-ui,dashboard} --parallel=1`: each target reported `Successfully ran target typecheck`. Auth providers was rerun with `NX_SKIP_NX_CLOUD=true` after an Nx Cloud free-plan warning; all four local targets passed.
- `npx prettier --write` completed on all changed source and spec files; dashboard source/spec were formatted again after the final local-usage assertion.

## Decisions

- Kept the Grok login probe optional: missing or malformed local auth means the CLI store is not authenticated, so the documented audit suppression is more precise than an error response.
- Retained the existing OAuth `noPlan()` result when all quota routes return 403, while allowing other routes to succeed.
- Kept the provider card's OpenCode sign-in message for owners with no local usage.
- No platform-cli file was changed because its failing CI spec passed in isolation.
- The `ptah_agent_report` tool was not listed in this agent's callable tools, so the report call could not be made.
