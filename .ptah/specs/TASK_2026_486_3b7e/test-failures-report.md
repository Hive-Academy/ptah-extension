# PR #539 test-failure diagnosis

## Classification

All three CI failures are **cause (A): pre-existing failures exposed by cache invalidation**.

The relevant source and spec trees under `libs/backend/platform-cli`,
`libs/backend/platform-electron`, and `apps/ptah-electron` have no diff from
`origin/main`. The reproduction also passed the same explicit CI overrides,
`--parallel=3 --maxWorkers=2`, so neither the new `nx.json` default nor the new
`jest.preset.js` default caused these CI failures. The per-project coverage
thresholds did not fail; each failed target contained a behavioral assertion or
timeout.

Worker/load sensitivity (the mechanism described by candidate B) explains why
the pre-existing tests were intermittent, but it is not a branch-introduced
worker-count regression: CI overrides both changed defaults, and the unchanged
`origin/main` tests reproduce under those overrides.

### `@ptah-extension/platform-cli:test` — cause (A)

CI timed out waiting for a real watcher event. Local reproduction failed at a
different event in the same contract, and a later run showed that delivery
after a host restart could race the replacement host's native subscription.
The test waited a fixed 1.5 seconds after `watch()`/restart instead of observing
the protocol's `subscribed` acknowledgement.

Changed the shared watcher contract to accept an optional deterministic
subscription-readiness barrier. The CLI real-host spec now records
`subscribed` messages and waits for the acknowledgement both initially and
after a supervised restart. No event assertion or retry was removed.

### `@ptah-extension/platform-electron:test` — cause (A)

CI failed a fixed 64 MiB delta assertion against
`process.memoryUsage().heapUsed`. That heap belongs to the entire instrumented
Jest worker (including ts-jest, coverage, and unrelated specs), not to
`ElectronStateWorkerRuntime`, so it cannot prove runtime retention. Under local
three-project load, ordinary durable-state operations also crossed Jest's
generic 5-second unit-test timeout, and watcher-restart delivery raced native
resubscription.

Changed the retention test to prove steady state using the runtime-owned value
cache and cursor maps before and after another operation phase. Added a
30-second default budget to this real-filesystem integration spec while keeping
its behavioral assertions and existing larger stress-test limits. The real
host-kill harness now waits for both native `subscribed` acknowledgements on the
initial and replacement hosts rather than sleeping for guessed durations.

### `ptah-electron:test` — cause (A)

CI observed two overflow batches where the stress spec asserted exactly one.
The spec itself already documented the same strict-form failure on `main` under
`--maxWorkers=2`. The port contract permits a second overflow after a native
subscription rebuild because the rebuild is another interval in which events
may have been lost.

Changed the CI mechanism assertion to distinguish the valid bounded shapes:
one storm overflow or the documented two-overflow native-rebuild sequence. It
still requires no normal batches after overflow, at most one leading normal
batch, at most two overflows, exactly one refresh cycle and one truncated
content push per overflow, and no directory-update echo. This corrects what the
test asserts without dropping the safety and amplification checks.

## Final verification

Command:

```text
npx nx run-many -t test -p @ptah-extension/platform-cli @ptah-extension/platform-electron ptah-electron --parallel=3 --maxWorkers=2 --coverage --skip-nx-cache
```

Nx header: `Running target test for 3 projects and 6 tasks they depend on`.

Final output:

```text
@ptah-extension/platform-cli
Test Suites: 15 passed, 15 total
Tests:       3 todo, 217 passed, 220 total

ptah-electron
Test Suites: 1 skipped, 46 passed, 46 of 47 total
Tests:       3 skipped, 635 passed, 638 total

@ptah-extension/platform-electron
Test Suites: 2 skipped, 36 passed, 36 of 38 total
Tests:       4 skipped, 3 todo, 618 passed, 625 total

NX Successfully ran target test for 3 projects and 6 tasks they depend on
```

No coverage threshold failed. No changes were made to `jest.preset.js`,
`nx.json`, or `.github/workflows/ci.yml`.
