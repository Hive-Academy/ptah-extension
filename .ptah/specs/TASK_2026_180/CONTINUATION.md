# TASK_2026_180 — continuation handoff

**Written 2026-08-13, updated 2026-08-15.** Everything below was verified by
re-running it, not taken from an agent's report. Read this, then `tasks.md`
**§2 Batch index**, **§3 Global invariants** and **§6 Orchestrator hand-off
notes** — §6 has grown a lot and several notes are addressed to specific
unstarted batches.

---

## 1. Where

- **Worktree**: `D:/projects/ptah-extension/.claude-worktrees/task180`
- **Branch**: `ak/task-180-skill-synthesis`, HEAD **`c699bca9f`** (merged into `ak/tui-defects`)
- **Use complete absolute Windows paths** for every Read/Write/Edit — known Claude Code bug with relative paths here.
- `D:/projects/ptah-extension` is a **different worktree** on unrelated TUI work. Do not touch it. It also holds `TASK_2026_236`, which this worktree does not — **scan both when allocating a task id**, or you will burn one. **ID ALLOCATION IS BROKEN ACROSS WORKTREES — do not trust a folder scan.** Ids `237`–`241` were allocated on this branch AND independently in `D:/projects/ptah-extension` during the same session, for different tasks. This branch renumbered ITS carriers TWICE (237/238 → 240/241, then 239/240/241 → 242/243/244) because the other worktree's were real work. **The folder-scan rule in the root CLAUDE.md cannot work when two worktrees allocate concurrently** — any scan is stale the moment the other side commits. Until that is fixed: re-check BOTH worktrees immediately before committing a carrier, and expect to renumber anyway. This worktree tops out at `TASK_2026_244`; the other holds up to `241`. Next free across both is `245`.

## 2. Status: Commits 0, 1, 2 and 3 COMPLETE — Phase 4 is next

**29 of 37 batches done** (34 planned + 3 added mid-flight: B0.8, B0.9, B0.10).
**Phases 0, 1, 2 and 3 are all closed and fully gated.** Phase 3 was built
directly on `ak/tui-defects` (NOT in the `task180` worktree — see §1), so there
is nothing left to merge. The next session starts on B4.1 with nothing
half-finished behind it.

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

| Commit               | State                       |
| -------------------- | --------------------------- |
| **C0 — Phase 0**     | ✅ **Complete.** B0.1–B0.9  |
| **C1 — Phase 1**     | ✅ **Complete.** B1.1–B1.11 |
| **C2 — Phase 2**     | ✅ **Complete.** B2.1–B2.4  |
| **C3 — Phase 3**     | ✅ **Complete.** B3.1–B3.5  |
| **C4 — Phase 4**     | Not started (B4.1–B4.5)     |
| **C5 — Tier B tray** | Not started (B5.1, B5.2)    |

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

**CURRENT — full gate run by the orchestrator at `368ebee36` (B3.5, Phase 3
closed), everything idle. Use these, not the `c699bca9f` block below:**

```
skill-synthesis     58 of 64  |  1123 passed, 37 skipped, 1160 total
rpc-handlers        77 suites |  2095 passed, 31 skipped, 2126 total
skill-synthesis-ui  22 suites |   284 passed,  0 skipped,  284 total
shared              32 suites |   762 passed,  0 skipped,  762 total
persistence-sqlite  16 of 24  |   161 passed, 65 skipped,  226 total
npm run typecheck:all                                  → 90 projects clean
```

**The load-bearing skip counts are UNCHANGED: 37 / 31 / 65.** Only the passed
counts moved, by the five Phase-3 commits. A rise in a skip count still means a
suite went dark — see §7.

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

### B4.1 — migration `0037` + the workspace-root thread-through (correction C10)

**Next up. Depends on B3.1 (done), so it is unblocked.** Executor
`backend-developer`, sequential. Then B4.2 → B4.5, then B5.x.

**The migration is `0037`** — B0.8 took `0035` and B3.1 took `0036`.
**`0036`'s ratchet was already moved to the shape `0033` uses** (exists once, 34
precedes, 36 follows) specifically so `0037` would not have to touch it again.
Every new migration still requires
bumping version ratchets in older migration specs: run the FULL
`persistence-sqlite` suite to find them, because the wording differs per spec
and grep misses some. That suite also has 8 entirely dark suites (65 tests
asserting nothing) — see §7 item 3 — so read its skipped count, not its exit
code.

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

1. **`--testPathPattern` is IGNORED.** Use `npx jest --config <lib>/jest.config.ts --runTestsByPath <path>`.
2. **`better-sqlite3` is built against Electron's ABI** (`NODE_MODULE_VERSION 143` vs Node's `137`). The house native-gated spec pattern makes specs **skip silently — green while asserting nothing.** Reuse `skill-synthesis/src/lib/queue/queue-db.test-support.ts` (`node:sqlite` fallback; it applies `0035` after `0032`). **Always demand per-spec passed/skipped counts from agents.**
3. **`persistence-sqlite` has 8 entirely dark suites — 65 tests asserting nothing.** Native-gated migration specs for `0014`–`0027`. Pre-existing, not caused by this task, and worth its own cleanup: migration coverage that reports green while running nothing. The `node:sqlite` fallback built here is the fix.
4. **The pre-commit hook takes ~3 minutes** (lint-staged + full Electron `validate-deps` across 30 projects). Use a 600000 ms timeout.
5. **Nx daemon goes stale** with concurrent agents and reports contradictory lint errors — `npx nx daemon --stop`.
6. **`nx lint a b c` silently lints only `a`.** Use `nx run-many -t lint -p a b c`.
7. **`libs/backend/cli-engine` uses `jest.config.cjs`**, not `.ts`.
8. **Angular libs typecheck via `tsconfig.lib.json`, which EXCLUDES specs**, and `jest-preset-angular` here does not hard-fail on missing members — so spec/DTO drift is invisible to both CI gates. Run `tsc --noEmit -p <lib>/tsconfig.spec.json` to see it.
9. **Every new migration requires bumping version ratchets in older migration specs.** Run the FULL `persistence-sqlite` suite to find them — the wording differs per spec, so grep misses some.
10. One pre-existing `agent-sdk` spec (`sdk-query-runner.service.spec.ts:368`) fails if the shell exports `ANTHROPIC_AUTH_TOKEN=""` / `ANTHROPIC_API_KEY=""` / `ANTHROPIC_BASE_URL=""`. Not this task.
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

## 9. Follow-ups filed, deliberately NOT in this task

- **`TASK_2026_245`** — the replay gate's missing production producer. Phase 3
  shipped its handler with nothing enqueuing a row, on purpose. See §2.
- **`TASK_2026_247`** — **read this before blaming an agent for stopping.** A
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
