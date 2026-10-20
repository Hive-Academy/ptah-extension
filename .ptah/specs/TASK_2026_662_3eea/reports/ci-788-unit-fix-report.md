# PR #788 shard 4 unit failures

## BackOfficeActivityService

- **Failure and root cause:** CI log `j118820269545.log:1462-1478` reports `notifications.recentNotices()[0]` as `undefined` at `back-office-activity.service.spec.ts:51`. The merge result retained main's synthesis failure notice assertion (`origin/main` spec lines 45-59), while the PR had removed `SKILL_SYNTHESIS_EVENT` from `handledMessageTypes` and `mapMessage` (`back-office-activity.service.ts:113-123,216-238` after this edit). The removed event can no longer create a ticker item or notice.
- **Branch caused it:** Yes, through an integration mismatch. `git log origin/main..HEAD` shows `788f75a97` removing the synthesis activity branch and `6838d2932` removing its event. Main later added notice projection in `7c10ebe4b`; the PR merge retained its obsolete synthesis test. `git diff origin/main...HEAD` showed only the earlier synthesis removals, which explains why the later main test escaped the branch diff.
- **Change:** In `libs/frontend/core/src/lib/services/back-office-activity.service.spec.ts`, removed the synthesis failure projection assertion and the synthesis pause portion of the progress notice test. Kept main's tests for embedder, indexing, and boot notices. In `libs/frontend/core/src/lib/services/back-office-activity.service.ts`, carried over main's notice projection for embedder, vec, indexing, and boot, excluding only the synthesis label and event branch. Before this edit, the branch lacked all of main's new notice projection; afterward, `git diff origin/main` for these files contains only synthesis-related removals and a harmless ring-capacity comment update. The activity ticker still maps the retained event types.
- **Evidence:** The approved removal is implementation-plan.md row 26 (line 186), which explicitly removes the core skill push branch and its fixtures; row 60 (line 220) removes the shared push event after all consumers are cut. This does not authorize removal of other notice projection.

## CliWorkspaceWatcher

- **Failure and root cause:** CI log `j118820269545.log:2991-3004` says the shared contract timed out after 5,000 ms waiting for the first sync file. It received a `nested` directory create event, but no `sync-1.txt` event. The test writes `.git` and then `sync-1.txt` before waiting (`run-workspace-watcher-contract.ts:270-282`), using a real forked host and `@parcel/watcher` (`cli-workspace-watcher.spec.ts:1-13`). This is consistent with real-filesystem event timing or event loss under load; the log does not establish a watcher logic regression.
- **Branch caused it:** No evidence of a branch change. `git log origin/main..HEAD` and `git diff origin/main...HEAD` are empty for `cli-workspace-watcher.ts`, its spec, and the shared contract. The task reports that main and other PR branches pass today. The same contract's event timeout defaults to 5,000 ms (`run-workspace-watcher-contract.ts:139`).
- **Change:** None, as required for an untouched watcher with a real-filesystem timing failure. The orchestrator can recheck it when the machine is free.

## Decisions

- Preserve the Skills Library and the activity ticker's retained inputs. Remove only the pipeline-only synthesis push expectation, per implementation-plan.md row 26 and row 60.
- Preserve main's unrelated notice projection rather than losing embedder, vec, indexing, or boot alerts during the PR merge.
- No `nx`, Jest, TypeScript, lint, build, e2e, or npm checks were run, per lane instruction. A read-only `git diff --check` found no whitespace errors; test verification remains with the orchestrator.
