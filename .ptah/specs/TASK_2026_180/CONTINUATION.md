# TASK_2026_180 — continuation handoff

**Written 2026-08-13.** Everything below was verified by re-running it, not taken
from an agent's report. Read this, then `tasks.md` **§2 Batch index**, **§3
Global invariants** and **§6 Orchestrator hand-off notes** — §6 has grown a lot
and several notes are addressed to specific unstarted batches.

---

## 1. Where

- **Worktree**: `D:/projects/ptah-extension/.claude-worktrees/task180`
- **Branch**: `ak/task-180-skill-synthesis`, HEAD **`9e42f9c81`**
- **Use complete absolute Windows paths** for every Read/Write/Edit — known Claude Code bug with relative paths here.
- `D:/projects/ptah-extension` is a **different worktree** on unrelated TUI work. Do not touch it. It also holds `TASK_2026_236`, which this worktree does not — **scan both when allocating a task id**, or you will burn one.

## 2. Status: Commit 0 COMPLETE, Commit 1 needs one batch

**19 of 36 batches done** (34 planned + 2 added mid-flight).

| Commit               | State                                                 |
| -------------------- | ----------------------------------------------------- |
| **C0 — Phase 0**     | ✅ **Complete.** B0.1–B0.9                            |
| **C1 — Phase 1**     | B1.1–B1.10 done, **B1.11 remaining** (cross-host e2e) |
| **C2 — Phase 2**     | B2.1, B2.2 done. **B2.3, B2.4 remaining**             |
| **C3 — Phase 3**     | Not started (B3.1–B3.5)                               |
| **C4 — Phase 4**     | Not started (B4.1–B4.5)                               |
| **C5 — Tier B tray** | Not started (B5.1, B5.2)                              |

### Commits so far (working commits, deliberately interleaved by phase)

```
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

**Working commits interleave phases ON PURPOSE.** The six-commit contract is
honoured at the END by collapsing each phase with `git reset --soft <phase-base>`.
**No single commit mixes two phases** — that is the property the collapse depends
on. Preserve it: stage by path and never let one commit straddle.

Path→phase split used so far: `libs/backend/skill-synthesis/**` has been C1 or C0
depending on batch; `platform-core` + `rpc-handlers` + `libs/shared` were C0 for
B0.5 and C1 for B1.8. **Check which batch owns a file before staging.**

## 3. Verified baselines at `9e42f9c81`

Re-measure before you claim a regression; these were all run with no agents writing.

```
ui                  17 suites  |  315 passed, 0 failed, 0 skipped
skill-synthesis     48 of 53   |  819 passed, 36 skipped, 855 total
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

### B1.11 — cross-host e2e (closes C1)

Depends on B1.10 (done). Executor `senior-tester`, **parallel** — two file-disjoint
e2e specs against different harnesses. Safe to write now: the picker renders
pinned state correctly as of `9e42f9c81`. Writing it before that fix would have
pinned broken rendering.

### B2.3 — `SessionArchaeologistService` (the substance of Phase 2)

Depends on B2.1, B2.2, B1.5 — **all done, unblocked now.**

- Orchestrated multi-pass retrieval via `TranscriptWindowReader`, driven from TypeScript. **NOT SDK tool calling** (decision Q3).
- `maxPasses = 1` collapse on `tool-use-unsupported`.
- Heartbeat between passes — `touchClaim` returning `false` means the row was lost and this worker MUST stop writing.
- This is the first batch that spends **real tokens per session**, so B0.8's per-stage counter starts earning its keep here. Watch it.

### B2.4 — demote the regex, feed the verdict to synthesis, wire the `archaeology` stage

Depends on B2.3. **B2.4.4 is the only stage-wiring task in the whole plan** —
see §6's note about the `lane-failed` producer.

### Then B3.x → B4.x → B5.x per §2.

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

- **`TASK_2026_237`** — the `[value]`-without-`[selected]` select-binding sweep. One confirmed instance left (`json-schema-form.component.ts:74-87`).
- **Four-container spec smell** (`tasks.md` §6): `skills-synthesis-rpc.handlers.spec.ts` builds its tsyringe container in four places, plus a fifth in `skills-synthesis-rpc.queue.spec.ts:131`. Every new constructor param breaks all five. Cleanup task of its own; do not fold into a feature batch.
- **`SkillsSynthesisRpcHandlers` injection surface** — 16+ constructor dependencies, well past the >8 smell threshold in the root `CLAUDE.md`. The five-container spec problem is a symptom. Wants a facade; real refactor, not a batch side-effect.
- **`persistence-sqlite`'s 65 dark tests** (§7 item 3).
- **`analyzeNow` RPC** (`skills-synthesis-rpc.handlers.ts:709`) still calls `analyzeSession` directly. Judged legitimate — an explicit user-initiated foreground action with a synchronous result contract a queue enqueue cannot satisfy — and documented as the only other caller. Revisit only if that stops being true.
