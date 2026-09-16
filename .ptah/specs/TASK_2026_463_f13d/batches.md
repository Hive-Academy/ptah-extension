# Batches - TASK_2026_463_f13d

Total tasks: 9 | Batches: 4 (3 code, 1 PR prep) | Complete: 4/4

Worktree (every path below is inside it; never touch `D:\projects\ptah-extension` root files,
never modify `W\node_modules` — it is a junction):
`W = D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers`
Branch `chore/task-463-437-leftovers`, base `97239e814` (origin/main).

## Plan validation

Status: PASSED WITH RISKS

Every decision-critical citation in implementation-plan.md was re-read at `97239e814`. No
BLOCKER. Orchestrator decision recorded: the publish-electron input is `dry-run` (hyphen),
matching `W\.github\workflows\publish-cli.yml:49` and the `github.event.inputs.dry-run`
dereference at `:387`, `:394`.

### Citation check

| Ref                    | Plan citation                                                                                                                                                                                                                                | Found at `97239e814`                                                                                                                                 | Verdict                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| C1 guards              | `ci.yml:46-49`, `electron-e2e.yml:42-45`, `vscode-e2e.yml:54-57`; comments `ci.yml:41-45`, `electron-e2e.yml:40-41`, `vscode-e2e.yml:52-53`                                                                                                  | `startsWith(github.head_ref, 'chore/bump-')` at ci :48, e2e :44, vscode :56; comments as cited                                                       | OK                                                                  |
| Bot branches           | `publish-cli.yml:401`, `publish-electron.yml:657`, `publish-extension.yml:226`; `gh pr create` :416/:680/:247                                                                                                                                | identical; no other `chore/bump` in `.github/workflows`                                                                                              | OK                                                                  |
| D3 input               | `publish-electron.yml:46-60` (only `bump`; group `publish-electron`)                                                                                                                                                                         | inputs :47-57, concurrency :58-60                                                                                                                    | OK                                                                  |
| D3 sign steps          | eSigner :457, check-1 :476, retry-2 :507, check-2 :513, retry-3 :544, copy-back :555, installer sign :616                                                                                                                                    | identical; retries gated on `steps.sign-check-N.outputs.complete != 'true'` (:508, :515, :545) — an empty output from a skipped check RUNS the retry | OK, critical row confirmed                                          |
| D3 anchors             | `&batch_sign_with` :460, `*batch_sign_with` :510, :547                                                                                                                                                                                       | identical                                                                                                                                            | OK                                                                  |
| D3 publish never       | :310, :342, :590                                                                                                                                                                                                                             | identical                                                                                                                                            | OK                                                                  |
| D3 upload / release    | upload :630 (`retention-days: 30`), `release` job :642 (no `if:` today)                                                                                                                                                                      | identical                                                                                                                                            | OK                                                                  |
| D3 sync                | `sync-release-branch.yml:142`                                                                                                                                                                                                                | `-f "bump=$BUMP"` at :144                                                                                                                            | Shifted +2, no impact                                               |
| D2 gate                | `DEFAULT_MAX_CONCURRENT = 2` :87, per-lane :103, timeout :114, lanes :23/:33/:56, `admissible` :432-436, `drain` :468-481, file 486 lines                                                                                                    | identical                                                                                                                                            | OK                                                                  |
| D2 service             | `acquireSlot` :140-185, `blockedBy` ternary :169-173, per-lane key :39-40, `readLimit` :258                                                                                                                                                  | identical; file 308 lines                                                                                                                            | OK                                                                  |
| D2 barrel              | `internal-query/index.ts`                                                                                                                                                                                                                    | re-exports lane constants only, no limit constants                                                                                                   | No barrel change (plan default holds)                               |
| D2 settings            | keys :372-373, defaults :631-632 (`1`, `60000`), comment :627-630 names `internal-query.service.ts`                                                                                                                                          | identical; per-lane key absent                                                                                                                       | OK                                                                  |
| D2 settings precedence | `file-settings-manager.ts:83-91` caller default wins over registered default                                                                                                                                                                 | identical                                                                                                                                            | OK (FU-16c is display drift)                                        |
| D2 Electron routing    | `electron-workspace-provider.ts:90-102` routes registered keys only                                                                                                                                                                          | :91-101                                                                                                                                              | OK                                                                  |
| D2 specs               | gate spec :156 fallback test; service spec :416 "honours a configured limit", :461 "holds a third lane"; `makeGatedHarness(maxConcurrent?, maxConcurrentPerLane?, collaborators)` :203; gate `acquire` helper :20-38; settings spec :818-878 | identical                                                                                                                                            | OK                                                                  |
| D2 docs                | `internal-query-queue-timeout.error.ts:5-6` "default limit 1"; `agent-sdk/CLAUDE.md:87` "is 2", `:88` "The global ceiling (2)"; `curator-job-queue.ts:38-40` "claim both global slots"                                                       | identical                                                                                                                                            | OK                                                                  |
| D2 other consumers     | grep `internalQuery\.maxConcurrent\|DEFAULT_MAX_CONCURRENT\b` outside `.ptah/specs`                                                                                                                                                          | only the 7 files the plan lists                                                                                                                      | OK                                                                  |
| D4 source              | `S437/handoff.md:480-490`                                                                                                                                                                                                                    | §9 at :480-490, source `D:/projects/property-hub`                                                                                                    | OK                                                                  |
| D4 lint seam           | "npx eslint scripts/perf if the root config covers scripts/\*_/_.mjs"                                                                                                                                                                        | `eslint.config.mjs:388-396` and `:428-435` include `**/*.mjs`; `scripts/` not in ignores (:166-190)                                                  | eslint applies                                                      |
| Tools                  | `node_modules/yaml`, `node_modules/js-yaml` present; no actionlint                                                                                                                                                                           | `yaml` resolvable                                                                                                                                    | OK                                                                  |
| Degradation audit      | TOTAL print; scan scope                                                                                                                                                                                                                      | `check-degradation.ts:852`; inputs are `libs/**/src/**/*.ts` and `apps/**/src/**/*.ts` only (`project.json`)                                         | Only Batch 1 can move it; `.github/` and `scripts/` are not scanned |

### Assumptions

- A3-1 `github.event.inputs.dry-run` is the string `'true'` for a checked boolean dispatch input
  and a hyphenated property dereference is valid — unverifiable locally; precedent
  `publish-cli.yml:387`. Checked by the user's first dry-run dispatch (`prepare` step summary
  `release_mode=dry-run`). Task 2.2 prints the mode to the summary.
- A-D2-1 No user has `internalQuery.maxConcurrent` written to `~/.ptah/settings.json` at `1` or
  `2` because of the displayed default. If one has, `limit 2` now gives `backgroundLimit = 1`
  (curator and skill-synthesis serialise again, the TASK_2026_352 shape) and `limit 1` keeps the
  serial behaviour. Accepted; Task 1.1 documents it at `backgroundLimit` and in `CLAUDE.md`.
- A-D4-1 The load-test source `D:/projects/property-hub` exists on the user's machine — not
  required by this task (only `--dry-run` and refusal paths run). If the source is absent, setup
  `--dry-run` prints `source missing` and exits 1 rather than hiding it (Task 3.2 criterion 3).
- Defaults chosen by team-leader (recorded per operating rules):
  - T1 Executor for every code batch is the `codex` CLI lane (orchestrator instruction; the plan
    names devops-engineer/backend-developer, which become the fallback executors). Reviews are
    Claude `code-logic-reviewer` + `code-style-reviewer`, never the implementing lane. Commits
    only by team-leader, one commit per batch, explicit paths.
  - T2 C1 and C3 share one batch (both workflow YAML, no Jest, one reviewer pass). C1 comment
    edits to `publish-cli.yml` and `publish-extension.yml` stay in Task 2.1; the
    `publish-electron.yml` comment stays in Task 2.2 (plan constraint).
  - T3 Parallel group 1 = Batch 1 + Batch 2 (max 2 lanes; Batch 1 is the only Jest batch).
    Batch 3 starts when a lane frees (after Batch 2 is committed, or in Batch 2's place if Batch 2
    goes to a second review round).
  - T4 The degradation-audit reference TOTAL is measured ONCE, by Batch 1, before its first edit
    (Task 1.0). Batches 2 and 3 cannot move it (unscanned paths) and do not run it.

| Risk                                                                                                                  | Severity | Mitigation                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| A skipped `Check batch-sign output` step leaves `complete` empty, so a retry step runs and bills eSigner in a dry run | HIGH     | Task 2.2: explicit `release_mode == 'publish'` term on every sign, check, retry and copy-back step; assertion script checks each |
| Dry-run concurrency group cancels a pending real release (or the reverse)                                             | MEDIUM   | Task 2.2: group includes the mode                                                                                                |
| Negative (`!= 'true'`) gating fails open into a signed public release                                                 | HIGH     | Task 2.2: positive `release_mode` token + second lock step in `release`                                                          |
| Push path or Sync Release Branch dispatch resolves to dry-run and silently stops releases                             | HIGH     | Task 2.2: push self-check `exit 1`; default `false`; hand evaluation of 3 events                                                 |
| YAML anchors broken by edits around `&batch_sign_with`                                                                | MEDIUM   | Task 2.2 + batch verification: YAML parse resolves aliases; assertion reads retry `with.command == 'batch_sign'`                 |
| Guard prefix too broad (re-creates PR #512 skip) or typo (bot PRs run CI)                                             | LOW      | Task 2.1 + assertion script over 4 `head_ref` values                                                                             |
| Background cap wrongly counts governor-held waiters, or stores cap at construction instead of per acquire             | HIGH     | Task 1.1: getter over `activeByLane`, `backgroundLimit(this.limit)` per check; gate tests 3 and 6                                |
| Capped background head blocks a foreground waiter behind it                                                           | HIGH     | Task 1.1: term inside `admissible()` so `drain()` skips it; gate test 2                                                          |
| `limit = 1` gives background cap 0 and starves curator/synthesis                                                      | HIGH     | Task 1.1: `backgroundLimit(1) === 1`; gate test 4                                                                                |
| Service log reports `governor` for a background-capped wait                                                           | LOW      | Task 1.2: `'background'` reason + service test                                                                                   |
| Default change breaks 3 pinned tests; executor deletes them instead of updating                                       | MEDIUM   | Tasks 1.1/1.2/1.3 name each test; review rejects deletions                                                                       |
| Load-test cleanup deletes a real repo or the Ptah repo                                                                | HIGH     | Task 3.1 guard module (5 refusal rules + marker); `--execute` never run in this task; self-test                                  |
| Parallel lanes in one worktree (shared Nx daemon, stray formatting)                                                   | MEDIUM   | No `project.json` edits → no `nx reset`; Batch 2/3 run no nx; prettier only on own files; explicit-path staging                  |
| Machine not idle (perf run) during Jest/nx                                                                            | HIGH     | Batch 1 waits for the orchestrator's idle-machine release and a node-runner count of 0                                           |

Edge cases:

- `workflow_dispatch` of `electron-e2e`/`vscode-e2e` has empty `head_ref` → still runs — Task 2.1
  (unchanged behaviour, state it in the comment)
- Human branch `chore/bump-electron-vite` still skips CI (accepted residual) — Task 2.1 comment
- Push event on `release/electron` has no inputs → `publish` — Task 2.2
- Dispatch without `dry-run` (Sync Release Branch) → `publish` — Task 2.2
- Dry run with an already-existing next tag → `prepare` aborts as today — Task 2.2 (unchanged)
- Dry-run Windows leg must not throw in copy-back — Task 2.2 (copy-back gated)
- Unsigned dry-run artifacts must not look distributable — Task 2.2 (5-day retention + header note)
- `maxConcurrent` set to 1 → background still gets 1 slot — Task 1.1
- `maxConcurrentPerLane` ≥ 2 → background lanes together capped at `limit − 1` — Task 1.1
- Unknown lane string → foreground, not capped (fail open) — Task 1.1
- Lane casing/whitespace (`' Memory-Curator '`) resolved before classification — Task 1.2 (service
  already calls `resolveLane`; test uses the canonical constant)
- Load-test target path variants: case, trailing separator, nested, root, inside Ptah repo — Task 3.1
- Setup fails after the clone → marker exists, cleanup can remove — Task 3.2
- Cleanup when worktrees were already deleted by the load test → `git worktree prune` — Task 3.3

---

## Idle-machine gate (read before starting any batch)

An idle-machine perf run is in progress on this machine. **Batch 1 (Jest, nx typecheck/lint,
degradation audit) must not start until the orchestrator gives the idle-machine release** and
the node-runner count is 0:

`powershell -NoProfile -c "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ? { $_.CommandLine -match 'jest-worker|run-executor' }).Count"`

Batches 2 and 3 run no nx, Jest or builds (only `node` parse/assertion scripts and `prettier` on
a handful of files). The orchestrator decides whether they may start before the release; the
default is to start them together with Batch 1 after the release.

---

## Common rules for every codex task (copy into each lane prompt)

- Work only inside `W`. Do not edit `batches.md`, `task.md`, `context.md`,
  `implementation-plan.md`. Do not commit, stash, amend, or `git add`. Do not run `nx reset`.
  Never modify `W\node_modules` (junction to the main checkout).
- TypeScript strict; `catch (error: unknown)`; no `@ts-ignore`; no TODO/stub/placeholder; no new
  `catch { return <literal> }` or empty `.catch`.
- Replace in place; delete the old text/API; no `V2`/`Legacy` copies. Update pinned tests; never
  delete a test to make a default change pass.
- Never run `--execute` on the load-test scripts. Never dispatch a workflow, push, or call `gh`.
- Verification order (report the literal output lines; skip steps the batch marks N/A):
  1. Tests: `npx nx run-many -t test -p <projects> --parallel=1 -- --maxWorkers=2` — quote the
     `Running target test for N projects` header; N must equal the count listed.
  2. `npx nx run-many -t typecheck -p <projects> --parallel=1` (header count must match)
  3. `npx nx run-many -t lint -p <projects> --parallel=1` (0 errors; report new warnings)
  4. `npx nx run degradation-audit:lint --skip-nx-cache` — quote `degradation-audit: TOTAL N`
     and the rows for touched directories; N must equal the TOTAL recorded in Task 1.0, no `FAIL`
     row.
  5. `npx prettier --check <every changed file>` (use `--write` on your own files only if it fails).
  6. Workflow batches only: YAML parse + structural guard assertion script (inline `node -e` or a
     temp file under `%TEMP%`, never committed), output quoted.
- **Quote every `|` in an nx/jest argument** — on Windows PowerShell an unquoted `|` in
  `--testPathPatterns a|b` is parsed as a pipe; write `--testPathPatterns '"a|b"'`. Prefer
  `run-many -t test -p <projects>` over path patterns. If a run goes unusually long with no
  output, check for an executor process with no worker children before waiting longer.
- At most one Jest batch at a time across all lanes (Batch 1 is the only one in this task).
- Return: absolute path of every file created/modified; per task, evidence for each acceptance
  criterion; how each listed risk was handled.

## Review protocol (every code batch)

`code-logic-reviewer` + `code-style-reviewer` in parallel → issues back to the same codex lane →
delta review. **Revise cap: 2 rounds per batch.** A third NEEDS_REVISION marks the batch FAILED
and returns to the orchestrator (escalate: fallback executor or architect). Then team-leader
verifies on disk and commits the batch's paths only.

---

## Batch 1: Internal-query slot reservation + default alignment (C2) — COMPLETE

- Commit: see `feat(agent-sdk): reserve an internal-query slot for user actions over background
  lanes` on `chore/task-463-437-leftovers`
- Outcome: no revise round. Logic review APPROVE (HIGH; 1 moderate, 2 pre-existing minors). Style
  review APPROVE (HIGH; 3 minors). Task 1.0 reference TOTAL **303**; post-change TOTAL 303, no
  `FAIL` row.
- Lane evidence: test header 2 projects (41 suites / 781 passed + 4 todo; 110 of 112 suites /
  1976 passed + 3 skipped); typecheck header 3 projects OK; lint header 3 projects, 0 errors (56
  pre-existing warnings, none in Batch 1 files); prettier clean on 9 files; `git diff --check` clean.
- Team-leader verification: `libs/**` diff is exactly the 9 Batch 1 files; no TODO/stub markers;
  `admissible()` carries the one background term over current `this.limit`;
  `backgroundLimit` = `limit >= 2 ? limit - 1 : 1`; defaults 3 / per-lane 1 registered.
- Follow-ups (not blocking):
  - Runtime signal / degradation report when `maxConcurrent <= 2` re-serialises background lanes
    (today documented + pinned only).
  - Hard-coded lane literals at `curator-pass-admission.ts:59` and `lane-runner.service.ts:198`
    should import the lane constants.
  - Naming asymmetry: gate `inFlightInBackground` vs service/log `backgroundInFlight`.
  - Two doc phrasing minors from the style review.

- Recommended executor: CLI lane `codex` x 1
- Fallback executor: Claude `backend-developer` sub-agent
- Execution mode: sequential
- Parallel group: 1 (with Batch 2)
- Rationale: one concurrency predicate, its service log and three pinned specs across agent-sdk
  and platform-core; tasks share the gate constants, so one lane in order. The only Jest batch.
- Tasks: 4 | Depends on: none. **Starts only after the orchestrator's idle-machine release.**
- Projects: `@ptah-extension/agent-sdk`, `@ptah-extension/platform-core`,
  `@ptah-extension/memory-curator`

### Task 1.0: Record the degradation-audit reference TOTAL — COMPLETE

- File: none (measurement only)
- Plan reference: implementation-plan.md:672-674
- Acceptance criteria:
  1. Before ANY edit in this worktree by any lane, run
     `npx nx run degradation-audit:lint --skip-nx-cache` once. Quote
     `degradation-audit: TOTAL N` and confirm no `FAIL` row. (Batch 2 editing `.github/` in
     parallel cannot move it — not scanned.)
  2. Report N as the task reference TOTAL (last recorded 303 at the TASK_2026_437 P4 gate; the
     base has moved since, so the measured value wins). Team-leader records it in this file.

### Task 1.1: Gate — default 3, background cap, docs — COMPLETE

- Files:
  - MODIFY `W\libs\backend\agent-sdk\src\lib\internal-query\internal-query-concurrency-gate.ts` (486 lines)
  - MODIFY `W\libs\backend\agent-sdk\src\lib\internal-query\internal-query-concurrency-gate.spec.ts` (552 lines)
- Plan reference: implementation-plan.md:161-202 (D2), :290-307, :337-354
- Pattern to follow: existing predicate `admissible` :432-436; `inFlightForLane` :269-271;
  spec helpers `acquire` :20-38 and the fake governor / lane-parameterised tests :193-252.
- Acceptance criteria:
  1. `DEFAULT_MAX_CONCURRENT = 3` (:87). Doc block :61-86 rewritten: keeps TASK_2026_323 and
     TASK_2026_352 history; says why three (two background families + one slot background may
     never take, FU-16b-c, 60 s user-action queue timeout behind a 90-120 s background call).
  2. New exported pure `backgroundLimit(limit: number): number` returning
     `limit >= 2 ? limit - 1 : 1`. Doc names D2-c (`limit = 1` → 1, a cap of 0 would starve
     curator/synthesis) and A-D2-1 (`limit = 2` → 1, background lanes serialise again).
  3. New read-only getter `inFlightInBackground: number` = sum of `activeByLane` over
     `GOVERNED_BACKGROUND_LANES`. No new counter, map, timer or listener.
  4. `admissible(lane)` gains exactly one term:
     `(!GOVERNED_BACKGROUND_LANES.has(lane) || this.inFlightInBackground < backgroundLimit(this.limit))`,
     computed from the current `this.limit` (no stored cap). Independent of the governor.
     `drain()` unchanged.
  5. Class doc :176-224 "One gate, two ceilings" → three terms, plus a paragraph "Background never
     takes the last slot" naming the shared-foreground-slot residual (`default` and `user-action`
     share the reserved slot). `GOVERNED_BACKGROUND_LANES` doc :45-55 says the set also drives the
     slot cap.
  6. Spec :156-168 "falls back to the defaults for a nonsensical limit": lanes a, b, c admitted, a
     4th queued, `inFlight === DEFAULT_MAX_CONCURRENT`. Updated, not deleted.
  7. New `describe('background slot cap (FU-16b-c)')` with the six tests of plan :341-354:
     (1) limit 3/perLane 1: `memory-curator` + `skill-synthesis` + `user-action` all admitted
     immediately; (2) limit 3/perLane 2: two `memory-curator` admitted, third background queues,
     `user-action` behind it admitted; (3) capped background waiter stays queued when a foreground
     slot frees and is admitted when a background slot frees; (4) limit 1: background admitted,
     `default` queues; (5) `backgroundLimit` 1→1, 2→1, 3→2, 5→4; (6) a governor-held background
     waiter does not count toward `inFlightInBackground`.
  8. File stays under 700 lines.
- Validation notes: risks "counts governor-held waiters", "capped head blocks foreground",
  "limit = 1 starvation".

### Task 1.2: Service — `blockedBy: 'background'` + service specs — COMPLETE

- Depends on: Task 1.1
- Files:
  - MODIFY `W\libs\backend\agent-sdk\src\lib\internal-query\internal-query.service.ts` (308 lines)
  - MODIFY `W\libs\backend\agent-sdk\src\lib\internal-query\internal-query.service.spec.ts` (572 lines)
- Plan reference: implementation-plan.md:308-316, :355-365
- Pattern to follow: `acquireSlot` :140-185 (log fields, ternary :169-173); `makeGatedHarness` :203
- Acceptance criteria:
  1. `acquireSlot` computes `backgroundInFlight = this.gate.inFlightInBackground` and
     `backgroundCapped = GOVERNED_BACKGROUND_LANES.has(lane) && backgroundInFlight >= backgroundLimit(limit)`;
     both in the wait condition and in the debug log fields. `blockedBy` order
     `'global'` → `'lane'` → `'background'` → `'governor'`. Nothing else in the service changes
     (no Zod, no signature change, `readLimit` unchanged).
  2. Spec :416-429 → `makeGatedHarness(4, 4)`: 4 admitted, 5th queued (default lane).
  3. Spec :461-472 renamed "holds a fourth lane at the global ceiling": `memory-curator`,
     `skill-synthesis`, `default` admitted, `user-action` queued; `started() === DEFAULT_MAX_CONCURRENT`.
  4. New test "admits a user-action query while both background lanes hold slots at the defaults"
     (no overrides, `started() === 3`).
  5. New test "logs blockedBy background when the background cap binds": `makeGatedHarness(3, 2)`,
     two `memory-curator` calls, a third background call's debug log has `blockedBy: 'background'`.
- Validation notes: risk "service log reports governor".

### Task 1.3: Settings defaults, per-lane key, docs and comments — COMPLETE

- Depends on: Task 1.1 (numbers must match)
- Files:
  - MODIFY `W\libs\backend\platform-core\src\file-settings-keys.ts`
  - MODIFY `W\libs\backend\platform-core\src\file-settings-keys.spec.ts`
  - MODIFY `W\libs\backend\agent-sdk\src\lib\errors\internal-query-queue-timeout.error.ts`
  - MODIFY `W\libs\backend\agent-sdk\CLAUDE.md`
  - MODIFY `W\libs\backend\memory-curator\src\lib\curator-llm\curator-job-queue.ts` (comment only)
- Plan reference: implementation-plan.md:317-335, :366-368
- Pattern to follow: existing keys/defaults at `file-settings-keys.ts:363-373`, `:627-632`; spec
  block `file-settings-keys.spec.ts:818-878`.
- Acceptance criteria:
  1. `'internalQuery.maxConcurrent': 3`; `'internalQuery.maxConcurrentPerLane'` registered in
     `FILE_BASED_SETTINGS_KEYS` next to :372-373 and defaulted to `1` next to :631-632.
  2. Defaults comment :627-630 points at `agent-sdk/src/lib/internal-query/internal-query-concurrency-gate.ts`
     (`DEFAULT_MAX_CONCURRENT`, `DEFAULT_MAX_CONCURRENT_PER_LANE`, `DEFAULT_QUEUE_TIMEOUT_MS`).
     Keys comment :363-371 adds that the per-lane key was also unregistered (TASK_2026_463).
  3. Spec: `internalQuery.maxConcurrent` → 3; register, route and default checks for
     `internalQuery.maxConcurrentPerLane` → 1; describe doc names TASK_2026_463. Hard-coded
     literals stay (platform-core cannot import agent-sdk).
  4. Error doc :5-6: no number; says the gate bounds concurrent one-shot subprocesses host-wide
     (`ptah.internalQuery.maxConcurrent`, see `DEFAULT_MAX_CONCURRENT`).
  5. `agent-sdk/CLAUDE.md:87`: "is 3", background cap `limit − 1` (min 1), predicate text matches
     the code. `:88`: the "global ceiling (2) … waits" sentence replaced with the new rule and the
     shared-foreground-slot residual. No other paragraph edited.
  6. `curator-job-queue.ts:38-40`: "claim both global slots" → "claim both background slots".
     Comment only.
- Validation notes: A-D2-1 documented; no new setting key for the cap.

### Batch 1 verification

- N/A steps: 6.
- 1: `npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/platform-core --parallel=1 -- --maxWorkers=2` → header 2 projects
- 2/3: `npx nx run-many -t typecheck -p @ptah-extension/agent-sdk @ptah-extension/platform-core @ptah-extension/memory-curator --parallel=1`, then `-t lint` → header 3 projects, 0 lint errors
- 4: TOTAL equals Task 1.0 (no catch/fallback sites added)
- 5: prettier on the 9 files
- Consumers reasoned, not run: `rpc-handlers` `internal-query-lane-drift.spec.ts` (lane strings
  unchanged); `agent-generation` `agent-customization.service.spec.ts:786-799` (local concurrency)
- Reviewers: logic (admission correctness, drain, timers) + style; accepting verdicts

---

## Batch 2: CI bump guard + publish-electron dry run (C1 + C3) — COMPLETE

- Commit: see `ci(workflows): narrow bump-branch guard and add publish-electron dry-run` on
  `chore/task-463-437-leftovers`
- Outcome: revise round 1 of 2. Logic APPROVE 8/10 (moderate: duplicated dry-run predicate between
  `concurrency.group` and `Resolve release mode`) and style APPROVE 8/10 (minor: no inline
  `release_mode` invariant comment; guard comments not verbatim). All three closed in round 1:
  cross-reference comments at both predicate sites, invariant comment beside the job output,
  identical guard prose except the trigger-specific last clause.
- Deviation accepted: AC 2.2.3 said dry-run only when event is `workflow_dispatch` AND input
  `'true'`; round 1 keys on the input alone so the step matches `concurrency.group` exactly. A push
  has no inputs, so it still resolves to `publish`, and the push self-check stays.
- Team-leader verification: strict `yaml` parse of all six files OK; 7 build steps carry the
  positive `release_mode == 'publish'` term (all four eSigner steps, both checks, copy-back);
  `jobs.release.if` gated, first step `Refuse unless publishing`; retry anchors resolve to
  `batch_sign`; `dry-run` boolean default false; each guarded job has exactly the three prefixes;
  `git diff --check` clean. No dispatch run.
- Recommended executor: CLI lane `codex` x 1
- Fallback executor: Claude `devops-engineer` sub-agent
- Execution mode: sequential
- Parallel group: 1 (with Batch 1)
- Rationale: workflow YAML only, one release/CI surface, no Jest/nx. C3 touches a paid,
  outward-facing pipeline, so one lane with one structural assertion over all six files.
- Tasks: 2 | Depends on: none

### Task 2.1: Narrow the `chore/bump-` skip guard (C1) — COMPLETE

- Files:
  - MODIFY `W\.github\workflows\ci.yml` (guard :48, comment :41-45)
  - MODIFY `W\.github\workflows\electron-e2e.yml` (guard :44, comment :40-41)
  - MODIFY `W\.github\workflows\vscode-e2e.yml` (guard :56, comment :52-53)
  - MODIFY (comment only) `W\.github\workflows\publish-cli.yml` (above `BRANCH=` :401)
  - MODIFY (comment only) `W\.github\workflows\publish-extension.yml` (above `BRANCH=` :226)
- Plan reference: implementation-plan.md:143-159 (D1), :242-283
- Pattern to follow: the existing multi-line `if: |` blocks at the cited lines.
- Acceptance criteria:
  1. In each of the three guarded jobs, `!startsWith(github.head_ref, 'chore/bump-') &&` is
     replaced by exactly three terms: `'chore/bump-cli-v'`, `'chore/bump-electron-v'`,
     `'chore/bump-extension-v'`. The PR-state and `chore(release)` terms are unchanged.
  2. Each guard comment names the three bot prefixes and their source files, says a human
     `chore/bump-<dep>` branch runs CI (PR #512 was skipped by the old guard), names the accepted
     residual (`chore/bump-electron-v…`), and keeps the `head_commit` null explanation.
  3. One comment line above `BRANCH=` in `publish-cli.yml` and `publish-extension.yml`: renaming
     the branch requires the same edit in the bump guards of `ci.yml`, `electron-e2e.yml` and
     `vscode-e2e.yml`. No other line in those two files changes.
- Validation notes: guard prefix risk.

### Task 2.2: `dry-run` mode for publish-electron (C3) — COMPLETE

- File: MODIFY `W\.github\workflows\publish-electron.yml` (719 lines)
- Plan reference: implementation-plan.md:204-226 (D3), :402-489
- Pattern to follow: input shape `publish-cli.yml:49-53`; step outputs via `$GITHUB_OUTPUT`
  as at `publish-electron.yml` `find-exe` step; env-passing (no `${{ }}` of inputs inside `run:`).
- Acceptance criteria:
  1. Input `dry-run` (boolean, `required: false`, `default: false`, description per plan :408)
     beside `bump`. `bump` unchanged.
  2. Concurrency `group: publish-electron-${{ github.event.inputs.dry-run == 'true' && 'dry-run' || 'publish' }}`,
     `cancel-in-progress: false`.
  3. `prepare`: first step `Resolve release mode` (id `mode`) — values via `env:`; writes
     `release_mode=dry-run` only when event is `workflow_dispatch` AND input is `'true'`, else
     `publish`; echoes the mode to `$GITHUB_STEP_SUMMARY`; `exit 1` if event is `push` and mode is
     not `publish`. Job output `release_mode: ${{ steps.mode.outputs.release_mode }}`. Bump, tag
     check and abort steps unchanged.
  4. `&& needs.prepare.outputs.release_mode == 'publish'` added to the `if:` of exactly these 7
     build steps: eSigner main exe (:457), check attempt 1 (:476), retry attempt 2 (:507), check
     attempt 2 (:513), retry attempt 3 (:544), copy-back (:555), installer sign (:616). Existing
     terms kept.
  5. No other build step gains a mode term, except `Upload artifacts`
     `retention-days: ${{ needs.prepare.outputs.release_mode == 'publish' && 30 || 5 }}`. The
     `Stage main app executable for signing`, NSIS repack, post-repack verifies and
     `Find Windows installer` steps stay ungated.
  6. `release` job: `if: needs.prepare.outputs.release_mode == 'publish'`; first step
     `Refuse unless publishing` exits 1 unless env `RELEASE_MODE` (from the same output) is
     `publish`. Tag, bump PR and Release steps otherwise unchanged. Cross-reference comment
     (Task 2.1 text) above `BRANCH=` at :657.
  7. Header comment :5-14 gains a "Dry run" paragraph: what runs, what is skipped, zero eSigner
     signatures, ~3 runner legs of minutes, artifacts are unsigned and must never be distributed.
  8. Anchors `&batch_sign_with` / `*batch_sign_with` still resolve.
- Validation notes: all D3 risks in the table (billing retry, fail-open, concurrency, push path,
  anchors).

### Batch 2 verification

- N/A steps: 1, 2, 3, 4 (no nx, no Jest; `.github/` is not scanned by the audit).
- 5: `npx prettier --check` on the six workflow files (YAML is not in lint-staged; match by hand).
- 6a: YAML parse of all six files:
  `node -e "const Y=require('yaml'),fs=require('fs');for(const f of ['ci','electron-e2e','vscode-e2e','publish-cli','publish-extension','publish-electron'])Y.parse(fs.readFileSync('.github/workflows/'+f+'.yml','utf8'),{strict:true})"` from `W`
- 6b: guard assertion script (not committed), which must print each check and exit non-zero on
  any failure:
  - For `ci.yml` job `main`, `electron-e2e.yml`, `vscode-e2e.yml`: `if` contains the three exact
    `startsWith` terms and not `'chore/bump-')`.
  - The three `BRANCH=` values start with `chore/bump-cli-v`, `chore/bump-electron-v`,
    `chore/bump-extension-v`.
  - A small evaluator over the three prefixes for `head_ref` values `chore/bump-cli-v1.2.3`,
    `chore/bump-electron-v0.9.1`, `chore/bump-extension-v2.0.0` (skip) and
    `chore/bump-better-sqlite3-13`, `` (empty) (run).
  - `publish-electron.yml`: every `jobs.build.steps` entry whose `uses` starts with
    `sslcom/esigner-codesign`, or whose `name` starts with `Check batch-sign output` or
    `Copy signed binaries back`, has `if` containing `needs.prepare.outputs.release_mode == 'publish'`
    (expect 7 matches, printed by name); `jobs.release.if` contains it; no other build step
    mentions `release_mode` except upload `with.retention-days`; the retry steps' parsed
    `with.command === 'batch_sign'` (anchor resolved);
    `on.workflow_dispatch.inputs['dry-run'].type === 'boolean'` and `.default === false`;
    `jobs.prepare.outputs.release_mode` exists; `jobs.release.steps[0].name === 'Refuse unless publishing'`;
    `concurrency.group` contains `dry-run`.
- 6c: hand evaluation of the mode for push, dispatch without input, dispatch with `dry-run=true`,
  written in the report.
- Reviewers: logic (must re-run 6b independently) + style; accepting verdicts

---

## Batch 3: Property-hub load-test scripts (C4) — COMPLETE

- Recommended executor: CLI lane `codex` x 1
- Fallback executor: Claude `devops-engineer` sub-agent
- Execution mode: sequential
- Parallel group: 2 (starts when a lane frees; may take Batch 2's slot if Batch 2 is in review)
- Rationale: three new files sharing one guard module; setup and cleanup import it, so one lane in
  order. No product code, no Jest.
- Tasks: 3 | Depends on: none (file-disjoint)
- Commit: see `chore(scripts): add guarded property-hub load-test setup and cleanup scripts` on
  `chore/task-463-437-leftovers`
- Outcome: revise round 1 of 2. Logic review NEEDS_REVISION (lexical-only path guard; a
  symlink/junction target bypassed containment) → delta APPROVE 9/10. Style review APPROVE; its
  serious duplication finding (`run`, `childFailure`, `comparable`, `isStrictlyWithin` copies)
  closed in the delta — all exported once from `property-hub-loadtest-paths.mjs`. Fix:
  `realpathSync.native` resolution (nearest existing ancestor for new paths) plus an `lstat`
  component walk refusing any symlink/junction; cleanup re-checks immediately before `fs.rm`.
  Residual accepted: TOCTOU window between that re-check and `fs.rm` (inherent to check-then-act).
- Team-leader verification: `node --check` OK on 3 files; `--self-test` → `self-test junction
refusal OK`, `self-test junction cleanup OK`, `self-test OK`, exit 0; no TODO/stub markers;
  `--execute` never run.

### Task 3.1: Shared path guard + marker module — COMPLETE

- File: CREATE `W\scripts\perf\property-hub-loadtest-paths.mjs`
- Plan reference: implementation-plan.md:491-513
- Pattern to follow: Node ESM script precedent `W\scripts\performance-baseline.mjs`; mode-flag
  precedent `W\scripts\reset-ptah-dev-profile.sh:1-40`
- Acceptance criteria:
  1. Exports `resolveLoadtestPaths({ source, target })` (defaults `D:/projects/property-hub`,
     `D:/projects/property-hub-loadtest`), `path.resolve`d, case-insensitive compare on win32,
     trailing separators normalised.
  2. Five refusal rules, each with its own message: equal; nested either way; basename not ending
     `-loadtest`; target inside or containing the Ptah repo (resolved from `import.meta.url`);
     filesystem root.
  3. `MARKER = '.git/ptah-loadtest-clone.json'`; `writeMarker(target, { source, createdAt, worktrees })`;
     `readMarker(target)` validates shape by hand (string `source`, ISO `createdAt`, integer
     `worktrees`) and returns `null` on any mismatch or read/parse failure (the failure reason is
     reported by the caller's refusal message, not swallowed silently — cleanup prints
     "not a load-test clone").
  4. `--self-test` entry (only when run directly): assertions over every refusal rule including
     case variants and trailing separators, plus a valid pair; prints `self-test OK` and exits 0,
     else exits 1. Node built-ins only.

### Task 3.2: Setup script — COMPLETE

- Depends on: Task 3.1
- File: CREATE `W\scripts\perf\property-hub-loadtest-setup.mjs`
- Plan reference: implementation-plan.md:514-531; `S437/handoff.md:480-490`
- Acceptance criteria:
  1. Exactly one of `--dry-run` | `--execute` required (none → usage, exit 2); `--source`,
     `--target`, `--worktrees N` (integer 1-40, default 16, else exit 2), `--skip-install`.
  2. Steps in order: guards (source is a git work tree, target absent) → `git clone --no-hardlinks`
     (on failure remove the target only if this run created it) → marker → `git remote remove origin`
     → `npm ci` unless skipped (`npm.cmd` on win32, `spawn` with an args array, no shell string) →
     N × `git worktree add .claude-worktrees/loadtest-NN -b loadtest/NN` → print the manual
     procedure (B-E, 3 streaming tiles, `PTAH_PROFILE_ON_LAG_MS=500`, log paths, "do not run during
     a perf measurement").
  3. `--dry-run` prints every step and runs none (no clone, no marker, no spawn except the
     read-only `git rev-parse` source check); a missing source is reported and exits 1.
  4. First failed step exits non-zero naming the step and the child exit code, and says
     `run cleanup --execute` once the marker exists.

### Task 3.3: Cleanup script — COMPLETE

- Depends on: Task 3.1
- File: CREATE `W\scripts\perf\property-hub-loadtest-cleanup.mjs`
- Plan reference: implementation-plan.md:532-541
- Acceptance criteria:
  1. `--dry-run` | `--execute` (exactly one), `--target`.
  2. Guards, then refuse unless `readMarker` returns a valid marker ("not a load-test clone", exit 1).
  3. `git worktree list --porcelain` → `git worktree remove --force` for every non-main entry →
     `git worktree prune` → `fs.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })`
     → elapsed time. Dry run prints each and runs none.
  4. No code path deletes a path without a valid marker, under the source, or under the Ptah repo.

### Batch 3 verification

- N/A steps: 1, 2, 4 (no nx project owns `scripts/`; audit does not scan it). Step 3 is replaced by
  `npx eslint scripts/perf` (covered by `eslint.config.mjs:388-396`, `**/*.mjs`) — 0 errors.
  This is a single eslint process, not nx.
- `node --check` on the three files.
- `node scripts/perf/property-hub-loadtest-paths.mjs --self-test` → `self-test OK`, exit 0.
- `node scripts/perf/property-hub-loadtest-setup.mjs --dry-run` → plan printed, target not created
  (exit 0 if the source exists, exit 1 with `source missing` otherwise — report which).
- `node scripts/perf/property-hub-loadtest-setup.mjs --dry-run --target D:/projects/property-hub` → exit 1 (rule 1).
- `node scripts/perf/property-hub-loadtest-cleanup.mjs --dry-run --target D:/projects/property-hub` → exit 1.
- No-mode invocation of setup → exit 2.
- 5: prettier on the three files.
- `--execute` never run.
- Reviewers: logic (deletion safety, guard rules) + style; accepting verdicts

---

## Batch 4: PR prep — COMPLETE

- Recommended executor: team-leader (Mode 3) then orchestrator
- Execution mode: sequential
- Parallel group: none (after Batches 1-3 are COMPLETE)
- Tasks: 1 | Depends on: Batches 1, 2, 3

### Task 4.1: Final verification, carrier status, PR hand-off — COMPLETE

- Done by team-leader: Batches 1-3 COMPLETE with commits; `task.md` `status:` set to `in_review`;
  spec folder and b2 review files committed; branch pushed. PR not opened (orchestrator owns it).

#### Manual post-merge actions (user-owned)

1. Dispatch **Publish Electron** from `main` with `dry-run=true`. Expect: three build legs green,
   zero eSigner steps run, `release` job skipped, step summary `release_mode=dry-run`, artifacts
   kept 5 days. Record the run id in `S437/batches.md` Batch 10 D10. Never distribute its artifacts.
2. AC-10 boot evidence: start the app with `PTAH_PROFILE_ON_LAG_MS=1000` on an idle machine (no
   load test, no other perf run) and capture the boot lag log.
3. Load-test run (`scripts/perf/property-hub-loadtest-setup.mjs --execute`, then cleanup) stays
   manual.
4. Confirm the CI guard on the next human `chore/bump-<dep>` PR (CI runs) and the next bot bump PR
   (CI skips).

#### Follow-ups (not in this task)

- Runtime signal when `internalQuery.maxConcurrent <= 2`: background cap `limit - 1` leaves at
  most one background lane; surface a warning instead of silent starvation.
- Lane literal constants: lane strings are repeated as literals; hoist to shared constants.
- Naming asymmetry between the gate's background-cap naming and the settings key / `blockedBy`
  value; align in one rename pass.
- Optional: back-port the positive `release_mode` gating pattern to `publish-cli.yml` /
  `publish-extension.yml`; commit the Batch 2 structural assertion script as a CI lint step.

- Files: `W\.ptah\specs\TASK_2026_463_f13d\task.md` (`status:` line only), `batches.md`
- Acceptance criteria:
  1. Team-leader Mode 3: every batch COMPLETE with a commit SHA that resolves in
     `git log --oneline`; every listed file exists; every risk above has a resolution.
  2. The task spec folder (`task.md`, `context.md`, `implementation-plan.md`, `batches.md`, review
     files) is committed on the branch by team-leader (`docs(specs): ...` or the repo convention
     read from `git log --oneline -10`).
  3. `git status --short` in `W` is empty after the spec commit; no stray temp assertion scripts.
  4. Edit only `status:` in `task.md` → `in_review` when the PR is opened.
  5. Orchestrator opens the PR against `main` (never a release branch). PR body lists the
     user-owned follow-ups: the first `dry-run` dispatch of Publish Electron from `main` after
     merge (expected evidence per implementation-plan.md:483-488, run id goes to
     `S437/batches.md` Batch 10 D10), the load-test run (`--execute`), AC-10 boot evidence, and
     that the next human PR / bot bump PR confirm the CI guard.
