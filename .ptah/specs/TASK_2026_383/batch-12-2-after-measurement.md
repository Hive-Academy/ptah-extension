# Batch 12.2 — after-measurement raw data (2026-09-07)

Raw output only. The verdict belongs in `test-report.md`.

## Conditions

Identical method to the Batch 9 before-measurement, so the two are comparable.

| Item        | Value                                                             |
| ----------- | ----------------------------------------------------------------- |
| Worktree    | `D:\projects\ptah-extension\.claude-worktrees\task-383`           |
| Head commit | `1269a187c` (Batch 11) — Batches 10 and 11 both landed            |
| Build       | rebuilt after both commits                                        |
| Probe       | `measure-boot-rpcs.mjs --seconds=90 --keep-db`                    |
| Database    | the same pre-migrated version-42 copy the before-measurement used |
| Cold cache  | 32 GB scratch write + read before each run                        |
| Machine     | quiet                                                             |
| Runs        | 3 successful                                                      |

## Headline: 380 criterion 2 is now MET

Event-loop lag maxima, from the app's own `[event-loop] lag` lines. Ceiling is
500 ms.

| Run | Before (Batch 9) |        After |
| --- | ---------------: | -----------: |
| 1   |         493.6 ms | **460.3 ms** |
| 2   |         547.4 ms | **485.2 ms** |
| 3   |        1502.6 ms | **449.1 ms** |

All three after-runs sit under the ceiling. The 1502.6 ms outlier is gone, and
the spread narrowed from 1009 ms to 36 ms. This is the clearest result in the
measurement, and it is the criterion Batch 11.3 was promoted to address.

## Call counts

| Handler               | Before (A/B/C) | After (A/B/C) |
| --------------------- | -------------- | ------------- |
| `autocomplete:agents` | 1 / 1 / 1      | **0 / 0 / 0** |
| `config:models-list`  | 2 / 2 / 2      | 2 / 2 / 2     |
| `session:list`        | 2 / 2 / 2      | 2 / 2 / 2     |
| Total RPCs per run    | 26             | 25            |

`autocomplete:agents` is gone from the boot window entirely. Task 10.1 is
confirmed by measurement.

**Task 10.3 did not reduce the call count.** Its acceptance criterion in
`batches.md` reads "exactly one `session:list`", and that is **not met**. The
single-flight joins callers whose requests overlap. The two boot-window calls
do not overlap, so each still issues its own read. The remedy is correctly
implemented and does not do what the acceptance line claimed it would.

## Handler durations

Median of the first call per run. Duration is `answeredAt - sentAt`, so it is
wall time, not main-thread time.

| Handler               |  Before |   After | Change          |
| --------------------- | ------: | ------: | --------------- |
| `config:models-list`  | 1175 ms | 2039 ms | **slower**      |
| `git:info`            |  436 ms |  638 ms | **slower**      |
| `git:branches`        |  366 ms |  548 ms | **slower**      |
| `git:lastCommit`      |  284 ms |  503 ms | **slower**      |
| `git:stashList`       |  174 ms |  547 ms | **slower**      |
| `auth:getAuthStatus`  |  734 ms |  747 ms | flat            |
| `session:list`        |  212 ms |  228 ms | flat            |
| `autocomplete:agents` |  500 ms |       — | call eliminated |
| `editor:getFileTree`  |  148 ms |   59 ms | faster          |

After-run raw values, first call per run:

| Handler              |   Run A |   Run B |   Run C |
| -------------------- | ------: | ------: | ------: |
| `config:models-list` | 1560 ms | 2039 ms | 2249 ms |
| `git:info`           |  638 ms |  790 ms |  615 ms |
| `git:branches`       |  552 ms |  548 ms |  515 ms |
| `git:lastCommit`     |  477 ms |  538 ms |  503 ms |
| `git:stashList`      |  547 ms |  548 ms |  511 ms |
| `auth:getAuthStatus` |  759 ms |  148 ms |  747 ms |
| `session:list`       |  228 ms |    3 ms |  239 ms |

### Reading the git regression

Every `git:*` handler got slower in wall time while event-loop lag improved.
That is the expected signature of Task 11.3, not a contradiction of it. The
work moved off the main thread. An off-thread spawn does not finish sooner —
it stops blocking the event loop while it runs. The probe measures wall time
from request to response, so it records the added hand-off cost and none of
the benefit. The lag table above is where the benefit appears.

Whether roughly 200 ms of extra wall time per git call is a good trade for the
lag improvement is a judgement, not a measurement. It is stated here so the
trade is visible rather than buried.

### `config:models-list` is not explained

1175 ms to 2039 ms median, consistent across all three runs. Batches 11.1 and
11.2 touched this path. The off-thread argument above does not obviously apply,
because this handler was already off-thread before this task (TASK_2026_353).
**This regression has no confirmed cause.** It should not be written up as if
it does.

## Cross-boot persistence — inconclusive

Batches 11.1 and 11.2 persist the SDK model catalog and the CLI health verdict
across boots. The three runs above cannot show that benefit: each copies a
fresh database, so nothing a prior boot persisted survives into the next.

A separate two-boot test ran the probe twice against the same database, the
second boot reading whatever the first wrote:

| Handler              | Boot 1         | Boot 2        |
| -------------------- | -------------- | ------------- |
| `config:models-list` | 1866 / 1377 ms | 1461 / 513 ms |
| `auth:getAuthStatus` | 292 / 0 ms     | 792 / 0 ms    |
| `git:info`           | 648 ms         | 647 ms        |
| `session:list`       | 3 / 2 ms       | 175 / 118 ms  |

`config:models-list` improved on the second boot, most clearly on its second
call (1377 to 513 ms). But `auth:getAuthStatus` moved the wrong way (292 to
792 ms) and `session:list` moved the wrong way too. With one boot pair and
run-to-run noise already measured at this scale, **this test does not
demonstrate the cross-boot benefit.** It does not refute it either. A proper
answer needs several boot pairs, which was not run.

## Probe reliability degraded further

P-1 (the intermittent attach failure) was measured at roughly 1 attempt in 3
during Batch 9. During this measurement it was far worse:

- One run needed 11 attempts, another 12 without ever succeeding.
- One three-run loop failed every attempt across all three runs.
- 86 leftover `ptah-bootprobe-*` directories had accumulated. Removing them
  did not restore the earlier success rate.

Disk space was not the cause — 329 GB free throughout. The application was not
the cause: a direct launch of the same build booted correctly through
`SQLite connection opened + migrated successfully` every time it was tried.

The practical effect is that collecting 3 usable runs took well over 30 probe
launches. P-1 should be raised in priority in `future-enhancements.md`.

## Artifacts

- `tmp/after-runA.json`, `-runB.json`, `-runC.json` — the three after-runs
- `tmp/warm-boot1.json`, `tmp/warm-boot2.json` — the cross-boot pair
- `tmp/boot-probe-runA.json`, `-runB.json`, `-runC.json` — the Batch 9 before-runs
