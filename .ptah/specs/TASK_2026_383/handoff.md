# TASK_2026_383 — Session handoff (2026-09-07)

Read this first in a new session. Then read `batches.md` for the per-batch
records and `context.md` for the original intent.

## Where the work lives

| Item                    | Value                                                                           |
| ----------------------- | ------------------------------------------------------------------------------- |
| Worktree                | `D:\projects\ptah-extension\.claude-worktrees\task-383`                         |
| Branch                  | `task/383-degradation-audit`                                                    |
| Base branch             | `electron-cold-start-380` (PR #463, **not merged**)                             |
| Task folder (canonical) | `D:\projects\ptah-extension\.ptah\specs\TASK_2026_383\` (main worktree, staged) |
| Task folder (mirror)    | same path under the task-383 worktree, untracked                                |
| Task status             | `in_progress`                                                                   |

The main worktree is on branch `fix/empty-assistant-bubbles`. Do not commit the
task folder from there. It is staged for a later docs commit.

## Commits on the branch (oldest first)

| Commit      | Batch | Summary                                                          |
| ----------- | ----- | ---------------------------------------------------------------- |
| `00e5464c0` | 1     | `DegradationEvent` contract + `DegradationReporter` port         |
| `52fe10711` | 3     | `tools/degradation-audit` ratchet + self-test                    |
| `7319d02cd` | 2     | Report the swallowed startup boot, boot summary line             |
| `56d708910` | 4     | ESM bundle gate per host, fail-not-skip                          |
| `39aba3486` | 5     | Classify degradation sites, six libraries                        |
| `a5f4f945f` | 6     | Integrity worker `backup` command                                |
| `52e8d9f39` | 7     | `SqliteBackupService` runs the copy out of process               |
| `bbaaf98a4` | 8     | Every call site uses `backup(kind)`, daily-backup guard fixed    |
| `096c1719f` | 12.1  | Classify four contested dirs, baseline 421 → 312                 |
| `96f20674d` | 12.3  | Docs: degradation contract, marker convention, `nx reset` gotcha |

## Track status

- **Track A (audit instruments)**: complete. Batches 1 to 5.
- **Track B (backup off main thread, 380 HIGH #1)**: complete. Batches 6 to 8.
- **Track C (post-boot RPC jank, 380 HIGH #2)**: **blocked** on Batch 9.
- **Batch 12**: 12.1 and 12.3 done. 12.2 and the final verification wait on Track C.

## The blocker: Batch 9 cold re-measurement

### What we measure

After the first RPC, five handlers run together on the main process. Each one
takes 2 to 4 s. Lag spikes reach 1074 ms across about 14 s. Target: no spike
above 500 ms (380 criterion 2).

| Handler               | 380 measurement |
| --------------------- | --------------- |
| `autocomplete:agents` | 4095 ms         |
| `git:info`            | 2476 ms         |
| `config:models-list`  | 2296 ms         |
| `session:list`        | 2291 ms         |
| `auth:getAuthStatus`  | 2244 ms         |

Cause: subprocess spawns (`claude.exe`, `codex.cmd`) and model-list calls.

### Why we measure before we fix

380 set the rule: re-run cold before you design the fix. If the numbers move
more than 30 percent, re-select the remedies. Batches 10 and 11 may not be
assigned until the Batch 9 table is in the task folder.

### How to run it

Preconditions:

1. Quiet machine. Close every other Claude session and every Ptah instance,
   including a dev instance. Two runs failed from foreign `node.exe` CPU load.
2. Fresh build in the worktree:
   `npx nx build-dev ptah-electron && npx nx copy-renderer-dev ptah-electron`.
3. A temp copy of a real large database. Never open
   `~/.ptah/state/ptah.sqlite` directly. Copy it, then pass the copy.

Command (from the worktree root):

```
node apps/ptah-electron-e2e/scripts/measure-boot-rpcs.mjs --db=<temp copy> --seconds=90 --keep-db
```

The script launches its own Electron from `dist` with `NODE_ENV=production`
and kills it by PID. A dev instance from `npm run electron:serve` cannot be
measured this way, and `ptah-dev.sqlite` is too small to show the problem.

Also in Batch 9: time `PRAGMA optimize` in isolation (item A-2). Fill the A-2
line in `future-enhancements.md` with the result.

### Alternative

The user may decide to skip the gate. Then ship Batches 10 and 11 on the
structural analysis alone and record that decision in `batches.md`.

## Next steps in order

1. Run Batch 9 (above). Write the table into `test-report.md` and `batches.md`.
2. Batches 10 and 11 (Track C remedies, see `implementation-plan.md`):
   delete the eager agent preload, drop the constructor `loadModels()`,
   coalesce `session:list`, persist the SDK model catalog and CLI health across
   boots, route `git:info` via `IProcessSpawner`. Re-select if Batch 9 moved
   more than 30 percent.
3. Task 12.2: after-measurement, before/after tables into `test-report.md`,
   assert zero degradation events on a healthy boot.
4. Batch 12 final verification: audit self-test, `run-many` test/lint/typecheck
   on the touched projects, affected typecheck and build. Read the
   `Running target test for N projects` header and check N.
5. Final commit. Set `task.md` `status:` to `in_review`.
6. After PR #463 merges: rebase `task/383-degradation-audit` onto `main`, then
   open the 383 PR against `main`.

## Standing rules for this task

- Never open `~/.ptah/state/ptah.sqlite`. Copy to temp, pass via `--db=` or `PTAH_DB_PATH`.
- Never `taskkill /IM electron.exe`. PID-scoped kills only.
- Never bypass git hooks. Never amend. Stage by explicit path.
- Never `nx test a b c`. Use `npx nx run-many -t test -p a b c`.
- No `nx reset` while other executors run in the worktree.
- Do not touch `no-restricted-syntax` in `eslint.config.mjs`.
- commitlint: `scope-enum` has no `audit` or `tools`. Use `chore(ci)`,
  `build(ci)`, `docs(docs)`. Subject max 72 chars.
- The pre-commit hook runs `nx format:write` on staged files. It can add
  whitespace-only changes to a comment-only commit. Record that in `batches.md`.
- Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Known pre-existing flakiness

- `skills-sh-legacy-adoption.spec.ts` and `voice-rpc.handlers.spec.ts` time out
  under parallel load. They pass in isolation. Filed in `future-enhancements.md`.
- `cli-engine` specs log `migrationRunner.runMigrations is not a function` from
  `with-engine.ts:292`. Pre-existing fake gap, filed.
- `realbinary` and integration native specs self-skip locally (Electron ABI 143
  vs Node 137). CI rebuilds.

## Untracked files in the worktree

- `.ptah/specs/TASK_2026_383/` mirror. Leave it.
- `npm-ci.log`. Leave it. Do not stage it.
