# Batches - TASK_2026_441_7825

Total tasks: 23 | Batches: 10 | Complete: 9/11

Phase 1 review: APPROVED 7/10 (`code-logic-review.md`, diff `2e0811f0a~1..5991b51be`, Batches 1-4 +
Batch 3 fix). Fix round Batch 4F committed; re-review scoped to the Batch 4F commit PENDING,
reviewer family must not be codex.

Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-441-lanes-first-c89362de48e8` (branch
`task-441-lanes-first`). All paths below are relative to it unless absolute. `P` =
`apps/ptah-extension-vscode/assets/plugins/ptah-core`.

## Execution defaults (recorded by team-leader)

- Gate 0.1 = `enabled` (lanes-first), approval `lane-review` (decisions.md #1, #10). Every batch
  recommends a CLI lane. A subagent executor must carry a `Subagent reason`.
- Executor resolution: the orchestrator picks the lane from the live `ptah_agent_list` at spawn time.
  No vendor is fixed here. A row that is AT LIMIT (with a reset time or "reset unknown") stays skipped
  for this run until a fresh list row shows room. Do not force-spawn.
- Review family: every phase code-logic review runs on a lane from a family different from every
  implementer family in that phase. Keep at least one capable family unused by a phase's implementers
  so its review can be cross-family. If the implementers span two families, use a third, or split the
  review by implementer family. Same-family review needs a written reason and a "weaker evidence" label.
- Fallback order on a lane failure (the rule this task ships): limit -> other family same capability ->
  same family other provider/model -> subagent with reason. Non-limit failure twice on one lane -> next
  eligible lane -> subagent.
- Lanes never run git and never commit. They may delete files with the filesystem; team-leader stages
  the deletion.
- Ordering follows implementation-plan.md:80-91: H1 validator first, A/B/C disjoint, G repo-local, H2
  packaging last. The validator is not in CI (only `manifest:check` is, `.github/workflows/*.yml`), so
  H1 commits with a defined expected-red list that A, B and C retire (see Batch 1 verification).
- Fixed vocabulary for parallel Batch 2 (both lanes must use these exact strings so cross-references
  agree): `Document gates` and `Shipping code` (the two bullets in agent-lanes §6); `other family same
  capability`, `same family other provider/model`, `subagent` (fallback order); `Subagent reason`;
  `Review family`; `reset unknown`; `AT LIMIT`.
- Verification per CLAUDE.md: only changed projects, Nx `--parallel=1`, Jest `--maxWorkers=2
  --coverage=false`, one heavy check at a time, output tailed. Never build, serve, dev, e2e, package, or
  workspace-wide runs. Every lane prompt repeats these rules.

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- New spec `libs/backend/agent-generation/src/lib/team-leader-template.policy.spec.ts` is picked up by
  the library's Jest run — verified: `tsconfig.spec.json` includes `src/**/*.spec.ts`, preset is
  `@nx/jest/preset` (closes Round 2 R2-5).
- `orchestration/references/fleet.md` does not exist yet — verified; Task 3.1 creates it.
- The validator's `REQUIRED_AGENTS` (14 ids) all resolve to `templates/agents/<id>.template.md` —
  unverified; Task 1.1 checks it and the validator's retained `validateAgentFilesExist` proves it.
- `content-manifest.json` hashes both plugin files and `templates/agents/**`
  (`scripts/generate-content-manifest.js:25-26,136-144`) — verified; so H2 must run after Batch 4.
- `.claude/skills/{orchestration,agent-lanes,tribunal}` are tracked copies, not junctions (verified with
  `git ls-files` and `Get-Item`). They will drift from the plugin. Not edited here per context.md
  "Source of truth"; noted in the final summary.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Round 2 R2-1: plan §5 wording names `failureKind: quota` as quota authority, but no model-facing formatter shows `failureKind` (`mcp-response-formatter.ts:1914-1950`) | MEDIUM | Task 2.2: the limit authority is the `ptah_agent_list` AT LIMIT row (reset time or "reset unknown") read after the failure, plus the lane's own output text; `failureKind` is not mentioned as something the orchestrator reads |
| decisions.md #9: one `<agent-lane-completed>` signal per lane turn; a message queued with `ptah_agent_message` runs as a new turn after a `delivered` signal and can change the deliverable | HIGH | Task 2.2 adds an agent-lanes §4 rule: a later signal from the same agent supersedes an earlier one; do not start review of a deliverable while a queued message for that lane is pending. Task 1.2 asserts a marker for it |
| R2-2: document-gate escalation sentences checked only by manual grep | LOW | Task 1.2 adds the escalation phrases (same-side -> user, REVISE at cap -> user, removal -> user) as validator markers for agent-lanes §6 and checkpoints.md |
| R2-3: plan says "headings" for `Document gates` / `Shipping code`; the file uses bullets; validator reads only `orchestration` today | LOW | Task 2.2 writes them as bold-labelled bullets; Task 1.2 matches the bullet form (`**Document gates`, `**Shipping code`) and adds the `agent-lanes/SKILL.md` path to the validator |
| R2-4: replacing the named-vendor roster in `lane-assignment.md:92-105` removes example content (not a rule) | LOW | Task 2.1 replaces it with live-row placeholders; Mode 3 summary mentions it |
| `skill-triggers.v1.jsonl` is hash-pinned in `tools/mcp-bench/fixtures/memory-skills/MANIFEST.json:54` and read by `committed-u4-labels.spec.ts:31`; the plan does not list MANIFEST.json and a third Nx project (`mcp-bench`) | HIGH | Separate Batch 6 owns the jsonl and MANIFEST.json. Task 6.1 investigates first and stops without editing if committed labels pin row 6 content or line numbers |
| `.claude/workflows/fleet-fix.js:135` tells the worker to set `task.md` `status:` itself; plan's `fleet.md` says only orchestrator/team-leader writes status (plan :71) | MEDIUM | Task 5.2 aligns the workflow with the status-ownership rule if the workflow has its own verification step; otherwise records the divergence in the workflow header and flags it in the report for the phase review |
| H1 commits a validator that fails until A/B/C land | LOW | Expected-red list defined in Batch 1 verification; each later batch must shrink it; Batch 4 must leave it fully green |
| Parallel Batch 2 lanes write cross-referencing text | MEDIUM | Fixed vocabulary above; team-leader greps both outputs for the exact strings in Mode 2 |
| Plugin `plugin.json` bump and manifest must happen once, after every content edit including fix rounds | MEDIUM | Batch 7 is its own phase after Phase 1 and Phase 2 reviews have accepted |

Edge cases:

- Stored lane preference but no spawnable lane -> `disabled`, tell the user, `Approval: user` — Task 2.1
- Conflicting or stale memory hits -> most recent unambiguous wins, else ask — Task 2.1
- Memory unavailable -> record `preference unknown`, use the no-preference default — Task 2.1
- Unknown reset time -> skip that lane for the rest of the run; re-check only at next Gate 0.1 or on
  user request; a fresh list row with room overrides — Task 2.2
- Resumed lane gets a new agent id; the exhausted entry is keyed by lane (cli/ptahCliId), not agent id —
  Task 2.2
- Queued message after a `delivered` signal — Task 2.2
- In-process subagent reviewing in-process subagent code = same family, needs reason + label — Task 2.2
- Fleet invoked with one id -> ordinary continuation; ids validated before any spawn — Tasks 2.1, 3.3
- Respawned fleet worker whose artifact is already complete no-ops — Task 3.1
- Multiple Nx projects in fleet tests -> `run-many -p A B --parallel=1` and check the "N projects" header;
  never positional `nx test A B` — Tasks 5.1, 5.2

## Batch 1: Validator retarget and rule markers (H1) — COMPLETE (commit 2e0811f0a)

- Executed by: CLI lane (codex, d432de19). Report: `batch-1-report.md`.
- Team-leader verification: `npm run validate-skill` run once after the lane's final edit -> 24
  errors, 0 warnings. All 24 errors are in the expected-red categories: missing `fleet.md` (1);
  checkpoints Gate 0.1 (`ptah_memory_search`, `no recorded preference | \`enabled\``) (2);
  lane-assignment (2); team-leader template (2); agent-lanes §4 (4), §5 (7), §6 (6). There are no
  missing-template diagnostics (all 14 resolve) and no retained-check failures. The lane's
  unverified final §6 refinement is now covered by this run.


- Recommended executor: CLI lane (capability: TypeScript scripting)
- Fallback executor: per the fallback order above; last resort backend-developer subagent
  (Subagent reason would be: every lane exhausted)
- Execution mode: sequential
- Rationale: one file, two dependent edits; one lane in sequence.
- Tasks: 2 | Depends on: none
- Phase: 1 Shipped policy | Phase review: none at this batch (Phase 1 review after Batch 4)

### Task 1.1: Retarget the validator to the shipped plugin and agent templates — COMPLETE

- File: `scripts/validate-orchestration-skill.ts`
- Plan reference: implementation-plan.md:75
- Pattern to follow: the file's own existing check functions (`:405-424`, `:433-450`, `:495-509`)
- Quality requirements: skill root -> `P/skills/orchestration`; agent lookup ->
  `libs/backend/agent-generation/templates/agents/<id>.template.md`. Keep `validateAgentFilesExist`,
  syntax, internal-link, strategy-documented, agent-documented, invocation-pattern, required-section and
  line-count checks. Add `fleet.md` to `REQUIRED_REFERENCES`. Fix mirror-path error, suggestion and
  missing-root text (`:416-419,506,560`).
- Validation notes: all 14 `REQUIRED_AGENTS` (`:108-123`) must resolve; a missing template must still
  fail with a diagnostic naming the template path.
- Implementation details: path constants change; no check is removed or weakened.

### Task 1.2: Add static rule-marker assertions — COMPLETE

- Depends on: Task 1.1
- File: `scripts/validate-orchestration-skill.ts`
- Plan reference: implementation-plan.md:76; review Round 2 R2-2, R2-3
- Pattern to follow: existing required-section checks in the same file
- Quality requirements, each scoped to its section and order-checked so a stray occurrence cannot pass,
  each diagnostic naming file and section:
  - `checkpoints.md` Gate 0.1: `ptah_memory_search` appears before mode selection; no-preference
    default `enabled`; no-spawnable-lane -> `disabled`.
  - `lane-assignment.md` and `team-leader.template.md`: CLI-lane default and `Subagent reason`.
  - `agent-lanes/SKILL.md` §4: the per-turn signal rule (later signal supersedes; no review while a
    queued message is pending).
  - `agent-lanes/SKILL.md` §5: `other family same capability` before `same family other
    provider/model` before `subagent`; unknown-reset skip; `AT LIMIT` named as the limit signal.
  - `agent-lanes/SKILL.md` §6: bullets `**Document gates` and `**Shipping code`, with different-family,
    reason and weaker-evidence markers in the Shipping code bullet.
  - Document-gate escalations survive in agent-lanes §6 and `checkpoints.md`: same-side -> user, REVISE
    at cap -> user, proposed removal -> user.
  - `fleet.md`: batch cap sentence and judge schema keys `taskId, round, pass, defects, testsRan,
    mentorNote`.
- Validation notes: add the `P/skills/agent-lanes/SKILL.md` path (validator reads only orchestration
  today). Match exact strings from "Fixed vocabulary".
- Implementation details: one helper that slices a file by heading and asserts ordered substrings.

### Batch 1 verification

- File exists and contains both tasks' work.
- Scoped command: `npm run validate-skill 2>&1 | tail -60`.
- Expected-red acceptance (this batch only): every retained check passes against the plugin and all 14
  templates resolve; the only failures are the new-marker diagnostics for checkpoints, lane-assignment,
  agent-lanes §4/§5/§6, template, and the missing `fleet.md`. Any other failure = NOT ACCEPTED.
- No per-batch review.

## Batch 2: Lanes-first policy in orchestration and agent-lanes (A) — COMPLETE (commit 3c107d09c)

- Executed by: CLI lanes x 2 (codex fe63b168 for 2.1, codex f821d912 for 2.2). Report:
  `batch-2-report.md`.
- Team-leader verification round 1 (2026-10-13): NOT ACCEPTED, no commit. `npm run validate-skill`
  -> 11 errors. Five are expected red (`fleet.md` x3: two broken links plus the missing required
  reference; team-leader template markers x2). Six belong to this batch:
  1. `checkpoints.md:158` Checkpoint 0.1: markers `no recorded preference | \`enabled\`` and
     `No spawnable lane` are missing. The table at `:173-178` says "no preference" and "No spawnable
     capable lane". Fix: row 1 cell ends `no recorded preference` directly before `| \`enabled\``; row 4
     reads `No spawnable lane and no lane preference | \`disabled\``.
  2. `lane-assignment.md:40` `## Batches on lanes`: no `CLI lane` and no `Subagent reason` inside
     that section. The lanes-first default sits in the previous section (`:34-38`). Fix: state in
     `## Batches on lanes` that a CLI lane is the default executor for every bounded batch (sequential
     or parallel; parallel still needs independent, file-disjoint tasks) and that a subagent executor
     must carry a `Subagent reason`.
  3. `agent-lanes/SKILL.md:94` §4: `later signal` and `supersedes` fail the order check because the
     first `queued` sits in the last sentence (`:126`). `:124` says `queue-next-turn`, not `queued`.
     Fix: use the Task 2.2 wording, "A message queued with `ptah_agent_message` runs as a new turn
     after a `delivered` signal and can change the deliverable again", before the later-signal sentence.
- Passed in round 1: Gates 1/1.7/2 are not weakened (checkpoints `:94-113,130-151`: all five
  escalations kept; agent-lanes §6 `:172-184` keeps opposite-side, same-side -> user, REVISE at cap ->
  user, removal -> user). All fixed vocabulary is present. No vendor roster remains (the one `Codex`
  hit, agent-lanes `:239`, is an existing cost measurement and is not new). The plan :77 regression
  over all 9 files incl. tribunal found no `CLI author -> subagent`, `code that will ship ->
  cross-side` or `failureKind` text.
- Acceptance for round 2: the validator shows exactly 5 errors (`fleet.md` x3, template x2).
- Fix round 1: one codex lane (13070265). Report: `batch-2-fix-report.md`.
- Team-leader verification round 2 (2026-10-13): ACCEPTED. `npm run validate-skill` run once -> 5
  errors, 0 warnings, all expected red (`fleet.md` x3: `SKILL.md:50,186` links plus the missing
  required reference; team-leader template `:103` `Recommended executor: CLI lane`, `Subagent
  reason:`). Fixed spots on disk: `checkpoints.md:176` `no recorded preference | \`enabled\``,
  `:179` `No spawnable lane and no lane preference | \`disabled\``; `lane-assignment.md:39-44`
  `## Batches on lanes` names the CLI-lane default, the file-disjoint parallel condition and `Subagent
  reason`; `agent-lanes/SKILL.md:124-127` puts the queued-message sentence before the later-signal
  sentence. Round-1 passes still hold: escalations at checkpoints `:103,107-109,141,146` and
  agent-lanes `:176-182` (same-side -> user, REVISE at cap -> user, removal -> user); the plan :77
  grep over all 9 files finds no `CLI author -> subagent` or `failureKind`. The `Code that will ship`
  row (`agent-lanes:170`) routes to a different family, not cross-side. The only vendor name is the
  existing `Codex` measurement at `:239`.
- Phase 1 implementer families so far: codex (Batches 1, 2). The Phase 1 review must use a non-codex
  family.

- Recommended executor: CLI lanes x 2 (capability: precise technical writing against cited lines)
- Fallback executor: per the fallback order; last resort one sequential subagent for both tasks
- Execution mode: parallel
- Rationale: two file-disjoint tasks, each self-contained with the fixed vocabulary; no shared
  registry or entry point. Prefer two lanes of the same family, so a different family stays free for
  the Phase 1 review.
- Tasks: 2 | Depends on: Batch 1
- Phase: 1 Shipped policy | Phase review: none at this batch

### Task 2.1: Orchestration skill and references — COMPLETE

- Files: `P/skills/orchestration/SKILL.md`, `P/skills/orchestration/references/checkpoints.md`,
  `P/skills/orchestration/references/lane-assignment.md`,
  `P/skills/orchestration/references/team-leader-modes.md`
- Plan reference: implementation-plan.md:43-46
- Pattern to follow: existing section style in each file
- Quality requirements: Gate 0.1 text as quoted at plan :43 (memory search first, explicit instruction
  wins, stale/conflict rule, no-preference `enabled`, `auto` still selectable, memory unavailable ->
  `preference unknown`, preference-but-no-lane -> `disabled` + `Approval: user`, record source/mode/
  approval/rows in `context.md`). Label Approval mode as applying to document Gates 1/1.7/2 and keep all
  five escalations (`checkpoints.md:94-107,128-146`). SKILL.md: Gate 0.1 default, code-review wording,
  reference table, fleet entry ("`/orchestrate TASK_A TASK_B ...` or explicit fleet loads
  `references/fleet.md`; one ID keeps ordinary continuation"; validate ids before spawning).
  lane-assignment: code-review row -> different-family lane with exception reason and weak-evidence
  label; document-review row stays opposite-side; replace `:107-109` CLI-author-to-subagent rule;
  keep batch cap `:78-80` and UI/browser/git boundaries; replace vendor roster `:92-105` with live-row
  placeholders; bounded batches, tests, research and reviews default to lanes, including sequential
  coupled files. team-leader-modes: one phase code-logic review on a different-family lane; summary
  records executor, author/reviewer family, same-family reason + label, subagent fallback cause.
- Validation notes: R2-4 (roster is example content). Must not weaken Gates 1/1.7/2. Use fixed vocabulary.
- Implementation details: edit in place; no copies.

### Task 2.2: agent-lanes §4, §5, §6 and completion — COMPLETE

- File: `P/skills/agent-lanes/SKILL.md`
- Plan reference: implementation-plan.md:47-51; review Round 2 R2-1, R2-3; decisions.md #9
- Pattern to follow: existing tables and bullets at `:94-189`
- Quality requirements:
  - §4 (`:94-133`), new rule: the runtime sends one `<agent-lane-completed>` signal per lane turn. A
    message queued with `ptah_agent_message` runs as a new turn after a `delivered` signal and can change
    the deliverable again. A later signal from the same agent supersedes an earlier one; do not start
    review of a deliverable while a queued message for that lane is still pending.
  - §4 completion (`:94-129`): declare `deliverables`; the pushed signal is the wake; read status/output
    and verify contents; if push is unavailable do one status/read check; a missing or empty file is not
    complete. No timer or watcher.
  - §5 (`:135-149`): replace with the plan :47 recovery text, with R2-1 applied — the limit signal the
    orchestrator can read is the `ptah_agent_list` AT LIMIT row (reset time or "reset unknown") after the
    failure, plus the lane's own output; do not present `failureKind` as something the orchestrator reads.
    Never infer a limit from timeout, capacity, or a missing deliverable. Record lane id/family and reset
    or `reset unknown` in this run's `context.md`; no force-spawn; fallback order; unknown-reset skip and
    confirmed-room override; non-limit path (resume once, else respawn narrower; two non-limit failures
    -> next eligible lane -> subagent); report fallback/cause/reset; never silently replace a pin.
  - §6 (`:162,164-176,177-179`): edit every code/review routing site; split into `**Document gates`
    (unchanged protocol, quoted plan :49) and `**Shipping code` (different family, quoted plan :50)
    bullets. Keep `file:line`, cap, parity, visual and scoped-test rules (`:159-189`).
- Validation notes: no remaining "CLI author -> subagent" shipping-code rule or "Code that will ship ...
  cross-side" row. Use fixed vocabulary exactly.
- Implementation details: edit in place.

### Batch 2 verification

- Both artifacts edited as above; team-leader greps both for the fixed-vocabulary strings.
- Scoped command: `npm run validate-skill 2>&1 | tail -60` — the checkpoints, lane-assignment (its half)
  and agent-lanes markers turn green; remaining red is only `fleet.md` and template markers.
- Grep regression (plan :77) over agent-lanes, orchestration SKILL.md, checkpoints, lane-assignment,
  team-leader-modes, strategies, agent-catalog, `P/skills/tribunal/SKILL.md`,
  `P/skills/tribunal/references/relay.md`: escalation sentences survive; no CLI-author-to-subagent code rule.
- No per-batch review.

## Batch 3: Generic fleet mode in the plugin (B) — COMPLETE (commit 314813c3e)

- Executed by: CLI lane (codex, 16c926e9). Report: `batch-3-report.md`.
- Team-leader verification: `npm run validate-skill` run once -> 2 errors, 0 warnings, both the
  team-leader template markers (`Recommended executor: CLI lane`, `Subagent reason:`) that Batch 4
  retires; the three `fleet.md` errors are gone. Link anchors `lane-assignment.md#batches-on-lanes`,
  `agent-lanes/SKILL.md#8-cost`, `git-standards.md#quiet-commit-window` and
  `#hook-failure-protocol` resolve. Genericity grep over the 4 plugin files for vendor names, `nx`,
  `npx`, `run-many`, `scope-enum`, repo scopes (`webview`, `vscode`), `fleet-fix` and `.claude/`
  returned no match. `.claude/skills/fleet-orchestration` unchanged (Batch 5 owns deletion).
- Fleet parity (plan :59-69): §1 -> `fleet.md` Entry + `orchestrate.md` "Select the workflow"; §2
  generic part -> `fleet.md` Resume from disk (repo-local caveat stays with Batch 5); §3 ->
  Checkpoints (all six judge keys, `judge-round-<round>.json`, respawn no-op); §4 -> Disjoint
  batching (exact cap sentence); §5 -> `git-standards.md` Quiet commit window; §6 generic pointer ->
  `git-standards.md` Repository commit rules (repo enum -> Batch 5); §7 -> Batch 5; §8 -> Judge
  protocol (read-only, cited defects, two-round cap, never edits `task.md`); §9 -> link to agent-lanes
  §§1,3,4,8. Status ownership sentence present (`fleet.md:36`).
- Removed content noted for the Phase 1 review: `git-standards.md` dropped this repo's commit
  examples, `typecheck:affected`/lint-staged hook table and the branch/PR command snippets (repo-
  specific or outside fleet scope); `orchestrate-help.md` dropped stale phases (`progress.md`,
  non-existent `/validate-*` commands, "no parallel Task()"). Strategies and agent list remain in
  `orchestrate.md` Quick Reference. Reviewer should confirm no generic capability was lost.
- Phase 1 implementer families so far: codex (Batches 1, 2, 3).
- Fix (decisions.md #12, user-approved): CLI lane (codex, 76cdc99a), report `batch-3-fix-report.md`,
  commit f52ba626e. Restored generically: default types and valid/invalid examples, branch operations
  (new/continue branch, commit, PR), pre-commit checks (discover hooks), hook option actions, agent
  behavior rules, bypass documentation, example scenarios. Team-leader compared each against
  `git show 314813c3e~1:<path>`; grep for `nx`, `npx`, `scope-enum`, `webview`, `vscode`,
  `lint-staged`, `typecheck:affected` and vendor names -> no match; `#hook-failure-protocol` and
  `#quiet-commit-window` intact; `npm run validate-skill` -> 0 errors. Not restored by design: repo
  scope list, subject length/case limits presented as enforced, stack hook table. The old
  destructive-commands table is condensed to one sentence (not in the user's restore list) — note for
  the Phase 1 reviewer.

- Recommended executor: CLI lane (capability: technical writing)
- Fallback executor: per the fallback order
- Execution mode: sequential
- Rationale: commands and git-standards link to the new `fleet.md`; one lane in order.
- Tasks: 3 | Depends on: Batch 2 (SKILL.md fleet entry)
- Phase: 1 Shipped policy | Phase review: none at this batch

### Task 3.1: Create `fleet.md` — COMPLETE

- File: `P/skills/orchestration/references/fleet.md` (new)
- Plan reference: implementation-plan.md:57-71 (parity table §1, §3, §4, §8, §9 rows)
- Pattern to follow: `P/skills/orchestration/references/lane-assignment.md` structure; source content
  `.claude/skills/fleet-orchestration/SKILL.md:14-164`
- Quality requirements: Entry, resume from disk, Checkpoints (artifact before status; judge JSON keys
  `taskId, round, pass, defects[], testsRan, mentorNote`; filename `judge-round-<round>.json`;
  respawned worker with complete artifact no-ops), disjoint batching with the exact cap sentence "At
  most 6 files across at most 2 libraries/projects per batch, with one scoped verification command",
  read-only judge with cited defects and a two-round cap, judge never edits `task.md`; only
  orchestrator/team-leader writes `task.md` `status:` after artifact verification; lane mechanics link to
  agent-lanes §§1,3,4,8.
- Validation notes: generic for all users — no vendor roster, no Nx command, no local commitlint enum.
- Implementation details: new file.

### Task 3.2: git-standards quiet commit window and local commitlint pointer — COMPLETE

- File: `P/skills/orchestration/references/git-standards.md`
- Plan reference: implementation-plan.md:57,65-66 (`:50-64,153-180`)
- Quality requirements: quiet commit window (generic); "read the repository's commitlint config" rather
  than any scope enum.

### Task 3.3: Orchestrate commands select fleet mode — COMPLETE

- Files: `P/commands/orchestrate.md`, `P/commands/orchestrate-help.md`
- Plan reference: implementation-plan.md:57,61 (`orchestrate.md:11-30`)
- Quality requirements: multiple ids or explicit "fleet" -> fleet mode; one id -> continuation; ids
  validated before spawn; help lists fleet mode.

### Batch 3 verification

- Scoped command: `npm run validate-skill 2>&1 | tail -60` — `fleet.md` exists, links resolve, cap and
  schema markers green; remaining red is only the template markers.
- Inspect `fleet.md` for vendor names, `npx nx`, or scope enums (none allowed).
- No per-batch review.

## Batch 4: team-leader template lanes-first schema and policy spec (C) — COMPLETE (commit 5991b51be; Phase 1 review `code-logic-review.md` APPROVED 7/10, fix round Batch 4F)

- Executed by: CLI lane (codex, d5d42d2a). Report: `batch-4-report.md`.
- Team-leader verification: diff read — CLI-lane default incl. sequential coupled and cross-file work,
  parallel only file-disjoint, subagent only with a specific `Subagent reason`, exact cap sentence,
  the five schema keys, cross-family shipping review with same-family exception + weaker-evidence
  label; no vendor names; task/commit ownership sections untouched. Policy spec Jest -> 4/4 passed;
  `npx nx lint agent-generation --parallel=1` -> pass; `ptah_get_diagnostics` on the spec -> 0
  errors; `npm run validate-skill` -> 0 errors, 0 warnings (expected-red list fully retired). Hooks
  passed on commit.
- Phase 1 implementer families: codex only (Batches 1-4 and the Batch 3 fix).

- Recommended executor: CLI lane (capability: TypeScript + Jest)
- Fallback executor: per the fallback order
- Execution mode: sequential
- Rationale: the spec asserts strings the template edit writes.
- Lane note (2026-10-13 list: codex, antigravity, opencode, Glm ptah-cli installed; grok AT LIMIT
  until 17:40 UTC): prefer a codex lane so Phase 1 implementers stay one family and antigravity,
  opencode or Glm stays free for the cross-family Phase 1 review. Resolve from the live list at spawn.
- Tasks: 2 | Depends on: Batch 2 (shared vocabulary)
- Phase: 1 Shipped policy (last batch) | Phase review: code-logic on Batches 1-4 combined diff, by a
  family different from every Phase 1 implementer; style review not required (no new public API)

### Task 4.1: Executor matrix, cap and `batches.md` schema — COMPLETE

- File: `libs/backend/agent-generation/templates/agents/team-leader.template.md`
- Plan reference: implementation-plan.md:52 (`:140-171,198-205`)
- Quality requirements: recommend `CLI lane` for every bounded batch including sequential coupled or
  cross-file work; parallel needs disjoint files; a subagent recommendation names the missing
  capability, interaction/visual/git need, user pin, or exhausted fallback; orchestrator resolves live
  rows. Exact cap sentence. Schema keys: `Recommended executor: CLI lane [capability]`, `Execution mode:
  sequential | parallel`, `Fallback order: other family same capability -> same family other
  provider/model -> subagent`, `Subagent reason: <specific reason | N/A>`, `Review family: different from
  implementer | exception reason`. Keep task/commit ownership (`:165-171,242-315`).
- Validation notes: no vendor names; `_shared/cli-delegation.md` unchanged.

### Task 4.2: Template policy spec — COMPLETE

- Depends on: Task 4.1
- File: `libs/backend/agent-generation/src/lib/team-leader-template.policy.spec.ts` (new)
- Plan reference: implementation-plan.md:53
- Pattern to follow: `libs/backend/agent-generation/src/lib/agent-generation.spec.ts`
- Quality requirements: read the source template with `fs` relative to `__dirname`; assert exact schema
  keys, CLI-lane default, cap sentence, required `Subagent reason`.

### Batch 4 verification

- Scoped command: `npx jest -c libs/backend/agent-generation/jest.config.ts
  libs/backend/agent-generation/src/lib/team-leader-template.policy.spec.ts --coverage=false
  --maxWorkers=2 2>&1 | tail -30`
- Then `npm run validate-skill 2>&1 | tail -30` must be fully green (end of expected-red).
- Phase 1 review due: team-leader returns NEEDS REVIEW for the Batch 1 parent..HEAD diff.

### Phase 1 review record

- Review: `code-logic-review.md` (Glm ptah-cli, resumed lane 73fea0bf; implementer family codex, so
  cross-family). Range `2e0811f0a~1..5991b51be`. Verdict APPROVED 7/10; 0 Blocking, 0 Serious, 4
  Moderate, 2 Minor (decisions.md #16).
- Fix-round triage (one round; Moderate fixed only when it can break lane behaviour/config or lose data):
  | Finding | Severity | Disposition |
  | --- | --- | --- |
  | 1 Validator template markers match only the fenced example | Moderate | FIX in Batch 4F (a false pass leaves the lanes-first default unprotected by `validate-skill`) |
  | 2 git-standards lost the named destructive commands | Moderate | FIX in Batch 4F per user decision decisions.md #17 (restore a short generic named list) |
  | 3 orchestrate-help lost the code-quality standards | Moderate | APPROVED REMOVAL, user decision decisions.md #18 (stack opinion, not a generic plugin rule); no change |
  | 4 agent-lanes §4 no legal action when the single check says `running` | Moderate | FIX in Batch 4F (orchestrator stall up to the lane timeout on a no-push host) |
  | 5 checkpoints "use lanes more" row vs Gate 0.1 approval table | Minor (raised) | FIX in Batch 4F: two rules give different approval modes, so an orchestrator can pick the wrong lane config |
  | 6 agent-lanes §5 lost the in-process end-state row | Minor | DEFERRED to Later task L1 below; the rule survives at agent-lanes §1 and lane-assignment.md:128-129 |

## Batch 4F: Phase 1 review fixes — COMPLETE (commit 6c57bf67e; re-review `code-logic-rereview.md` by Glm: round 1 REVISE on R1 `orchestration/SKILL.md:153`, orchestrator applied R1 verbatim, round 2 APPROVED; Phase 1 CLOSED)

- Executed by: CLI lane (codex, 5cd6d8ba, exit 0, delivered). Report: `batch-4f-report.md`.
- Team-leader verification: read all 4 diffs. 4F.1 generic seven-row table with `Ask first`, the
  "or equivalent commands" catch-all and the inspect-state sentence; heading unchanged; no repo names.
  4F.2 bounded re-check (one status/read check, then at most 5 checks per lane, >= 60 s apart, "no
  tight loop, timer, or watcher", fifth-check stop with end-of-turn notice or `ptah_agent_stop` + §5
  non-limit recovery); no `queued`/`later signal`/`supersedes`/`pending` in the new text. 4F.3 cell
  matches Gate 0.1 row (`checkpoints.md:177`) and the Approval mode table. 4F.4 four additive
  `validateRuleMarkers` calls, no existing call changed; the template `### Batch` heading
  (`team-leader.template.md:145`) is the only heading named `Batch`, markers at `:157,:163` sit before
  the first fence (`:182`). `npm run validate-skill` -> 0 errors, 0 warnings, exit 0;
  `git diff --name-only` -> exactly the 4 files; template unchanged (`git diff --quiet` exit 0);
  `ptah_get_diagnostics` on the validator script -> 0 errors in the requested file.
- Note for the re-review: `orchestration/SKILL.md:153` still says "one status check at most, then
  wait", which reads narrower than the new agent-lanes §4 no-push path (out of 4F scope; reviewer to
  judge whether it is a contradiction).

- Recommended executor: CLI lane (capability: precise technical writing + TypeScript scripting)
- Fallback executor: per the fallback order; last resort one sequential backend-developer subagent
  (Subagent reason would be: every lane exhausted)
- Subagent reason: N/A
- Execution mode: sequential
- Rationale: Task 4F.4 asserts exact strings that Tasks 4F.1-4F.3 write, so one lane does all four in
  order. 4 files across 2 areas (plugin skill assets, `scripts/`). codex implemented Phase 1 and may fix;
  the re-review must use a non-codex family (Glm, antigravity or opencode). grok AT LIMIT until 17:40 UTC
  (skip; resolve from the live list at spawn).
- Tasks: 4 | Depends on: Batch 4
- Phase: 1 Shipped policy (fix round) | Phase review: one code-logic re-review scoped to the Batch 4F
  commit, non-codex family; no style review (no new public API)
- Do NOT touch `libs/backend/agent-generation/templates/agents/team-leader.template.md` or any other file.

### Task 4F.1: Restore the named destructive-command list (decisions.md #17) — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-441-lanes-first-c89362de48e8\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\orchestration\references\git-standards.md`
- Plan reference: code-logic-review.md Finding 2; decisions.md #17; old table at `git show 314813c3e~1:apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/references/git-standards.md`
- Required change: replace the body of `## Destructive operations` (`:86-88`), keeping the heading text
  exactly. New body, in this order: (a) one sentence containing the exact phrase `Ask first`: these
  commands discard or rewrite work, so ask the user first and act only on explicit authorization;
  (b) a short two-column table (`Command` | `What it can lose`), rows in this exact order:
  `git reset --hard`; `git clean -fd`; `git checkout .` and `git restore .` (one row);
  `git branch -D`; `git push --force` (including `--force-with-lease`); `git rebase` on a shared or
  already-pushed branch; `git stash drop` and `git stash clear` (one row); (c) one sentence: before
  asking, inspect state — `git status`, `git log`, `git stash list`, and the exact paths or branch the
  command touches — and show the user what would be lost. Keep the "or equivalent commands" catch-all
  for unlisted commands.
- Validation notes: generic only — no repository names, scopes, vendors or this repo's paths. Do not
  change any other section.

### Task 4F.2: Bounded re-check when push is unavailable (Finding 4) — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-441-lanes-first-c89362de48e8\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\agent-lanes\SKILL.md`
- Plan reference: code-logic-review.md Finding 4; old bounded poll at `git show 2e0811f0a~1:apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/agent-lanes/SKILL.md` §4
- Required change: in §4 (`## 4. Run`), replace the sentences at `:119-121` from "If push is
  unavailable" through "as a substitute." with text that contains these exact phrases in this order:
  `push is unavailable` (keep the existing examples), `make one status/read check`,
  `at most 5 status checks per lane`, `at least 60 s apart`, `fifth check`. Meaning: if the check reports
  `running`, continue other independent work and re-check, at most 5 status checks per lane, at least
  60 s apart, never a tight loop, timer or watcher. If the fifth check still reports `running`, stop
  waiting: either tell the user the lane is still running (agent id, lane) and end the turn, or, when it
  has clearly exceeded its expected duration, stop it with `ptah_agent_stop` and recover per §5 as a
  non-limit timeout (never as a usage limit).
- Validation notes: keep every existing §4 marker in its current order (`one \`<agent-lane-completed>\`
  signal per lane turn`, `queued`, `later signal`, `supersedes`, `pending`); the new text must not
  contain the words `queued`, `later signal`, `supersedes` or `pending`. No vendor names.

### Task 4F.3: Align the "use lanes more" approval with Gate 0.1 (Finding 5) — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-441-lanes-first-c89362de48e8\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\orchestration\references\checkpoints.md`
- Plan reference: code-logic-review.md Finding 5; Gate 0.1 table `:174-179`, Response Handling `:195-203`
- Required change: only the `"use lanes more"` row of the first `### Response Handling` table (`:201`).
  Approval cell becomes exactly: `` `lane-review` with a spawnable lane, unless "gate me" was given;
  otherwise `user` `` (consistent with the Gate 0.1 row "`lane-review` if enabled/auto with a spawnable
  lane; otherwise `user`", and "gate me" keeps every approval with the user). Lane mode stays
  `enabled`. Keep the table aligned and valid markdown.
- Validation notes: no other row or checkpoint changes; the existing Checkpoint 0.1 markers must still
  pass.

### Task 4F.4: Validator asserts the prose rules, not only the fenced example — COMPLETE

- Depends on: Tasks 4F.1-4F.3
- File: `D:\projects\ptah-extension\.claude-worktrees\task-441-lanes-first-c89362de48e8\scripts\validate-orchestration-skill.ts`
- Plan reference: code-logic-review.md Finding 1; `validateLanesFirstRules` `:621-662`
- Required change, inside `validateLanesFirstRules`, keeping every existing call unchanged:
  1. Add `validateRuleMarkers(TEAM_LEADER_TEMPLATE, 'Batch', ['Recommend \`CLI lane\` for every bounded
     batch by default', 'Put that reason in \`Subagent reason\`'])` — the `### Batch` prose section
     (template `:145-177`, no fenced block), so a deleted prose default fails even with the fenced
     schema intact. Keep the existing `Mode 1 — Decomposition` fenced-schema call.
  2. Add `validateRuleMarkers(LANE_SKILL_FILE, '4. Run', ['push is unavailable', 'make one status/read
     check', 'at most 5 status checks per lane', 'at least 60 s apart', 'fifth check'])` as a separate
     call.
  3. Add `validateRuleMarkers(checkpoints, 'Checkpoint 0.1: CLI Lane Mode', ['"use lanes more"',
     '\`lane-review\` with a spawnable lane, unless "gate me"'])` as a separate call.
  4. Add a `git-standards.md` path under `REFERENCES_DIR` and `validateRuleMarkers(gitStandards,
     'Destructive operations', ['Ask first', 'git reset --hard', 'git clean -fd', 'git checkout .',
     'git restore .', 'git branch -D', 'git push --force', 'git rebase', 'git stash drop',
     'git stash clear'])`.
- Validation notes: no check removed or weakened; markers are matched after whitespace collapse, so
  strings must match the written text exactly (backticks included). If the `Batch` heading lookup hits
  an earlier heading named `Batch`, report it rather than renaming template headings.

### Batch 4F verification

- Team-leader reads all 4 files; greps confirm the template prose markers sit outside any fence and
  every new marker string exists verbatim in its target file.
- Scoped command: `npm run validate-skill 2>&1 | tail -30` -> 0 errors, 0 warnings.
- `git diff --name-only` shows exactly the 4 files; the template is unchanged, so the
  agent-generation policy spec is not re-run (if the template does change, NOT ACCEPTED).
- CLAUDE.md rules repeated in the lane prompt: only changed projects, one heavy check at a time,
  `--maxWorkers=2`, never build/serve/e2e/package or workspace-wide runs; lanes never run git.
- After commit: team-leader returns NEEDS REVIEW for the Batch 4F commit only (re-review, non-codex).

## Later task L1 (deferred, not in this run) — agent-lanes §5 in-process end state

- Source: code-logic-review.md Finding 6 (Minor). Add one sentence to agent-lanes §5 naming the final
  fallback ("No lane available at all -> do the work in-process and label it as not an outside lane").
  Recorded, not fixed (lean fix-round rule: Minor). File for a follow-up task.

## Later task L3 (deferred, not in this run) — fleet-fix revise checkpoint

- Source: code-logic-review-phase2.md M3. A resume after a failed judge round and before the revision
  finishes goes straight to the next judge round. Add a `revisedRound` arg (or a caller rule from
  `revision-round-N.json`) so the revise stage is skipped only when its artifact exists.
- Also recorded (Minor): m1 `version: 'v1'` in three synthetic mcp-bench specs; m2 `TASK_A TASK_B`
  placeholders in prompt suggestions.

## Later task L2 (deferred, not in this run) — Nx command in the generic plugin

- Source: decisions.md row 21. `P/skills/orchestration/SKILL.md:150` (Token economy) names
  `nx run-many -t <target> -p <changed projects>` in the shipped plugin, which must stay stack-neutral.
  Pre-existing, outside this task's scope. Replace with a stack-neutral "scoped to the changed projects
  with the repository's own task runner" rule in a follow-up task.

## Batch 5: Repo-local fleet migration (G1) — COMPLETE (codex lane 93144bc3 + fix 5F lane 91d7415a; report batch-5-report.md, batch-5f-report.md)

- Recommended executor: CLI lane (capability: JS/TS editing)
- Fallback executor: per the fallback order
- Execution mode: sequential
- Rationale: small, related edits; the deletion goes last, after parity is confirmed.
- Tasks: 4 | Depends on: Batch 3 (parity transfer to `fleet.md`), Phase 1 review accepted
- Phase: 2 Repo-local migration | Phase review: none at this batch

### Task 5.1: Repo-local Nx and commitlint rules in CLAUDE.md — COMPLETE

- File: `CLAUDE.md`
- Plan reference: implementation-plan.md:66-67 (parity §6, §7)
- Quality requirements: keep every existing STRICT rule; add commitlint scope pointer/enum and the
  single/multiple-project Nx rule (`npx nx test <project> --parallel=1`; `npx nx run-many -t test -p A B
  --parallel=1` with the "Running target test for N projects" check; never positional `nx test A B`).

### Task 5.2: fleet-fix workflow header and prompts — COMPLETE

- File: `.claude/workflows/fleet-fix.js`
- Plan reference: implementation-plan.md:62,67,71 (`:2,7-15,135,170`)
- Quality requirements: header points to `P/skills/orchestration/references/fleet.md` and keeps the
  repo-local resume caveat; prompts at `:135,170` use the single/multiple-project rule.
- Validation notes: RISK — `:135` has the worker edit `task.md` `status:`; align with the
  status-ownership rule if the workflow has its own verification step, else record the divergence in
  the header and in the report.

### Task 5.3: Prompt suggestions — COMPLETE

- File: `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/prompt-suggestions.component.ts`
- Plan reference: implementation-plan.md:71 (`:228,299`)
- Quality requirements: replace `/fleet-orchestration ...` with `/orchestrate` fleet invocations (multiple
  task ids); labels unchanged in meaning.

### Task 5.4: Delete the old skill — COMPLETE

- Depends on: Tasks 5.1-5.3
- File: `.claude/skills/fleet-orchestration/SKILL.md` (delete; the approved exception)
- Quality requirements: only after every parity row (plan :59-69) is confirmed in its new home.

### Task 5F: fleet-fix.js resume checkpoint (orchestrator finding) — COMPLETE

- Batch 5 removed the worker's `in_review` write (fleet.md status ownership), and the implement stage
  had no artifact, so a resumed run implemented again. Fix: the implement agent writes
  `implementation.json`; the skip condition also honours `stage` `implement`/`judge` (decisions.md #27).

### Batch 5 verification

- Orchestrator re-ran: `npx nx typecheck chat-ui --parallel=1` success; `node --check` OK; search for
  `fleet-orchestration` outside `.ptah` = 0 hits after Batch 6.

- Scoped command: `npx nx typecheck @ptah-extension/chat-ui --parallel=1 2>&1 | tail -20` (typecheck
  exercises the literal change; there is no spec for this component, so the full chat-ui test suite is
  not run — deviation from plan :90 recorded).
- Light checks: `node --check .claude/workflows/fleet-fix.js`; search for `fleet-orchestration` outside
  `.ptah/specs` returns only the Batch 6 fixture.
- No per-batch review.

## Batch 6: Benchmark fixture reference (G2) — COMPLETE (re-scoped to a v2 fixture, decisions.md #25-26; codex lane e281eeb4; report batch-6-report.md)

- Investigation result: the stop condition was met (23 unique skill ids asserted, `orchestration`
  already row 12, raw-byte hash pinned). User chose "Add a v2 fixture": `skill-triggers.v2.jsonl`
  (22 rows), v1 deleted, MANIFEST entry replaced (`6c43ca13…`), `TRIGGER_LABELS_TARGET` and specs
  retargeted.

- Recommended executor: CLI lane (capability: TS/Jest, careful investigation)
- Fallback executor: per the fallback order
- Execution mode: sequential
- Rationale: a hash-pinned, versioned fixture; investigation before edit, with a stop condition.
- Tasks: 2 | Depends on: Batch 5
- Phase: 2 Repo-local migration (last batch) | Phase review: code-logic on Batches 5-6 combined diff,
  family different from the Phase 2 implementers

### Task 6.1: Investigate and retarget row 6 — COMPLETE

- File: `tools/mcp-bench/fixtures/memory-skills/skill-triggers.v1.jsonl`
- Plan reference: implementation-plan.md:71; context.md acceptance 7
- Pattern to follow: `tools/mcp-bench/src/memory-skills/ground-truth/fixture-manifest.ts`,
  `committed-u4-labels.spec.ts:31`
- Quality requirements: first read the fixture consumers. If committed labels or ground truth pin row 6
  content or line numbers, or skill ids must be unique, STOP without editing and report the evidence.
  Otherwise retarget row 6 so no row names `fleet-orchestration` (fleet triggers move to
  `orchestration`), keeping row count and line order.

### Task 6.2: Update the fixture manifest hash — COMPLETE

- Depends on: Task 6.1
- File: `tools/mcp-bench/fixtures/memory-skills/MANIFEST.json`
- Quality requirements: recompute the `skill-triggers.v1.jsonl` hash with the method in
  `fixture-manifest.ts` (canonical JSONL or raw bytes, whichever it uses for this file).

### Batch 6 verification

- Scoped command: `npx jest -c tools/mcp-bench/jest.config.ts
  tools/mcp-bench/src/memory-skills/ground-truth/committed-u4-labels.spec.ts
  tools/mcp-bench/src/memory-skills/projection.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -30`
  (add any other spec that reads MANIFEST.json for this file).
- Orchestrator re-ran the 5 specs: 5 suites, 72 tests passed (needs the worktree `node_modules`
  junction; the Jest `marked` mapper is an absolute worktree path). `npx nx typecheck mcp-bench` success.
- Phase 2 review due after commit.

## Batch 6F: Phase 2 review fixes — COMPLETE (codex lane 7ffb65c6, commit 6804d0c23; re-review APPROVED 8/10)

- Review `code-logic-review-phase2.md` (antigravity): S1, M1, M2, M4 fixed; M3 -> later task L3;
  m1, m2 recorded (decisions.md #29-30).

## Batch 7: Plugin version and content manifest (H2) — COMPLETE (in-process, decisions.md #31)

- Recommended executor: CLI lane (capability: run node scripts)
- Fallback executor: per the fallback order
- Execution mode: sequential
- Rationale: one bump and one regeneration, after all content and every fix round.
- Tasks: 2 | Depends on: Batches 1-6, Phase 1 and Phase 2 reviews accepted
- Phase: 3 Packaging | Phase review: none — packaging only

### Task 7.1: Bump plugin version — COMPLETE

- File: `P/.claude-plugin/plugin.json`
- Quality requirements: `1.6.0` -> `1.7.0` (minor: new fleet mode and policy).

### Task 7.2: Regenerate the content manifest once — COMPLETE

- Depends on: Task 7.1
- File: `content-manifest.json`
- Quality requirements: run `node scripts/generate-content-manifest.js` exactly once.

### Batch 7 verification

- Scoped command: `npm run manifest:check 2>&1 | tail -10`, then final `npm run validate-skill 2>&1 |
  tail -20` green.

## Batch 8: Lanes-First Gate 0.1 and Quota Walkthrough — PENDING

- Recommended executor: orchestrator in-process
- Subagent reason: the walkthrough needs the live orchestration tools (`ptah_memory_search`,
  `ptah_agent_list`, `ptah_agent_spawn` refusal on an AT LIMIT row) in the session that owns Gate 0.1;
  a lane cannot spawn lanes or run Gate 0.1.
- Fallback executor: general-purpose subagent with the ptah tools
- Execution mode: sequential
- Rationale: manual acceptance gate named in implementation-plan.md:105.
- Tasks: 1 | Depends on: Batch 7
- Phase: 4 Acceptance | Phase review: none — evidence document only

### Task 8.1: Record the walkthrough in `test-report.md` — PENDING

- File: `.ptah/specs/TASK_2026_441_7825/test-report.md` (new)
- Plan reference: implementation-plan.md:95-105
- Quality requirements: inputs, sanitized tool responses, decisions, fallback order, output paths and a
  pass/fail verdict for acceptance criteria 1-6: no-pin batch/review routing with every subagent reason;
  one same-family case and one in-process subagent case with reason and label; memory hit, conflict/stale
  and unavailable cases with the resulting notice; simulated limit -> AT LIMIT row with reset or "reset
  unknown" -> fallback named in the summary -> later batch skips the lane; a queued-message second turn
  superseding a `delivered` signal; fleet with two disjoint tasks, a resumed artifact and a read-only
  judge. Prose rules alone are not a pass.

### Batch 8 verification

- `test-report.md` exists with a verdict per criterion; any FAIL routes back as a fix batch in its phase.
