# Task Context - TASK_2026_609_c495

## User Request

Relayed by the TASK_2026_597 session (user-requested handoff), paraphrased from the user:

- Focus first on our subagents and the system prompt. Do surgical fixes. This work links to the Thoth skills and the subagent/skills trajectory, and later to content-manifest updates.
- Build it as its own silo: sub-routes in the Settings page where the user manages everything about subagents (extracted from codebase analysis and from the skills trajectory).
- Use Codex CLI lanes AND subagents, with the usage hygiene below, until the PR #634 fixes are merged.

Two user-reported problems:

1. Setup wizard: waits for a codebase analysis that writes ~4 files nobody uses afterwards, then runs an opaque workflow to generate subagents, then saves copies per provider (.claude, .codex, .opencode ...). The user must set `model:` by hand in each file; there is no programmatic way to set the model (per agent type / per provider).
2. Running the setup wizard in one project changes the subagents of OTHER projects. TASK_2026_365 ("Scope the agent user layer by workspace", done) was meant to fix this. Treat it as incomplete or regressed; baseline `.ptah/specs/TASK_2026_365/context.md`. Also check TASK_2026_534 item 4 (provider connect changed CLI sub-agent tiers). TASK_2026_246 (backlog) is only a structural refactor of agent-generation.

## Task Type

BUGFIX (Part A) then FEATURE (Part B)

## Complexity

Complex

## Strategy

- Part A: BUGFIX flow - research (root cause of the scope leak + model setting + prompt gap) -> team-leader -> QA. Surgical fixes only.
- Part B: FEATURE flow with UI surface - PM -> parity-inventory -> designer -> prototype -> Gate 1.7 -> architect -> Gate 2 -> team-leader -> QA.

## CLI Lanes

Gate 0.1 (2026-10-03, confirmed by the user in this session): Lanes + subagents. Usage hygiene:

1. A fresh team-leader for every Mode 2/3 call; give it only report + review paths.
2. Resume a developer/reviewer/lane only if its last activity was < 5 minutes ago.
3. Risk-based review: no per-batch review; scoped checks per batch (`npx nx run-many -t typecheck,lint -p <projects>`, then `-t test ... --maxWorkers=2`; never --maxWorkers on typecheck; never workspace-wide; tail output). One code-logic review per phase on the combined diff.
4. At most one fix round (Blocking/Serious; Moderate only if it can break a config or lose data).
5. Short status updates. Lanes get a narrow file list and a tool-call ceiling; no polling.

Never commit to main; ask the user before push/PR; never skip hooks.

## Conversation Summary

Facts from TASK_2026_597 (PR #634, branch `fix/task-597-lane-token-burn`, not merged):

- N3: `libs/backend/agent-generation/src/lib/services/subagent-tool-allowlist.ts` + `buildAgentFileContent` in `orchestrator.service.ts` write `disallowedTools` into generated agent frontmatter. Rules: full tool names or server-level names only; partial wildcard matches nothing; bare `*` drops the whole list.
- N4: `PTAH_CORE_SYSTEM_PROMPT` (3,660 tokens: memory snapshot, symbol list, orchestration tables) is appended only to the MAIN session (`sdk-query-options-builder.ts:1704-1762`, passed at `:1203`). Subagents get only MCP server instructions (126 tokens) and ptah_* tool schemas (<=12,313 tokens).
- Regenerated skill/agent content needs `npm run manifest:generate` + commit, or CI `manifest:check` fails.
- Files #634 touches (rebase risk): agent-generation `orchestrator.service.ts`, `subagent-tool-allowlist.ts`, `.claude/agents/*`, .codex/.opencode team-leader mirrors, agent-sdk helpers (auto-compact-control, sdk-query-options-builder, session-lifecycle*), cli-agent-runtime cli-adapters.

Research (research-report.md): leak = incomplete TASK_2026_365 fix, not regression. Cause = `seedLegacyAgents` (`user-layer-mirror.service.ts:1832`) copies flat-base clones into a new workspace scope.

Machine evidence (orchestrator, 2026-10-03): `~/.ptah/user/agents` flat base still holds 15 clones (last written 2026-09-09). Ptah-only `video-director.md` + `visual-reviewer.md` exist in ALL 4 scoped dirs (property-hub, ptah-extension, qa3elhamor, temp); property-hub also has `figma-designer.md`. Confirms F1.

## User Decisions (2026-10-03)

- Cleanup: stop new leaks (F1) + one-time quarantine of foreign slugs that no workspace manifest owns, moved to a `.history`/quarantine folder, never deleted.
- Model: Part A = `agentGeneration.models` settings key + Claude override only (F2, after #634 merges). Non-Claude model fields (F3) move to Part B Settings silo.
- Part A scope: F1 (+quarantine), F2 (held for #634), F4 (held for #634 on team-leader.template.md/content-manifest), F5. F6 = no change; analysis files surface in Part B.

## User Decisions — Gate 1 review round 0 (2026-10-03)

- Model settings scope: machine-wide default + per-workspace overrides. A save in workspace X changes only X unless the user edits the default on purpose. Applies to F2 (Part A Batch 3 key shape) and F3 (Part B).
- Content-manifest update detection (version badge + rebase from silo): DEFERRED to a named follow-up task. Part B keeps only the existing rebase action for parity.

## User Decisions — Batch 1 hold (2026-10-03)

- Hand-edited CLI copy retired by the reconciler: save to `.history/<slug>/<ts>/` in that workspace, then remove; report as removed-with-local-edit. Applies to all retirements (incl. disabled-agent cleanup), not only the 609 seed path.
- Order: new Batch 1a (harness-sync guard + spec) lands first; then Batch 1 (seed fix + quarantine) committed as one unit.
- Batch 2 committed locally as `381449fba`.

## User Decisions — Part B scope change (2026-10-03, Gate 1 feedback)

User: "I'm in a hurry; strengthen what we have rather than expand scope without surgical gain." Analysis stays as is.
Part B is NARROWED to surgical improvements on the existing Thoth Library -> Agents tab (`skill-clones-view.component.ts`), no new Settings silo:
1. Model control per agent card (machine default + workspace override; Claude field + explicit-only fields for Codex/OpenCode/Copilot/Cursor) — F2 UI + F3.
2. Provider sync chips per card (claude/codex/opencode/copilot/cursor: in sync / missing / edited) + Sync action via the existing reconcile RPC.
3. Foreign / quarantined agents indicator + Restore (Part A quarantine).
4. Generation preview in the wizard's last step: list each agent and the provider files it will write, before writing.
Out: Settings silo, analysis changes, saved-analyses removal, trajectory-based enhancement (existing "Enhance now" covers it), content-manifest update detection.
No new surface -> no designer/prototype/Gate 1.7; completion needs before/after screenshots (dark + light). The earlier task-description.md (silo version, 3 review rounds) is superseded.

## User Decisions — fast track (2026-10-03)

User: "reduce the interview rounds to push this quickly." Part B process:
- Gate 1 and Gate 2 merged into ONE combined gate (requirements + plan presented together). Architect starts as soon as task-description.md is written.
- ONE cross-side Codex review of both documents together; revise cap = 0 recheck rounds (author fixes blocking items once, no re-review); open items disclosed at the gate.
- Orchestrator asks the user only for data-loss or scope-changing decisions.

## Combined Gate (1+2) — APPROVED by user (2026-10-03)

- Approved: task-description.md (narrowed, 136 lines) + implementation-plan.md (209 lines, with "Review fixes"). Reviewer: Codex lane, round 0 REVISE; authors fixed 6 findings once (fast track, no recheck).
- Restore destination: option 1 (default) — owned workspace source `{ws}/.claude/agents/<slug>.md`, disclosed before Restore.
- Next: team-leader Mode 1 for B-1..B-4 now; B-5/B-6 after #634; B-7 screenshots + QA.

## Session 2 (2026-10-03) — decisions restated by the user, not asked again

- Gate 0.1: lanes + subagents. Combined Gate 1+2: APPROVED. Restore option 1. Fast track. Usage hygiene above kept.
- Run order: Part A phase review (cross-side Codex lane, `git show` per commit, max one fix round) ∥ B-5e; then B-5f1 → B-5f2/3/4 (+ B-5g) → FU-4 → B-6 → B-7.
- Ask before any push/PR. Never commit to main. Never stage `.ptah/specs/` or `test-results/`.
- 2026-10-04: user asked for a PR so CI and code review run. Branch pushed; PR #635 opened (body: do not merge until the Part B fix round lands). Further fix commits are pushed to the same branch.
- 2026-10-04: CodeRabbit posted 5 Minor-labelled comments on PR #635. User decision: fix all 5 now (PR-FIX-A agent-generation items 1,2,4,5; PR-FIX-B skill-synthesis-ui item 3), scoped checks, one short cross-side re-check, push. Item 1 = FU-10 from Mode 3.
- Part A re-review (code-logic-rereview.md, 5/10) left 2 narrow data-loss paths after the one allowed fix round. User decision (2026-10-04): ONE more bounded fix round (A-FIX-3 harness-sync unreadable-file fail-closed; A-FIX-4 quarantine rollback never unlinks the original path), then one short scoped re-check. No further rounds; anything left goes to Gate 3 as disclosed open items.

Worktree: `.claude-worktrees/task-609-subagent-setup`, branch `fix/task-609-subagent-setup` from `origin/main` (21c27d17f).
