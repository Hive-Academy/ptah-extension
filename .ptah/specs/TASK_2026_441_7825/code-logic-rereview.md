# Code Logic Re-review — TASK_2026_441_7825, fix batch 4F

Reviewer: Glm ptah-cli (Ollama Cloud family); Implementer family: codex; Diff: 6c57bf67e~1..6c57bf67e; Verdict: APPROVED.

## Scope examined

Commit `6c57bf67e` (6 files: `batch-4f-report.md`, `batches.md`, `agent-lanes/SKILL.md`, `checkpoints.md`, `git-standards.md`, `scripts/validate-orchestration-skill.ts`). All four changed source files were read in full, once. Two unchanged files were read because the checks demand it: `orchestration/SKILL.md` (check 5) and `libs/backend/agent-generation/templates/agents/team-leader.template.md` (check 1 target). Context: `code-logic-review.md` findings 1, 2, 4, 5; `decisions.md` rows 14, 16, 17; `batch-4f-report.md`; the four per-file diffs of the commit.

Checks performed: every new validator marker was traced to the text it asserts, with the section boundary and fence position of each target section verified. The validator diff was confirmed additions-only (15 insertions, 0 deletions). The new agent-lanes §4 no-push path was traced against the per-turn signal rule, §5 recovery, and every file that states a status-check rule (one sweep over the plugin and the agent templates). The checkpoints "use lanes more" cell was compared with the Gate 0.1 table and the approval-mode table. Grep for `TODO|PLACEHOLDER|STUB|FIXME` ran on each changed file.

This review ran no command (read-only mandate). The implementer's validator run is the execution evidence (`batch-4f-report.md`: exit 0, 9 files, 0 errors). The marker binding was verified by reading `validateRuleMarkers` in full (validate-orchestration-skill.ts:554-618).

## Per-check results

### Check 1 — Finding 1: new validator markers check prose; no existing check removed or weakened — CLOSED

- New prose check: validate-orchestration-skill.ts:640-642 asserts `Recommend `CLI lane` for every bounded batch by default` and `Put that reason in `Subagent reason``. Both occur as prose in team-leader.template.md:157 and :163, inside the `### Batch` section (:145). The section slice ends at the next heading, `### Output contract` (:178). No fence exists between :146 and :177; the fenced `batches.md` example sits at :182-243, outside the slice. The markers bind to prose, not fenced code.
- The fenced-schema check is kept verbatim (:637-639, `Mode 1 — Decomposition`), as Finding 1's required change asked.
- Nothing was removed or weakened: the validator diff is additions-only. The first `Checkpoint 0.1` list (:627-629), `Approval mode` (:633-635), `Batches on lanes` (:636), the first `4. Run` list (:643-645), all three `5. Recover` lists (:650-656), all three `6. Verify and revise` lists (:657-665) and both fleet checks (:666-671) are unchanged.
- Mechanism note, not a finding: `validateRuleMarkers` still includes fenced lines in a section slice when a fence exists inside it — the fence state is used only to find the section end (:580-592, slice :594). Two new checks target sections that contain a fence, and in both cases the markers occur only in prose: the `4. Run` list (:646-649) has its five markers only in the prose at agent-lanes/SKILL.md:119-125, not in the spawn/wait fence (:96-101); the checkpoints list (:630-632) has its markers only in the Response Handling table (:201), not in the fenced Gate 0.1 template (:185-193). Finding 1's accepted remedy was to point markers at the prose, and the commit does that; the mechanism limitation the finding documented stays by design.

### Check 2 — Finding 2 / decisions.md row 17: generic destructive table with Ask-first and inspect-state rules; no repo names — CLOSED

- Ask-first rule: git-standards.md:88, including the equivalent-commands catch-all.
- Named per-command table: :90-98. Commands named: `git reset --hard`, `git clean -fd`, `git checkout .`, `git restore .`, `git branch -D`, `git push --force` (with `--force-with-lease`), `git rebase` on a shared or already-pushed branch, `git stash drop`, `git stash clear`. Every command of the old table is covered; the stash pair is added.
- Inspect-state rule: :100 — `git status`, `git log`, `git stash list`, the exact paths touched, and showing the user what would be lost.
- No repo names: the full file names only git commands and generic tooling. No project path, vendor roster, or commitlint scope appears. The anchors the implementer claimed are intact: `Quiet commit window` :43, `Hook Failure Protocol` :49.
- decisions.md:20 (row 17) records the user's choice "Restore the named list" (AskUserQuestion 2026-10-13). The restoration satisfies it. Finding 2 closes by user ratification plus the restored table.

### Check 3 — Finding 4: bounded re-check consistent with the per-turn signal rule and "no timer or watcher" — CLOSED

- agent-lanes/SKILL.md:119-125: push unavailable → one status/read check → if `running`, continue other independent work and re-check with at most 5 status checks per lane, at least 60 s apart → "Do not use a tight loop, timer, or watcher" → if the fifth check still reports `running`, tell the user (agent ID and lane) and end the turn, or use `ptah_agent_stop` and recover per §5 as a non-limit timeout, "never as a usage limit".
- Per-turn signal rule intact and untouched: :103-106 (the pushed signal is the wake; do not poll in a loop), :128-131 (a queued message runs as a new turn; a later signal supersedes; no review while a queued message is pending). The re-check sits strictly inside "If push is unavailable" (:119), so the push path is unchanged. Bounded, spaced re-checks between other work contradict neither :103 nor :122.
- §5 routing agrees: "non-limit timeout, never as a usage limit" (:125) matches §5's own rule that a limit is never inferred from a timeout (:144) and its non-limit ladder (:154-158).
- The stall Finding 4 identified is gone: after the checks, both exits end the wait with a defined action. No path waits for the lane's inactivity timeout with no legal action.
- The restored shape equals the pre-change bounded poll that Finding 4 cited as the lost fallback: one check, then at most 5 checks per lane, never a loop.
- Observation, not a finding: the text allows two harmless readings of the budget (the initial check counted inside or outside the 5). Under both readings, "the fifth check" names the last allowed check and the escalation is identical. No behaviour differs.
- The rule is validator-pinned: :646-649 asserts all five phrases, which occur only in this prose.

### Check 4 — Finding 5: checkpoints "use lanes more" cell agrees with the Gate 0.1 table — CLOSED

- checkpoints.md:201: mode `enabled`, approval `` `lane-review` with a spawnable lane, unless "gate me" was given; otherwise `user` ``.
- Gate 0.1 table :174-179: a current explicit instruction is applied "as instructed", with approval `lane-review` if enabled/auto with a spawnable lane, otherwise `user` (:177). "Use lanes more" is a current explicit instruction about the mode. The cell reproduces the :177 approval derivation exactly.
- The "unless gate me" carve-out agrees with the rest of the same file: the "gate me" response row (:200) sets approval `user`, and the approval-mode table (:103) sets `user` when "the user asked to approve gates themselves". A standing "gate me" is itself a current instruction, so :177 yields `user` for approval. The cell composes the two instructions without conflict.
- Mode `enabled` with an empty roster contradicts no table row: the `disabled` rows (:178-179) are the no-instruction defaults, and :177 says an explicit instruction wins. Approval `user` (:201) covers document gates when no lane is spawnable, and the no-eligible-lane fallback is defined in agent-lanes §5.
- The old failure scenario (approval "unchanged" against the table's `lane-review`) no longer produces two answers. Validator-pinned at :630-632.

### Check 5 — orchestration/SKILL.md:153 against agent-lanes §4 — OPEN (Finding R1, Serious)

orchestration/SKILL.md:153 still reads: "No polling loops: act on the completion signal; one status check at most, then wait." This contradicts the new §4 no-push path (agent-lanes/SKILL.md:119-125): "at most" forbids the five re-checks, and "then wait" forbids both §4 exits. The commit did not touch this file, so the contradiction is new since `6c57bf67e`. Phase 1 could not report it: at that time :153 matched the one-check rule it reviewed.

The sweep over the plugin and the agent templates found every other echo of the rule, and none of them contradicts §4:

- team-leader.template.md:443-444 — "waits for each `<agent-lane-completed>` signal (or one `ptah_agent_status` check)". Names the no-push probe; states no cap and no instruction to wait.
- fleet.md:54 — "wait for the completion signal or make one status check", in a sentence that routes lane mechanics to agent-lanes §§1, 3, 4 and 8. Same shape: no cap, no wait instruction.
- `_shared/cli-delegation.md:1` — "wait for `<agent-lane-completed>` or one `ptah_agent_status` check, then `ptah_agent_read`". Same shape.
- ptah-cli-usage/references/internal-mcp.md:123 — "`ptah_agent_status` on a matched interval instead; never a tight loop". Agrees with §4's spacing and no-tight-loop rule.
- agent-cli.md:67 and internal-mcp.md:86 are tool listings, not rules.

Only orchestration/SKILL.md:153 states a hard cap plus an open-ended wait. See Finding R1 for the required replacement sentence.

### Check 6 — No TODO/PLACEHOLDER/STUB — CLOSED

Grep for `TODO|PLACEHOLDER|STUB|FIXME` returned no match in scripts/validate-orchestration-skill.ts, agent-lanes/SKILL.md, git-standards.md and checkpoints.md. `batch-4f-report.md`, read in full, contains none. The two task-record files in the commit hold no source markers.

## Findings

### R1 — Serious — orchestration/SKILL.md:153 re-imposes the one-check rule that batch 4F removed from agent-lanes §4

**Evidence.** orchestration/SKILL.md:153: "No polling loops: act on the completion signal; one status check at most, then wait." agent-lanes/SKILL.md:121-122 now allows "at most 5 status checks per lane, at least 60 s apart" when push is unavailable, followed by an escalation (:122-125). The same parent file routes lane mechanics to the agent-lanes skill (:128), so the two rules meet with no order of precedence stated.

**Failure scenario.** A host without push. The orchestrator follows the parent skill's token-economy rule: one status check, the lane reports `running`, "then wait". No signal can arrive. The turn stalls until the lane's own timeout ends it — the exact failure Finding 4 identified, with the default timeout of one hour. An agent that follows §4 instead behaves correctly. Which rule wins depends on which file the agent weighs, so the fix is wired in one file and contradicted in the other. Phase 1 scored the same stall Moderate as a gap in a new policy. This is Serious because the commit's stated purpose was to remove that stall, and the un-updated echo keeps the removed failure mode reachable through the parent skill — a partially wired fix on a path the §4 text itself enumerates (no live spawning session, no parent session, no chat runtime).

**Required change.** Replace the sentence at orchestration/SKILL.md:153 with:

> - No polling loops: act on the completion signal. If push is unavailable, re-check at most 5 times per lane, at least 60 s apart, then tell the user the lane is still running or stop it (agent-lanes §4).

This keeps the no-tight-loop rule, states the same bound and spacing as §4, and ends in §4's two exits: a user notice that ends the turn, or `ptah_agent_stop` with §5 recovery. The four files this commit touched need no other change.

## Answers to the five logic questions (scoped to this diff)

1. **How does this fail silently?** No new silent path. The validator markers fail loudly when their text is missing; the three content fixes end in defined actions.
2. **What user action produces unexpected behaviour?** None in the changed files. The "use lanes more" cell now matches the Gate 0.1 table (check 4). The one contradiction lives in a file this commit did not touch (R1).
3. **What input data makes this produce a wrong answer?** A standing "gate me" plus a later "use lanes more" now composes to `enabled` with approval `user`, which matches the Gate 0.1 derivation (check 4).
4. **What happens when a dependency fails?** The no-push path is bounded and ends in escalation or stop (check 3). The remaining gap is the contradicting parent rule (R1).
5. **What is missing?** The fix did not update the orchestration/SKILL.md echo of the old rule (R1).

## Verdict

REVISE — 0 Blocking, 1 Serious, 0 Moderate, 0 Minor.

Findings 1, 2, 4 and 5 of the phase-1 review are correctly fixed and validator-pinned, and check 6 is clean. The one defect is the un-updated echo at orchestration/SKILL.md:153, which re-opens the Finding 4 stall for any agent that follows the parent skill. Apply the R1 replacement sentence. No other change is required in the four files this commit touched.

## Round 2 — R1 fix confirmed

Scope: the orchestrator's uncommitted fix for Finding R1 in `orchestration/SKILL.md`, read once as `git diff HEAD -- <file>` (one hunk), and `agent-lanes/SKILL.md` §4, read once in full. No other file was opened; no command other than the one `git diff` was run. The orchestrator reports the validator at 0 errors after the edit.

### R1 — CLOSED

The required replacement sentence was applied; the contradiction with agent-lanes §4 is gone; nothing else in the file changed. Evidence per check:

- **(a) The applied text matches the R1 requirement.** orchestration/SKILL.md:153-155 now reads: "No polling loops: act on the completion signal. If push is unavailable, re-check at most 5 times per lane, at least 60 s apart, then tell the user the lane is still running or stop it (agent-lanes §4)." This is the exact sentence demanded under "Required change" above. Only the markdown wrap points differ ("at most 5 times / per lane", "stop it / (agent-lanes §4)"). No word was added, dropped, or re-ordered. The deleted line in the same hunk is the old sentence R1 quoted verbatim, so the pre-fix state was as documented.
- **(b) The contradiction with agent-lanes §4 is gone.** Both contradicting fragments are deleted: "one status check at most" no longer forbids §4's re-checks, and "then wait" no longer forbids §4's exits. The remaining clauses agree with §4 one for one: "act on the completion signal" is the per-turn signal rule (agent-lanes/SKILL.md:103-106); "re-check at most 5 times per lane, at least 60 s apart" repeats :121-122's "re-check with at most 5 status checks per lane, at least 60 s apart" with the same bound and spacing; "No polling loops" restates :122's "Do not use a tight loop, timer, or watcher"; "tell the user the lane is still running or stop it (agent-lanes §4)" names :122-125's two exits, with the pointer routing the recovery detail (§5, non-limit timeout) to the skill. An agent that follows either file now performs the same bounded, spaced re-checks and always ends the wait in a defined action. The R1 failure scenario — a no-push host stalling until the lane's own inactivity timeout — is no longer reachable through the parent skill.
- **(c) Nothing else in the file changed.** `git diff HEAD` on orchestration/SKILL.md contains exactly one hunk (@@ -150,7 +150,9 @@): the deletion of the old line 153 and the addition of its three-line replacement at :153-155. No other hunk exists, so no other line of the file differs from HEAD.

Observation, not a finding: the new parent sentence is not validator-pinned. The batch 4F markers assert agent-lanes/SKILL.md's §4 phrases (validate-orchestration-skill.ts:646-649), not the orchestration/SKILL.md echo, so a future edit of the echo could drift from §4 unnoticed — the same drift that produced R1. R1's required change asked for the sentence only, and the fix meets that requirement as written; pinning the echo is optional hardening for a later batch, not a defect of this fix.

### Round 2 verdict

APPROVED — 0 Blocking, 0 Serious, 0 Moderate, 0 Minor.

Finding R1 is closed. The Round 1 closures of phase-1 findings 1, 2, 4 and 5 are unaffected: this edit touches only orchestration/SKILL.md, a file commit 6c57bf67e did not modify. The batch 4F fix plus this follow-up sentence is logically complete: every no-push wait path in the plugin now ends in a bounded, spaced re-check and a defined exit.