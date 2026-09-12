# CI round 3 — PR #494 (TASK_2026_411)

Branch `fix/task-411-profile-performance`, worktree
`.claude-worktrees/task-411-profile-performance`. Four commits on top of `2b0adee18`
(one merge + three fixes). **Not pushed.**

`origin/main` was **not** an ancestor of this branch, so the merge was required and is the
first commit. It brought PR #493 in, which is what made failure 1 reproducible here.

---

## Failure 1 — `auth-providers:test` compile error

**Cause confirmed — and it was NOT the whole story given in the brief.**

The brief said the spec passed seven arguments to an eight-parameter constructor, which was
true. Adding the eighth argument was not sufficient: `CompactionBoundaryGenerationRegistry`
is declared in `libs/backend/agent-sdk/src/lib/helpers/index.ts:59` but was **never
re-exported from the package index**, so no consumer outside `agent-sdk` could import it.
Sibling specs construct it by relative path, which is why they compile and this one could not.

The trap worth recording: `nx run @ptah-extension/auth-providers:typecheck` **passed** with the
spec still broken, because `tsconfig.lib.json` excludes spec files. Typecheck is not a gate for
this class of break — only the jest `ts-jest` transform catches it. I ran typecheck, saw green,
and was wrong; the isolated `test` run is what exposed it.

**Fix**

- `libs/backend/agent-sdk/src/index.ts:86` — re-export `CompactionBoundaryGenerationRegistry`
  beside its siblings `CompactionCallbackRegistry` and `CompactionConfigProvider`.
- `libs/backend/auth-providers/src/lib/providers/codex/codex-stream-parity.spec.ts:1-8,47` —
  import it and pass `new CompactionBoundaryGenerationRegistry()`. A real instance, not another
  `as never`, per the brief.

**Tests added**: none. The existing spec *is* the test; it now compiles and runs.

**Result**: `@ptah-extension/auth-providers` — **41 suites, 751 tests, all passing** (was: 1
suite failing to compile, 40/745).

---

## Failure 2 — `platform-electron:test` coverage thresholds

**Cause confirmed.** Every test passed; three of four thresholds missed. The worker host,
commit store, manifest and worker runtime added by B1/B2 were driven only along their happy
path.

**Fix — tests only. No threshold lowered, no `coveragePathIgnorePatterns`, no file excluded.**

Four new spec files, prioritising the error and recovery branches the brief called out:

- `electron-state-storage-worker-runtime.error-paths.spec.ts` (NEW) — drives the runtime
  directly, the only way to reach a refusal without corrupting a fixture on disk: replayed
  operation id, request before `initialize`, non-array read as a sequence, invalid cursor, item
  over page budget, unknown sequence/scalar write, string slices out of order, incomplete
  slices at commit, scalar page with a mismatched key, scalar commit with no root value,
  unknown snapshot cursor, excluded key prefixes, and the `split-array-value` family including
  both merge policies (`replace`, `prefer-longer-arrays`) and the tagged-sequence merge in its
  array and object stored forms. Also the `migration-failed` recovery verdict raised from
  inside `initialize`.
- `electron-state-storage-worker-host.error-paths.spec.ts` (NEW) — scripts a **malformed**
  worker, which the existing in-process-runtime harness can never produce: an unparseable
  reply, a reply correlated to no pending operation, a `postMessage` that throws, a plain
  failure code, a `recovery-required` mapped to the typed error, and use after `dispose`. Plus
  `extractLargeStrings` directly: depth limit, non-finite number, cyclic value, class instance,
  non-cloneable value, and the >32 KB lift.
- `electron-state-storage.degraded-paths.spec.ts` (NEW) — the synchronous v1 store's whole
  second sequence implementation, and a worker-backed store that never became ready
  (`recovery-required` and `not-ready` refusals, `updateSync` unavailable in worker mode).
- `electron-file-dialog.spec.ts` (NEW) — the adapter was at 20 % lines; cancel and
  multi-select-with-filters are ordinary outcomes and neither had a test.

**Coverage, before → after** (`--coverage`, thresholds in brackets):

| metric | before | after | threshold |
| --- | --- | --- | --- |
| statements | 88.76 | **94.01** | 90 |
| branches | 74 | **84.67** | 75 |
| functions | 92.65 | **95.8** | 90 |
| lines | 90.35 | **95.38** | 95 |

Tests 346 → **406**; suites 22 → 26. Command exits **0**.

**One test I wrote and then removed**, recorded rather than hidden: a host-level
`splitArrayValue` case whose scripted `migration-receipt` could not satisfy the response schema
without restating the protocol in the test. The path is already driven end to end against a
real receipt by the runtime suite, and the coverage table confirmed the failing version never
covered those lines anyway (`338-345` stayed uncovered while it ran), so deleting it cost
nothing. No file was excluded from coverage; the brief's one-file exclusion allowance was not
needed and not used.

I also added a `dispose()` to the never-ready store test. Without it that spec left a live fake
worker and its handshake timer behind, and Jest printed *"A worker process has failed to exit
gracefully"*. The warning is gone.

---

## Failure 3 — `electron-e2e`, 16 RPC timeouts

### What I proved, from source, locally

`bootstrapElectron` awaits workspace-storage readiness at
`apps/ptah-electron/src/activation/bootstrap.ts:306-310`, and constructs the `IpcBridge` that
registers `rpc`, `get-state` and `set-state` at `:318-330` — **after** it. That ordering is
deliberate and is pinned by `state-storage-readiness-gate.spec.ts:30-45` ("awaits the exact
workspace storage delegate before IPC and session activation"), so inverting it is not
available.

The consequence is the defect: when that await rejects, `main.ts:112-133` catches, sets
`startupShellQuery` to `recovery`, paints the recovery shell and **`return`s** — leaving a
live window whose three renderer channels have **no listener at all**.

This is the brief's hypothesis (b), and it is exactly the failure mode `b9f3ff4b7` fixed for
`get-startup-config`, reproduced on three more channels:

- `get-state` is **sync** (`preload.ts:28`, `ipcRenderer.sendSync`). Electron never replies on
  a sync channel with no listener, so the renderer blocks inside the call.
- `rpc` is async and simply silent: every caller waits out its own budget and learns nothing.
  A 10 s `sendRpc` timeout with no error text is precisely what that produces, and
  `rpc.spec.ts`, `state.spec.ts`, `smoke.spec.ts`, `setup-wizard.spec.ts` and
  `task-340-session-list-phantoms.spec.ts` are exactly the specs that use these channels.

### Fix

- **NEW** `apps/ptah-electron/src/activation/recovery-mode-ipc.ts` — claims only channels
  nothing else has claimed (`ipcMain.listenerCount(channel) === 0`), so a failure raised *after*
  `IpcBridge.initialize()` succeeded — the `WEBVIEW_MANAGER` and session-notifier throws later
  in bootstrap — keeps the real bridge rather than being downgraded to a stub. `get-state`
  assigns `returnValue` on every path; `set-state` drops the write rather than persisting into
  a store under recovery; `rpc` answers a structured failure carrying the caller's
  `correlationId` and errorCode `state-storage-recovery-required`. It serves no data and does
  no work — it is the error path of a state the app already renders, not a second bridge.
- `apps/ptah-electron/src/main.ts:112-127` — registered inside the bootstrap catch, before the
  recovery shell loads. The `reason` passed across the boundary is our own closed vocabulary
  (`StateStorageRecoveryReason` or `startup-failed`), never a raw error message.

### Coverage that fails in ordinary CI, not only in e2e

`apps/ptah-electron/src/activation/recovery-mode-ipc.spec.ts` (NEW, 11 tests) — per-channel
behaviour, both accepted envelope shapes (`payload.correlationId` and the `requestId` alias),
fire-and-forget and destroyed/absent-sender cases, and that a live bridge is never displaced.
Three are source-order assertions (the established pattern for `main.ts`, which uses
`import.meta` and is not importable under ts-jest): the registration is on the failure path and
precedes the recovery shell load. One pins the premise — if `IpcBridge` ever moves ahead of the
storage await in `bootstrap.ts`, that test fails and this module should be deleted rather than
kept as dead code. The e2e suite and its timeouts are untouched.

### What I could NOT prove, and why — read this before treating failure 3 as closed

I cannot run the e2e suite in this worktree (it lacks `electron`, `@playwright/test`,
`web-tree-sitter`, `prismjs`, `daisyui`, and I was instructed not to install them). The
following are therefore **unverified locally**:

1. **That `bootstrapElectron` actually rejects in CI.** I proved the *consequence* of a
   rejection from source, and it matches the observed symptom precisely. I did **not** obtain
   the CI log line that would confirm it — `[Ptah Electron] Workspace storage did not become
   ready: <code>` — because no such log was available to me. `e2e-final2.log` in the worktree
   root is a stale capture: it contains no `ERR_ABORTED`, no `sendRpc timed out`, and no
   failing-spec lines. **If that line is absent from the real CI run, my fix converts the 16
   silent timeouts into 16 fast, explicit failures but does not make them pass, and the true
   trigger is still open.** That is the single most useful thing to check in the next run.
2. **The `ERR_ABORTED (-3)` on the preparing shell.** I could not establish its cause. The
   shell load *is* awaited before boot, so the obvious "renderer swap supersedes it" story does
   not hold on its face, and the competing explanations (Playwright teardown aborting a pending
   navigation, versus a genuine abort during load) are indistinguishable without the run. Note
   it is logged by the `continuing to boot` guard, so it is **not** fatal by itself — the guard
   from `b9f3ff4b7` is working as designed. I did not change it.
3. **That 16 tests will now pass.** Not claimed. What is claimed and proven is that the
   registration hole is real, is reachable from the documented failure path, and is now closed
   and regression-tested.

---

## Gate results

Every gate run in the foreground from the worktree, after the commits.

| gate | result |
| --- | --- |
| `nx run @ptah-extension/platform-electron:test --coverage --maxWorkers=2` | **PASS**, exit 0 — 26 suites, 406 tests; all four thresholds met |
| `nx run-many -t test -p auth-providers agent-sdk platform-electron` | **PASS** — header `Running target test for 3 projects`; 751 + 1687 + 406 passed |
| `nx run-many -t typecheck -p auth-providers agent-sdk platform-electron ptah-electron` | **PASS** — 4 projects |
| `nx run di-lint:lint` | **PASS** — `1466 @inject sites all resolve to a registered token (670 tokens)` |
| `nx run degradation-audit:lint` | **PASS** — `apps/ptah-electron: 4 ok (baseline 4)`, `libs/backend/platform-electron: 4 ok (baseline 4)`; no new unsuppressed site |
| `nx run ptah-electron:test` (includes `src/di/**` smoke) | **PASS** — 40 suites, 524 tests |
| `ptah-electron-e2e` | **NOT RUN** — dependencies absent from this worktree, by instruction |

### One honest caveat on the `run-many` gate

The first `run-many` invocation reported **2 failed platform-electron suites**. I re-ran the
identical command and it passed all three projects; platform-electron also passes
deterministically in isolation across five separate runs. I could not capture the failure text
before it stopped reproducing, so I am **not** claiming it diagnosed. Two contributing facts:
that first run was launched concurrently with a second nx invocation against the same project
in the same worktree (my error), and the never-disposed fake worker described under failure 2
was still present at the time and has since been fixed. Treat a recurrence under parallel load
as unexplained rather than known-flaky.

---

## `git log --oneline -6`

```
f570c329e fix(electron): answer the renderer ipc channels when the boot fails
ef5ed9b94 test(platform-electron): cover the state storage failure paths
d7397bb13 fix(agent-sdk): export the compaction boundary registry
603f79ba7 Merge remote-tracking branch 'origin/main' into fix/task-411-profile-performance
2b0adee18 docs(task-specs): keep the TASK_2026_411 b4 and b5 review records
630be28d8 Merge pull request #493 from Hive-Academy/fix/compaction-ui-consistency
```

`git status --short`: clean (this report is the only untracked addition). **Not pushed.**

## Files changed

- MODIFIED `libs/backend/agent-sdk/src/index.ts` — re-export the boundary registry
- MODIFIED `libs/backend/auth-providers/src/lib/providers/codex/codex-stream-parity.spec.ts` —
  pass a real registry instance as the 8th argument
- CREATED `libs/backend/platform-electron/src/implementations/electron-state-storage-worker-runtime.error-paths.spec.ts`
- CREATED `libs/backend/platform-electron/src/implementations/electron-state-storage-worker-host.error-paths.spec.ts`
- CREATED `libs/backend/platform-electron/src/implementations/electron-state-storage.degraded-paths.spec.ts`
- CREATED `libs/backend/platform-electron/src/implementations/electron-file-dialog.spec.ts`
- CREATED `apps/ptah-electron/src/activation/recovery-mode-ipc.ts`
- CREATED `apps/ptah-electron/src/activation/recovery-mode-ipc.spec.ts`
- MODIFIED `apps/ptah-electron/src/main.ts` — register the recovery responders on the
  bootstrap failure path

## Out-of-scope observations

- `electron-state-storage-worker-protocol.ts` is the lowest-covered file left (93.57 % lines).
  Its gaps are schema-rejection branches; reachable, but not needed for the thresholds and not
  in this batch.
- `electron-state-storage-commit-store.ts` sits at 90.29 % lines. The remaining lines are
  durable-step recovery branches already covered structurally by its own fault-injection spec.
- `e2e-final2.log` at the repo root is a stale, committed-looking artefact that does not match
  the current failure and cost me time before I identified it as such. Worth deleting.
