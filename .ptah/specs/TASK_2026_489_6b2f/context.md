# Context — TASK_2026_489

## What was asked

`@ptah-extension/platform-electron`'s real-process watch-host stress suite
(`workspace-watch-host.stress.spec.ts`) fails intermittently on clean
`origin/main`, with a different failure count between two measured baseline
runs on 2026-09-20:

- Clean detached worktree at `origin/main`: 2 failed suites, 4 failed tests,
  614 passed / 625.
- A feature branch untouched by the watch host: 1 failed suite, 3 failed
  tests, 615 passed. Nx separately flagged `platform-cli`'s
  `cli-workspace-watcher` spec as flaky in the same run.

Named failing tests:

- ST-2 — mass delete storm (`workspace-watch-host.stress.spec.ts:91`)
- AC-7 — single real kill, bare (`workspace-watch-host.stress.spec.ts:124`)
- AC-7 — repeated kills past the restart budget
  (`workspace-watch-host.stress.spec.ts:140`)

Job: determine whether this is (a) a load-sensitive timing assumption, (b) a
genuine product defect the tests correctly catch, or (c) a harness defect
(leaked processes/watchers or cross-test contamination), with evidence from
several repeated runs — not a single green run — then fix (a)/(c)
deterministically or, if (b), stop and write up the defect without touching
product code.

## What I found

Both AC-7 tests failed reproducibly under real machine contention (this
worktree ran alongside several other agents' test suites all session,
including a concurrent full `ptah-cli` run and, at peak, 130+ `node.exe`
processes on the box), and both failures trace to the TEST HARNESS, not the
product:

1. `runDegradedPastBudgetScenario` (`workspace-watch-host.stress.harness.ts`,
   was line 760) calls the raw Node `process.kill(pid, 'SIGKILL')` on a host
   pid read one `await` earlier, in a 3-iteration kill loop. Under
   contention, a freshly forked host can crash or exit on its own (or the
   supervisor can already have entered degraded mode without forking a
   replacement — `workspace-watch-supervisor.ts:548` `enterDegraded` never
   calls `startHost`) before the loop's next kill runs. `process.kill` on an
   already-exited pid throws `ESRCH`, which is not caught anywhere in the
   loop, so the scenario throws instead of proceeding. This reproduced twice
   in my own two batch runs (see test-report.md), always at the same
   file:line, always the identical `kill ESRCH` message.

2. `runSingleKillScenario`'s final wait — "delivery to resume on the
   surviving subscription after the restart" — used `waitFor`'s 15 000 ms
   default. `waitFor` already polls an observable condition
   (`recorderA.hasPath(resumedA)`) rather than sleeping a fixed amount, so
   this is not a race in the classic sense, but under heavy CPU/IO
   contention the real restart + IPC + coalescer round trip can simply take
   longer than 15 s to complete, and the poll then times out on a correct
   but slow system rather than a broken one.

No evidence of a genuine watch-host defect turned up: every failure's stack
trace bottoms out in the harness's own kill loop or its own `waitFor`
timeout, never in an assertion about the batches/overflow/degradation the
watcher actually delivered — those values, when the scenario got far enough
to report them, were correct (`ST-2` was green in every run; `AC-7`'s
assertions never failed — only the harness's setup step before them did).

Fixed both in the harness (never touched product code): an idempotent
`killIfAlive` helper that swallows `ESRCH`, and a widened, still-polling
(never fixed-sleep) timeout on the single-kill resume wait. Post-fix, the
`ESRCH` crash is gone in every run I collected (3), but under two runs that
also broke several unrelated real-process specs in the same project
(5-7 of 36 suites failing at once — clear evidence of extreme, unrelated
machine contention, not something this task should chase by inflating
budgets further), the degraded scenario's separate "recovery" wait timed
out. That wait already carries a 15 000 ms load margin; I left it alone
rather than pad it further on the strength of two runs that were failing
everywhere else too.

See `test-report.md` for the full per-test pass/fail pattern (9 pre-fix
runs, 3 post-fix runs), what changed and why, and what is and is not proven.
