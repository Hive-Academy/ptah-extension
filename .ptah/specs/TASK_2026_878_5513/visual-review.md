# Visual / E2E Review - TASK_2026_878_5513 (PR #957)

**Verdict: PASS WITH ISSUES.** All four surfaces report honestly after the change. The same flows were silent before it. Failure sentences and the running states were not reached (see "Not verified").

## Method

- Real Electron app, real handlers, no RPC mocks. Driver: Playwright `connectOverCDP` to the app launched with `--remote-debugging-port`. Scripts are in `/var/tmp/b878/visual/*.mjs`. They were not added to the repo, so the optional `memory-skills.shot.ts` was not created.
- AFTER: worktree `memory-skills-dead-actions` at 875301d69. I rebuilt it with `build-dev` + `copy-renderer-dev` under the verify lock.
- BEFORE: detached worktree `/home/amun/ptah-extension/.claude-worktrees/memory-skills-base` at 6638ed29c, also rebuilt. **I left it in place.** Its `node_modules` is a symlink to the shared one.
- Isolation: each variant used a throwaway DB (`/var/tmp/b878/visual/{before,after}.sqlite`), `HOME=/var/tmp/b878/visual/home-<v>`, a throwaway `--user-data-dir` and its own workspace copy. Nothing under `~/.ptah` was opened.
  - `home-<v>/.claude/.credentials.json` is a symlink to the user's real file, so the Claude CLI login is reachable. No secret was copied into a file, screenshot or report.
- No `rebuild-native` was needed. Viewport 1500x960. Dark is the default `ptah-glass` theme.
- Light theme was produced by setting `data-theme="light"` and `data-theme-mode` on `<html>`. It was not switched through the Settings picker, so light shots may differ from a true theme switch (see defect 6).
- Branch base caveat: `git diff 6638ed29c..875301d69` is about 710 files, because main-merge content is in range. BEFORE vs AFTER therefore includes unrelated changes. The behaviour deltas below are confined to the four surfaces.

## Seeded data

- Sample workspace `/var/tmp/b878/visual/sample-ws`: git repo with `src/{pricing,plans,server}.ts`. AFTER used it directly. BEFORE used `sample-ws-before`, a copy of a pristine snapshot with the harvest markers removed.
- `.ptah/specs`:
  - TASK_2026_001: `code-logic-review` APPROVED 8/10.
  - TASK_2026_002: `code-logic-review` REVISE 5/10, plus `code-style-review` APPROVED 7/10 (older mtime).
  - TASK_2026_003: `code-logic-review-phase-a` APPROVED 9/10 (older) and `-phase-b` REVISE 4/10 (newer).
  - TASK_2026_004: `code-logic-review` APPROVED 8/10, plus the document reviews `task-description-review` REVISE 3/10 and `design-spec-review` APPROVED 9/10.
  - TASK_2026_005: no `task.md`.
  - 001 to 004 each have a `task.md` with `status: done`.
  - Verdicts are written as `## Verdict` followed by `**APPROVED — 8/10**`. See defect 5.
- Direct SQL: 4 `skill_invocation_events` rows (`sample-skill`, task_id 001 to 004, unreconciled) in each DB. This is the only way to give harvest something to reconcile.
- Real LLM calls: Claude CLI (subscription login), model **Haiku**.
  - AFTER: 6 chat turns (2, then 4). BEFORE: 5 chat turns.
  - The curator also ran on those sessions. I cannot give an exact curator call count, because the app triggers it automatically. In AFTER, Recall went to 3 memories, so the model was invoked.
  - My first batch of 4 turns in AFTER never sent, because the textarea was hidden on the Thoth view. I re-ran it after switching to Chat.

## Per-surface results

Screenshot names are in `.ptah/specs/TASK_2026_878_5513/visual/`, as `<surface>-<state>-<before|after>-<dark|light>.png`.

| Surface | BEFORE (6638ed29c) | AFTER (875301d69) | Screenshots |
|---|---|---|---|
| 1. Run curator now (Memory > Maintenance) | Click gave nothing: no status element (count 0), no busy state. The only trace was "Last curator run ... · extracted=0, merged=0, created=0", which is raw key=value text. | Result line `Ran · nothing new to learn · 6:38 PM` (`manual-run-status`, `role=status`). The "Last curator run" line uses the same wording. `aria-busy` was false by the first poll because the run is sub-second here, so the spinner was never caught. | curator-{idle,running,result}-{before,after}; the running shots are dark only |
| 2. Code index Re-index / Index now | The workspace section jumped from "not indexed" to "Indexed. Last updated just now." No last-run line, and the progress state was not observed in a 400 ms poll. | Progress state seen (`Indexing workspace… 0% — preparing…`, Pause/Cancel). It then shows `Indexed · Last manual run just now: 3 files, 5 symbols, 0 errors, 2s`. | index-{idle,running,result}-{before,after}-{dark,light} |
| 3. Harvest now (Skills > Orchestration specs) | No message at all after the click. Counts line only (`4 specs, 0 stale`). Events stayed unreconciled. | `Last run 6:48 PM: 4 tasks scanned, 4 harvested, 4 skill runs reconciled. 1 folder skipped (no task.md)`. DB check: 001 succeeded=1, 002 succeeded=0, 003 succeeded=0 (latest phase-b REVISE wins), 004 succeeded=1. 004's REVISE `task-description-review` was ignored, so document reviews do not grade work. | harvest-{idle,running,result}-{before,after}-{dark,light} |
| 4. Curator provider picker (Settings > Providers > Background Model Roles) | The Provider select offers **OpenAI Codex**. | Codex is **absent**: Active provider (default), OpenRouter, Kimi Code, Z.AI, GitHub Copilot, Ollama, Ollama Cloud, LM Studio, Claude (Subscription), Sakana, Requesty, OpenCode Zen, OpenCode Go, anthropic. | settings-curator-picker-{before,after}-{dark,light} |
| Memory index "Rebuild" | Button "Rebuild index". Click gave no feedback (no busy state, no result). | Button "Rebuild memory search index". Result `Memory search index rebuilt (full-text: yes, vectors: yes)` (`memory-rebuild-result`). | rebuild-{idle,running,result}-{before,after} |

**Evidence limits.** Surface 2: the BEFORE reading could be a fast completion rather than "no UI". The absence of any last-run line is what matters. Surface 3: BEFORE harvest may have run silently. The visible fact is that no result was shown. I did not read the BEFORE DB for grades (the `skill_task_grades` table is empty in both runs; see defect 5).

## Defects and observations

1. **Fast manual runs never show a running state.** Curator, harvest and rebuild finished in under 500 ms to 1 s, so the spinner or `aria-busy` was never observed. Not a bug, but the running state is not verified. Evidence: `curator-running-after-dark.png` already shows the idle button.
2. **"Last curated" text collides with the clock icon.** In the stat card at 1500 px, `11/6/2026, 6:42:26 PM` runs under the clock icon. Screenshot: `index-result-after-dark.png`. File not located (stat-card template in the memory-curator-ui lib).
3. **"Idle timer" number input clips its value.** It shows `60000C` for 600000 in the Triggers card. Screenshot: `probe-maint.png` (not kept in the deliverable folder; the layout is visible in `curator-idle-after-dark.png`).
4. **Curator popover is cramped.** The Model select reads `Default (active provide…` (truncated), and the popover overlaps the section header. Screenshot: `settings-curator-picker-after-dark.png`. "No models available from this provider" is shown for Claude (Subscription). That is honest, but the user has no model to choose.
5. **Review verdict format is not parsed.** The harvester (`libs/backend/skill-synthesis/src/lib/spec-extractor.ts`, `parseReviewVerdict`, about lines 139-146) accepts `Verdict: X` or a `## Verdict` heading followed by a value. A bare `**APPROVED — 8/10**` line with no label is not recognised, and my first harvest therefore reconciled 0 runs. Whether agent-written reviews use the recognised forms was not checked. Also `skill_task_grades` stayed empty in both runs, because grading needs lane attributions I did not seed. That path is unverified end to end.
6. **Light theme: toggles may render as hollow pills.** The Skills and Skill telemetry switches were hollow outlines (`harvest-result-after-light.png`). I forced the theme by attribute, so I cannot say whether this is real. Confirm via Settings > Themes. The light shots otherwise looked sound, with no contrast failures noticed by eye. I did not measure contrast ratios or tab order.
7. **Sidebar and stat counts disagree.** `Memory 0 facts / All curated` sits next to `Recall 3` and `3 queued for curation` (`harvest-result-after-light.png`, `index-result-after-dark.png`). Possibly stale stat refresh after the curator created memories.
8. **"Workspace not indexed yet" can show beside an existing index.** On the AFTER first load the Code index stat was 5 and the workspace card said "not indexed yet". It is the same in BEFORE, so not a regression.
9. **Repeated `embedder-download` events** (10+) appear in Diagnostics "Recent events" on the fresh home. This looks like noise from the throwaway `~/.ptah/models`, but I did not confirm.

## Not verified

- Failure wording ("Indexing failed. See the logs.", curator stalled / refused / no-provider sentences, purge toolbar error). I could not provoke a failure without editing product code or breaking auth, so there are no failure screenshots.
- Running states for curator, harvest and rebuild (see defect 1). The indexing running state was seen.
- Whether the curator called Haiku on a manual click (both manual results said "nothing new"). The 3 Recall memories show the automatic runs did.
- Contrast ratios, focus order and keyboard behaviour (only visual inspection).
- Purge. Success or error text was not exercised.

## Cleanup

- Electron processes I started (after and before) were stopped.
- The BEFORE worktree was left in place at `/home/amun/ptah-extension/.claude-worktrees/memory-skills-base`.
- Throwaway data stays under `/var/tmp/b878/visual/`.
- No product source was edited. The only repo files added are the screenshots and this report.

## Coordinator triage (main session)
Spot-checked harvest-result-after-dark, index-result-after-dark, settings-curator-picker-after/before-dark: the claims match.
- Defect 1 (sub-second runs, no spinner caught): the running states are covered by unit tests
  (memory-diagnostics-state, skill-synthesis-state, workspace-indexing specs). No change.
- Defects 2, 3, 4, 6, 7, 8: NOT introduced by this branch. The "Last curated" strip
  (memory-stats-strip.component.ts) and the sidebar tile (dashboard thoth-status.service.ts)
  are unchanged; the idle-timer input and the picker truncation/"No models available" text are
  in unchanged parts of changed files, and the picker looks identical on the base commit.
  Reported as follow-ups.
- Defect 5 (bare `**APPROVED — 8/10**` line without a `## Verdict` heading or `Verdict:` label
  is not parsed): the review files this workflow writes use `## Verdict` + a bold line, which
  is parsed (verified by the harvest result). Accepting bare bold lines is a product decision;
  reported as a follow-up.
- Screenshots (47 PNG, 35 MB) are kept locally in visual/ and not committed.
