# Handoff — TASK_2026_306

**Written 2026-08-23, at the end of the work.** Twelve batches, all implemented,
reviewed and committed. **Nothing is pushed.** Branch: `ak/boot-blocker-quota-gate`.

If you are picking this up cold, read §1 and §2, then §7 for what is _not_ done.

---

## 1. What this task was

A dev `nx serve ptah-electron` reached full DI registration, opened and migrated
SQLite, registered all 362 RPC methods — and never created a `BrowserWindow`.

Two independent defects sat behind that, and seven more were found in the same log:

- **A — the boot blocker.** The activation chain awaited cron cold-start catchup,
  which ran every overdue job serially. `@ptah/skills-drain-frequent` alone took
  94 seconds. `createMainWindow` is called only after all of it returns. Structural:
  it fires for a healthy provider with a large backlog too.
- **B — the quota gate.** The developer was authenticated through the Codex OAuth
  translation proxy on an **exhausted** subscription. The proxy correctly answered
  429 with `rate_limit_error` and nothing consumed the signal, so an exhausted
  subscription was recorded as `kind: timeout` and every queued row paid a full
  `timeoutMs` to rediscover the same dead endpoint.
- **C–G** — a fully broken session importer, a workspace index aborting on one
  missing file, a boot double-init, and a harness summary reporting a per-target
  slice under all-target field names.

The task was then **widened twice** during the work:

- **R2** (2026-08-22) — the thirteen `.claude/skills` directories reconcile reports
  as `missing` while `writeFailed` stays `0`. Became Batches 6–9.
- **F1** (2026-08-22) — a material finding from the Batch 2 review: the quota gate
  made the curator discard the very episodes it was gated from processing. Became
  Batch 10, and it was ranked **ahead** of the R2 work because it was live data loss.

**The original complaint is fixed and was confirmed live**: the window opens.
`MainWindowTitle: Ptah - Coding Orchestra`, 30.6 minutes of uptime on a real run.

---

## 2. Git state

Branch `ak/boot-blocker-quota-gate`, **nothing pushed**, working tree clean.

| Commit      | Batch    | Subject                                    |
| ----------- | -------- | ------------------------------------------ |
| `ca183174d` | 2        | provider quota gate                        |
| `5c2090bdf` | 5        | harness health at one scope                |
| `5dfedc09c` | 10       | keep a stalled curation pass's input       |
| `e1851b34a` | 6        | explain the blocked shortfall              |
| `12cc37071` | 8        | consent-gated repair + quarantine          |
| `f03e0cfd0` | 7 + 11   | blocked-paths disclosure, panel and home   |
| `29f754070` | 12       | boot WARN names the card                   |
| `f505c652a` | 9 + 11.2 | consent dialog + the route into it         |
| `70ba25ff2` | —        | F1 follow-up: `repairBlocked` store guards |

Batches 1, 3 and 4 landed earlier on the branch. Docs commits: `d1a534fae`,
`df7a6ee55`, `c79cc5fb3`, `440f3e4a0`, `2d3e2b807`.

### Two commits on this branch that are NOT this task

- **`f40cc4e4f`** (`.do/app.yaml`) — **deliberate, by the user's decision.** It rides
  this branch on purpose. **Anyone splitting this into PRs needs to know it is there
  and that it is not an accident.**
- **`8358528ff`** — moved `typescript` from `devDependencies` to `dependencies` in
  `libs/backend/workspace-intelligence/package.json`. An unplanned prerequisite, not
  part of any batch: the pre-commit `nx affected --target=lint` widened to 29 projects
  once Batch 3 landed, and `@nx/dependency-checks` fails there because
  `TypeScriptDiagnosticsProvider` calls `require('typescript')` at runtime. Pre-existing
  on `main` and fails identically there. The team-leader refused `--no-verify`, which
  was right; the lib is `"private": true` and `typescript` was already in the generated
  `dist/apps/ptah-electron/package.json`.

---

## 3. What shipped

**Boot and background work**

- Cron cold-start catchup is fire-and-forget, matching the resume path. The window opens.
- A provider quota gate: `QuotaExhaustedError`, a 15-minute cooldown registry (in-process,
  evict-on-read, 6 h clamp), `'quota-exhausted'` classified TRANSPORT so rows requeue
  rather than being terminally marked. Quota failures are **exempt** from `maxAttempts`,
  matching `auth-unresolvable` — the reasoning is recorded in `batch-2-implementation.md` §5.
- The curator can now tell "the gate stopped me" from "I ran and found nothing"
  (`CuratorExtraction` is a discriminated union). A stalled pass keeps its rows
  `processed_at IS NULL`, restores its episode buffer, and leaves the boot-scan watermark
  where it is. Before this, every cooldown destroyed the episodes it was gated from reading.
- Session importer no longer discards every file on a truncated prefix; `initialize()` has
  an in-flight de-dup guard; the workspace index survives a per-entry `ENOENT`.

**The harness blocked-path story (R2)**

- `blockedTargetPaths` — `missing ∩ foreign`, **one definition**, in `libs/shared` beside
  `summarizeHarnessHealth`. Five call sites: the reconcile WARN, the repair service, the
  Marketplace popover, the Dashboard card, the consent dialog. No second intersection
  exists anywhere, and a spec compares two surfaces' counts _against each other_ so a
  duplicate would fail rather than merely violate a convention.
- A reconcile WARN naming each blocked path and its reason, `full` passes only, silent when
  the set is empty, summary line byte-unchanged.
- The disclosure on two surfaces: the Marketplace plugins popover and a Dashboard home card,
  so the shortfall is legible without opening a page the user may never visit.
- A consent-gated repair: move the occupant to `.claude/skills/.ptah-quarantine/<name>-<timestamp>`
  (same volume, atomic rename), prove the move landed, then one ordinary full pass. The write
  is the _reconciler's_, which makes "a failed move means no write at that path" structural.
  Nothing is ever deleted — even an obstruction during a restore is moved aside as
  `<name>.superseded-<timestamp>`. The quarantine is never scanned and **never cleaned up**;
  it is the undo.
- A consent dialog that opens with **nothing ticked**, sends no request at all on an empty
  confirm (guarded three times over), and cannot send a path outside the blocked set because
  the sent list is derived from the rendered rows rather than from the tick set.

**The finding that reframed R2, and which must not be rediscovered**

> `SkillJunctionService` **linked** skills and only **copied** commands. It never wrote the
> thirteen directories and could not have.
> `git e107e6f89^:libs/backend/agent-sdk/src/lib/helpers/skill-junction.service.ts:304-356`

So their provenance is **unknown** — the Claude Code SDK, the pre-TASK_2026_288
`npx skills add` path, or the user's own hand. **Content matching is not a valid ownership
proof** and must not be added as one: both non-Ptah install paths produce matching content by
construction. Consent is the only proof available. This is recorded in
`libs/backend/harness-sync/CLAUDE.md` precisely so a third investigation does not start from
the false premise the first two did.

---

## 4. How it was reviewed

Every batch got a team-leader MODE 2 review before commit, and **every review found something
real**. The pattern worth continuing:

- **Re-count the spec cases.** Nine batches were recounted independently; two early
  self-reported counts were wrong in opposite directions, both caught this way.
- **Ask what a mutation proves.** "Revert it and the module does not resolve" is a compile
  error, not behavioural discrimination — that claim was rejected on Batch 6 and withdrawn.
- **Read the whole diff for removed spec lines.** Every batch was checked for weakened
  assertions; none were found, and one rewrite (`resolves.toEqual([])` → asserts the
  discriminator) turned the task's worst assertion into its sharpest.

Batch 2 is the exception: it was committed before its review because the implementing agent
was killed mid-flight. The review was reconstructed post-hoc from the commit and is at
`batch-2-implementation.md` — it is labelled as such, and it is where F1 was found.

**A harness note for whoever runs the next session in this tree:** `git status` returned a
false "clean" twice during this work while `git diff --stat HEAD` showed 678 changed lines,
almost certainly an index race against concurrent agents and ~30 live worktrees.
**Verify with `git diff --stat HEAD`, not `git status`.**

---

## 5. Closing verification — the full suite, all twelve batches in the tree

**This is the first and only run with all twelve batches present simultaneously.** Every prior
run verified a batch against a tree that did not yet contain the others; nothing had checked
them together until this pass.

`nx run-many -t test --skip-nx-cache` across eleven projects, **0 failures**:

| Project                  | Suites   | Result                                   |
| ------------------------ | -------- | ---------------------------------------- |
| `rpc-handlers`           | 87       | 2423 passed, 31 skipped, 2454 total      |
| `skill-synthesis`        | 65 of 71 | 1324 passed, 37 skipped, 1361 total      |
| `shared`                 | 43       | 1101 passed                              |
| `agent-sdk`              | 74       | 1045 passed                              |
| `workspace-intelligence` | 36       | 896 passed                               |
| `task-specs`             | 16       | 440 passed, 23 skipped, 463 total        |
| `memory-curator`         | 22 of 25 | 354 passed, 57 skipped, 411 total        |
| `harness-sync`           | 36       | 275 passed                               |
| `marketplace`            | 10       | 162 passed                               |
| `cron-scheduler`         | 4        | 38 passed                                |
| `dashboard`              | 3        | 37 passed                                |
| **Total**                | **405**  | **8095 passed, 148 skipped, 8243 total** |

**Confirmed by two independent invocations**, both reporting
`Successfully ran target test for 11 projects` and exit code 0.

**`skill-synthesis` has held at exactly 1324 across all ten commits** — including Batch 10,
which touched `skill-trigger.service.ts`. That is the standing evidence for the review
judgement that the seam genuinely needed no new spec: the callback became `async` and returns
the literal `'ran'`, adding no branch and no condition, so a spec there would assert a
constant. The meaningful pin lives one level up in `boot-scan-runner.spec.ts`, which both
pipelines share. If you revisit that seam — particularly if the skills pipeline ever gains an
inline provider call there — this is the number to re-check, because a hardcoded `'ran'`
would silently inherit F1.

Two pre-existing warnings, neither attributable to this task and both deliberately left alone
in a closing pass: a worker-teardown warning ("a worker process has failed to exit
gracefully") in `skill-synthesis` and `rpc-handlers`, and an ESM load warning on
`libs/backend/rpc-handlers/jest.config.ts`.

---

## 6. Task-spec files

```
.ptah/specs/TASK_2026_306/
├── task.md                          # carrier — see §7 for the status value and why
├── context.md                       # intent, scope, codebase constraints, decisions
├── research-report.md               # the original defect inventory, §F corrected in place
├── r2-migration-plan.md             # the architect's A+D recommendation for R2
├── tasks.md                         # all 12 batches, final state, commit table at the top
├── HANDOFF.md                       # this file
├── batch-{1,3,4,5}-implementation.md
├── batch-2-implementation.md        # post-hoc review; F1 is §6, live evidence §8
├── batch-{6,7,8,9,10,11,12}-implementation.md
└── task-4-4-implementation.md
```

---

## 7. NOT DONE — read this before assuming the task is finished

### Two verifications are unclaimed. Neither is a batch, and neither can be scheduled.

1. **Batch 10's live cold start against a genuinely exhausted provider.** The before-picture
   exists: `tmp/logs/coldstart-306.log:1232-1260` shows fifteen skip-passes in a tight
   `findSessionsDirectory` → skip loop, draining and discarding episodes. The after-picture
   should show the same WARN lines with the episodes **still pending** and the boot scan
   stopping at the first stall. It needs a real quota-exhausted provider.
2. **Batch 8's manual repair walkthrough.** Blocked paths → consent → moved + written →
   `missing` reduced, `writeFailed` still `0`, quarantine populated and not reported
   `foreign`. It needs a workspace that genuinely has blocked paths.

Both are covered by specs. Neither has been seen working end to end on a real machine.

### Follow-ups, none blocking

| Item                                                              | Note                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No e2e on either disclosure surface**                           | No e2e spec references any harness identifier. A green e2e run means nothing moved — and equally would not catch either card disappearing.                                                                                                                             |
| **Blocked list uncapped on a scrolling home**                     | The popover bounds it with `max-h-[26rem] overflow-y-auto`; the Dashboard card sits in page flow. At 13 paths fine; at 500 it pushes every other card off the first screen.                                                                                            |
| **The two host boot lines still disagree on scope**               | `apps/ptah-extension-vscode/.../plugin-activation.ts:286-294` logs the bare claude slice under unqualified `expected`/`found` names while Electron now leads with the aggregate. Batch 5 made this strictly worse and Batch 12 deliberately declined to paper over it. |
| **The destructive-verb check is a denylist, not semantic**        | It covers delete/remove/erase/trash/rm over the whole WARN line. "purge", "wipe" and "drop" still pass. **The durable fix is an exact-match allowlist** on the action string — brittleness is the feature for a safety-critical instruction.                           |
| **`MemoryTriggerService` is 1088 raw lines**                      | Past the "deliberate look" threshold. It owns trigger wiring, episode buffer lifecycle, curate invocation, boot-scan mapping, coalescing and rate-limiting. `episode-tracker.ts` is the precedent for the next extraction.                                             |
| **The hourly rate-limit token is not refunded on a stalled pass** | `tryAcquire` fires before the curate and there is no refund API. Not data loss — the rows survive — but a long cooldown can eat the hourly budget so curation is throttled once quota returns.                                                                         |
| **F3-1**                                                          | A whitespace-only file under 8 KB reaches the filename fallback and produces the phantom `Session <date>` entry the sidecar guard exists to prevent. Gate on `bytesRead >= METADATA_PREFIX_BYTES`.                                                                     |
| **F3-2**                                                          | `initInFlight` is correct only by promise-reaction FIFO ordering; an identity check (`if (this.initInFlight === p)`) removes the dependence on scheduling.                                                                                                             |
| **F3-3**                                                          | Two concurrent `reset()` calls can have the second answered by the guard after `dispose()`.                                                                                                                                                                            |
| **R4**                                                            | One spec for `formatClaudeSlice` — a pure three-branch function; the `0/0` state was an acceptance criterion and a named edge case.                                                                                                                                    |
| **`EPERM`/`EBUSY` missing from `MISSING_ENTRY_CODES`**            | On Windows a file locked by another process usually surfaces as `EPERM`, so one locked file still aborts a whole index. **Note:** the quarantine/repair code does _not_ have this bug — it retries all four codes and fails per-path.                                  |
| **`onDidOpen` ordering is unenforced**                            | The fix silently no-ops unless the SQLite token is registered before `startTaskSpecsIndex`. Both hosts order correctly today; nothing enforces it.                                                                                                                     |

**Closed since the last handoff:** R1 (the blocked WARN, Batch 6.2), R2 (became Batches 6–9),
R3 (the WARN names the paths), and the `workspace-target.ts` NUL bytes — fixed in Batch 8
along with the same problem in `content-hash.ts`, which had been hiding two of the three
quarantine-exclusion sites from `grep`.

---

## 8. Carrier status

`task.md` is set to **`in_review`**, not `done`.

Every acceptance criterion has code and specs behind it, and the original complaint is fixed
and confirmed live. But two of this task's own verification steps — §6's live cold start and
the manual repair walkthrough — were written into the batch verification blocks and have not
been performed, and nothing is pushed. `done` would assert a completeness that the unclaimed
verifications do not support. Flip it to `done` once both are seen working, or once someone
decides they are not worth waiting for.
