# Phase 4 fix report — TASK_2026_596_0a19

Scope: Moderate findings 2 and 3 from `phase-4-code-review.md`. Finding 1 (Antigravity account identity) is a named later task and was left alone.
Files edited (only under `libs/backend/cli-agent-runtime/**`):

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.spec.ts`

`doSpawnSdk`, the resume entry and never-touch files were not changed.

## Finding 2: `ledgerOnly` discarded the status `planOwnerRead` already knew

**Fix** (`plan-limit-owner-discovery.service.ts:319`): `ledgerOnly` now calls `planOwnerRead(owner)` once per owner:

- `null` (outside the plan-limit scope) or an `unknown` identity: skipped, as before.
- `{kind:'known', status, unavailableReason?}`: that status and reason are passed straight to `snapshotWithoutRead`. An Anthropic `credential` owner is now `unsupported-auth` with no windows; before, it was `service-unavailable`.
- `{kind:'read'}`: `service-unavailable` with no reason. This is the real "ledger-only, no current read" case.

The module doc (sources, item 5) now describes this.

**Behaviour change in an existing test.** A ledger-only Claude *account* owner now carries `unavailableReason: 'no-open-session'`, because `planOwnerRead` knows this owner has no session handle. The expectation in "builds ledger-only snapshots from evidence…" was updated at spec:365.

**Tests added:**

- spec:370 `a ledger-only owner needing a live read is plain service-unavailable`: an OpenCode owner key gives `service-unavailable` with no `unavailableReason`.
- spec:385 `a ledger-only Anthropic API-key owner keeps unsupported-auth, with no windows`: covers both ledger origins (`owner-key` and `active-evidence`). The ledger fixture has a window, and the test asserts it is dropped (`windows: []`).

## Finding 3: `discoverTargets` had no deadline

**Fix:**

- **Deadline per source** (`fromSource`, service:433). Each source races its own timer of `LIMIT_LOOKUP_DEADLINE_MS`, imported from `@ptah-extension/shared`. This uses the same race / `unref` / `clearTimeout` pattern as `lane-limit-lookup.service.ts:132-162`, so it adds no new timer mechanism. A timeout returns a module-private `TIMED_OUT` symbol (service:151). The source is then dropped alone, logged at debug as `'[PlanLimitOwnerDiscovery] source timed out', { source }`, carrying only the source name. The timer is released in `finally` (service:459) on every path: settled, thrown or timed out. A late result or rejection from the abandoned read is still handled by the race, so it cannot become an unhandled rejection.
- **Concurrent sources** (`discoverTargets`, service:191). All sources now start together, and their results are added in the fixed source order. As a result:
  - "First source to name an owner wins" still follows source order, not which source settles first.
  - One call is bounded by a single deadline, about 3 s. Running the sources one after another would have allowed up to 7 × 3 s.
  - `cli-store` and `lane` still share the one bounded `detection` call.
- The `vscode-lm-tools` `settledWithin` helper was not imported. It is private to `protocol-dispatcher.ts` and sits in a library this one does not depend on, so I followed the local precedent in `lane-limit-lookup.service.ts` instead.

**Test added:** spec:426 `a source that never settles is dropped alone at the lookup deadline, timers released`. It uses fake timers, and `listAgents` never settles. It checks that:

- the call is still pending at `deadline - 1`;
- at the deadline it resolves with every other source's owners (selected Codex, OpenCode CLI store, and a ledger-only key);
- exactly one debug call is made: `{ source: 'ptah-cli' }`;
- `jest.getTimerCount()` is 0 afterwards.

## Verification

`npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-agent-runtime` (foreground):

- `test`, `typecheck` and `lint` all passed: "Successfully ran targets typecheck, test, lint".
- Test counts, from the cached replay of that same run: Test Suites 91 passed / 91; Tests 1867 passed, 1 skipped, 1868 total.
- The Nx Cloud 401 message (organisation plan disabled) is unrelated to this change.
