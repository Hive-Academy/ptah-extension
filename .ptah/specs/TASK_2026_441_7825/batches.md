# Batches - TASK_2026_441_7825

Total tasks: 18 | Batches: 8 | Complete: 1/8

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

## Batch 2: Lanes-first policy in orchestration and agent-lanes (A) — IN_PROGRESS

- Recommended executor: CLI lanes x 2 (capability: precise technical writing against cited lines)
- Fallback executor: per the fallback order; last resort one sequential subagent for both tasks
- Execution mode: parallel
- Rationale: two file-disjoint tasks, each self-contained with the fixed vocabulary; no shared
  registry or entry point. Prefer two lanes of the same family, so a different family stays free for
  the Phase 1 review.
- Tasks: 2 | Depends on: Batch 1
- Phase: 1 Shipped policy | Phase review: none at this batch

### Task 2.1: Orchestration skill and references — IN_PROGRESS

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

### Task 2.2: agent-lanes §4, §5, §6 and completion — IN_PROGRESS

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

## Batch 3: Generic fleet mode in the plugin (B) — PENDING

- Recommended executor: CLI lane (capability: technical writing)
- Fallback executor: per the fallback order
- Execution mode: sequential
- Rationale: commands and git-standards link to the new `fleet.md`; one lane in order.
- Tasks: 3 | Depends on: Batch 2 (SKILL.md fleet entry)
- Phase: 1 Shipped policy | Phase review: none at this batch

### Task 3.1: Create `fleet.md` — PENDING

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

### Task 3.2: git-standards quiet commit window and local commitlint pointer — PENDING

- File: `P/skills/orchestration/references/git-standards.md`
- Plan reference: implementation-plan.md:57,65-66 (`:50-64,153-180`)
- Quality requirements: quiet commit window (generic); "read the repository's commitlint config" rather
  than any scope enum.

### Task 3.3: Orchestrate commands select fleet mode — PENDING

- Files: `P/commands/orchestrate.md`, `P/commands/orchestrate-help.md`
- Plan reference: implementation-plan.md:57,61 (`orchestrate.md:11-30`)
- Quality requirements: multiple ids or explicit "fleet" -> fleet mode; one id -> continuation; ids
  validated before spawn; help lists fleet mode.

### Batch 3 verification

- Scoped command: `npm run validate-skill 2>&1 | tail -60` — `fleet.md` exists, links resolve, cap and
  schema markers green; remaining red is only the template markers.
- Inspect `fleet.md` for vendor names, `npx nx`, or scope enums (none allowed).
- No per-batch review.

## Batch 4: team-leader template lanes-first schema and policy spec (C) — PENDING

- Recommended executor: CLI lane (capability: TypeScript + Jest)
- Fallback executor: per the fallback order
- Execution mode: sequential
- Rationale: the spec asserts strings the template edit writes.
- Tasks: 2 | Depends on: Batch 2 (shared vocabulary)
- Phase: 1 Shipped policy (last batch) | Phase review: code-logic on Batches 1-4 combined diff, by a
  family different from every Phase 1 implementer; style review not required (no new public API)

### Task 4.1: Executor matrix, cap and `batches.md` schema — PENDING

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

### Task 4.2: Template policy spec — PENDING

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

## Batch 5: Repo-local fleet migration (G1) — PENDING

- Recommended executor: CLI lane (capability: JS/TS editing)
- Fallback executor: per the fallback order
- Execution mode: sequential
- Rationale: small, related edits; the deletion goes last, after parity is confirmed.
- Tasks: 4 | Depends on: Batch 3 (parity transfer to `fleet.md`), Phase 1 review accepted
- Phase: 2 Repo-local migration | Phase review: none at this batch

### Task 5.1: Repo-local Nx and commitlint rules in CLAUDE.md — PENDING

- File: `CLAUDE.md`
- Plan reference: implementation-plan.md:66-67 (parity §6, §7)
- Quality requirements: keep every existing STRICT rule; add commitlint scope pointer/enum and the
  single/multiple-project Nx rule (`npx nx test <project> --parallel=1`; `npx nx run-many -t test -p A B
  --parallel=1` with the "Running target test for N projects" check; never positional `nx test A B`).

### Task 5.2: fleet-fix workflow header and prompts — PENDING

- File: `.claude/workflows/fleet-fix.js`
- Plan reference: implementation-plan.md:62,67,71 (`:2,7-15,135,170`)
- Quality requirements: header points to `P/skills/orchestration/references/fleet.md` and keeps the
  repo-local resume caveat; prompts at `:135,170` use the single/multiple-project rule.
- Validation notes: RISK — `:135` has the worker edit `task.md` `status:`; align with the
  status-ownership rule if the workflow has its own verification step, else record the divergence in
  the header and in the report.

### Task 5.3: Prompt suggestions — PENDING

- File: `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/prompt-suggestions.component.ts`
- Plan reference: implementation-plan.md:71 (`:228,299`)
- Quality requirements: replace `/fleet-orchestration ...` with `/orchestrate` fleet invocations (multiple
  task ids); labels unchanged in meaning.

### Task 5.4: Delete the old skill — PENDING

- Depends on: Tasks 5.1-5.3
- File: `.claude/skills/fleet-orchestration/SKILL.md` (delete; the approved exception)
- Quality requirements: only after every parity row (plan :59-69) is confirmed in its new home.

### Batch 5 verification

- Scoped command: `npx nx typecheck @ptah-extension/chat-ui --parallel=1 2>&1 | tail -20` (typecheck
  exercises the literal change; there is no spec for this component, so the full chat-ui test suite is
  not run — deviation from plan :90 recorded).
- Light checks: `node --check .claude/workflows/fleet-fix.js`; search for `fleet-orchestration` outside
  `.ptah/specs` returns only the Batch 6 fixture.
- No per-batch review.

## Batch 6: Benchmark fixture reference (G2) — PENDING

- Recommended executor: CLI lane (capability: TS/Jest, careful investigation)
- Fallback executor: per the fallback order
- Execution mode: sequential
- Rationale: a hash-pinned, versioned fixture; investigation before edit, with a stop condition.
- Tasks: 2 | Depends on: Batch 5
- Phase: 2 Repo-local migration (last batch) | Phase review: code-logic on Batches 5-6 combined diff,
  family different from the Phase 2 implementers

### Task 6.1: Investigate and retarget row 6 — PENDING

- File: `tools/mcp-bench/fixtures/memory-skills/skill-triggers.v1.jsonl`
- Plan reference: implementation-plan.md:71; context.md acceptance 7
- Pattern to follow: `tools/mcp-bench/src/memory-skills/ground-truth/fixture-manifest.ts`,
  `committed-u4-labels.spec.ts:31`
- Quality requirements: first read the fixture consumers. If committed labels or ground truth pin row 6
  content or line numbers, or skill ids must be unique, STOP without editing and report the evidence.
  Otherwise retarget row 6 so no row names `fleet-orchestration` (fleet triggers move to
  `orchestration`), keeping row count and line order.

### Task 6.2: Update the fixture manifest hash — PENDING

- Depends on: Task 6.1
- File: `tools/mcp-bench/fixtures/memory-skills/MANIFEST.json`
- Quality requirements: recompute the `skill-triggers.v1.jsonl` hash with the method in
  `fixture-manifest.ts` (canonical JSONL or raw bytes, whichever it uses for this file).

### Batch 6 verification

- Scoped command: `npx jest -c tools/mcp-bench/jest.config.ts
  tools/mcp-bench/src/memory-skills/ground-truth/committed-u4-labels.spec.ts
  tools/mcp-bench/src/memory-skills/projection.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -30`
  (add any other spec that reads MANIFEST.json for this file).
- Phase 2 review due after commit.

## Batch 7: Plugin version and content manifest (H2) — PENDING

- Recommended executor: CLI lane (capability: run node scripts)
- Fallback executor: per the fallback order
- Execution mode: sequential
- Rationale: one bump and one regeneration, after all content and every fix round.
- Tasks: 2 | Depends on: Batches 1-6, Phase 1 and Phase 2 reviews accepted
- Phase: 3 Packaging | Phase review: none — packaging only

### Task 7.1: Bump plugin version — PENDING

- File: `P/.claude-plugin/plugin.json`
- Quality requirements: `1.6.0` -> `1.7.0` (minor: new fleet mode and policy).

### Task 7.2: Regenerate the content manifest once — PENDING

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
