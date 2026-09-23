# PR #582 round 3 (7 new CodeRabbit comments + CI fix): cross-side review

## Verdict: REVISE

The CI fix and 3 of the antigravity lane's comments are closed in the plugin source and the template. All four GLM-lane comments are pending re-apply: a concurrent restore removed the lane's edits (R1). The orchestrator has confirmed this and the GLM session is re-applying them; they will be rechecked when they land. The antigravity lane's new UI-evidence exemption was added in two places but not carried to the five other places that still require an approved prototype for every UI task (R2).

## Review state

| Field | Value |
| --- | --- |
| Authors | Antigravity lane (CI, 4086482665, 4086482668, 4086482673). GLM lane (4086482638, 4086482645, 4086482653, 4086482661). Orchestrator: mirror to `.claude/skills`, 3-way merge into `.claude/agents/team-leader.md`, and regeneration of the `.codex`/`.opencode` team-leader copies with the harness-sync transformers. |
| Reviewer | In-process subagent (opposite side from the CLI lanes) |
| Reviewed revision | Current working tree of `docs/skills-design-gate-parity` (uncommitted, on `615c91f9c`) |
| Completed revise rounds | 0 |

`P` = `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills`. `TL` = `libs/backend/agent-generation/templates/agents/team-leader.template.md`.

## Mechanical checks

| Check | Result |
| --- | --- |
| `diff -rq` of `P/{agent-lanes,orchestration,ui-ux-designer,tribunal}` against `.claude/skills/*`, ignoring files that exist only in `.claude` | Identical |
| TL additions in `.claude/agents/team-leader.md`, `.opencode/agent/team-leader.md` and `.codex/agents/team-leader.toml` (escaped) | 19/19 added lines present in all three |
| Python `tomllib` over `.codex/agents/*.toml` | 15/15 parse |
| `npm run -s manifest:check` | Up to date (`sha256:a6afb6c3…`, 225 files) |
| CR bytes in changed files and the round-3 reports | None |
| `git diff --check` | Clean |
| The 6 `lane-rule-single-home.spec.ts` patterns, run by hand over `P/{agent-lanes,orchestration,tribunal}` and the `.claude` mirrors | The home (`P/agent-lanes/SKILL.md`) matches all 6; no other file matches any |
| `NX_DAEMON=false npx nx run-many -t test -p vscode-lm-tools agent-generation --skip-nx-cache` | `Successfully ran target test for 2 projects` (exit 0) |

## Comment status

| Comment / item | Status | Evidence |
| --- | --- | --- |
| CI: `lane-rule-single-home.spec.ts` | Closed | `P/agent-lanes/SKILL.md:171` now says "at most 2 revise rounds" (the home teaches the revise cap). `P/orchestration/references/strategies.md:41,51,64,128,160,214,221,290,302` now say "bounded revision per agent-lanes §6". A manual pattern run finds no offender. |
| 4086482665: UI BUGFIX with no redesign | Partly closed. See R2. | `P/orchestration/SKILL.md:42` and `TL:316-318` allow before/after dark and light screenshots instead of a prototype. Other places still require the approved prototype for every UI task. |
| 4086482668: BUGFIX batch template and executor prompt | Closed (orchestrator-side follow-up in R3) | `TL:194` and `TL:196` (plan reference and quality source for BUGFIX: `task.md`, `context.md`, `research-report.md`, the reproduction). `TL:408-410` (executor prompt). The "plan validation section" at `:410` and `:413` refers to `batches.md` `## Plan validation` (`TL:167`), which exists for BUGFIX, so the reference is valid. |
| 4086482673: inventory completeness against the old surface | Closed | `TL:302-305`: Mode 3 first compares the inventory or preserve list against the OLD surface at the base commit (routes, commands, RPC calls, user-facing actions); a capability found there but absent from the list blocks; row checks run only after that. Present in all three rendered copies. |
| 4086482638: `agent_id` declared twice | **Pending re-apply (R1)** | `.ptah/specs/TASK_2026_535/task.md:45-46` still reads "`run_id` (primary key; `agent_id` nullable and indexed),\n  agent_id, …". |
| 4086482645: HTTPS-only TypeSafe endpoint | **Pending re-apply (R1)** | `.ptah/specs/TASK_2026_537/task.md:47-49` has no `https:` requirement. |
| 4086482653: per-flag holdout ship criteria | **Pending re-apply (R1)** | `TASK_2026_537/task.md:69-71` still says "the gate thresholds ship only with a passing holdout eval". |
| 4086482661: delete the legacy Cursor setting even when a secret exists; #581 merged | **Pending re-apply (R1)** | `.ptah/specs/TASK_2026_538/task.md:32-34` still deletes the plain setting only on the "no secret exists" path. `:19-21` still says "PR #581 (still open) … must be based on its branch", but `gh pr view 581` shows it `MERGED` at 2026-09-23T19:44:30Z into `main`. |

## Consistency with earlier rounds

- **The BUGFIX plan-free rule holds in the lane-owned files.** `P/orchestration/references/team-leader-modes.md:14,41-43,56`, the `TL:64-68`, `:93-104` and `:194-196` paths and the new executor prompt at `:408-410`, and the continuation rows at `P/orchestration/references/task-tracking.md:146,148,149` all agree. The one gap is on the orchestrator side (R3).
- **The UI-evidence rule is inconsistent (R2).** The exemption exists only at `P/orchestration/SKILL.md:42` and `TL:316-318`.
- **No lane rule is restated outside agent-lanes, by the spec's patterns.** See the advisory for one restatement the patterns do not catch.

## Defects

1. **R1 (pending re-apply, GLM lane): none of the GLM lane's edits are in the working tree.**
   - **Status.** The orchestrator confirmed a single concurrent restore to HEAD during the antigravity run. The GLM session is re-applying the edits and adding an agent-lanes §3 item 7 rule that forbids git commands which discard working-tree changes. This review does not score these four comments as failed; they are rechecked when the re-apply lands.
   - **Problem.** `git status` shows no change to `.ptah/specs/TASK_2026_535/task.md`, `TASK_2026_537/task.md` or `TASK_2026_538/task.md` against HEAD `615c91f9c`. All three files have the same modification time, 22:50:14. That is after the GLM report (`pr-582-round3-lane-glm-report.md`, 22:47:15) and before the antigravity report (22:51:04), so something restored them to the committed content after the GLM lane wrote them. `git log --all -S "nullable, indexed"` finds nothing, and the edits are not in any other checkout. The GLM report's `file:line` claims do not match the files.
   - **Fix.** Re-apply the GLM changes and confirm with `git diff -- .ptah/specs`:
     - **(a) `TASK_2026_535/task.md:45-46`:** "`run_id` (primary key), agent_id (nullable, indexed), parent_session_id, …". `agent_id` appears once.
     - **(b) `TASK_2026_537/task.md:47-49`:** add "The configured endpoint must use `https:`; reject any other scheme before attaching the key." Add an Acceptance bullet: "a non-`https:` endpoint is rejected without sending the key".
     - **(c) `TASK_2026_537/task.md:69-71`:** replace "passing holdout eval" with per-flag holdout criteria for `replacesExistingSurface`, `touchesUiSurface` and `changesPersistedSettings`: a maximum false-negative rate (a recall floor) and a calibration bound (for example ECE), with exact numbers fixed at the research gate. No threshold ships until every gate-driving flag meets them.
     - **(d) `TASK_2026_538/task.md:32-34`:** "If a secret exists, keep it; otherwise copy the plain value into the secret store. In both cases delete the plain setting." Add a test for the case where both exist.
     - **(e) `TASK_2026_538/task.md:19-21`:** "The log leak is fixed in PR #581 (merged to `main`)". Base the task on `main`, and keep `depends_on: [TASK_2026_534]`.
   - The recheck will also cover the new agent-lanes §3 item 7 rule: the `agent-lanes/SKILL.md` line count (at or under 230), the `.claude` mirror, the manifest, and whether any lane-rule pattern now appears outside the home.

2. **R2 (blocking, antigravity lane): the UI BUGFIX evidence exemption is missing from five places that still require an approved prototype.**
   - **Problem.** A UI bug fix that adds or redesigns nothing has no `prototype/`, yet these places still require one:
     - `P/orchestration/references/team-leader-modes.md:34-35`: "UI batches require visual-reviewer screenshots in dark + light themes against the approved `<taskFolder>/prototype/`"
     - `P/agent-lanes/SKILL.md:152`: the UI row says "compared with the approved prototype"
     - `P/orchestration/references/checkpoints.md:452-453`: "required UI evidence against the approved prototype"
     - `TL:387`: the `TASK COMPLETE` return requires "visual-reviewer evidence against the approved prototype (for UI tasks)"
     - `TL:456-457`: the refusal says "rendered visual evidence against the approved prototype across dark and light themes is mandatory"

     Mode 3, the orchestrator's completion checks, and the agent-lanes verification row therefore still block such a fix, which was the problem comment 4086482665 raised. The new rule also never says when the "before" screenshots are taken, and they cannot be taken after the fix lands.
   - **Fix.** In each place, change "against the approved prototype" to "against the approved prototype, or — for a UI change with no added/redesigned surface and so no prototype — before/after screenshots (dark + light) of the affected screen". At `P/orchestration/SKILL.md:42` and `TL:316-318`, add: "capture the before screenshots from the base commit (or before the first batch) with the visual-reviewer". Mirror to `.claude/skills` and regenerate the agent copies.
   - `agent-lanes/SKILL.md:152` is the lane-rule home, so it may be edited. Keep it at or under 230 lines.

3. **R3 (minor, antigravity lane; orchestrator-side counterpart of 4086482668): agent-catalog still passes a plan to BUGFIX executors and reviewers.**
   - **Problem.** `P/orchestration/references/agent-catalog.md:84` (backend-developer and frontend-developer), `:86` (senior-tester) and `:88` (code-logic-reviewer) still pass `**Plan**: implementation-plan.md`, which a plan-free BUGFIX does not have.
   - **Fix.** Change each to "`**Plan**: implementation-plan.md` (BUGFIX: `task.md`, `context.md`, `research-report.md` when present)". Mirror to `.claude/skills`.

## Advisory (not a defect)

- `P/orchestration/references/checkpoints.md:38-39` ("At most two automatic rounds per artifact") and `:43` ("after round 2") still state the revise-cap number outside agent-lanes. The spec's regex does not match this wording, and the text is older than this round, so the test passes. To keep one home, consider "up to the agent-lanes §6 revise cap".

## Round 1 recheck

### Verdict: APPROVED

R1, R2, R3 and the advisory are all closed. The new agent-lanes §3 item 7 git rule is sound, lives only in agent-lanes, and contradicts no other guidance. No new blocking defect. Two gaps are acceptable if disclosed (N1, N2).

### Review state

| Field | Value |
| --- | --- |
| Authors | GLM lane: spec re-apply, committed as `6fb340306`. Antigravity lane: R2, R3, the advisory and the item 7 rewrap, uncommitted; the item 7 rule itself and the earlier fixes are committed as `ceca79a2b`. Orchestrator: mirror, 3-way merge into `.claude/agents/team-leader.md`, and regeneration of the `.codex`/`.opencode` team-leader copies with the transformers. |
| Reviewer | In-process subagent (opposite side from the CLI lanes) |
| Reviewed revision | Local commits `6fb340306` + `ceca79a2b` (not pushed) plus the uncommitted working tree of `docs/skills-design-gate-parity` |
| Completed revise rounds | 1 |

`P` = `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills`. `TL` = `libs/backend/agent-generation/templates/agents/team-leader.template.md`.

### Mechanical checks (against `HEAD~2`, which covers both commits and the working tree)

| Check | Result |
| --- | --- |
| `diff -rq` of `P/{agent-lanes,orchestration,ui-ux-designer,tribunal}` against `.claude/skills/*` | Identical |
| TL additions in `.claude/agents/team-leader.md`, `.opencode/agent/team-leader.md` and `.codex/agents/team-leader.toml` (escaped) | 29/29 added lines present in all three |
| Python `tomllib` over `.codex/agents/*.toml` | 15/15 parse |
| `npm run -s manifest:check` | Up to date (`sha256:1b9dd6c0…`, 225 files) |
| CR bytes in changed files | None |
| `git diff --check HEAD~2` | Clean |
| The 6 `lane-rule-single-home.spec.ts` patterns over `P/{agent-lanes,orchestration,tribunal}` and the `.claude` mirrors | The home matches all 6; no other file matches any |
| `agent-lanes/SKILL.md` length | 223 lines (limit 230) |
| Markdown headings followed by a blank line in TASK_2026_535, 537 and 538 | All satisfy MD022 |
| `NX_DAEMON=false npx nx run-many -t test -p vscode-lm-tools agent-generation harness-sync --skip-nx-cache` | `Successfully ran target test for 3 projects` (exit 0) |

### Round-0 items

| Item | Status | Evidence |
| --- | --- | --- |
| 4086482638 | Closed | `.ptah/specs/TASK_2026_535/task.md:45`: "`run_id` (primary key), agent_id (nullable, indexed), parent_session_id, …". `agent_id` is declared once. `:88` and `:133` still give each rejected row its own `run_id`. |
| 4086482645 | Closed | `TASK_2026_537/task.md:48-51`: the endpoint must be `https:`, a non-https URL is rejected before the key is attached, and the redirect and host rule stays. |
| 4086482653 | Closed | `TASK_2026_537/task.md:73-79`: per-flag holdout ship criteria for `replacesExistingSurface`, `touchesUiSurface` and `changesPersistedSettings`: a strict false-negative bound (for example recall ≥ 0.95) and a calibration criterion (for example ECE ≤ 0.05), with numbers fixed at the research gate. Nothing ships until every flag passes, and TASK_2026_523 stays a required case. |
| 4086482661 | Closed | `TASK_2026_538/task.md:31-33`: an existing secret is kept and the plain setting is deleted in either case; the plain value is copied only when no secret exists. `:19-20` says #581 is merged and the task is based on `main` (confirmed: #581 MERGED 2026-09-23T19:44:30Z). |
| R2 | Closed | The before/after exemption, with "before" taken from the base commit, now appears at `P/orchestration/references/team-leader-modes.md:34-37`, `P/agent-lanes/SKILL.md:154`, `P/orchestration/references/checkpoints.md:452-455`, `TL:388-391` (`TASK COMPLETE` return) and `TL:460-463` (refusal). It also stays at `P/orchestration/SKILL.md:42` and `TL:316-321`. The only unconditional prototype mentions left are `TL:315`, which the exemption directly follows, the visual-reviewer template's "when `prototype/` exists" / "when one was produced" (`:94`, `:156`, `:295`), and flows that ran Gate 1.7. |
| R3 | Closed | `P/orchestration/references/agent-catalog.md:84`, `:86`, `:88`: "`**Plan**: implementation-plan.md, or for a BUGFIX task.md + context.md (+ research-report.md)`". |
| Advisory | Closed | `P/orchestration/references/checkpoints.md:38-39` now says "within the agent-lanes §6 revise cap", and `:43` says "when the cap is exhausted". No other file states the number. |

### Agent-lanes §3 item 7 (`P/agent-lanes/SKILL.md:71-74`)

The rule forbids lanes from running git commands that discard working-tree changes: `restore`, `checkout -- <path>`, `stash`, `reset`, `clean`. A change the lane did not make "belongs to another writer — report it, never revert it."

- **Lives only in agent-lanes.** No discard rule for lanes appears in orchestration or tribunal. `P/orchestration/references/git-standards.md:285-294` lists `reset --hard`, `clean -f`, `checkout .` and `restore .` as dangerous for the orchestrator. That points the same way and does not restate the lane rule.
- **No contradiction.**
  - The throwaway-worktree exception in the same item covers only commit, push and history-changing git. The discard ban has no exception, and nothing in agent-lanes, orchestration or tribunal tells a lane to stash, reset or restore.
  - The harness's "never use bare `git stash`" guidance is for sessions, not lanes, and is stricter in the same direction.
  - Lanes cannot commit, so they have no legitimate reason to set work aside with `stash`.
  - Listing whole subcommands (`reset`, `stash`, `restore`) also forbids the harmless forms (`restore --staged`, `stash list`). That is broader than needed, but a lane has no reason to use them, so it is acceptable.
- **It addresses the cause of the incident.** The antigravity report states that its first run executed `git checkout -- .ptah/specs/TASK_2026_53{5,7,8}/task.md`, and the rule forbids exactly that.

### New items (acceptable with disclosure, non-blocking)

1. **N1 (antigravity lane): the visual-reviewer has no instruction for the "before" capture.**
   - **Problem.** The rule assigns the base-commit "before" screenshots to the visual-reviewer (`P/orchestration/SKILL.md:42`, `TL:319-321`). But the visual-reviewer template and its agent-catalog invocation (`agent-catalog.md:89`, `**Base URL**: <running app URL>`) have no before/after mode and no step to run the base commit. Until one is added, the orchestrator must spell out the base-commit capture in that prompt.
   - **Optional fix.** Add a context line to the agent-catalog visual-reviewer row: "`**Before/after**: base commit <sha> — capture before screenshots (dark + light) of <screen> before the fix lands`, when no prototype exists".

2. **N2 (GLM lane): the Acceptance sections do not yet cover the new rules.**
   - **Problem.** `TASK_2026_537/task.md` Acceptance (`:88-98`) has no bullet for the `https:`-only endpoint or for the per-flag ship criteria. `TASK_2026_538/task.md` item 4 (tests) has no case where both the plain setting and a secret exist. The Scope text binds the implementer, so this is not a blocker.
   - **Optional fix.** Add to 537 Acceptance: "a non-`https:` endpoint is rejected before the key is attached; thresholds ship only when every gate-driving flag meets its holdout recall and calibration bounds". Add to 538 tests: "plain setting + existing secret → secret unchanged, plain setting deleted".

### Open items for the user's gate

None blocking. Disclose N1 and N2 as accepted follow-ups.
