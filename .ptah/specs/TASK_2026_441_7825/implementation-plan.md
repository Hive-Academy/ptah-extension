# Implementation Plan - TASK_2026_441_7825

Revision: 2

## Changes from revision 1

- 1: Add static rule assertions, required template spec, and named manual walkthrough in `test-report.md`.
- 2: Enumerate all review edits; separate unchanged document gates from family-based shipping-code review; add grep regression.
- 3: Replace Markdown-only extension tests with validator/static/link checks.
- 4: Preserve validator checks while retargeting agent IDs to template filenames and updating diagnostics.
- 5: Demote shared/runtime/signal changes to optional follow-up; use existing quota and list evidence.
- 6: Define unknown-reset skip through this run and confirmed-room override.
- 7: Split H into file-disjoint H1 validator first and H2 version/manifest last.
- 8: Anchor fleet cap, judge schema, and single/multiple-project Nx rules.
- 9: Assign fleet task-status ownership and artifact-complete crash respawn behavior.
- 10: Locate the repo-local fleet-fix entry and correct its test prompts.
- 11: Preserve tribunal/strategies/agent-catalog document rules and include them in regression search.
- 12: Define Gate 0.1 memory/no-lane cases; defer optional persistent exhausted-lane memory.

## Inputs and design decisions

- Source of truth: `.ptah/specs/TASK_2026_441_7825/context.md:46-123` and `decisions.md:5-10`. Skill/command authorship is in `apps/ptah-extension-vscode/assets/plugins/ptah-core/`; agent rules are in `libs/backend/agent-generation/templates/agents/`. Never author generated `.claude/agents/**`, mirrored `.claude/skills/**`, `.codex/agents/**`, or `.opencode/agent/**`. The approved deletion of obsolete repo-local `.claude/skills/fleet-orchestration/SKILL.md` is the sole exception (`context.md:91-101`). No commit.
- Lanes-first: a spawnable capable lane gets bounded batches, tests, research, and code reviews by default. A subagent needs a stated reason. Existing defaults favor subagents for coupled work (`team-leader.template.md:151-163`) and `auto` at Gate 0.1 (`checkpoints.md:165-182`). Sequential cross-file work can use one lane; parallel work stays file-disjoint.
- Review has two contracts. Gates 1/1.7/2 retain independent opposite **execution-side** document review and user escalation on same-side review, capped REVISE, or proposed removal (`orchestration/SKILL.md:89-124`; `checkpoints.md:94-101`). Shipping code uses an independent different-**family** reviewer where available; same-family review needs a reason and weaker-evidence label. Current `agent-lanes/SKILL.md:162-179` conflates them.
- Runtime limit/completion mechanics exist: classifier parses clock reset and excludes capacity/auth/timeout (`lane-limit-classifier.ts:1-25,120-158,199-214`); manager records quota and ledger evidence (`agent-process-manager.service.ts:2362-2379,2432-2464,2505-2522`); list reports AT LIMIT and UTC reset/unknown (`agent-limit.formatter.ts:290-329`); both transports refuse known-limited spawns absent `force` (`protocol-dispatcher.ts:1189-1200`; `agent-tool.dispatcher.ts:411-432`); push completion verifies declared files (`lane-completion-notifier.service.ts:499-535,617-679`). No second parser, cache, watcher, or envelope.
- Fleet is a generic mode of `/orchestrate`. `agent-lanes` remains the internal lane contract. Old fleet skill mixes generic protocol with repo-specific Nx/commitlint rules (`.claude/skills/fleet-orchestration/SKILL.md:14-164`); only repo-local files retain those rules.
- Plugin packaging: version 1.6.0 (`plugin.json:4`), one bump and one `node scripts/generate-content-manifest.js`, followed by `npm run manifest:check` and `npm run validate-skill` (`package.json:66-69`). Validator currently reads mirrors (`scripts/validate-orchestration-skill.ts:147-154`), so H1 retargets before a pass counts.

## Current-state inventory, scope 1-5

| Scope | State, evidence | Needed |
| --- | --- | --- |
| 1 executor/review | Partial: phases can be lanes (`lane-assignment.md:72-88`), but template favors subagents (`team-leader.template.md:151-163`) and lane-authored code routes to a subagent (`agent-lanes/SKILL.md:166-175`). | Lanes-first and separate family code rule; retain document gates. |
| 2 memory | Partial: general ladder names `ptah_memory_search` (`orchestration/SKILL.md:60-74`), Gate 0.1 omits it (`checkpoints.md:155-195`). | Search/pre-select before notice. |
| 3 quota | Partial: runtime quota/reset/list/spawn guard exists (above); skill only has generic two-failure reassignment (`agent-lanes/SKILL.md:135-149`). `AgentFailureKind` already includes quota (`agent-process.types.ts:55,161-163`). | Ordered skill fallback and run-local exhausted table. |
| 4 reliability | Partial: two failures reassign to another lane (`agent-lanes/SKILL.md:142-149`), without next-lane-then-subagent rule. | Explicit non-limit path. |
| 5 completion | Exists: signal and deliverable verdict (`agent-lanes/SKILL.md:94-129`; `lane-completion-notifier.service.ts:499-535,617-679`). | Verify contents; one status/read fallback. No watcher. |

## Exact shipped skill and template edits

All skill paths below are under `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/` (Nx project `ptah-extension-vscode`).

- `orchestration/references/checkpoints.md:94-107,128-146,155-195`: At `:94-107` label Approval mode as applying to document Gates 1/1.7/2 and preserve cross-side APPROVED plus all five escalations; at `:128-146` retain opposite-side document protocol, same-side -> user, REVISE at cap -> user, and removal -> user. Do not route shipping-code reviews through this document gate. Replace Gate 0.1 triggers and notice with: “Before selecting a lane mode, call `ptah_memory_search` for user execution preference, then inspect current request, task context/settings, and `ptah_agent_list`. Current explicit instruction wins. For conflicting/stale memory, use most recent unambiguous preference; if unresolved, ask. With no preference and a spawnable capable lane, pre-select `enabled`; `auto` stays selectable. If memory unavailable, record `preference unknown` and use that default. If stored preference wants lanes but none is spawnable, use `disabled`, tell user why, set `Approval: user`; never imply enabled lanes. Record source, mode, approval, rows in `context.md`.” A current user pin and existing lane-review eligibility still win.
- `orchestration/SKILL.md:80,89-124,153-171`: Update Gate 0.1/default, phase code-review wording, and on-demand reference table. Retain opposite-side review before Gates 1/1.7/2, cross-side APPROVED in lane-review mode, and user escalation on same-side, capped REVISE, or removal. Add: “`/orchestrate TASK_A TASK_B ...` or explicit fleet loads `references/fleet.md`; one ID keeps ordinary continuation.” Validate IDs before spawning.
- `orchestration/references/lane-assignment.md:18-39,55-109`: Replace `:72-88` code-review row with different-family capable lane, exception reason/weak-evidence label; keep document-review row opposite-side. Replace `:107-109` CLI-author-to-subagent rule with explicit code/document distinction. Preserve batch cap `:78-80` and UI/browser/git boundaries. Replace named-vendor worked roster `:92-105` with live-row placeholders; no fixed vendor roster. Bounded batches, tests, research, reviews default to lanes, including sequential coupled files.
- `orchestration/references/team-leader-modes.md:36-41,64-95`: Preserve one eligible phase code-logic review and cap. Assign it to independent different-family lane when available; Next action/summary records actual executor, author/reviewer family, same-family reason and weaker-evidence label, and subagent fallback cause.
- `agent-lanes/SKILL.md:135-149`, replace §5 recovery: “Classify terminal evidence as quota/usage-limit, auth, crash, timeout, bad/missing output, or unknown. Typed `failureKind: quota` and `ptah_agent_list` limit state are quota authority; never infer quota from timeout/capacity/missing deliverable. On quota, record lane ID/family and list-row reset or `reset unknown` in this run's `context.md`; do not force-spawn. Choose in order: other family same capability; same family other provider/model; subagent with reason. Skip known-reset lane until cleared. With unknown reset, skip it for rest of run; re-check via `ptah_agent_list` only at next Gate 0.1 or user request. A fresh list row with confirmed room overrides the exhausted entry. On non-limit failure, resume once if session ID/useful work exists, otherwise respawn once narrower; after two non-limit failures on that lane choose next eligible lane, then subagent. Report fallback/cause/reset. Never silently replace a pin.” A resumed lane has a new agent ID (`:137-140`); no original-record clear rule.
- `agent-lanes/SKILL.md:162,164-176,177-179`: Edit **all** code/review routing sites; split mixed bullet into:
  - **Document gates (unchanged):** “Decision artifacts use an independent opposite-execution-side reviewer. A same-side review goes to user rather than approving Gate 1/1.7/2 in lane-review mode; REVISE at cap and proposed removals also go to user. Keep document verdict and `checkpoints.md` protocol.”
  - **Shipping code (different family):** “Use independent code reviewer from a different family than implementer regardless of execution side; keep `code-logic-review.md`. Same-family review requires specific reason and weaker-evidence label. An in-process subagent reviewing code by an in-process subagent of same family also requires both. If no eligible lane reviews, use independent subagent only with same reason/label; never claim unavailable review.” Retain defect `file:line`, cap, parity, visual checks, and scoped tests (`:159-189`).
- `agent-lanes/SKILL.md:94-129` completion: “Declare `deliverables`; pushed `<agent-lane-completed>` is wake; read status/output and verify contents. If push unavailable, do one status/read check. Missing/empty file is not complete.” No timer/watcher.
- `libs/backend/agent-generation/templates/agents/team-leader.template.md:140-171,198-205` (`@ptah-extension/agent-generation`): replace executor matrix with “Recommend `CLI lane` for every bounded batch, including sequential coupled/cross-file work; parallel requires disjoint files. Subagent recommendation names missing capability, interaction/visual/git need, user pin, or exhausted fallback. Orchestrator resolves live rows.” Preserve/add exact cap: “At most 6 files across at most 2 libraries/projects per batch, with one scoped verification command.” `batches.md` schema must contain `Recommended executor: CLI lane [capability]`, `Execution mode: sequential | parallel`, `Fallback order: other family same capability -> same family other provider/model -> subagent`, `Subagent reason: <specific reason | N/A>`, `Review family: different from implementer | exception reason`. Keep task/commit ownership (`:165-171,242-315`).
- **Required template test:** new `libs/backend/agent-generation/src/lib/team-leader-template.policy.spec.ts` reads source template and asserts exact schema keys, default, cap, and required subagent reason. Other templates lack the batch executor matrix; shared `templates/agents/_shared/cli-delegation.md:1` remains unchanged.

## Fleet merge parity and repo-local migration

Create generic `orchestration/references/fleet.md`; modify shipped `commands/orchestrate.md:11-30`, `commands/orchestrate-help.md`, and `orchestration/references/git-standards.md:50-64,153-180`. Fleet validates IDs, resumes from artifacts, schedules disjoint paths, runs read-only judges, and uses quiet commit windows. No vendor roster, Nx command, or local commitlint enum in shipped plugin.

| Old section | New home / retained rule | Evidence |
| --- | --- | --- |
| §1 Entry | `fleet.md` Entry; command selects fleet for multiple IDs or explicit fleet. | old `:14-27`; command `:11-30` |
| §2 Harness limitation | repo-local `.claude/workflows/fleet-fix.js` resume caveat; generic disk resume in `fleet.md`. | old `:29-44`; workflow `:7-15` |
| §3 Checkpoints | `fleet.md` Checkpoints: artifact before status; judge JSON keys `taskId, round, pass, defects[], testsRan, mentorNote`, filename `judge-round-<round>.json`; respawned worker with complete artifact no-ops. | old `:46-62`; workflow `judgeSchema` |
| §4 Disjoint batching | `fleet.md`: “At most 6 files across at most 2 libraries/projects per batch, with one scoped verification command”; parallel only for nonoverlapping writes. Template and `lane-assignment.md:78-80` keep cap. | old `:64-80` |
| §5 Commit window | shipped `git-standards.md` quiet window; runner hooks repo-local. | old `:82-95`; git ref `:153-180` |
| §6 Commitlint | repo-local `CLAUDE.md` scope enum; shipped git ref says read local config. | old `:97-111`; git ref `:50-64` |
| §7 Nx tests | repo-local `CLAUDE.md` and workflow: single project `npx nx test <project> --parallel=1`; multiple `npx nx run-many -t test -p <projectA> <projectB> --parallel=1`, check “Running target test for N projects” matches N. Delete contrary unconditional rule; never positional `nx test projA projB`. | old `:113-127`; `CLAUDE.md:3-16`; workflow `:135,170` |
| §8 Judge | `fleet.md` read-only judge, cited defects, schema above, two-round cap; judge never edits `task.md`. | old `:129-143` |
| §9 CLI mechanics | Dropped, duplicate of `agent-lanes/SKILL.md` §§1,3,4,8; `fleet.md` links there. | old `:144-164`; lane skill `:12-34,94-133,217-232` |

`fleet.md` additionally says only orchestrator/team-leader writes `task.md` `status:` after artifact verification; workers/judges do not (`task-tracking.md:61,75-76`). No separate `.claude/skills/fleet-fix` exists here; `.claude/workflows/fleet-fix.js:2` is the repo-local entry, and its header points to new `fleet.md`. Fix its `:135,170` prompts to use single/multiple-project rule, not unconditional run-many. Delete only old `.claude/skills/fleet-orchestration/SKILL.md` after parity transfer. Update live references `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/prompt-suggestions.component.ts:228,299` and `tools/mcp-bench/fixtures/memory-skills/skill-triggers.v1.jsonl:6`; historical specs stay as evidence.

## Validator, runtime scope, and regression

- `scripts/validate-orchestration-skill.ts:147-154,405-424,433-450,495-509,543-593`: retarget skill root to shipped `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration` and agent lookup to `libs/backend/agent-generation/templates/agents/<agent>.template.md`. Keep `validateAgentFilesExist`, syntax, internal-link, strategy-documented, agent-documented, invocation-pattern, required-section and line-count checks. Add `fleet.md` to `REQUIRED_REFERENCES`. Fix mirror-path errors/suggestions/missing-root text (`:416-419,506,560`). `REQUIRED_AGENTS` (`:108-123`, 14 IDs) is a subset of template basenames; verify all via retained check.
- Add static rule-marker assertions to that validator: Gate 0.1 `ptah_memory_search` precedes mode selection and no-preference `enabled`; assignment/template contain CLI-lane default and `Subagent reason`; lane §5 orders “other family same capability”, “same family other provider/model”, “subagent” and unknown-reset skip; lane §6 has `Document gates` and `Shipping code` headings with different-family/reason/weaker markers; fleet has cap and judge-schema keys. Check section boundaries and order so stray occurrence cannot pass; diagnostic names file/section.
- Post-edit grep over plugin `agent-lanes/SKILL.md`, `orchestration/SKILL.md`, `references/checkpoints.md`, `references/lane-assignment.md`, `references/team-leader-modes.md`, `references/strategies.md`, `references/agent-catalog.md`, `tribunal/SKILL.md`, `tribunal/references/relay.md`: verify opposite-side document gate and same-side -> user, capped REVISE -> user, removal -> user sentences survive in agent-lanes and checkpoints; no remaining “CLI author -> subagent” shipping-code or “code that will ship -> cross-side” rule. Tribunal (`relay.md:20-21`; `SKILL.md:14`), strategies (`:6,35,58`), and agent-catalog (`:97,104`) concern document gates and need no edit.
- **No required runtime edits.** Failed record has typed quota and list has reset (`agent-process.types.ts:55,161-163`; `agent-limit.formatter.ts:290-329`). Skills match failed lane to list row and record run-local exhaustion/reset. Do not add shared `failureResetsAt` or change manager, notifier, status formatter. Optional follow-up only if real run proves list-row identity cannot resolve reset; verify cross-host `AgentProcessInfo` serialization and scope dependent typechecks first. Persistent memory for exhausted lanes is deferred; run-local `context.md` is required.

## File-disjoint batches and verification

One owner per file, at most 6 files/2 Nx projects. Run heavy checks serially. H1 lands first; A/B/C/G are disjoint; H2 lands last after plugin/template edits. H1 full validator can pass only after A/B/C. No workspace-wide, build, serve, dev, e2e, or package command.

| Group | Files owned | Verification |
| --- | --- | --- |
| H1 validator first | `scripts/validate-orchestration-skill.ts` (1; root) | `npm run validate-skill` after A/B/C; check all 14 templates resolve and targeted missing-marker diagnostics. |
| A policy | plugin `orchestration/SKILL.md`, `references/checkpoints.md`, `references/lane-assignment.md`, `references/team-leader-modes.md`, `agent-lanes/SKILL.md` (5; extension assets) | `npm run validate-skill` after B/C; targeted validator link/static checks and grep regression. No extension project test. |
| B fleet plugin | plugin `references/fleet.md`, `references/git-standards.md`, `commands/orchestrate.md`, `commands/orchestrate-help.md` (4; extension assets) | `npm run validate-skill` after A/C; targeted command/fleet links, schema/cap markers. No extension project test. |
| C template | `team-leader.template.md`, new `src/lib/team-leader-template.policy.spec.ts` (2; `@ptah-extension/agent-generation`) | `npx nx test @ptah-extension/agent-generation --parallel=1`; validator template marker after A/B. |
| G repo-local | `CLAUDE.md`, `.claude/workflows/fleet-fix.js`, old `.claude/skills/fleet-orchestration/SKILL.md` deletion, `prompt-suggestions.component.ts`, `skill-triggers.v1.jsonl` (5; chat-ui + root) | `npx nx test @ptah-extension/chat-ui --parallel=1`; targeted JSONL parse, prompt inspection, live-reference search. |
| H2 packaging last | plugin `.claude-plugin/plugin.json`, root `content-manifest.json` (2; root + extension assets) | Single bump, one `node scripts/generate-content-manifest.js`, `npm run manifest:check`, final `npm run validate-skill`. |

## Acceptance criteria to verification

| Criterion | Executable evidence and owner |
| --- | --- |
| 1 no-pin lanes/subagent reasons | H1 static default/assignment markers; C template spec. Orchestrator records **Lanes-First Gate 0.1 and Quota Walkthrough** in `test-report.md` with no-pin batch/review and every subagent reason. |
| 2 same-family disclosure | H1 §6 family/reason/weaker markers; A grep preserves document gates. Walkthrough includes one-family and in-process subagent case with reason/label. |
| 3 memory preselection | H1 memory-before-selection/no-lane markers. Walkthrough records preference hit, conflict/stale case, unavailable memory, resulting notice. |
| 4 quota order/reset/skip | Existing runtime spec `agent-process-manager.service.spec.ts:1975-2014` is code evidence; no runtime edits. H1 checks skill ordering and unknown-reset skip. Walkthrough injects simulated quota, records list reset/unknown, fallback/summary, and later batch skip. Skill-level ordering is manual evidence, not an automated runtime claim. |
| 5 template schema | C spec asserts default, cap, fallback fields, reason; H1 checks policy agreement. |
| 6 completion/fleet | Existing notifier evidence above; B link/schema checks; G live-reference/JSONL checks. Walkthrough records deliverable check, two disjoint tasks, resumed artifact, read-only judge. |
| 7 packaging/generic plugin | H2 bump/manifest/check/validator; inspect fleet reference for local command/scope leakage. |

The walkthrough is a named **manual acceptance gate** owned by orchestrator/team-leader during implementation. `test-report.md` must contain inputs, sanitized tool responses, decisions, fallback order, output paths, and pass/fail verdict; prose rules alone are not a pass. This revision edits only this plan.

## Clarifications Needed

None; existing runtime and decisions settle the scope.
