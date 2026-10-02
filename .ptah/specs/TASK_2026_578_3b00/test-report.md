# Test Report - TASK_2026_578 (Mode 3: boot-time behaviour on a copy of real data)

## Scope

- User request: verify the destructive boot-time lifecycle behaviour (migration 0051, startup reconcile, one curator pass) against a COPY of the live Ptah database and skills root; check plan assumption A1 and review item M-2.
- Method: copied `~/.ptah/state/ptah.sqlite` (+ `-wal`, `-shm`) and `~/.ptah/skills` into `%TEMP%/task-578-qa/home/.ptah/`. A throwaway jest spec (untracked, deleted afterwards) built the production DI container (`registerSkillSynthesisServices`, same pattern as `skill-lifecycle.reachability.integration.spec.ts`) with `PTAH_DB path = sandbox copy`, `os.homedir()` mocked and `HOME`/`USERPROFILE` redirected into the sandbox, the real `sqlite-vec` extension loaded (`vecExtensionLoaded: true`), and a fake lane. The curator rate limit was set to refuse, so no LLM call was made (`laneCalls = 0`); reconcile, retirement and the backlog purge do not use it. Settings were the production defaults (retirement N/M = 30/30); only `enabled`, `curatorEnabled`, `curatorIntervalHours` were set.
- Deliberately not tested: umbrella LLM merge on real data (disabled by design of this run); accept/reject RPC paths; UI.

## Environment found

- Live DB: `~/.ptah/state/ptah.sqlite` (production profile, 793 MB, user_version 49 before; `ptah-dev.sqlite` is a separate 37 MB dev DB, not used). Skills root: `~/.ptah/skills` (2 active skills: `execute-phase-gated-task`, `extract-and-relocate-angular-component-feature`, plus `_candidates/` with 2,620 dirs).
- Driver: better-sqlite3. A live installed `Ptah.exe` was running during the QA.

## Results (numbers before -> after)

| Item | Before | After migration (a) | After reconcile (b) | After pass (c) |
|---|---|---|---|---|
| user_version | 49 | 51 | 51 | 51 |
| skill_candidates `candidate` | 585 | 585 | 585 | 554 |
| skill_candidates `rejected` | 1876 | 1876 | 1876 | 1907 (+31 `backlog-purge: unclustered >30d`) |
| skill_candidates `promoted` | 0 | 0 | 0 | 0 |
| skill_suggestions `pending` | 13 | 13 | 13 | 18 (+5 singleton suggestions surfaced) |
| skill_suggestions `accepted` | 2 | 2 | 2 | 2 |
| skill_suggestions `dismissed` | 2 | 2 | 2 | 2 |
| accepted suggestions adopted (`promoted_candidate_id` set) | n/a (column added by 0051) | 0 | 0 | 0 |
| skill_backlog_purge_state | absent | empty | empty | 1 row, `rejected = 31` |
| skills dormant / retired | - | - | - | 0 / 0 (no promoted rows exist) |
| directories under `skills/` (sandbox) | 3 | 3 | 3 | 3 (unchanged; none deleted) |

- Migration (a): applied cleanly 49 -> 51; no warnings.
- Reconcile (b): `{"adopted":0,"missing":1,"ambiguous":0,"blockedByCandidateRow":1,"failed":0}`.
  - `extract-and-relocate-angular-component-feature`: slug is held by a non-promoted candidate row (`01KWCJTHXM2WKEY9P71RM6Q1PW`, status `rejected`), so it is not adopted. The registry row is `synth` pointing at that rejected candidate.
  - `execute-phase-gated-task`: "no provable skill directory" (`reason: missing`). The directory exists but the registry row is `diverged`, so the body no longer matches the suggestion (the M-3 case).
- Pass (c): umbrella step rate-limited (by design), purge rejected 31 candidates (the 31 unclustered, >30 d orphans; marker written), 5 singleton suggestions surfaced, retirement dormant 0 / retired 0.
- Logged warnings/errors (total 2, both from the reconcile, both listed above). No errors.
- Side effects inside the sandbox only: SKILL.md migration markers written (migrated 0, skipped 2,622 and 2,620), embedding-backfill enqueued, one curator report.

## A1 and M-2 verdict on real data

- A1 does NOT hold as stated: neither of the 2 legacy accepted suggestions was adopted at its slug. Both are skipped fail-safe (one blocked by a rejected candidate row, one with a diverged/edited body), and will warn on every start (future-enhancements item 6 / M-3). The two live rows are exactly the shapes the reconcile cannot prove, so the "adopt" feature has no effect on this user's data.
- M-2 has no effect on this data: there are 0 promoted candidates, and since nothing was adopted the member merge never ran. 0 skill directories were removed, 0 rows outside the purge set changed. Only the 31 purge rejections, 5 new singleton suggestions and the migration columns changed.
- "Nothing outside synth rows is removed" holds: all directories and registry rows were identical after the run.

## Real-data safety check

- Real `~/.ptah/skills` (2,623 files): identical size and mtime before and after. No new file in the real `~/.ptah/curator-reports` (the QA report was written to the sandbox).
- Real `ptah.sqlite` and `ptah.sqlite-wal` changed mtime/size (db 793,616,384 -> 794,300,416 bytes). This is the installed `Ptah.exe`, which was running and writing to it (its WAL already advanced between my own `ls` calls before any test code existed; the DB checkpoint time of 05:51 precedes the 05:53 test run). The spec never opened the real path: the DB path, `os.homedir()` and the curator report path all resolved into the sandbox. This is an observation about the live app, not a defect of the change; the real files were never opened by the QA run for write.

## Execution

- Command: `npx nx test skill-synthesis --testFile=qa-real-data.tmp.spec.ts --skip-nx-cache --maxWorkers=2` (HOME/USERPROFILE redirected). Result: 1 passed, 0 failed. (Nx printed an unrelated "DB transaction error" from its own cache DB after the run.)
- Throwaway spec and sandbox were removed afterwards; nothing committed; no production code edited.

## Verdict

- Safe to ship: yes. On this real data the boot path destroys nothing, the migration applies, and the purge removed only 31 old unclustered candidates.
- Blocking the PR: nothing found. Notes for the PR description:
  1. Neither live accepted suggestion is adopted (rejected-candidate-held slug; diverged body) and each warns at every start. Consider the P2 relaxed-proof item, or a one-time warn.
  2. First pass after upgrade will reject about 31 candidates (5% of the pool) via the backlog purge, and surface singleton suggestions.
  3. M-2 (promoted member directory removal at boot) is unexercised by real data (0 promoted rows); its risk remains covered only by specs.
  4. The umbrella LLM step was not run on real data.

## Re-run after Batch 15

Same method as above, at commit 89c224300 (Batch 15 = 9978b040e): fresh copy of `ptah.sqlite` + `-wal` + `-shm` and `~/.ptah/skills` in `%TEMP%/task-578-qa/`, HOME/USERPROFILE and `os.homedir()` redirected, fake lane (`laneCalls = 0`), umbrella step off (rate limit refuses), one real-defaults curator pass after the reconcile. Command: `npx nx test skill-synthesis --testFile=qa-real-data.tmp.spec.ts --skip-nx-cache --maxWorkers=2` (1 passed).

- Reconcile result: `{"adopted":2,"missing":0,"ambiguous":0,"blockedByCandidateRow":0,"failed":0}`. Both legacy suggestions are adopted; A1 now holds on this data.
- `extract-and-relocate-angular-component-feature`: path `repromote-rejected`, proof `body-match`. Its previously rejected candidate row `01KWCJTHXM2WKEY9P71RM6Q1PW` is promoted: status `promoted`, residency `resident`, not pinned, `rejected_reason` NULL, description "Extract a UI feature ... encapsulation." (non-empty, the suggestion's description). All judge_* columns (score, status, reason, the five criteria, panel rationales) are NULL (cleared). Suggestion `promoted_candidate_id` = `01KWCJTHXM2WKEY9P71RM6Q1PW`. Registry: `synth`, `candidate_id` `01KWCJ...`, unchanged.
- `execute-phase-gated-task`: path `new-row`, proof `diverged`. New promoted row `01M3XC11BJYKKS8B6KE28K8B6M`: status `promoted`, residency `resident`, not pinned, description "Execute a complex, multi-phase project ... mixed in commits.", all judge_* columns NULL. Suggestion `promoted_candidate_id` = `01M3XC11BJYKKS8B6KE28K8B6M`. Registry: `clone_status` stays `diverged` (diverged flag 1), `candidate_id` now `01M3XC11...` (was NULL).
- M-2 (member merge): 0 directories removed. `skills/` holds the same 3 entries (`_candidates`, `execute-phase-gated-task`, `extract-and-relocate-angular-component-feature`) before, after the reconcile and after the pass. No candidate was rejected `merged-into:` (0 rows); the suggestions' member candidates were left as they were (rejected counts: 1876 -> 1875 only because the repromoted row left `rejected`).
- `getStats()`:

| Moment | candidates | promoted | active | dormant | retired | rejected |
|---|---|---|---|---|---|---|
| Before (after migration) | 585 | 0 | 0 | 0 | 0 | 1876 |
| After reconcile | 585 | 2 | 2 | 0 | 0 | 1875 |
| After one curator pass | 554 | 2 | 2 | 0 | 0 | 1906 |

- Retirement: the pass right after the reconcile left both adopted skills `promoted` / `resident` (dormant 0, retired 0, curator report "Turned dormant: 0, Retired: 0"). The same purge as before ran (31 candidates rejected, 5 singleton suggestions, pending 13 -> 18).
- Logs: no errors. Only warnings were `[SQLite] slow statement` (6, 150 ms to 2.5 s each, on the 793 MB copy; cold-cache queries on `skill_candidates_vec`, `skill_invocation_events`, `getStats`). No reconcile warnings now.
- Real home: `~/.ptah/skills` is identical in size and mtime before and after (diff of all file stats clean); no new file in the real `~/.ptah/curator-reports`. The real DB was never opened by the run (the running `Ptah.exe` keeps writing to it independently).
- Cleanup: throwaway spec and sandbox deleted; nothing committed.
- Blocks the PR: no. Only observation for the PR text: the slow-statement warnings on a large DB.
