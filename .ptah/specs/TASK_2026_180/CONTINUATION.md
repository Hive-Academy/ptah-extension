# TASK_2026_180 — continuation handoff

**Written 2026-08-13, updated 2026-08-15.** Everything below was verified by
re-running it, not taken from an agent's report. Read this, then `tasks.md`
**§2 Batch index**, **§3 Global invariants** and **§6 Orchestrator hand-off
notes** — §6 has grown a lot and several notes are addressed to specific
unstarted batches.

---

## 1. Where

- **Worktree: `D:/projects/ptah-extension` — the MAIN one. Branch `ak/tui-defects`.**
  Phase 3 was built here, not in the task180 worktree. Work continues here.
- **Superseded**: `.claude-worktrees/task180` on `ak/task-180-skill-synthesis`
  carried phases 0–2 and was merged at `c699bca9f`. It still exists and is now
  BEHIND. Do not resume work in it, and do not merge it again.
- **Use complete absolute Windows paths** for every Read/Write/Edit — known Claude Code bug with relative paths here.
- `D:/projects/ptah-extension` is a **different worktree** on unrelated TUI work. Do not touch it. It also holds `TASK_2026_236`, which this worktree does not — **scan both when allocating a task id**, or you will burn one. **ID ALLOCATION IS BROKEN ACROSS WORKTREES — do not trust a folder scan.** Ids `237`–`241` were allocated on this branch AND independently in `D:/projects/ptah-extension` during the same session, for different tasks. This branch renumbered ITS carriers TWICE (237/238 → 240/241, then 239/240/241 → 242/243/244) because the other worktree's were real work. **The folder-scan rule in the root CLAUDE.md cannot work when two worktrees allocate concurrently** — any scan is stale the moment the other side commits. Until that is fixed: re-check BOTH worktrees immediately before committing a carrier, and expect to renumber anyway. **Confirmed again on 2026-08-15, live**: `TASK_2026_246` appeared in the main worktree at 19:11 while B3.5 was mid-flight, created by a concurrently running Ptah session. A scan taken minutes earlier had topped out at `244`. `245` and `247` are this task's; `246` is the other session's. **Next free across both is `248`** — and re-scan anyway, because that number can go stale while you are reading this sentence.

## 2. Status: 40 of 40 — ALL BATCHES LANDED, REVIEWED, AND THE REVIEW FIXES SHIPPED.

**Updated 2026-08-16.** Every phase is closed. The count moved 37 → 40: two of
the user's four design rulings became real batches (B4.6, B4.7), a cross-batch
defect found during verification became a third (B4.8), and the three
post-completion reviews produced a fourth (B4.9).

```
9aa14d3bf  B4.9  R5 guard reads lanes; re-open + re-point made atomic
868da42d1  B4.8  digest rewrite lane is opt-in, never automatic
a73facb7f  B5.2  tray e2e — quit parity, keep-alive, packaged icon   (closes C5)
b4864bcea  B4.5  digest panel + nudges on the existing event push
8c8e33ab8  B4.7  curator authoring lane + workspace-scoped win rate
3251f41d1  B4.6  weekly drain tier gets its own item cap
7c3c9bf7f  TASK_2026_247  permission abort scope + distinguishability
a0eef370f  B4.1  migration 0037 + workspaceRoot + getWinRates()
9c167fb14  docs  handoff re-baselined
a5df85a49  B4.2  SkillGapCuratorService, the four sweeps
dd54e65b7  B4.3  win rate → scorecard, enhancer, dormancy (nulls last)
f4ba19b63  B5.1  Electron tray keep-alive
5043c8ab5  B4.4  skillSynthesis:digest + AgentScorecard.winRate
```

**B4.8 exists because two batches were each individually correct and wrong
together, and only the orchestrator could see it.** B4.7 put an LLM call in
`runDigest` on the strength of a batch-text claim that the drain's budget gate
covered it — it does not, because `digest` has no registered handler and no
producer, so `runDigest`'s only caller is the foreground RPC. Independently,
B4.5 wired the UI to call that RPC automatically on four background event kinds
and again on tab init. Neither agent could see the other half. **When batches are
run in parallel, the interaction between them is nobody's ownership but yours.**

**One live gap, deliberately left open:** nothing passes `allowRewrite: true`,
because no explicit-refresh affordance exists on the digest panel. The authoring
lane B4.7 built is therefore **dormant in production** — correct by default
rather than by accident. Wiring a control is a product decision and its own
batch. Do not "finish the wiring" without deciding whether the digest should
have a user-triggered refresh at all.

### A hazard this session hit that the previous one did not

**A SECOND PTAH SESSION WAS COMMITTING INTO THIS WORKTREE, LIVE.** It landed
`d8ff2bf75` on top of HEAD mid-verification, later `d9f0cf290` and three docs
commits, and it created `TASK_2026_252` and `TASK_2026_254` while this session
created `253`. Two consequences worth carrying:

- **Its unfinished work blocked commits.** The pre-commit hook runs
  `nx affected --target=lint` across ~70 projects, not just staged files, so two
  `no-useless-escape` errors in ITS in-flight `vscode-lm-tools` edit rejected a
  commit of files it had never touched. It cleared on its own minutes later.
  **Re-run the lint on the offending project before concluding you are blocked**
  — the window can close while you are drafting the question.
- **Never leave files staged while another session is active.** `git commit`
  commits the whole INDEX, so anything staged is swept into whatever commit that
  session makes next. Unstage (`git reset`, which leaves the working tree alone)
  if you have to pause.

**Every one of those was verified by the orchestrator independently** — full
suites re-run with the box idle, every mutation test re-run by hand, diffs read.
Two agent claims did not survive contact and are corrected below (§3, §7).

**B4.5 and B5.2 are file-disjoint** (`libs/frontend/skill-synthesis-ui` vs
`apps/ptah-electron-e2e`) and can run concurrently.

**One item is owned by no batch and should be decided before C4 is called done:**
`DRAIN_TIER_LIMITS.weekly` still has the starvation defect B0.10 fixed for
nightly — one tick a week, single round, cap 4. It was harmless while weekly had
no producers; phase 3 gave it `judge-panel` and `trigger-eval` producers, so it
now has real supply against a cap nobody revisited. `tasks.md` §6 flags this and
warns that three existing specs (`failures`, `idempotency`, `budget`) drain
`tier: 'weekly'` while setting `maxItemsPerRun`, so changing which key weekly
reads breaks them. It is a real batch, not a number bump.

### Superseded status (kept for the batch-count arithmetic)

**30 of 37 batches done** (34 planned + 3 added mid-flight: B0.8, B0.9, B0.10).
**Phases 0, 1, 2 and 3 are all closed and fully gated.** Phase 3 was built
directly on `ak/tui-defects` (NOT in the `task180` worktree — see §1), so there
is nothing left to merge.

**B4.1 landed 2026-08-15 at `a0eef370f`** — migration `0037`, the `workspaceRoot`
thread-through (correction C10) and `getWinRates()`. Verified independently by
the orchestrator, not taken from the agent's report: both full suites re-run with
the box idle, both mutation tests re-run by hand, `typecheck:all` clean across 90
projects, and `rpc-handlers` re-run because it imports `skill-synthesis`.

**`TASK_2026_247` was fixed first, at `7c3c9bf7f`** — the config-change permission
kill that cost two agents ~2.5 hours during B3.5. Two of its three fixes shipped;
see that task's `context.md` for what is still open and why. **It is worth reading
before you launch agents**, because the failure mode it describes (an agent
returning early with "no files written") is no longer the most likely explanation
for a stopped agent, and you should not spend time re-diagnosing it.

**B4.2 and B4.3 both depend on B4.1 ONLY, not on each other.** They are the first
genuinely parallelizable pair in phase 4 — B4.2 owns `digest/`, B4.3 owns
`skill-scorecard` / `skill-enhancer` / `skill-promotion`. Both read `getWinRates()`
and neither writes it. Give each explicit file ownership and they can run
concurrently, the way 3-4 agents ran all through phases 0-3.

**Phase 3 shipped one gate with no producer, deliberately.** `replay` has a
registered stage handler and nothing enqueues a row for it, because its request
needs a graded candidate row and the cluster path ends at a SUGGESTION. Making
a cluster draft a candidate is a product decision — it re-enters clustering,
dedup and auto-promotion — and it is filed as **`TASK_2026_245`**. Do not
"finish the wiring" without reading that first.

**The six-commit collapse was abandoned, deliberately — see `tasks.md` §6.** It
is not achievable by `git reset --soft`: 27 files are edited by both C0 and C1,
so path-staging puts one phase's work inside another's commit. The working
commits were merged as-is, which means the tested artifact and the merged
artifact are the same object. Do not try to reconstruct the six commits.

| Commit               | State                                     |
| -------------------- | ----------------------------------------- |
| **C0 — Phase 0**     | ✅ **Complete.** B0.1–B0.9                |
| **C1 — Phase 1**     | ✅ **Complete.** B1.1–B1.11               |
| **C2 — Phase 2**     | ✅ **Complete.** B2.1–B2.4                |
| **C3 — Phase 3**     | ✅ **Complete.** B3.1–B3.5                |
| **C4 — Phase 4**     | In progress. B4.1 ✅; B4.2–B4.5 remaining |
| **C5 — Tier B tray** | Not started (B5.1, B5.2)                  |

### Commits so far (working commits, deliberately interleaved by phase)

```
c699bca9f  C2  corpus measurement harness
84c4e24ea  C0  B0.10 (nightly tier cap)
475540653  docs
34e5aac04  C2  B2.4  (closes C2)
5a0862bfc  docs
53803a750  C1  B1.11  (closes C1)
ddeaf14fb  C2  B2.3
7a13483e0  docs
9e42f9c81  fix(ui): show a pinned provider as pinned in the model picker
9a6e95720  C1  B1.7 + B1.10
6eb4df566  C0  B0.8
aa0541c0d  C1  B1.8
21517c1cf  C0  B0.6 + B0.7 + B0.9
1bd2a0e74  C1  B1.5 + B1.6
c9b2fe4e5  C0  B0.5
79f28c1e8  C2  B2.2
ca04e3446  C1  B1.4
bb97255a5  C2  B2.1
964c668c6  C1  B1.3
3e8f6ef19  C0  B0.4
4fa288f6a  C0  B0.1 + B0.2 + B0.3
d4c0153e9  docs
```

**Working commits interleave phases ON PURPOSE** — that is what let 3–4 agents
run concurrently in one worktree. No single commit mixes two phases, and that
discipline was worth keeping for reviewability.

**But the collapse it was meant to enable DOES NOT WORK, and was abandoned.**
27 files are edited by both C0 and C1 (10 by C0∩C2, 11 by C1∩C2), so
`git reset --soft` plus path-staging necessarily puts one phase's work inside
another phase's commit — the straddling unit is the **file**, not the commit.
Full analysis in `tasks.md` §6. The working commits were merged as-is on the
user's decision. **Do not attempt to reconstruct six commits.**

Still stage by path when you commit, for review clarity: `libs/backend/skill-synthesis/**`
has been C0, C1 and C2 depending on batch; `platform-core` + `rpc-handlers` +
`libs/shared` were C0 for B0.5/B0.10 and C1 for B1.8. **Check which batch owns a
file before staging.**

## 3. Verified baselines

Re-measure before you claim a regression; these were all run with no agents writing.

**CURRENT — full gate run by the orchestrator at `9aa14d3bf` (B4.9), everything
idle, no agent writing. These supersede everything below. Use these:**

```
skill-synthesis     61 of 67  |  1230 passed, 37 skipped, 1267 total
rpc-handlers        78 suites |  2110 passed, 31 skipped, 2141 total
skill-synthesis-ui  23 suites |   328 passed,  0 skipped,  328 total
platform-core       29 suites |   502 passed,  4 todo,     506 total
persistence-sqlite  17 of 25  |   173 passed, 65 skipped,  238 total
ptah-electron-e2e             |   135 passed, 13 skipped
npm run typecheck:all                                  → 91 projects clean
```

**`ptah-electron-e2e` was run through the REAL `nx e2e` chain, not a workaround**
— 21.9 minutes, exit 0, `+5 passed` over the `130 passed / 13 skipped` baseline,
which is exactly B5.2's five specs. It matters that this one was measured in
full: B5.2's own agent could only verify its specs standalone and correctly
refused to claim the suite. **A note on how it nearly went unmeasured twice:**
both that agent and the orchestrator piped the run through a buffering filter
(`tail`, `Select-Object -Last N`), which writes nothing until the process exits,
so an in-progress run is indistinguishable from a dead one. The agent killed a
healthy run on that evidence and orphaned four Electron processes. **Run it
unbuffered.**

**THE RECORDED `platform-core` BASELINE WAS STALE BY 31 TESTS AND THIS COST AN
AGENT TIME.** The `466 passed` figure below dates from `c699bca9f`; HEAD was
already `497` before B4.6 added five. B4.6 proved it by stashing only its own two
files and re-running. Nothing was dark — the number was simply old. **Re-measure
every baseline at HEAD before handing one to an agent**, including the ones in
this document, and including the ones you measured yourself two batches ago.

Superseded, kept only to attribute a delta — measured after B4.4 + B5.1 at
`5043c8ab5`:

```
skill-synthesis     60 of 66  |  1190 passed, 37 skipped, 1227 total
rpc-handlers        78 suites |  2106 passed, 31 skipped, 2137 total
agent-sdk           68 suites |   903 passed,  0 skipped,  903 total
shared              32 suites |   762 passed,  0 skipped,  762 total
ptah-electron       18 of 19  |   236 passed,  4 skipped,  242 total  ← 2 FAILED
```

**`ptah-electron`'s 2 failures are REAL, PRE-EXISTING and now filed as
`TASK_2026_251`.** Both are in `di/container.smoke.spec.ts`, both throw
`registerChatServices(): registerOutputStyleServices() must run first` from
`rpc-handlers/src/lib/chat/di.ts:90`. They are the R1/R2 token-aliasing guards,
so two risk guards are currently asserting nothing. Reproduced identically
before B5.1, after B5.1, and after B4.4. **Do not treat a red `ptah-electron` as
normal beyond exactly these two** — 236 passed / 4 skipped is the rest.

Project count moved 90 → 91 between runs. Not from this task; nothing here adds
a project.

Pre-B4.2/B4.3/B4.4 numbers, for attributing a delta:
`skill-synthesis 59 of 65 | 1137 passed, 37 skipped, 1174 total`;
`rpc-handlers 77 suites | 2095 passed, 31 skipped, 2126 total`.

**The load-bearing skip counts are UNCHANGED: 37 / 31 / 65.** B4.1 added +1 suite
and +14 tests to `skill-synthesis`, +1 suite and +12 tests to `persistence-sqlite`,
and moved `rpc-handlers` not at all. A rise in a skip count still means a suite
went dark — see §7.

**`agent-sdk` is now a usable gate — 68 suites, 903 passed, ZERO failures.** It
was 898 before `TASK_2026_247` added 5. See §7 item 10, which is now stale.

Pre-B4.1 numbers, for reference when attributing a delta:
`skill-synthesis 58 of 64 | 1123 passed, 37 skipped, 1160 total`;
`persistence-sqlite 16 of 24 | 161 passed, 65 skipped, 226 total`.
Measured at `368ebee36` and re-confirmed byte-identical at `9ca0b16af` — the one
time this session the recorded baseline had NOT gone stale. Re-measure anyway.

`skill-synthesis-ui` (22 suites, 284 passed) and `shared` (32 suites, 762 passed)
were last measured at `368ebee36` and B4.1 touched neither.

**The `c699bca9f` numbers below went stale mid-phase and cost an agent time
re-deriving why.** Three Phase-3 commits (`0c2542b76`, `1d745501c`, `61a382fa8`)
landed between that measurement and B3.5, adding +6 suites and +231 tests to
`skill-synthesis` before B3.5 wrote a line. **Re-measure at HEAD before handing
a baseline to an agent**, or it will spend a run proving your number wrong.

**Superseded — full pre-merge gate at `c699bca9f`.** The first time the whole
branch was gated rather than each batch:

```
skill-synthesis     52 of 58   |  892 passed, 37 skipped, 929 total   ← see note
rpc-handlers        75 suites  |  2013 passed, 31 skipped, 2044 total
platform-core       29 suites  |  466 passed, 4 todo, 470 total
persistence-sqlite  15 of 23   |  148 passed, 65 skipped, 213 total
shared / ui / skill-synthesis-ui / auth-providers / memory-curator-ui /
cli-engine / cron-scheduler / thoth-runtime            → all green
agent-sdk           1 FAILED   → pre-existing env, see §7 item 10
npm run typecheck:all                                  → 90 projects clean
nx e2e ptah-electron-e2e   130 passed, 13 skipped      → through the REAL
                            build chain, incl. B1.11's lane-picker assertion
```

**The `37 skipped` is NOT a dark suite — verify before you panic.** Moving
`prefilter-corpus-measurement.spec.ts` out of the tree gives exactly `36
skipped, 892 passed, 928 total`. That file is an **opt-in measurement harness**,
`describe.skip` unless `PTAH_PREFILTER_CORPUS=1`, because it reads
`~/.claude/projects/**` and is meaningless on a runner. **The real skill-synthesis
skip count is still 36.**

**`agent-sdk`'s single failure is your shell, not the code.** `sdk-query-runner.service.spec.ts:368`
asserts `toBeUndefined()`; this machine exports `ANTHROPIC_AUTH_TOKEN`,
`ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` as **empty strings**. Verified by
reading the env directly. Worth a one-line fix — an empty string is not a
credential — because it makes every full sweep red exactly when you want
signal.

**`platform-core` can fail under `nx run-many` and pass in isolation** — temp-dir
contention in the settings-manager benchmark spec. Re-run alone before believing it.

**`webview-e2e-harness` is NOT a clean gate**: `nx e2e` there reports
`37 passed, 32 failed`, and all 32 are pre-existing `chat/*` /
`sessions/session-create` scenarios failing on real network fetches to
`fonts.gstatic.com`. Grep your own scenario out rather than reading the exit
code. Note the target is `e2e` — that project has **no `test` target**.

Older baselines at `9e42f9c81`, still current for the untouched libs:

```
ui                  17 suites  |  315 passed, 0 failed, 0 skipped
skill-synthesis     48 of 53   |  819 passed, 36 skipped, 855 total  (superseded)
skill-synthesis-ui  22 suites  |  274 passed, 0 failed, 0 skipped
memory-curator-ui   16 suites  |  167 passed, 0 failed, 0 skipped
rpc-handlers        75 suites  |  2013 passed, 31 skipped, 2044 total
persistence-sqlite  15 of 23   |  148 passed, 65 skipped, 213 total
platform-core       29 suites  |  462 passed, 4 todo, 466 total
shared              31 suites  |  704 passed, 0 failed, 0 skipped
thoth-runtime        3 suites  |  36 passed
cli-engine          12 suites  |  130 passed
npm run typecheck:all → 90 projects clean
```

**Skip counts are load-bearing: 36 (skill-synthesis), 31 (rpc-handlers), 65
(persistence-sqlite).** A rise means a suite went dark, not that a test was
removed. See §7.

## 4. Next batches, in order

### B4.1 — migration `0037` + the workspace-root thread-through (correction C10) ✅ DONE

**Landed `a0eef370f`.** Kept here because the notes below are addressed to the
rest of phase 4. **Next up: B4.2 and B4.3 in parallel** (both depend on B4.1 only
— see §2), then B4.4 → B4.5, then B5.x.

**DONE 2026-08-15 at `a0eef370f`.** Migration `0037` (nullable `workspace_root`

- `idx_skill_inv_events_session`), the recorder forwarding `workspaceRoot`, the
  17-column store INSERT, and `getWinRates()` with the `null`-never-`0` rule. Both
  regression specs mutation-tested twice — by the implementer and again by the
  orchestrator: returning `0` for the empty denominator fails 3 of 10, dropping the
  forwarded `workspaceRoot` fails 4 of 14.

**The prediction that `0037` would not have to touch a ratchet was WRONG — three
specs still needed bumping.** `0028` and `0030` are plain `toBe(36)` → `toBe(37)`
bumps; `0036`'s own spec still carried a `Math.max(...) === 36` tail assertion,
now moved to the shape `0035` uses. **Assume the next migration bumps three or
four ratchets and budget for it**: run the FULL `persistence-sqlite` suite to find
them, because the wording differs per spec and grep misses some. That suite also
has 8 entirely dark suites (65 tests asserting nothing) — see §7 item 3 — so read
its skipped count, not its exit code.

**Two things B4.1 found that the batch text did not predict:**

- **The `EXPLAIN QUERY PLAN` assertion the batch implied is not the one worth
  making.** Plan §2.5's aggregate as written drives events → verdicts and is
  served by `skill_session_verdicts`'s PRIMARY KEY; the planner never touches
  `idx_skill_inv_events_session`. The index pays for the SESSION-keyed direction
  (`WHERE session_id = ?`), which is what phase 4's per-session sweeps walk and
  what the same join costs driven from the verdicts side. The spec asserts a
  before/after plan on THAT lookup — `SCAN` at v36, `SEARCH … USING INDEX` at v37
  — and it is the only test in the file that would notice the index being dropped.
- **`no-template-curly-in-migration` lints SPEC files too.** An
  `EXPLAIN QUERY PLAN ${sql}` helper trips it. Spell the SQL out as a constant;
  that is now precedent in `0037`'s spec. Do not reach for an `eslint-disable`,
  and do not narrow the rule's glob — it would drop the guard across every spec
  file to serve one narrow pattern.

**Four decisions Phase 4 inherits and must not re-open:**

- `hasUsableVerdict` is `row !== null && row.degradedReason === null`. A clean
  single-pass verdict from a non-tool-use lane has `degradedReason: null` and
  **is usable** — user-decided this session, see §6.
- The `maxAttempts` ceiling terminates `timeout` only; `auth-unresolvable`
  stalls indefinitely. Also user-decided, see §6.
- The drain is the sole owner of every queue transition. Nothing but
  `lanes/lane-runner.service.ts` may name `queueItemId` — **including in a
  comment**, because the guard is a substring scan over file text. This bit two
  separate agents this session.
- **A `null` gate measurement is NEVER `0`.** `replayConfidence: null` means
  nobody ran a hold-out, and it promotes on the judge score alone — which is the
  NORMAL case, because a cluster at the configured floor has no member to spare.
  A measured `0` means the draft failed against a session it had never seen, and
  blocks. Collapsing the two either blocks almost everything or blocks nothing.
  The UI half of the same rule renders the words "not measured", never a digit:
  `0` is falsy, so a `||` anywhere on that path silently retitles a measured
  failure as an absent measurement.

**Still unmade, and now inherited by Phase 4**, recorded in §6 and §9: a
`toolUse: 'required'` lane that exhausts a configured `maxPasses` while still
requesting evidence writes `degradedReason: null` and reads as fully usable.
Pre-existing and wrong; it wants its own `pass-budget-exhausted` reason. B3.2's
verdict-absent fallback did not force the issue, so it is still open.

### Then B5.x per §2.

## 5. Sequencing constraints — violating these causes real collisions

- **`skill-drain.service.ts`**: B0.8, B0.9 and B1.7 all touched it and were run **strictly in series**. Any future batch touching it must be too.
- **`di/tokens.ts`, `di/register.ts`, `src/index.ts`** in `skill-synthesis`: shared by many batches. Sequence rather than letting two agents edit a barrel.
- **Do not commit while an agent is writing.** `lint-staged` **stashes unstaged changes** during the pre-commit hook and would eat in-flight work.
- **A full-suite run while an agent writes is not authoritative.** `rpc-handlers` imports `skill-synthesis`; a sweep during a mid-write moment showed 2 phantom failures that passed in isolation. Re-run when idle.
- Give every agent **explicit file ownership** and tell it to STOP and report rather than edit outside it. That is what let 3–4 agents run concurrently in one worktree all session.

## 6. Two scope additions already approved — do NOT re-litigate

Both are recorded in full in `tasks.md` §6.

- **B0.8** (landed): per-stage token attribution. Migration **`0035`**. Consequently **B3.1's migration is now `0036`** and **B4.1's is `0037`** — already renumbered in the batch text.
- **B0.9** (landed): register the `prefilter`/`embedding` stage handlers and re-point the trigger service at the queue. Without it, C0 enqueued rows nothing drained and embedding backfill went dark.

Also settled by the user this session:

- **The attempt ceiling applies to `timeout` ONLY.** `auth-unresolvable` stalls indefinitely. Rationale and the spec pinning it are in §6 — a timeout is a transport fault nobody may clear; unresolvable auth is user-fixable, and `markFailed` is terminal, so killing the row means the user's config fix arrives too late.

## 7. Environment traps that cost real time

1. **`--testPathPattern` is IGNORED, and it is WORSE than that: `nx test <project> --runTestsByPath <path>` does not filter either** — it runs every suite in the project anyway. For a LIB use `npx jest --config <lib>/jest.config.ts --runTestsByPath <path>`; for an APP you also need `--rootDir`, e.g. `npx jest -c apps/ptah-electron/jest.config.ts --rootDir apps/ptah-electron --runInBand --runTestsByPath <path>`. Found the hard way in B5.1.
2. **`better-sqlite3` is built against Electron's ABI** (`NODE_MODULE_VERSION 143` vs Node's `137`). The house native-gated spec pattern makes specs **skip silently — green while asserting nothing.** Reuse `skill-synthesis/src/lib/queue/queue-db.test-support.ts` (`node:sqlite` fallback; it applies `0035` after `0032`). **Always demand per-spec passed/skipped counts from agents.**
3. **`persistence-sqlite` has 8 entirely dark suites — 65 tests asserting nothing.** Native-gated migration specs for `0014`–`0027`. Pre-existing, not caused by this task, and worth its own cleanup: migration coverage that reports green while running nothing. The `node:sqlite` fallback built here is the fix.
4. **The pre-commit hook takes ~3 minutes** (lint-staged + full Electron `validate-deps` across 30 projects). Use a 600000 ms timeout.
5. **Nx daemon goes stale** with concurrent agents and reports contradictory lint errors — `npx nx daemon --stop`.
6. **`nx lint a b c` silently lints only `a`.** Use `nx run-many -t lint -p a b c`.
7. **`libs/backend/cli-engine` uses `jest.config.cjs`**, not `.ts`.
8. **Angular libs typecheck via `tsconfig.lib.json`, which EXCLUDES specs**, and `jest-preset-angular` here does not hard-fail on missing members — so spec/DTO drift is invisible to both CI gates. Run `tsc --noEmit -p <lib>/tsconfig.spec.json` to see it.
9. **Every new migration requires bumping version ratchets in older migration specs.** Run the FULL `persistence-sqlite` suite to find them — the wording differs per spec, so grep misses some.
10. ~~One pre-existing `agent-sdk` spec (`sdk-query-runner.service.spec.ts:368`) fails if the shell exports `ANTHROPIC_AUTH_TOKEN=""` / `ANTHROPIC_API_KEY=""` / `ANTHROPIC_BASE_URL=""`.~~ **STALE as of 2026-08-15 — do not budget time for this.** The orchestrator ran the full `agent-sdk` suite twice from a shell that DOES export all three as empty strings (verified by reading `process.env` directly) and got **68 suites, 903 passed, 0 failed** both times. Whatever fixed it, `agent-sdk` is a clean gate now, so a red suite there is YOUR regression.
11. `A worker process has failed to exit gracefully` in parallel Jest runs is **pre-existing**; it disappears under `--runInBand`.
12. **An unattributed intermittent failure in `skill-synthesis.service.enqueue.spec.ts`, seen twice, never reproduced.** During B2.4 one full-suite run reported `1 failed` in that file at **27 s** (normal ~4 s), and an earlier one failed at the _suite_ level with **zero** test failures at 48 s. **Neither run captured the failing test name**, so it is not fully exonerated. Everything since has been green: 19 runs by the agent (13 parallel, 6 isolated, 2 `--runInBand`) plus 8 by the orchestrator **including deliberate contention** — a full suite running concurrently with four isolated runs of that file. Both sightings were under heavy box load, and nothing in the P2-4 block waits on wall-clock (`withClaimHeartbeat`'s only timer is a 60 s `unref`'d interval cleared in `finally`; `fireSessionEnd` is 8 × `await Promise.resolve()`), so a 27 s suite is a stalled machine rather than a 5 s jest timeout. Treated as item 11's flake. **If you see it again, capture the test name** — that is the one piece of evidence nobody has.

## 8. How to run this, based on what actually worked

- **Verify every batch yourself before committing. Do not trust the report.** Several agents miscounted their own tests this session; several others made good calls that deviated from their batch text.
- **Demand exact `Tests: N passed, M failed, K skipped, T total` lines per spec file**, plus the whole-suite block. "Tests pass" is not a report.
- **Mutation-test any spec whose whole job is to catch a regression.** Revert the fix, confirm the spec fails, restore, confirm it passes. Done twice this session (the timeout-only ceiling, the picker binding); both times it proved the spec was not vacuous. This is cheap and it is the only thing that distinguishes a guard from decoration.
- **Tell agents to STOP and report rather than edit outside ownership.** Three of the most valuable findings this session came from agents refusing to fix something and explaining why instead:
  - B0.7 could not build a token counter because the wire carried no token data → became B0.8.
  - B0.6 found the trigger service still calling `analyzeSession` inline, owned by no batch → became B0.9.
  - B1.10 found the shared picker could not display a pinned provider → fixed in `9e42f9c81`.
- **When an agent flags a decision that reinterprets an approved decision, surface it rather than deciding.** The `auth-unresolvable` ceiling was exactly this.

## 8b. The three post-completion reviews — what they found, and what it cost

Run at `868da42d1` after every batch had landed: `code-logic-reviewer`,
`code-style-reviewer`, and a security pass. **Scoped to 335 files derived from
this task's own 36 commits** (`git log --format=%H main..HEAD -- libs/backend/skill-synthesis apps/ptah-electron/src/services/tray libs/frontend/skill-synthesis-ui`),
NOT the branch diff — `ak/tui-defects` is ~3300 files ahead of `main` and 85-90 %
of that is unrelated. Scoping this way is the difference between three real
findings and a hundred pages of noise.

**Three findings across 335 files.** Two were fixed in B4.9; both are described
in that commit. The third — `registerAnalyzeNow` returning raw `error.message`
to the client where all 18 sibling handlers throw a generic `toUserError` — is
**pre-existing on `main` (3 instances) and the user chose not to file it.**

**Both reviewers corrected the orchestrator, and both were right.** The style
reviewer corrected "21 of 22 `tsconfig.spec.json` arity errors" to 15 of 22 (one
is enum drift, two are null/string, and four belong to `libs/frontend/editor`);
that number had been passed on from a batch report without being checked. The
security reviewer traced its own finding to `main` and said so rather than
presenting a pre-existing issue as a regression. **Give reviewers the
"do-not-re-open" list and the already-filed list** — both said explicitly that
they went looking for what per-batch verification could not see, instead of
restating design decisions, and that is why the output was three items and not
thirty.

**Found by B4.9 and NOT fixed — `SkillDrainService.reapStaleClaims` has no
callers anywhere in the repo.** Verified: zero production callers, zero specs.
Its own doc and `SkillQueueStore.reapStale`'s doc both claim
`SkillSynthesisService.start()` calls it. It does not, and `assertStaleClaimTtl`
carried the same false claim until B4.9 removed it. Reaping at the head of every
drain (`skill-drain.service.ts:616`) does work, so the impact is bounded to a
missing STARTUP reap — after a crash, orphaned claims wait for the next tick
rather than being cleared at boot, which for the frequent tier is ≤15 minutes.
Small, but it is dead code plus two lying comments.

## 9. Follow-ups filed, deliberately NOT in this task

- **`TASK_2026_251`** — the two red Electron DI risk guards (R1/R2 token
  aliasing) described in §3. Filed with a full context.md, including the one
  thing to check first: whether the REAL bootstrap has the same ordering as the
  spec's container, because that decides whether the fix is a harness change or
  a bootstrap change.
- **✅ ALL FOUR OPEN DESIGN CALLS WERE RULED ON BY THE USER 2026-08-16.** The
  originals are kept below for the reasoning they record; the rulings are here.
  Two of them became new batches, which is why the count moved 37 → 39.

  | Call                           | Ruling                                                                          | Lands as                             |
  | ------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------ |
  | `DRAIN_TIER_LIMITS.weekly`     | **Full B0.10-shaped fix** — new `weeklyMaxItemsPerRun` key + `multiRound: true` | **B4.6** (new)                       |
  | Sweep (a) writes pending       | **Provision an LLM lane for the curator** — do what B4.2 actually authorised    | **B4.7** part 1 (new)                |
  | Digest mixes scopes            | **Scope sweep (c) to the workspace** — `getWinRates()` gains the predicate      | **B4.7** part 2 (new)                |
  | B4.4's outbound Zod validation | **Keep it, scoped to this handler.** Do not spread it, do not revert it.        | doc note in `rpc-handlers/CLAUDE.md` |

  Three consequences worth carrying forward:
  - **B4.6 must not raise `perWorkspaceBatch`** — it stays `1` on every tier, for
    the R4 reason B0.10 recorded. The weekly key is **file-settings only, off the
    RPC wire**, exactly like `nightlyMaxItemsPerRun`. That makes the settings
    panel's single "Max items per run" number false for TWO tiers now, not one —
    append it to `TASK_2026_242`.
  - **B4.7 reuses the `synthesis` lane and adds NO fifth lane id.** A new lane id
    means ~8 new settings keys in `platform-core`, and `SkillCuratorService`
    already runs its overlap pass on `synthesis` (`skill-curator.service.ts:264`).
    The lane is injected `{isOptional: true}` with the verbatim-intent path kept
    as the lane-less fallback, because `drain()` must never throw in a CLI host.
  - **Sweep (a)'s conservative guarantees survive the LLM.** `updatePending` only,
    never `insertPending`; `pending` rows only; idempotent. Those are the reason
    the lane was approved, not incidental.

- **Decisions from B4.2/B4.4 the user should rule on** — ✅ **ALL RULED ON, see
  the table above.** Kept verbatim for the reasoning:
  - **Sweep (a) writes to pending suggestions.** The batch authorised a
    description rewrite through `SkillSuggestionStore.updatePending`, but no LLM
    lane is provisioned for the curator, so it appends the archaeologist's
    VERBATIM session intents instead of generating prose — idempotently, only to
    rows still `pending`, and `insertPending` is never called. Strictly more
    conservative than authorised, and it respects the autonomy boundary. Removing
    it is a one-method deletion, but `DigestItem` has nowhere to carry a
    suggestion id, so the RPC would need a new field.
  - **The digest MIXES SCOPES.** Sweeps (a), (b) and (d) are workspace-scoped via
    `listByWorkspace`; sweep (c) is cross-project because `getWinRates()` takes
    no arguments. A per-workspace digest containing one cross-project row is
    something a user can notice. Adding the predicate means editing
    `skill-candidate.store.ts`.
  - **B4.4 introduced OUTBOUND Zod validation, which this codebase had no
    precedent for.** `SkillDigestItemSchema` validates items on the way out, not
    params on the way in; it also makes `sessionIds.min(1)` mechanically
    enforced, so a contract violation surfaces as an error instead of an empty
    evidence list in the UI. Defensible, but it is new house style — decide
    whether it spreads or gets reverted (deleting the two schemas and the
    `.parse()` call is self-contained).
  - The wire type is **`SkillDigestItem`**, not `DigestItem`, because the handler
    imports the backend type and the wire type into the same file.
- **B4.4.3 shipped untested and the orchestrator wrote the test.** The
  `AgentScorecard` win-rate merge distinguishes three inputs that must not
  collapse into two — a measured `0`, a stored `null`, and an ABSENT row.
  Mutating it to `measured?.winRate || null` fails exactly ONE test, the one
  added in `skills-synthesis-rpc.handlers.spec.ts`. If that test is ever deleted,
  nothing else covers the branch.

- **THREE SPECS HAND-WRITE `skill_invocation_events` AND WILL BREAK THE DAY
  `better-sqlite3` IS REBUILT.** Found by B4.1, not fixed by it (outside its
  ownership). `r10-enhancement-window.spec.ts`, `spec-harvester.concurrent-attribution.spec.ts`
  and `spec-harvester.service.spec.ts` each `CREATE TABLE skill_invocation_events`
  with the pre-`0037` column list and each calls `store.recordSkillEvent`, which
  now writes 17 columns. They pass today ONLY because those call sites sit inside
  their skipped, native-gated tests — 8 dark tests between them. **This is §7
  item 3 turning into a live trap**: the moment the ABI is fixed, three suites
  break for a reason that has nothing to do with whatever change surfaced them.
  The fix is one line each, the same `db.exec(SQL_0037)` B4.1 used in
  `skill-candidate.store.spec.ts`. Do it before rebuilding the binding, not after.
- **`getWinRates()` takes no arguments** — plan §2.5's query verbatim, with no
  `workspaceRoot` predicate, because nothing scopes yet. B4.2's curator is the
  first caller that may want one; add it there rather than pre-building it.
- **`SkillWinRate` is exported from `skill-candidate.store.ts`, not `types.ts`.**
  If B4.2 wants it in `digest/digest.types.ts`, move it there — it was left at the
  store because `types.ts` was outside B4.1's ownership, not by design.

- **`TASK_2026_245`** — the replay gate's missing production producer. Phase 3
  shipped its handler with nothing enqueuing a row, on purpose. See §2.
- **`TASK_2026_247`** — ✅ **MOSTLY FIXED 2026-08-15 at `7c3c9bf7f`; status
  `in_review`.** The cleanup is now scoped to the sessions actually being
  disposed, and a system abort is distinguishable from a user deny at the
  tool-result layer. **Its `context.md` records what did NOT ship**, and one item
  matters here: the same laundering exists at
  `stream-router.service.ts:444-448`, arrives over the webview wire, and is NOT
  covered by that fix. The original text follows, for the chain it documents. A
  config change on `authMethod`, `anthropicProviderId` or any `ptah.auth.*`
  secret calls `disposeAllSessions()`, which cleans up pending permissions with
  NO session id — the branch that denies every in-flight permission request in
  every window, tab and background subagent. No user action is in that chain,
  and the reason Ptah sets (`'Session aborted'`) never reaches the model, which
  sees the generic "the user doesn't want to take this action" and correctly
  stops as though a person had decided. **It cost two agents ~2.5 hours during
  B3.5, mid-batch, and left a file non-compiling.** Suspect it whenever an agent
  returns early saying "no files written"; resuming it works, which is exactly
  why this keeps getting re-diagnosed instead of fixed. This task's own lane-auth
  work is a plausible trigger.
- **`JudgePanelResult` / `TriggerEvalOutcome` cannot report a lane failure.**
  Both collapse a `SkillLaneFailure` into a reason STRING, so their stage
  handlers cannot answer `lane-failed` and a timed-out judge lane takes the
  default 30-minute backoff instead of the lane's own. B3.5 documented the gap in
  the handlers rather than fabricating a `SkillLaneFailure` — inventing a `kind`
  and `retryAfterMs` would have the drain pick its retry ceiling from a guess.
  The fix is widening the two result types.
- **`TRIGGER_EVAL_SKIP_REASONS.noPrompts` collapses three different facts** — no
  lane in this host (permanent), the lane failed, and an unparseable reply (both
  transient) — into one token, so a handler cannot tell a permanent skip from a
  retryable one. It also has no success token; B3.5 had to declare
  `TRIGGER_EVAL_MEASURED_REASON` in its own file, where `REPLAY_REASONS.measured`
  sits beside its siblings.
- **The frontmatter-stripping candidate-body reader now exists in three places**
  — `skill-promotion.service.ts:531`, `skill-curator.service.ts:614`, and
  `skill-synthesis.service.ts` (B3.5 lifted the backfill's inline copy into a
  module-private function rather than adding a fourth). A shared
  `candidate-body.ts` is the cleanup. Note the callers DISAGREE about the
  missing-file case, so the shared helper must return `string | null`: the
  backfill folds the row's own text into the embedding, and a stand-in string
  would fold `description` in twice and move the vector for every file-less
  candidate.
- **`libs/frontend/skill-synthesis-ui/CLAUDE.md` contradicts itself.** Its
  "Runtime: ELECTRON-ONLY" section explains at length that the tab is
  Electron-only and that an earlier claim otherwise was wrong; the Guidelines
  section at the bottom still says "Do not Electron-gate this tab — skills work
  on VS Code too." That is the stale line the section above was written to kill.
- **`toSummary` has no logger**, so an unreadable `judge_panel_rationales` column
  is dropped silently — not fabricated, but not noticed either. It is a
  module-level free function; threading a logger through it ripples into
  `toDetail` and every call site.

- **`TASK_2026_243`** — the `[value]`-without-`[selected]` select-binding sweep. One confirmed instance left (`json-schema-form.component.ts:74-87`).
- **`TASK_2026_242`** — the Skills settings panel shows "Max items per run: 4" while the nightly tier ignores that key entirely (B0.10 routed `nightlyMaxItemsPerRun` through file settings but deliberately kept it off the RPC wire). A displayed number that is false for the one token-spending tier is worse than an absent control.
- **`TASK_2026_244`** — ✅ **DONE 2026-08-15, and it was filed on a WRONG premise.** The Skills tab is Electron-only BY DESIGN, like all four Thoth tabs: `SkillsSynthesisRpcHandlers` is in `EXPECTED_ABSENT_HANDLERS` (`apps/ptah-extension-vscode/src/di/expected-absent.ts`), so the whole backend is absent in VS Code — it needs better-sqlite3 + the embedder worker. The gates are right; the stale doc claim was fixed. **Invariant #5 keeps its conclusion but LOSES its rationale**: extracting the picker is still correct for single-definition reasons, but "a fork strands VS Code users" is false — this tab has no VS Code users. Do not cite it as evidence a cross-host path works, and do not "restore parity".
- **`pass-budget-exhausted`** — a `toolUse: 'required'` lane that exhausts a configured `maxPasses` while still asking for evidence writes `degradedReason: null` and reads as fully usable. Pre-existing, not introduced by B2.3, and it wants its own reason member. Phase 3's fallback logic is where this surfaces; decide it there.
- **Four-container spec smell** (`tasks.md` §6): `skills-synthesis-rpc.handlers.spec.ts` builds its tsyringe container in four places, plus a fifth in `skills-synthesis-rpc.queue.spec.ts:131`. Every new constructor param breaks all five. Cleanup task of its own; do not fold into a feature batch.
- **`SkillsSynthesisRpcHandlers` injection surface** — 16+ constructor dependencies, well past the >8 smell threshold in the root `CLAUDE.md`. The five-container spec problem is a symptom. Wants a facade; real refactor, not a batch side-effect.
- **`persistence-sqlite`'s 65 dark tests** (§7 item 3).
- **`analyzeNow` RPC** (`skills-synthesis-rpc.handlers.ts:709`) still calls `analyzeSession` directly. Judged legitimate — an explicit user-initiated foreground action with a synchronous result contract a queue enqueue cannot satisfy — and documented as the only other caller. Revisit only if that stops being true.
