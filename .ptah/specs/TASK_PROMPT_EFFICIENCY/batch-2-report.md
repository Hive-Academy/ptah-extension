# Batch 2 report — agent preamble compression (R1, R4, R6, R9 in agent files)

Scope: `.claude/agents/*.md` (15) and `.codex/agents/*.toml` (15). Nothing committed.

## Byte totals (`wc -c`)

| Path | Before (HEAD) | After | Delta |
|---|---|---|---|
| `.claude/agents/*.md` | 201,464 | 154,582 | -46,882 (-23.3%) |
| `.codex/agents/*.toml` | 171,666 | 155,167 | -16,499 (-9.6%; see note on two drifted files) |

Per file (`.md` before -> after): backend-developer 14,577 -> 11,200; code-logic-reviewer 14,649 -> 11,044; code-style-reviewer 14,030 -> 10,512; devops-engineer 12,058 -> 8,694; frontend-developer 15,321 -> 11,941; modernization-detector 9,363 -> 6,589; project-manager 14,071 -> 10,211; researcher-expert 9,506 -> 6,679; senior-tester 13,882 -> 10,599; software-architect 15,168 -> 11,512; team-leader 22,871 -> 20,635; technical-content-writer 13,719 -> 10,943; ui-ux-designer 8,401 -> 6,018; video-director 8,699 -> 5,106; visual-reviewer 15,149 -> 12,899.

Shared preamble per file (from `## Working rules` to `## Role`, including the role-specific trigger line): 1,521–1,657 bytes, down from ~4,800–5,200. Shared block alone (identical in all 15 files): 1,288 bytes. **Target of 1,200 was not met**; the shortfall is the role-specific clarification trigger (206–342 bytes) plus the CLI-lane bullet, which has to carry list/spawn/3-lane cap/completion signal/resume/no-git/synthesis rules. Cutting further would drop rules rather than words. project-manager and team-leader carry an extra `## Task carrier rules` block (996 bytes) holding the allocation, status-vocabulary, `>-` scalar and Edit-only-status rules that only those two roles had.

## Edits

R1 — compact preamble (all 15 files)
- `## Tooling precedence`, `## Task specs`, `## Clarifications: return them, do not ask`, `## Replace, do not accumulate`, `## Delegating to CLI agents` replaced by one `## Working rules` H2 with five terse bullets plus one `- Clarification trigger:` bullet carrying each role's trigger / stop-before / proceed-when text. Identical shared text in all 15 files.
- `## Reviewer stance` in code-logic-reviewer, code-style-reviewer, visual-reviewer compressed from the prose + table (~1,480 B) to three bullets (~640 B), keeping the score bands and shares.
- Preserved from audit §4: 3-lane cap, push-signal wait, no vendor hardcoding, replace-not-accumulate, task-folder ownership, `ptah_get_diagnostics` after edits.

R4 — polling removed
- The `Spawn (ptah_agent_spawn), Poll (ptah_agent_status), Read` line in 12 files is gone; the shared bullet now says wait for `<agent-lane-completed>` or one `ptah_agent_status` check, then `ptah_agent_read`.
- team-leader Batch executor prompt: "polls them" -> "waits for each `<agent-lane-completed>` signal (or one `ptah_agent_status` check)".
- `grep -ri poll .claude/agents .codex/agents` returns nothing.

R6 — scoped verification
- backend-developer / frontend-developer Method step 6; devops-engineer Method "Proof" bullet; senior-tester Method step 7; code-logic-reviewer Inputs 6; code-style-reviewer Inputs 5; visual-reviewer build-then-serve precondition; team-leader batch verification template: run only the projects changed with `-p <project>`, never workspace-wide; tail or filter output; never paste a full log into a deliverable or the thread; do not re-run a suite only to re-read output.

Tool-call budget line (developer and tester roles)
- backend-developer, frontend-developer (before "Working sequence"), devops-engineer (after the working-sequence paragraph), senior-tester (new Method step 8): finish in as few tool calls as possible; prefer `ptah_ast_analyze` / `ptah_context_enrich_file` / targeted reads; full read only for files you will edit.

R9 — team-leader
- Mode 1 "Batch": a batch is at most 6 files across at most 2 libs with one scoped verification command; split larger work into more batches.
- Mode 2 Step 2: "Read every file the batch names" -> read the files the batch names using AST/summary tools first, full reads only for files the batch edits.

Frontmatter: byte-identical in all 15 `.md` files (checked against HEAD). No CRLF introduced.

## Codex TOML regeneration

`libs/backend/harness-sync/src/lib/targets/transformers/codex-agent-transformer.ts` + `transform-rules.ts` were mirrored in a one-off node script (no `node_modules` in this worktree, so the TS module could not be imported directly). Fidelity check: running the mirror on the *unedited* `.md` files reproduced 13/15 committed TOMLs byte-for-byte. `frontend-developer.toml` and `team-leader.toml` at HEAD were already hand-written short variants that did not match their `.md` (pre-existing drift, 3,579 and 4,222 bytes); they are now regenerated from the `.md` like the other 13, so their diff (including the `description =` line) is larger than body-only. All 15 TOML `# source: ptah` / `name =` / `sandbox_mode` header lines are unchanged.

## Verification

- `grep -rnE "Poll \(|poll until|Spawn → Poll"` over both dirs: no matches.
- `npx nx run-many -t test -p harness-sync --output-style=static`: 46 suites, 386 tests passed, exit 0 (one Jest "worker failed to exit gracefully" warning, pre-existing).

## Notes for the coordinator

- The generator templates in `libs/backend/agent-generation/templates/agents/_shared/*.md` (tooling-precedence, clarification-protocol, cli-delegation, replacement-policy, reviewer-stance) still hold the long form; a regeneration from templates would reinstate ~4.8 KB per file. Out of this batch's ownership.
- Reviewers keep "Read whole files, not only changed lines" and "No approval of code you did not read in full" (not asked to change; audit §4 lists AST-first only for non-review roles).
