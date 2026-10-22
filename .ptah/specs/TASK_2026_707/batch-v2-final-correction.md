# Dashboard v2 final correction

## Defect 1 — discovery exhausts the snapshot budget

- Fix: `libs/backend/rpc-handlers/src/lib/services/plan-limits-snapshot.service.ts:86,150` reserves `SLOW_LIMIT_LOOKUP_DEADLINE_MS` (12 seconds) for owner reads by passing the 12-second discovery deadline to `discoverTargets`. The overall snapshot deadline remains 24 seconds.
- Specs: `libs/backend/rpc-handlers/src/lib/services/plan-limits-snapshot.service.spec.ts:161` verifies a read-kind OpenCode owner is actually read after 12 seconds of discovery, retains the reader's `unsupported-config` status, settles before 24 seconds, and leaves no timers. `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.spec.ts:379` verifies near-12-second successful detection with installed Codex and OpenCode, a hung Codex home resolution, preservation of the OpenCode CLI-store owner, and no timers.
- Jest: `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/services/plan-limits-snapshot.service.spec.ts --coverage=false --maxWorkers=1 --silent` — PASS, 12 tests. `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.spec.ts --coverage=false --maxWorkers=1 --silent` — PASS, 36 tests.

## Defect 2 — overflow evidence absent from accessible details

- Fix: `libs/frontend/dashboard/src/lib/components/provider-account-tile/provider-account-tile.component.ts:102-111` includes the overflow chip's full `title` in `detailLines`, which feeds the section title and `aria-label`. The compact visible line still starts with the first evidence notice.
- Spec: `libs/frontend/dashboard/src/lib/components/provider-account-tile/provider-account-tile.component.spec.ts:62` verifies all three evidence sentences appear in the `aria-label` and title, while the first remains visible.
- Jest: `npx jest -c libs/frontend/dashboard/jest.config.ts libs/frontend/dashboard/src/lib/components/provider-account-tile/provider-account-tile.component.spec.ts --coverage=false --maxWorkers=1 --silent` — PASS, 6 tests.

## Decisions

- Reserve the shared 12-second slow lookup budget from discovery rather than change discovery's source scheduling. The review identifies `discoverTargets` as the single gate before reads, and the existing `SLOW_LIMIT_LOOKUP_DEADLINE_MS` matches the required read window. Reversible.
- Keep the existing two-item evidence collapse and use its already populated `title` for accessible details. This preserves the compact layout while exposing every sentence. Reversible.

## Not done

- Scoped `ptah_get_diagnostics` did not return a TypeScript result: its compiler check remained running past the 45-second tool deadline, including on retry. The three scoped Jest suites passed. No build or broader verification was run, per task constraints.
