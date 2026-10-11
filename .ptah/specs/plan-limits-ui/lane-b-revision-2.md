# Lane B revision 2

## Defects and fixes

| Defect | Fix | File:line |
| --- | --- | --- |
| B | Read typed `PlanLimitOwnerSnapshot.unknownReason` and give each of the five reasons distinct neutral copy. | `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts:604` |
| 10 | Apply the existing shared short owner-key suffix to unknown owner labels too. | `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts:579` |
| 6 | Show Ollama Cloud key rejection and missing-key copy for the corresponding statuses; retain API-key/no-source copy for other providers and local-usage copy for no source. | `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts:623`, `:693` |
| 7 | Show formatted amount/token usage in the window value cell while keeping the percentage meter for measurable limits. | `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts:324`, `:768` |
| 8 | Apply warning/error fill to dashboard and session meters; show Near limit and Limit reached text beside the short reset. Stale status already appears as visible text on status tiles. | `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts:282`; `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tile.component.ts:79`, `:82` |
| C, 13 | Hide chevron for non-expandable local-usage tiles and add reset-aware `aria-valuetext` to the meter. | `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tile.component.ts:78`, `:85` |

Regression coverage: `provider-account-card.component.spec.ts:195`, `:614`, `:625`, `:645`; `plan-limit-tile.component.spec.ts:37`, `:67`, `:76`.

## Verification

- `npx jest -c libs/frontend/dashboard/jest.config.ts libs/frontend/dashboard/src/lib/components/provider-account-card --coverage=false --maxWorkers=1`: Test Suites: 1 passed, 1 total; Tests: 39 passed, 39 total.
- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/session/plan-limits --coverage=false --maxWorkers=1`: Test Suites: 5 passed, 5 total; Tests: 65 passed, 65 total.
- `npx nx typecheck dashboard --parallel=1`: exit 0; 1 task executed, 0 cache hits.
- `npx nx typecheck chat-ui --parallel=1`: exit 0; 1 task executed, 0 cache hits.
- Nx printed a recoverable Cloud free-plan-disabled warning after local checks.

## Decisions

- Kept the shared `ownerDisplayLabel` path so the suffix remains safe and consistent.
- Kept provider-specific Ollama copy localized to the card; no shared or backend files changed.
- The dashboard typecheck resolves the current shared snapshot declaration, so no cast or declaration workaround was needed.
- `ptah_agent_report` was unavailable: no `ptah_*` tools were exposed to this session.

