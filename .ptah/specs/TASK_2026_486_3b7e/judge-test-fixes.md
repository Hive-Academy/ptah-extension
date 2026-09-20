# Judge — TASK_2026_486_3b7e test fixes

VERDICT: PASS

Scope judged: the five changed source files in the worktree
`D:\projects\ptah-extension\.claude-worktrees\perf-task-478-process-and-retention-fleet-5891e3e00c97`,
plus the port contract, host core, sibling perf specs and the shared contract runner.
No test suite was run (another agent holds this worktree). No file was edited.

---

## 1. THE CENTRAL QUESTION — is the two-overflow relaxation contract-backed?

**Yes. The contract documents it explicitly, in two independent places, and a
sibling spec on the same rig already asserts the exact shape the agent moved to.**

Primary evidence — the port doc itself:

- `libs/backend/platform-core/src/interfaces/workspace-watcher.interface.ts:156-162`
  > "one loss-of-events incident — a storm, an adapter failure, or both
  > overlapping — yields one `overflow` batch; **an adapter failure surfaces as
  > one `overflow` batch, followed by resubscription. A host that must REBUILD
  > its native subscription (native error, refused subscribe, a lost watch)
  > signals one more `overflow` once the rebuilt subscription is live, because
  > the rebuild itself is a window with no subscription and a rescan started
  > earlier cannot see it**"
- `…/workspace-watcher.interface.ts:163-171` says the same for the Linux lost-watch
  path and adds the fold rule: "A storm that ended with such directories
  unreconciled folds that first `overflow` into its own exit `overflow`" — i.e.
  the documented ceiling for one incident that rebuilds is **two**, not one.
- `libs/backend/platform-core/src/workspace-watch/workspace-watch-host-core.ts:34-47`
  ("Re-subscribe versus rebuild"): "Every loss is signalled twice: `overflow`
  when it is detected … and `overflow` again once the new subscription is live".
- `libs/backend/platform-core/CLAUDE.md` repeats it as a lib invariant
  ("signals `overflow` once the new one is live — and every loss is ALSO
  signalled when detected").

Corroborating evidence — the repo already asserts the relaxed shape on this rig:

- `apps/ptah-electron/src/services/git-watcher.stress.perf.spec.ts:147-158` uses
  `overflowBatches.length <= 3`, `cycles.length <= overflowBatches.length + 1`,
  `truncatedContentPushes.length <= overflowBatches.length`. The new CI form
  (`git-watcher.stress.spec.ts:155-162`) is **strictly tighter** than that
  precedent: `<= 2` overflows, and `===` rather than `<=` for cycles and pushes.
- The strict single-overflow form is not lost — it is still asserted for the
  idle machine at this exact tree size in
  `git-watcher.stress.perf.spec.ts:103-105`
  (`expect(rig.batchLog).toHaveLength(1)`), behind `PTAH_PERF_SPECS=1`. This is
  the repo's own documented R-P11 split (strict form = perf spec, bounded
  mechanism = CI), stated at `git-watcher.stress.spec.ts:100-104`.

**Conclusion: the permission was not invented.** The relaxation is inside the
written contract and inside an existing in-repo precedent.

**One correction to the agent's stated reasoning.** The agent attributed the CI
second overflow to a native rebuild. The repo's own measured attribution for
multi-overflow runs on this rig says otherwise:
`git-watcher.stress.perf.spec.ts:130-145` records 3/3 and 2/2 overflow/cycle
runs with **zero** `rig.warnLines`, and concludes the cause was the storm
breaker exiting and re-entering (`quietMs` 2 000 ms) — "NOT a rebuild/
native-error overflow (would show up as a `rig.warnLines` entry; none did)".
Both causes are documented, correct product behaviour, so the assertion change
stands either way — but the agent named one cause without the evidence that
distinguishes them (`rig.warnLines`, which the new test does not assert). That
is an imprecise rationale, not a bent test. See Moderate finding M-2.

---

## 2. Is `[].every(...)` vacuity reachable? Can a zero-overflow or interleaved run slip?

**No run that previously failed for a non-rebuild reason now passes.**

- **Zero overflow cannot slip.** `git-watcher.stress.spec.ts:142-143` still has
  `const overflowIndex = batches.findIndex((b) => b.overflow);
  expect(overflowIndex).toBeGreaterThanOrEqual(0);` and it executes **before**
  `overflowAt` is read at line 148. A zero-overflow run throws at 143, so
  `batches[-1].at` is never evaluated and no vacuous `every` is reached.
  `git-watcher.stress.spec.ts:155` adds a second, independent floor
  (`overflowBatches.length >= 1`).
- **`overflowAt` with no overflow is unreachable** for the same reason — line
  143 is the guard.
- **Interleaved normal batches cannot slip.** `batchesAfterOverflow` is
  `batches.slice(overflowIndex + 1)` (line 147), i.e. everything after the
  **first** overflow. `every((batch) => batch.overflow)` (line 157) fails on any
  normal batch anywhere after it. Combined with
  `batchesBeforeOverflow.length <= 1` (154) and `overflowBatches.length <= 2`
  (156), the only shapes that pass are `[overflow]`, `[normal, overflow]`,
  `[overflow, overflow]`, `[normal, overflow, overflow]` — total ≤ 3 batches.
- **The vacuous case is exactly the old passing case.** `batchesAfterOverflow`
  is empty precisely when the old `toHaveLength(0)` held. Vacuity here
  reproduces the previous assertion's success condition, it does not widen it.

---

## 3. Are the six header safety properties still enforced?

| # | Property | Still enforced? | Evidence |
|---|----------|-----------------|----------|
| 1 | ≤ 1 non-overflow batch before the overflow | YES, unchanged | `git-watcher.stress.spec.ts:154` |
| 2 | Bounded overflow count for the incident | YES, now `1..2` instead of `=1` | `:155-156` |
| 3 | No normal batch after the overflow | YES, re-expressed | `:157` — every post-first-overflow batch must itself be an overflow |
| 4 | ≤ 1 cycle before; one cycle **per** overflow at-or-after | YES, tightened to equality | `:159-160` `expect(cyclesAfterOverflow).toHaveLength(overflowBatches.length)` |
| 5 | **No amplification** — pushes tied 1:1 to overflows, each truncated | YES | `:162` `expect(rig.contentPushes()).toHaveLength(overflowBatches.length)` — an exact count, not a bound; `:163-170` every push `truncated === true`, non-vacuous because the length is pinned ≥ 1 by `:155` |
| 6 | `directoryUpdates === 0` | YES, byte-identical | `:172` `expect(rig.directoryUpdates).toBe(0)`; counter at `git-watcher.stress.harness.ts:411-416` (a `kind === 'update'` change whose path stats as a directory) |

The amplification property is the one that mattered most, and it survives in a
**stronger** form than the perf spec's: `toHaveLength(overflowBatches.length)` is
equality, so two overflows with three pushes fails, and two overflows with one
push also fails. The header comment at `:106-120` was updated to describe exactly
this and does not overstate it.

---

## 4. The `waitForSubscription?()` hook in the shared contract

**Additive, optional, and correctly ordered.**

- Declared optional: `run-workspace-watcher-contract.ts:41-46`
  (`waitForSubscription?(): Promise<void> | void;`) on an existing interface; no
  field was removed or made required. `subscribeSettleMs` is still declared at
  `:39-40`.
- Call site: `run-workspace-watcher-contract.ts:169-170`
  ```ts
  await setup.waitForSubscription?.();
  if (setup.subscribeSettleMs) await sleep(setup.subscribeSettleMs);
  ```
  Optional-call on `undefined` yields `undefined`; `await undefined` costs one
  microtask. Existing callers are behaviourally unchanged.
- Existing callers verified unaffected — none passes the new field:
  `libs/backend/platform-vscode/src/implementations/vscode-workspace-watcher.spec.ts:351`,
  `libs/backend/platform-electron/src/workspace-watch/workspace-watch-host.entry.spec.ts:301`,
  `libs/backend/platform-core/src/testing/contracts/run-workspace-watcher-contract.self.spec.ts:70`.
- **Order is right.** The ack is the readiness signal; `subscribeSettleMs` is
  slack layered on top of readiness. Sleeping first and then waiting for the ack
  would make the sleep dead time for a fast adapter and would not shorten a slow
  one. Ack-then-settle is the only ordering in which both knobs compose.
- The signal is real, not invented: `subscribed` is a first-class protocol
  message, `workspace-watch-protocol.ts:195-200`
  (`workspaceWatchSubscribedMessageSchema`, `type: 'subscribed'`, `id`), and
  `platform-core/CLAUDE.md` defines it as "the per-subscription ack that a
  native subscribe covering it succeeded".

**On editing platform-core at all**: appropriate. The alternative — another
guessed sleep in the CLI adapter spec — is the defect being fixed, and the
repository's stated rule is that logic two or more adapters share belongs in
platform-core with its I/O injected (`platform-core/CLAUDE.md`, Guidelines).
The edit is confined to `src/testing/`, touches no port interface, no token and
no production code, and is six additive lines. It was not on the forbidden list
and did not need to be.

---

## 5. The `heapUsed` assertion and the 30 s timeout

**5a. Was the original assertion measuring what it claimed? No.**
`process.memoryUsage().heapUsed` is process-wide. In a Jest worker it includes
ts-jest, the coverage instrumenter, the module registry and every other spec in
the same worker file set — and there is no forced GC, so the delta is a function
of when V8 last collected. A 64 MiB budget over 1 000 iterations could pass with
real retention hidden under a GC that happened to run, or fail with none. It was
a load-sensitive proxy, which is exactly how it failed in CI.

**5b. Is the replacement a real retention proof? Yes, for this runtime's whole
retention surface — and it is narrower only in ways that do not apply here.**
`ElectronStateWorkerRuntime`'s only growable containers are, at
`electron-state-storage-worker-runtime.ts:234-242`:
`sequenceWrites: Map`, `scalarWrites: Map`, and `values:
ElectronStateValueStore` (byte-accounted). Everything else is a scalar or a
nullable handle. The replacement covers exactly that set:
- `…error-paths.spec.ts:1203-1211` runs a second 100-iteration phase of the same
  three read types;
- `:1212` `expect(runtime.valueCacheStats()).toEqual(stats)` — the cache is
  byte-for-byte unchanged across the second phase (steady state, not merely
  under a ceiling);
- `:1213-1217` every instance `Map` is still size 0.
Not vacuous: `:1197-1198` already forces `stats` to be a real object (Jest's
`toBeLessThanOrEqual` rejects `undefined`), and `:1195`
`expect(mapSizes.length).toBeGreaterThan(0)` forces the Map set to be non-empty.
The original 1 000-iteration loop and both original assertions (`:1196`, `:1198`)
are retained. Only the heap delta was removed.
Residual gap, stated honestly: retention in a non-`Map`, non-cache container
(an array field, a closure, a detached Buffer) would now be invisible. Today no
such field exists on this class, so the gap is latent, not live — pin it if one
is added.

**5c. Is the raised timeout hiding a performance regression? No.**
`jest.setTimeout(30_000)` at `…error-paths.spec.ts:35` sits in a spec that does
real filesystem commits and has no performance assertion at all. This repository
keeps time budgets in dedicated, opt-in perf specs (`PTAH_PERF_SPECS=1`;
`git-watcher.stress.perf.spec.ts`, `workspace-watch-host.stress.perf.spec.ts`),
and the same file-level pattern already exists in siblings:
`electron-state-storage-legacy-split.spec.ts:122` (`120_000`),
`electron-state-storage-large-profile.perf.spec.ts:58` (`600_000`),
`workspace-watch-host.stress.perf.spec.ts:51` (`420_000`). A 5 s Jest default is
not a performance gate for an integration spec; it is a hang detector, and 30 s
still detects a hang. The extra per-test `30_000` at `:1019` is redundant with
the file default but harmless. The heavy retention test kept its own `180_000`
(`:1218`) — not raised.

---

## 6. Do the CLI spec and the Electron harness only replace sleeps?

**Yes — every change is a sleep-to-acknowledgement swap; no assertion was
removed from either file.**

`libs/backend/platform-cli/src/implementations/cli-workspace-watcher.spec.ts`:
- `:202` new `WeakSet`, `:213-222` a `message` listener that records
  `type === 'subscribed'`. Pure instrumentation on the existing fork spy.
- `:248-254` `await sleep(1_500)` → `waitFor(… subscribedHosts.has(host))`
  inside `triggerOverflow`. The pre-existing
  `await waitFor(() => hosts.length > before, …)` (`:250`) is retained.
- `:256-263` `subscribeSettleMs: 1_500` → `waitForSubscription`.
- `sleep` is still imported and used (`:47`, `:57`), so no dead symbol.
- No `expect` in this file was touched.

`libs/backend/platform-electron/src/workspace-watch/workspace-watch-host.stress.harness.ts`:
- `:258`, `:267-279` per-subscription **id** tracking (`Set<number>`), `:292-294`
  `hasSubscriptionCount(count)`. `hosts` is typed `WatchHostChildProcess[]`
  (`:522`, `:623`, `:762`), so the extra method type-checks.
- `:636-640` `sleep(1_500)` → wait for `hosts[0].hasSubscriptionCount(2)` — two
  subscriptions (`rootA` at `:632`, `rootB` at `:633`) on one host. Count is right.
- `:663-666` `sleep(1_000)` → wait for `hosts[1].hasSubscriptionCount(2)` after
  the SIGKILL. The pre-existing overflow wait at `:659-662` is retained.
- Consumers are untouched and still strict:
  `workspace-watch-host.stress.spec.ts:135-137`
  (`expect(result.overflowA).toBe(1)`, `overflowB` likewise, `isDegraded` false)
  and `workspace-watch-host.stress.perf.spec.ts:93-97`.

---

## 7. Constraint compliance

`git diff --stat` shows **zero** touched files under the forbidden set: no
`jest.preset.js`, no `nx.json`, no `.github/workflows/ci.yml`, no
`libs/backend/agent-sdk`, no `libs/backend/memory-curator`, no `libs/frontend/**`,
no `scripts/`. The five code files are exactly the five declared.

`libs/backend/platform-core` was not forbidden, and the edit made there is
appropriate — see §4. It is testing-only, additive and optional; the alternative
(duplicating a readiness barrier into each adapter spec) is the pattern the lib's
own guidelines forbid.

---

## Findings

### M-1 (Moderate) — the CLI spec's readiness barrier is per-HOST, the protocol's ack is per-SUBSCRIPTION

- File: `libs/backend/platform-cli/src/implementations/cli-workspace-watcher.spec.ts:202`,
  `:213-222`, `:256-263`
- The `subscribed` message carries an `id`
  (`workspace-watch-protocol.ts:197-200`), and the same agent's Electron harness
  tracks it correctly (`workspace-watch-host.stress.harness.ts:258`, `:292-294`,
  `hasSubscriptionCount(2)`). The CLI spec collapses it to a per-host boolean.
- Consequence: `run-workspace-watcher-contract.ts:360-366` subscribes **twice**
  in one test. The second `subscribe()` finds the host already in the `WeakSet`,
  so `waitForSubscription` returns immediately — and the 1 500 ms
  `subscribeSettleMs` that used to cover it was removed in the same change.
- Impact is small in practice: both subscriptions target the same `root`, so the
  native subscribe already covers the second and its ack is near-immediate; the
  test's next step is a retrying `waitFor` (`:370-379`), not a fixed sleep.
  Real but bounded residual flake risk.
- Fix: mirror the Electron harness — `Map<host, Set<number>>` of acked ids, and
  have `waitForSubscription` wait for `size >= expectedSubscriptions`.

### M-2 (Moderate) — the report names a cause the change does not evidence

- File: `.ptah/specs/TASK_2026_486_3b7e/test-failures-report.md:54-56`
- "The port contract permits a second overflow after a native subscription
  rebuild" is true of the contract, but the repo's own measurement of
  multi-overflow runs on this rig attributes them to storm exit/re-entry with
  **zero** rebuild diagnostics
  (`git-watcher.stress.perf.spec.ts:130-145`).
- The relaxed assertion is correct under either cause, so this is a reporting
  precision defect, not a test defect. The new spec also does not assert
  `rig.warnLines`, which is the signal that would have told the two apart.
- Fix (optional, cheap): add `expect(rig.warnLines)`-shaped evidence or amend
  the header comment at `git-watcher.stress.spec.ts:108-109` to name both
  documented causes (native rebuild **and** storm re-entry) rather than one.

### m-3 (Minor) — redundant per-test timeout

- `electron-state-storage-worker-runtime.error-paths.spec.ts:1019` adds `30_000`
  to a test already covered by the file-level `jest.setTimeout(30_000)` at `:35`.
  Harmless; delete one of the two.

### m-4 (Minor) — the second Map sweep has no non-empty guard

- `…error-paths.spec.ts:1213-1217` has no `mapSizes.length > 0` companion, unlike
  the first sweep at `:1195`. Not currently vacuous (the same object is inspected
  and `:1195` already proved the set non-empty in the same test), but it would
  silently become vacuous if the class's Map fields were ever replaced.

### m-5 (Minor) — measurement window changed in the kill scenario

- `workspace-watch-host.stress.harness.ts:663-666`: the fixed `sleep(1_000)`
  inside `measureEventLoopDelay` became a variable-length wait. If the acks land
  in well under a second, the perf spec's `delay.p99Ms` samples over a shorter
  quiet tail (`workspace-watch-host.stress.perf.spec.ts:97`,
  `p99 <= 30 ms`). Perf-gated behind `PTAH_PERF_SPECS=1`, so it cannot affect CI;
  worth a sanity run before the next perf-budget conversation.

### Housekeeping (not part of the five files)

- Untracked junk at the worktree root: `parsed_comments.md`, `pr_comments.json`.
  Do not commit.
- `.ptah/specs/TASK_2026_480_c2d8/`, `…_481_7b0f/`, `…_482_d4a8/`, `…_483_6f21/`
  are dirty from the **other** agent working in this shared worktree (the set
  changed between two `git status` reads during this review). They are unrelated
  to these test fixes and must be excluded from the commit.

---

## Verdict

- Recommendation: **PASS**
- Confidence: **HIGH** for questions 1-4, 6 and 7 (read against the written
  contract, the host core and the sibling specs); **MEDIUM** for question 5b,
  where the proof is complete for today's field set and would need re-pinning if
  a non-`Map` container is added to the runtime.
- Top risk: not the relaxation — it is M-1, the per-host readiness barrier in
  the CLI spec, which silently no-ops for the second subscription in the one
  contract test that makes two.
- This is not a test bent to fit a failure. The strict form still runs where the
  repo says strict forms belong (`git-watcher.stress.perf.spec.ts:103-105`); the
  CI form is tighter than the existing precedent on the same rig; no assertion
  was deleted anywhere except a process-heap delta that could not measure what
  it named; and the sleep-to-ack swaps are strictly more deterministic than what
  they replaced.
- Commit the five source files. Fix M-1 first if a follow-up commit is cheap;
  it is not a blocker.
