# Code Logic Review — TASK_2026_441_7825, Phase 1

Reviewer: Glm ptah-cli (Ollama Cloud family); Implementer family: codex; Diff range: 2e0811f0a~1..5991b51be; Score: 7/10; Verdict: APPROVED.

## Scope examined

Changed files in the range, all read in full. Skill paths are under `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/` unless named otherwise:

- `agent-lanes/SKILL.md`, `orchestration/SKILL.md`
- `orchestration/references/checkpoints.md`, `lane-assignment.md`, `team-leader-modes.md`, `git-standards.md`, `fleet.md`
- `commands/orchestrate.md`, `commands/orchestrate-help.md`
- `libs/backend/agent-generation/templates/agents/team-leader.template.md`
- `libs/backend/agent-generation/src/lib/team-leader-template.policy.spec.ts`
- `scripts/validate-orchestration-skill.ts`

Checks performed: comparison of `git-standards.md`, `orchestrate-help.md`, the validator, and `agent-lanes/SKILL.md` against their pre-change versions (`git show 314813c3e~1` and `2e0811f0a~1`). Trace of every validator marker against the text it checks. Grep for vendor names, TODO and STUB markers, and the removed "CLI author" shipping rule. Fleet parity against the old `fleet-orchestration` skill, per the plan table (implementation-plan.md:59-69).

This review ran no command. The task record (batches.md) states that each batch passed its scoped check. Every claim below comes from reading the files.

## Answers to the five logic questions

1. **How does this fail silently?** One path exists. The validator check for the team-leader template reads markers that occur only inside the fenced `batches.md` example block. If an editor removes the prose rule but keeps the fenced example, `npm run validate-skill` still passes. See Finding 1. Every other failure path in the changed policy text ends in a recorded fallback, an escalation, or an error.
2. **What user action produces unexpected behaviour?** A mid-run "use lanes more" instruction after Gate 0.1 chose `disabled` with approval `user`. The Response Handling row and the Gate 0.1 table give two different approval answers. See Finding 5.
3. **What input data makes this produce a wrong answer rather than an error?** Stale memory at Gate 0.1. A recent but outdated preference selects lanes-first, and the rule asks the user only when memory conflicts. This behaviour is what the task requested. The recorded source, mode, and approval in `context.md` keep the choice auditable. Not a finding.
4. **What happens when a dependency fails, times out, or returns a wrong shape?** A timeout is never read as a usage limit (agent-lanes/SKILL.md:135-157). Memory failure and an empty roster both have defined paths (checkpoints.md:165-179). One gap exists: when push is unavailable and the single status check says "still running", the policy leaves no legal next action until the lane's own inactivity timeout ends the turn. See Finding 4.
5. **What is missing that the requirements never mentioned?** The "still running" branch above, and a home for the old code-quality standards that the `orchestrate-help.md` rewrite removed. See Findings 3 and 4.

## Findings

### Finding 1 — Moderate — Validator template markers match only the fenced example block

**Evidence.** `validateRuleMarkers` uses its fence state only to find the section end (scripts/validate-orchestration-skill.ts:579-592). The content slice at :594 includes fenced lines, so markers can match inside fenced code. The template check at :633-635 asserts `Recommended executor: CLI lane` and `Subagent reason:`. In `team-leader.template.md` those strings occur only inside the fenced `batches.md` example, at :205 and :208. The prose rule at :157-163 (`Recommend `CLI lane` for every bounded batch by default`, `Put that reason in `Subagent reason``) is not asserted by the validator.

**Failure scenario.** An editor deletes the prose default at :157-163 and keeps the fenced schema. `npm run validate-skill` passes. The prose rule is then protected only by `team-leader-template.policy.spec.ts:12`, which runs in a different project. A person who runs only the validator sees a pass for a template that no longer states the default.

**Required change.** Point the markers at the prose, for example `Recommend `CLI lane` for every bounded batch by default`, or add a second marker list for the prose section. Keep the fenced-schema check as well.

### Finding 2 — Moderate — git-standards.md lost the per-command destructive-operations table. Removal needs user ratification

**Evidence.** The old file (`git show 314813c3e~1`) listed seven commands with per-command risks: `reset --hard`, `push --force`, `rebase --hard`, `clean -f`, `branch -D`, `checkout .`, `restore .`. The new file has one sentence: "Do not discard or overwrite work with reset, clean, force push, or equivalent commands without explicit authorization." (git-standards.md:86-88). `git branch -D` and `git checkout .` are no longer named. decisions.md #12 lists the sections the user asked to restore. The destructive table is not in that list. The batches.md Batch 3 fix note defers this judgment to this review.

**Failure scenario.** An agent reads the one sentence and must decide which other commands are "equivalent". `git branch -D` deletes an unmerged branch. It does not look like reset, clean, or force push. A weaker model can run it without authorization because the enumeration is gone. The hard gate ("without explicit authorization") survives, so this is a guardrail-precision loss, not a lost gate.

**Required change.** Put this removal before the user before Batch 5. If the user accepts the one-sentence rule, keep it. If not, restore the per-command table.

### Finding 3 — Moderate — orchestrate-help.md lost ~100 lines. Some content has no new home. Removal needs user ratification

**Evidence.** The old file (`git show 314813c3e~1`, about 140 lines) contained a phase walkthrough, quality standards (zero `any` types, functions under 30 lines, coverage above 80 percent), a registry status command, troubleshooting, best practices, and exit criteria. The new file is 37 lines. decisions.md #13 records acceptance without user sign-off, because the walkthrough referenced `progress.md` and `/validate-*` commands that do not exist.

The stale references were correct to remove. The quality standards were not stale. They were repo-specific, so they cannot stay in the shipped plugin. But the repo-local batch (G) covers the commitlint and Nx rules only (implementation-plan.md:67, :90). The quality standards are not scheduled to land anywhere.

**Failure scenario.** The run loses its written code-quality bar. After Batch 5, no file in the plugin or in the repo-local files this task plans to touch says "coverage above 80 percent". A future fleet run has no instruction that states those standards.

**Required change.** Ask the user to ratify the removal. If the user wants the standards, move them to the repo-local `CLAUDE.md` in Batch 5.

### Finding 4 — Moderate — agent-lanes §4 leaves no legal action when the single status check says "still running"

**Evidence.** agent-lanes/SKILL.md:117-121: when push is unavailable, "make one status/read check. Do not use a timer, watcher, or repeated status checks as a substitute." The old skill (2e0811f0a~1, §4) allowed a bounded poll: one check, then wait at least 60 s, at most 5 checks per lane, never a loop. The plan chose the new text (implementation-plan.md:51, "No timer/watcher") and thereby removed the old bounded fallback. The removal is not in the user's restore list.

**Failure scenario.** A host without push. The single check reports the lane still running. The rule forbids a second check. No signal will arrive. The orchestrator must wait until the lane's own inactivity timeout ends the turn. With the default 1-hour timeout, one lane can stall the run for up to an hour. The reliability fallback in §5 does not apply, because the lane has not failed.

**Required change.** Restore a bounded re-check rule, for example "at most 5 checks per lane, spaced at least 60 s", or state the action for the still-running case.

### Finding 5 — Minor — checkpoints.md "use lanes more" row conflicts with the Gate 0.1 mode table

**Evidence.** The Response Handling row (checkpoints.md:197-201, unchanged by this diff) says a "use lanes more" response sets mode `enabled` and leaves approval "unchanged". The Gate 0.1 table (:165-179) derives approval from the mode and the roster: `enabled` with a spawnable lane gives `lane-review`.

**Failure scenario.** Gate 0.1 decided `disabled` with approval `user`. Mid-run, the user says "use lanes more". The two rules give different approval answers. One path reviews lane work on its own, the other keeps every approval with the user.

**Required change.** Update the Response Handling row. Say that the Gate 0.1 derivation applies again, or say that approval stays as decided at Gate 0.1.

### Finding 6 — Minor — agent-lanes §5 lost the in-process end-state row

**Evidence.** The old §5 table had: "No lane available at all → Do the work in-process and label it as not an outside lane." The new §5 (agent-lanes/SKILL.md:135-157) does not repeat it. The rule survives at agent-lanes §1 and at lane-assignment.md:128-129.

**Failure scenario.** A reader who uses §5 alone as the recovery playbook does not see the final fallback. The behaviour is still defined elsewhere, so the risk is low.

**Required change.** None required. Add one sentence in §5 that names the in-process fallback, or accept the current placement.

## Verified correct

- **Lanes-first default.** `Batches on lanes` makes a CLI lane the default executor for every bounded batch and requires a `Subagent reason` for a subagent (lane-assignment.md:39-44). The template carries the same rule and the same reason categories (team-leader.template.md:157-163). The spec asserts the exact prose (team-leader-template.policy.spec.ts:11-44).
- **Gate 0.1 memory-first with edge cases.** Memory read before mode selection. Current explicit instruction wins. Stale or conflicting memory uses the most recent unambiguous preference, else ask. No preference with a spawnable capable lane gives `enabled`, and `auto` stays selectable. Memory unavailable gives `preference unknown` and the no-preference default. Lanes preferred but none spawnable gives `disabled`, an explanation, and `Approval: user`. Source, mode, approval, and rows are recorded in `context.md` (orchestration/SKILL.md:82, 91-96; checkpoints.md:165-179).
- **Document gates unchanged.** Opposite-execution-side review for Gates 1, 1.7 and 2. Same-side review goes to the user. REVISE at the cap goes to the user. A proposed removal goes to the user (agent-lanes/SKILL.md:172-184; checkpoints.md:105-111). The "CLI author" text at agent-lanes/SKILL.md:175 is this document-gate rule, not the removed shipping rule.
- **Shipping-code review by a different family.** Different family regardless of execution side. Same-family review needs a specific reason and a weaker-evidence label. The same-family rule also covers an in-process subagent that reviews an in-process subagent. A subagent reviewer is a fallback only, with the same reason and label. The policy never claims an unavailable review (agent-lanes/SKILL.md:185-193; orchestration/SKILL.md:103-105; team-leader-modes.md:36-41, 65-68; lane-assignment.md review row; team-leader.template.md:99-103). Document-gate approval mode does not apply to code (orchestration/SKILL.md:103-105; checkpoints.md:94-115).
- **Usage-limit fallback order.** `AT LIMIT` authority is the `ptah_agent_list` row plus lane output. A limit is never inferred from timeout, capacity, or a missing deliverable. Lane ID, family, cause, and reset are recorded in the run's `context.md`. No force-spawn. Order: other family same capability, then same family other provider or model, then subagent with reason. Unknown reset skips the lane for the rest of the run, with a re-check at the next Gate 0.1 or user request. A fresh list row with confirmed room overrides the exhausted entry. A pin is never silently replaced (agent-lanes/SKILL.md:135-157).
- **Reliability fallback.** Non-limit failure: resume once when a session ID and useful work exist, else respawn once with a narrower prompt. After two non-limit failures on that lane: next eligible lane, then subagent (agent-lanes/SKILL.md:147-155).
- **Per-turn completion rule.** One `<agent-lane-completed>` signal per lane turn. A queued message runs as a new turn after `delivered` and can change the deliverable. A later signal supersedes an earlier one. No review starts while a queued message is pending (agent-lanes/SKILL.md:94-127). The quiet commit window echoes the rule (git-standards.md:45).
- **Fixed vocabulary.** `Document gates`, `Shipping code`, `other family same capability`, `same family other provider/model`, `subagent`, `Subagent reason`, `Review family`, `reset unknown`, `AT LIMIT` occur with the same wording in every file that uses them. No cross-file contradiction was found in agent-lanes §§4-§6, checkpoints, lane-assignment, team-leader-modes, the template, or orchestration/SKILL.md, apart from Finding 5.
- **Validator old checks.** The old file had nine checks: markdown syntax, internal references, strategies documented, agents documented, agent files exist, skill structure, invocation patterns, reference files exist, line count (`2e0811f0a~1:232-520`). The new file retains all nine and adds the rule-marker checks. The retarget points the skill root at the shipped plugin and the agent lookup at `libs/backend/agent-generation/templates/agents/` (scripts/validate-orchestration-skill.ts:147-154 area, current file). `fleet.md` is in `REQUIRED_REFERENCES`. The script is wired at package.json:66. The silent empty return for a missing file (:561-565) applies to files that the required-file checks already cover, so no missing file passes silently in practice.
- **The spec can fail.** It reads the source template through `join(__dirname, '..', '..', 'templates', 'agents', ...)` (team-leader-template.policy.spec.ts:4-7), which resolves from `src/lib`. It asserts real rule sentences, not only schema keys (:12, :20-23, :38-43). If either mode heading is renamed or removed, `decomposition` is undefined and every assertion fails. This is a real rule check, not a string presence check that cannot fail.
- **Plugin genericity.** In the changed plugin files, the only vendor string is the pre-existing cost measurement "over 7 days of Codex lanes" (agent-lanes/SKILL.md:239), not a roster. No Nx command, no commitlint scope enum, and no `.claude/workflows/fleet-fix.js` reference appears in the changed files. git-standards.md:7 says to read the repository's commitlint config. Lane-assignment and the template replace the old vendor roster with live-row placeholders.
- **Fleet parity per the plan table.** §1 Entry: fleet.md Entry plus ID validation before any spawn (orchestrate.md:21). §2: generic disk resume, respawned worker no-op (fleet.md). §3: judge JSON keys `taskId, round, pass, defects, testsRan, mentorNote`, file `judge-round-<round>.json`, artifact before status, only the orchestrator or team-leader writes `task.md` `status:` (fleet.md Checkpoints; orchestrate-help.md:29-30). §4: the exact batch cap sentence (validator-checked in fleet.md and template:148). §5: quiet commit window with the hook save-restore hazard and the queued-turn check (git-standards.md:43-48). §6: generic config-read rule; the repo-local scope enum is deferred to Batch 5. §7: repo-local, deferred to Batch 5. §8: read-only judge, cited defects, two-round cap (fleet.md Judge protocol). §9: dropped as a duplicate per the plan, with links to agent-lanes §§1, 3, 4, 8.
- **TODO, PLACEHOLDER, STUB.** None in the changed files. The only hits in the plugin are rule text in `review-logic.md`, which this diff does not touch.

## Score and verdict

Score 7/10. Every required behaviour in scope items 1 to 7 is present, consistent across files, and asserted by two wired checks, the validator and the Jest spec. No Blocking or Serious defect was found. What separates this score from 8: two removals wait for user ratification (Findings 2 and 3), one recovery branch is undefined (Finding 4), and one validator check does not protect the prose rule it was written for (Finding 1).

Verdict: APPROVED. Findings 2 and 3 must go to the user before Batch 5, because proposed removals belong to the user, not to this review.