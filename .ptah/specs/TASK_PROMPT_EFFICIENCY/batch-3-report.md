# Batch 3 report — skills (R4, R6, R9, R10)

Scope: `.claude/skills/**` and the `ptah-core` plugin mirror. No commits. No other paths touched.

## Edits

| File | Edit |
| --- | --- |
| `.claude/skills/agent-lanes/SKILL.md` | §2 `timeout` row: recommend 20 min (`1200000`) default, split lanes that need more. §4: replaced "every ~8s" polling fallback with signal-as-primary-wake; one `ptah_agent_status` call, ≥60 s between checks, ≤5 checks per lane. §6 scaffolding row: "Read it in full — only the files the lane edited". §6 Proof: scoped `run-many … -p <project>`, never workspace-wide, tail/filter output, never paste a full log. §8: added cost ≈ requests × context model, audit §0 figures (68 req/session, 115k avg context, 29% polling, 1.23B input tokens), 40-tool-call ceiling, file list up front. |
| `.claude/skills/fleet-orchestration/SKILL.md` | §4: batch cap (≤6 files, ≤2 libs, one scoped verification per batch). §7: tail/filter `run-many` output. §9: "Spawn, then Poll, then Read" → spawn, wait for `<agent-lane-completed>`, single status check otherwise, read; worked example updated. |
| `.claude/skills/orchestration/SKILL.md` | Never-list verification: scoped `-p`, output tailed, never workspace-wide. New "Token economy" subsection (5 bullets). |
| `.claude/skills/orchestration/references/lane-assignment.md` | "Assigning phases to lanes": whole-phase lanes respect the batch cap and tool-call ceiling; large implement phases become sequential narrow lanes. |
| `.claude/skills/execute-phase-gated-task/SKILL.md` | Step 1: read plan + batch, reference docs only when cited. Step 4: `ptah_ast_analyze` / `ptah_context_enrich_file` first, full reads only for edited files. Step 6 and "Validation gates" gotcha: scoped `-p`, tailed output, no re-running a suite to re-read output. |
| `.claude/skills/tribunal/references/crucible.md` | PASS row: scoped `-p` verification; relay only failing test names + first ~40 lines, never the full log. |
| `.claude/skills/tribunal/references/council.md` | "Poll and read all critiques" → wait for completion signals, then read. |
| `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/{agent-lanes,orchestration,tribunal}/…` | Byte-identical copies of the five changed files above. |

## Not mirrored

`fleet-orchestration` and `execute-phase-gated-task` have no copy under the plugin `skills/` folder, so nothing to mirror.

`apps/ptah-extension-vscode/assets/plugins/ptah-core/commands/*.md` contain no Spawn→Poll→Read or unscoped-verification wording; unchanged.

## Verification

- `grep -rn "every ~8s" / "Poll until" / "poll until" / "Spawn → Poll" / "then Poll" / "Poll and read"` over `.claude/skills`, plugin `skills/` and `commands/`: zero hits.
- `diff -rq .claude/skills/<skill> apps/…/ptah-core/skills/<skill>` for agent-lanes, orchestration, tribunal: no differences.
- No rule from audit §4 removed; the §4 no-poll paragraph, 3-lane cap, revise cap, cost announcement, "load references on demand" and `run-many -p` rule are all intact.
