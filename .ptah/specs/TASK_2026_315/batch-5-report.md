# Batch 5 report — TASK_2026_315 / C2

**Finding**: cron reports `succeeded` for skill drains that did nothing.
**Tasks**: 5.1 (fix) and 5.2 (named test deliverable) — both complete.
**Commits**: none created, per instruction.

---

## 1. How the "did nothing" signal is plumbed

The scope correction held: no new `JobRunStatus` member, no schema migration,
no wire change. `JobHandlerResult` gained the missing channel and the runner
gained the branch it never had.

### `libs/backend/cron-scheduler/src/lib/types.ts` — the channel

```ts
export interface JobHandlerResult {
  summary?: string;
  outcome?: 'succeeded' | 'skipped';
  reason?: string;
}
```

Both new fields are optional, so **absent means `'succeeded'`** and every
handler written before the channel existed keeps its meaning — the daily backup
handler (`start-thoth-cron.ts:200`, `cli-engine/.../thoth-runtime.ts:424`) is
untouched and still returns a bare `{ summary }`. The docblock records why this
is not a new enum member: `'skipped'` already exists on the run row and
`markSkipped` already writes it; only a channel for the case the **handler**
decides was missing.

### `libs/backend/cron-scheduler/src/lib/job-runner.ts` — the branch

`:170` was `this.runs.markSucceeded(runId, result.summary)` unconditionally. It
is now:

```ts
if (result.outcome === 'skipped') {
  this.runs.markSkipped(runId, result.reason ?? result.summary ?? 'handler-skipped');
} else {
  this.runs.markSucceeded(runId, result.summary);
}
```

`markSkipped` writes the reason into `job_runs.result_summary`, which is the
same column the two existing skip reasons (`concurrency-limit`, `aborted`) use
and the one the drawer renders — so the reason token reaches the user with no
new field anywhere.

The `[cron-scheduler] run succeeded` debug line is now
`[cron-scheduler] run skipped by handler` on that branch, carrying the reason.
That kills the misleading log pair in the capture directly.

**One judgement call, documented in a code comment**: `lastRunAt` **is** bumped
on the handler-skipped path, as it already is on succeeded and failed. The rule
the comment states is "`lastRunAt` records that the HANDLER executed" — the job
did fire on schedule and reached a verdict. The runner's own two skips
(concurrency cap, abort) deliberately still leave it alone, because there the
handler was never entered. Not bumping it would have left the job card showing
a stale "last run" for a job that has been firing every 15 minutes, which is a
second flavour of the same lie this batch exists to remove. Scheduling is
unaffected either way: `catchup-coordinator.ts:99` reads `lastRunAt` only as a
replay floor, and the slot is already claimed in `job_runs` under
`UNIQUE(job_id, scheduled_for)`, so a replay would hit `SlotAlreadyClaimedError`
and return quietly.

### The producer seam — **two** files, not one

`tasks.md` named `skill-drain.service.ts` as the source of the reason union.
**It needed no change**: `DrainSummary.skipped` and `DrainSummary.reason`
(`:198-225`, reason union at `:181-186`) have carried the signal since phase 1.
The gap was entirely downstream — the drain's reason could only reach the run
row as prose inside `summary`.

The `JobHandlerResult` producers are the two cron/skill-synthesis seams, and
**there are two of them**, which the batch spec did not list:

- `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts:118` (Electron)
- `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:511` (CLI / TUI)

Both were returning ``{ summary: `skipped: ${reason}` }``. Both now return
`{ outcome: 'skipped', reason: summary.reason ?? 'unknown' }`. Fixing only the
first would have left `ptah-cli` and `ptah-tui` hosts still recording
`succeeded` — the defect would have looked fixed on the surface the log came
from and survived on the other two.

The reason token is passed through **verbatim**
(`daily-token-budget-exhausted`, `on-battery`, `disabled`, `foreground-active`,
`aborted`) rather than re-worded, so the run history shows the same string the
drain logs. That is what makes the log pair in the capture cross-referenceable
instead of two unrelated sentences.

**`libs/backend/skill-synthesis/` was not opened for editing** — confirming
Batch 4's report that it touched nothing there. **No file under
`libs/backend/harness-sync/` was opened at all**; the ~28 modified files under
that lib in `git status` are the concurrent session's and are untouched by this
batch.

---

## 2. Blast radius — every consumer checked, per surface

**Result: no consumer needed a change, and each was verified by reading the
code rather than by assuming the type covered it.** The reason is that
`'skipped'` was already a legal `JobRunStatus`/`JobRunDto['status']` and every
renderer already handled it exhaustively — the status was reachable via
`concurrency-limit` and `aborted`, just never via a drain.

| Surface        | File                                                                              | What it renders now                                                                                                                                                                                                                                      |
| -------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Angular drawer | `libs/frontend/cron-scheduler-ui/.../cron-job-detail-drawer.component.ts:145-166` | An amber dot (`runStatusDotClass` → `bg-warning`, `cron-format.ts:74`), the literal word `skipped` from `{{ run.status }}` (`:160`), and `daily-token-budget-exhausted` in the summary cell (`:164`, `run.resultSummary \|\| run.errorMessage \|\| ''`). |
| Ink TUI        | `apps/ptah-tui/src/components/thoth/SchedulesPanel.tsx:43-58, :238-241`           | `runStatusColor` already has an explicit `case 'skipped'` → `theme.ui.dimmed`; the row prints `{run.status}` = `skipped`.                                                                                                                                |
| Headless CLI   | `apps/ptah-cli/src/cli/commands/cron.ts:328-353`                                  | `cron runs` emits the DTO array verbatim as a `cron.runs` notification. `status: "skipped"`, `resultSummary: "daily-token-budget-exhausted"`. Nothing to map.                                                                                            |

**The drawer does not fabricate a status** — `cron-scheduler-ui/CLAUDE.md:27,:50`
respected. The per-run status comes from `cron:runs`, the drawer is still its
only home, and nothing was added to the card. `cron-format.ts:26`'s stated data
limit (`ScheduledJobDto` has `lastRunAt` but no last-run status) is unchanged;
I did not widen `ScheduledJobDto` to carry an outcome, which would have been the
tempting-but-forbidden move here.

Two consumers beyond the three named, checked and clean:

- `CronStateService.stats` (`cron-state.service.ts`) is computed from `jobs`,
  not from `runs` — no success/failure tally to skew.
- `cron:runNow` (`cron-rpc.handlers.ts:262`, `cron-scheduler.ts:212-218`)
  returns `latestForJob` after the run, so a manually triggered drain against
  an exhausted budget now reports `skipped` in the same call. Previously it
  returned `succeeded`.

**Wire shape: unchanged.** `libs/shared/.../rpc.types.ts:3171` already declares
`status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'` and
`resultSummary: string | null`. `rpc.types.ts` was **not edited** —
`cron-rpc.handlers.ts`'s `toRunDto` (`:255-263`) passes `run.status` and
`run.resultSummary` straight through, so `cron-rpc.handlers.ts` was not edited
either. Asked explicitly by the batch: **no, the wire shape did not need to
change, and it did not.**

---

## 3. Task 5.2 — observed fail-then-pass evidence

New file: `libs/backend/cron-scheduler/src/lib/job-runner.spec.ts` (8 tests).

Verified by actually reverting the branch in `job-runner.ts` back to the
unconditional `this.runs.markSucceeded(runId, result.summary)`, running the
suite, and restoring.

**With the fix reverted** — `Tests: 2 failed, 44 passed, 46 total`:

```
● JobRunner outcomes › records a handler that deliberately did nothing as
  SKIPPED, not succeeded

  expect(jest.fn()).not.toHaveBeenCalled()
  Expected number of calls: 0
  Received number of calls: 1
  1: "01ARZ3NDEKTSV4RRFFQ69G5FAW", undefined

  > 141 |     expect(runs.markSucceeded).not.toHaveBeenCalled();

● JobRunner outcomes › falls back to the summary, then a token, when a skip
  carries no reason

  expect(jest.fn()).toHaveBeenCalledWith(...expected)
  Expected: "01ARZ3NDEKTSV4RRFFQ69G5FAW", "handler-skipped"
  Number of calls: 0
```

The `undefined` in that first received call is the defect in one line: the run
row was written as `succeeded` with a null summary, because the reverted code
reads `result.summary` on a result that only carries `outcome` and `reason`.

**With the fix restored** — `Test Suites: 5 passed, Tests: 46 passed`.

`run.store.spec.ts` and `cron-scheduler.spec.ts` **passed untouched in both
runs** (they are inside the 44 that stayed green under the revert) and neither
file was edited.

The companion tests, so the change cannot swing the other way:

1. `still records a handler that did real work as SUCCEEDED` — asserts
   `markSucceeded` with the drain's real summary and `markSkipped` never called.
2. `treats a handler that omits 'outcome' as succeeded` — the backwards
   compatibility of the optional field, driven with the daily-backup summary.
3. `still records a thrown handler as FAILED` — a genuine failure is not
   swallowed as "did nothing".
4. `marks the concurrency cap as skipped without entering the handler` —
   `job-runner.ts:150` unchanged; also pins that the capped slot does not bump
   `lastRunAt`.
5. `marks an aborted run as skipped with reason 'aborted'` —
   `job-runner.ts:181` unchanged.
6. `returns quietly when another runner already claimed the slot`.

The three outcomes are therefore distinct and each is pinned: real work →
`succeeded`, budget-exhausted → `skipped` with the reason preserved, genuine
failure → `failed`.

One existing test was updated, not deleted:
`thoth-runtime/src/lib/start-thoth-cron.spec.ts:394` asserted
`resolves.toEqual({ summary: 'skipped: on-battery' })` — the prose form that was
the defect. It now asserts `{ outcome: 'skipped', reason: 'on-battery' }` and
its title says OUTCOME rather than "summary". The `cli-engine` spec asserts the
non-skipped path only and needed no edit.

---

## 4. Files changed

```
M libs/backend/cron-scheduler/src/lib/types.ts              # the channel
M libs/backend/cron-scheduler/src/lib/job-runner.ts         # the branch
M libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts    # Electron seam
M libs/backend/thoth-runtime/src/lib/start-thoth-cron.spec.ts
M libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts # CLI/TUI seam
A libs/backend/cron-scheduler/src/lib/job-runner.spec.ts    # Task 5.2
```

Not edited, deliberately: `run.store.ts` (`markSkipped` already correct),
`skill-drain.service.ts` (`DrainSummary` already carried the signal),
`cron-rpc.handlers.ts` and `libs/shared/.../rpc.types.ts` (wire already
sufficient), all three consuming surfaces.

---

## 5. Commands and results

| Command                                                                                                                             | Result                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npx nx test cron-scheduler --skip-nx-cache`                                                                                        | **PASS** — 5 suites, 46 tests                                                                                                                                                              |
| `npx nx test cron-scheduler -- --testPathPattern=job-runner` _(fix reverted)_                                                       | **FAIL as required** — 2 failed / 44 passed; message quoted in §3                                                                                                                          |
| `npx nx run-many -t test -p cron-scheduler skill-synthesis rpc-handlers cron-scheduler-ui thoth-runtime cli-engine --skip-nx-cache` | **PASS** — 6 projects. `skill-synthesis`/`rpc-handlers`/`cron-scheduler-ui`/`cli-engine` group: 15 suites / 145 tests; `thoth-runtime`: 3 suites / 37 tests; `cron-scheduler`: 46 tests    |
| `npx nx run-many -t typecheck -p ptah-tui ptah-cli cron-scheduler thoth-runtime cli-engine cron-scheduler-ui --skip-nx-cache`       | **PASS** — 6 projects clean                                                                                                                                                                |
| `npx nx run-many -t lint -p cron-scheduler thoth-runtime cli-engine cron-scheduler-ui --skip-nx-cache`                              | **PASS** — 0 errors. 2 pre-existing warnings in `cli-engine` (`cli-adapters.ts:249` empty `dispose`, `thoth-runtime.spec.ts:14` unused `ThothRefs`), both in code this batch did not touch |

Note: `npx nx test a b c` treats the trailing names as Jest args and silently
runs only the first project ("No tests found, exiting with code 0"). The
`run-many -t test -p …` form above is the one that actually ran all six.

---

## 6. Constraints observed

- Windows absolute paths on every Read/Write.
- No `libs/backend/harness-sync/` file opened.
- Hexagonal rule intact: `cron-scheduler` still depends only on
  `platform-core` ports (`PLATFORM_TOKENS.MCP_SERVER_STATUS`, optional) and
  `persistence-sqlite`; no adapter import added anywhere.
- `skill-synthesis` still never imports `cron-scheduler` — the two seams remain
  the only place they meet.
- `catch (error: unknown)` + `instanceof Error` narrowing unchanged; no new
  catch introduced.
- No stubs, no `// TODO`, no placeholder return.
- No git commit created.
- Out-of-scope list re-read: `resolveRoot`, `skillSynthesis:listCandidates`,
  `cron:list`, `gateway:*` and harness-sync's refusal rule are all untouched.
