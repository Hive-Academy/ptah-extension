# Batch 9 — raw cold measurement data (2026-09-07)

Raw output only. The analysis and the verdict belong in `test-report.md`.

> **This file was rewritten mid-session.** The first version recorded two runs
> against an UNMIGRATED database copy. Those runs were invalid as a
> steady-state measurement — see "Discarded runs" at the end. The runs in the
> main tables below are the authoritative ones.

## Conditions

| Item              | Value                                                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worktree          | `D:\projects\ptah-extension\.claude-worktrees\task-383`                                                                                                                      |
| Head commit       | `96f20674d` (Batch 12.3)                                                                                                                                                     |
| Base branch       | `electron-cold-start-380` (PR #463, not merged)                                                                                                                              |
| Build             | `nx build-dev ptah-electron` + `nx copy-renderer-dev ptah-electron`                                                                                                          |
| Probe             | `apps/ptah-electron-e2e/scripts/measure-boot-rpcs.mjs --seconds=90`                                                                                                          |
| Database          | copy of the real `~/.ptah/state/ptah.sqlite`, 1058 MB + 5.4 MB WAL, **pre-migrated to schema version 42**                                                                    |
| Machine           | quiet. Only the orchestrator session ran. Ptah stayed open — the probe uses its own `--user-data-dir`, so it does not collide.                                               |
| Cold-cache method | 32 GB scratch write + read + delete, before each measured run. 27.86 GB total RAM. `RAMMap -Es` needs interactive elevation this shell cannot grant, same constraint as 380. |

**Why the copy was pre-migrated.** The real database on this machine is at
schema version 41. Every fresh copy therefore applies migration 42 on first
open, and migration 42 triggers a full pre-migration backup of the 1 GB file.
That is a one-time cost, not the steady state 380's baseline describes. The
copy was migrated once with a direct launch, verified at
`max(version) = 42`, and every measured run below starts from that migrated
copy.

## Boot markers — steady state

| Marker                               |      Run A |      Run B |      Run C |
| ------------------------------------ | ---------: | ---------: | ---------: |
| window (`Startup config registered`) |    7356 ms |    5190 ms |    7015 ms |
| `openAndMigrate()` started           |    7486 ms |    5324 ms |    7157 ms |
| SQLite open + migrated               |    7517 ms |    5347 ms |    7184 ms |
| **Readiness window**                 | **161 ms** | **157 ms** | **169 ms** |

Four further runs measured the readiness window at 134, 148, 169 and 258 ms.
The steady-state window is consistently **in the 130 to 260 ms range**.

**No RPC arrives before SQLite is open** in any steady-state run. The probe
prints `NO RPC arrived before SQLite was open. A readiness guard would never
fire on this path.` This reproduces all three of 380's runs. No readiness
guard ships.

## Handler durations — steady state

Duration is `answeredAt - sentAt`. A cell with two values is a handler called
twice in that run. Every call answered in every run. Zero failures, zero
unanswered calls, 26 RPCs per run.

| Handler               | 380 baseline |         Run A |         Run B |         Run C |  Median |
| --------------------- | -----------: | ------------: | ------------: | ------------: | ------: |
| `config:models-list`  |      2296 ms | 1368 / 905 ms | 1175 / 292 ms | 1157 / 167 ms | 1175 ms |
| `auth:getAuthStatus`  |      2244 ms |        283 ms |        753 ms |        734 ms |  734 ms |
| `session:list`        |      2291 ms |      3 / 2 ms |  234 / 198 ms |  212 / 179 ms |  212 ms |
| `git:info`            |      2476 ms |        364 ms |        436 ms |        710 ms |  436 ms |
| `autocomplete:agents` |      4095 ms |         13 ms |        500 ms |        709 ms |  500 ms |
| `git:branches`        |            — |        348 ms |        366 ms |        404 ms |  366 ms |
| `git:lastCommit`      |            — |        284 ms |        546 ms |        162 ms |  284 ms |
| `git:stashList`       |            — |        329 ms |        148 ms |        174 ms |  174 ms |
| `editor:getFileTree`  |            — |         38 ms |        148 ms |        305 ms |  148 ms |

**Run-to-run variance is large.** `autocomplete:agents` spans 13 to 709 ms and
`session:list` spans 2 to 234 ms across three runs of the same build against
the same database. Any conclusion drawn from a single run is unsafe. Run A is
the low outlier on both.

## Event-loop lag (380 criterion 2)

The probe does not record lag. These figures come from the app's own
`[event-loop] lag` lines in the retained `userData/logs/*.log`, available
because `--keep-db` retains the userData directory. The monitor arms at
`warnThresholdMs: 250, sampleIntervalMs: 2000, resolutionMs: 20`, so it
reports only samples above 250 ms.

| Lag run |   Max lag |             Spikes above 500 ms | Slow-handler log lines |
| ------- | --------: | ------------------------------: | ---------------------: |
| 1       |  493.6 ms |                               0 |                      0 |
| 2       |  547.4 ms |                               1 |                      0 |
| 3       | 1502.6 ms | 4 (1502.6, 1424, 1017.1, 833.1) |                      0 |

380's criterion 2 sets a 500 ms ceiling. 380 itself measured 1073.7 ms.
**The ceiling is exceeded in 2 of 3 runs, and the worst run is worse than
380's own figure.** Criterion 2 is not met.

Lag run 3 followed two failed probe launches, so residual load may have
inflated it. Lag runs 1 and 2 had no such preceding load and still straddle
the ceiling.

## Item A-2 — `PRAGMA optimize` in isolation

Measured with `better-sqlite3` under `ELECTRON_RUN_AS_NODE=1`, against a
separate copy of the same 1058 MB database. Plain `node` cannot load the
module — it is rebuilt for the Electron ABI.

| Measurement                                   | Result |
| --------------------------------------------- | -----: |
| `journal_mode = WAL`                          |   2 ms |
| `PRAGMA optimize`, fresh connection           |   0 ms |
| `PRAGMA optimize`, repeated                   |   0 ms |
| Touch all 57 user tables (`select * limit 5`) |  36 ms |
| `PRAGMA optimize`, after that load            |   0 ms |
| `analysis_limit=400` then `optimize`          |   0 ms |

The fresh-connection figure alone proves nothing: `PRAGMA optimize` only
analyzes tables the connection already queried. The measurement after the
table load is the one that counts, and it is also 0 ms.

A prior session measured 100 ms cold and 27 ms warm on this database. Both
sets agree on the decision: **`PRAGMA optimize` is not a boot cost.** A-2
needs no follow-up.

## The dominant remaining cost is the pre-migration backup

The discarded runs measured `openAndMigrate()` at 11045 and 12474 ms against
an unmigrated copy. The steady-state runs measure the same call at 31 to
169 ms. The whole difference is the **pre-migration backup**, which copies and
validates the 1 GB database (`migration-runner.ts:87-101`, confirmed by the
research report). It is not migrations, not sqlite-vec load, and not `PRAGMA`
work.

This cost is real and user-facing: every user whose database carries a pending
migration pays it once, on the first boot after an app update. A prior session
measured the same event at 75073 ms on a contended machine. **No batch in
`batches.md` targets it.**

## Probe defects found

1. **Intermittent attach failure.** `electronApplication.evaluate: Execution
context was destroyed` aborts the run before the probe installs. Measured
   rate across this session: roughly 1 attempt in 3, and 4 consecutive
   failures occurred once. A direct launch of the same build, database and
   environment boots correctly through
   `SQLite connection opened + migrated successfully`, so the application is
   not at fault. Two prior sessions hit the same failure. It is not tied to
   boot speed — steady-state boots succeeded 2 of 3 in a controlled check.
2. **The failure path prints no diagnosis.** It instructs the reader to "read
   the stdout above", but it collects stdout into an array and never prints
   that array on this path (`measure-boot-rpcs.mjs:222-244`). The reader gets
   one Playwright error and nothing else.
3. **The report prints arrival times, not durations.** Every duration in this
   file was computed from `tmp/boot-probe.json` by hand. The probe's own
   report cannot answer the question Batch 9 exists to ask.

All three are candidates for `future-enhancements.md`.

## Discarded runs

Two runs were taken against an unmigrated copy before the schema version was
checked. They are recorded here so the numbers are not mistaken for evidence
later:

| Marker / handler      | Discarded run 1 | Discarded run 2 |
| --------------------- | --------------: | --------------: |
| Readiness window      |        12474 ms |        11045 ms |
| `config:models-list`  |  1454 / 1014 ms |  1626 / 1358 ms |
| `git:info`            |          618 ms |          475 ms |
| `session:list`        |      18 / 11 ms |       11 / 5 ms |
| `autocomplete:agents` |            7 ms |            5 ms |
| `auth:getAuthStatus`  |            1 ms |            0 ms |

They are invalid for two reasons. They paid the one-time migration, so their
readiness window measures the pre-migration backup rather than the steady
state. They also ran on a warm OS file cache, with no eviction pass.

## Artifacts

- `tmp/boot-probe-runA.json`, `-runB.json`, `-runC.json` in the worktree hold
  the three authoritative traces.
- Migrated source copy: `%TEMP%\ptah-383-measure\migrated.sqlite`.
- The real `~/.ptah/state/ptah.sqlite` was never opened. It was copied with
  `Copy-Item`, and only copies were ever passed to anything that opens a
  database.
