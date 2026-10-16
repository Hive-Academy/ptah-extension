# HANDOFF - TASK_2026_646_136a (2026-10-16, end of session 9)

Status at handoff: branch `feat/decision-model-routing` pushed and in sync with origin at `d8675a544`, plus a docs-only
handoff commit on top (see "Done"). The worktree HAS UNCOMMITTED CODE: the P5 fix round (Batches 39a-39d) and the P4 fix
40a, with two spec suites still red (see "In progress"). No lane or subagent of this task is running. Draft PR
https://github.com/Hive-Academy/ptah-extension/pull/731 stays a draft.

## Goal

An optional decision model for orchestration routing, plus a lane evaluation loop: a "Decision model" background role
(Ollama, TypeSafe Jev via `/v1/systemone`, or a structured-output model), the `ptah_route_decide` MCP tool, lane and subagent
outcome records with `ptah_outcome_report`, a capability matrix as data, and a spread rule across lanes.
Requirements: `task-description.md` (rev 3). Plan: `implementation-plan.md` (+ part-a, part-b). Work list: `batches.md`.
Final user decisions (do not reopen): #12, #13, #18 (as amended by #22), #19, #96. Keep `skillSynthesis.enabled=false` in
`~/.ptah/settings.json`. Leave memory untouched.

## Done this session (all pushed)

| Commit | What | Executor |
| --- | --- | --- |
| 4a3b758c9 | Batch 22 - Decision model settings row (chat) + R-10 before screenshots | subagent frontend-developer (Anthropic) |
| 149440c89 | Batch 38a - P6 fix round, MCP side (+ orchestrator budget correction, decision #101) | codex lane |
| d8675a544 | Batch 38b - P6 fix round, host shutdown/wiring; P5 + P6 review files; decisions #99-#103 | codex lane + orchestrator spec fixes (#103) |

Reviews written: `reviews/p4-code-logic-review.md` (codex, NEEDS_REVISION 5/10), `reviews/p4-visual-review.md` (NEEDS_FIX
7/10), `reviews/p5-code-logic-review.md` (NEEDS_REVISION 6/10), `reviews/p5-code-style-review.md` (NEEDS_REVISION 6.5/10),
`reviews/p6-code-{logic,style}-review.md` (both NEEDS_REVISION 6/10), `reviews/p6-fix-code-logic-review.md` (APPROVED 7/10),
`reviews/p6-fix-code-style-review.md` (NEEDS_REVISION 6.5/10). Visual evidence: `visual/batch-22-before*`, `visual/batch-22-after*`.
The "Anthropic re-review of 36b" was already done (`p2-fix2`, APPROVED; decision #99).
Phases accepted: P1, P2, P3. Not accepted: P4, P5, P6 (P7 docs needs no review).

Triage records (read them): `batches.md` sections "P6 review triage", "P5 review triage", "P4 review triage",
"P6 re-review triage", and batch sections 38a/38b/38c/40a/40b; `decisions.md` #99-#105.

## In progress (uncommitted in the worktree)

1. **Batches 39a-39d (P5 fix round, codex lanes, reports `reports/batch-39{a,b,c,d}-report.md`)** and **Batch 40a (P4 fix,
   subagent backend-developer, `reports/batch-40a-report.md`)**. Orchestrator spec/type fixes already applied: 39a
   `outcome-report.tool.ts` failure narrowing; 39d `skill-telemetry-seam.adapter.spec.ts` logger built on the `noopLogger`
   prototype and `di/register.spec.ts` registers `TOKENS.LOGGER`; 39b `skill-clones-view.component.spec.ts` stub gained
   `outcomeStatus` + `outcomeReadFailures`.
   Last run (`nx run-many -t test -p vscode-lm-tools rpc-handlers skill-synthesis-ui skill-synthesis`): vscode-lm-tools and
   rpc-handlers PASS; agent-sdk and cli-agent-runtime PASSED in the run before. STILL RED:
   - `libs/backend/skill-synthesis/src/lib/di/register.spec.ts`: resolving the seam now needs `Symbol(PtahVecStatus)`
     (SkillCandidateStore position #2). Register a VecStatus stub instance under that token in the spec (find the token
     export; spec-only fix). Then check the host guard specs still resolve the seam (VS Code `src/di`, Electron
     container smoke via Jest, ptah-cli Jest).
   - `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.spec.ts`: its state stub lacks
     `outcomeStatus` (same fix as the view spec).
2. Not started: **Batch 38c** (P6 bounded correction, decision #105), **Batch 40b** (P4 UI fix), **Batch 40c** (new, see below).

## Open problems and decisions

- Process error (#103): `nx test ptah-electron` starts 6 `build-*` dependency tasks. Never use it. Use Jest + tsc (below).
- P6: one fix round spent; ONE bounded correction allowed (38c), then an independent codex review; if that review finds
  defects, report them to the user and stop (agent-lanes §6).
- P4 visual review (Serious): light-theme control borders 1.21:1 (`decision-model-row.component.ts:45-46` SELECT/INPUT
  classes) and placeholders 3.28:1. Moderate 1 "Detail: fetch failed" is a raw backend string from
  `libs/backend/lane-routing/src/lib/decision-model/decision-model.config.ts` (`errorMessage(error)` into `detail` at ~:398,
  ~:433 and the probe catch ~:574) -> Batch 40c (new): fixed safe detail text, real error still logged. Visual Moderates 2-3
  are inherited from the shared popover (record as later tasks). Minors: "Remove stored key" always shown; footer says
  "with Undo" but a key write has no Undo.
- 40a note for 40b: when the selection cannot be read, the host returns `unset` + `unreachable`; the row must treat that as
  "not read" and offer no Undo that would write `unset` over the real stored selection.
- The visual-reviewer's first run probed the machine's real local Ollama (read-only status probe, no request text); those
  shots were deleted and re-taken with the isolated seed. Tell the user.
- Later tasks: P2c, P3c, P4c (LT-P4-1, -2), P5c (LT-P5-1..12), P6c (LT-P6-1, -2, -4..-9; LT-P6-3 moved into 39a), FE-*.
- Worktrees: `646-base-shots` (c57a9a1e7 build) and `646-after-shots` (detached d8675a544, has a dev build) stay for visual
  re-checks. To re-check later: `git -C .claude-worktrees/646-after-shots checkout --detach <new sha>`, then rebuild there.

## Key files

- Task folder `T` = `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\.ptah\specs\TASK_2026_646_136a`.
- Batch 22 UI: `libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.ts`, `provider-consumer-rows.ts`.
- Config RPC: `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`; outcome RPC: `agent-outcome-rpc.handlers.ts`.
- MCP: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/{route-tool-handlers.ts,tool-result-budget.ts,tools/outcome-report.{tool,handler}.ts,protocol-dispatcher.ts}`, `mcp-stdio/agent-tool.dispatcher.ts`.
- Shutdown: `apps/ptah-electron/src/activation/{shutdown.ts,wire-runtime.ts}`, `apps/ptah-extension-vscode/src/main.ts`,
  `libs/backend/cli-engine/src/lib/bootstrap/{with-engine.ts,shutdown-host-runtime.ts}`, `libs/backend/lane-outcomes/src/lib/di/start.ts`.
- Visual scripts: `T\visual\batch-22-after\capture-*.cjs` (Electron + Playwright, isolated profile; see `visual/batch-22-after.md`).

## Next steps (in order)

1. `git -C <W> status -sb`; confirm only the files listed in "In progress" are dirty.
2. Fix the two red specs (above). Re-run `NX_NO_CLOUD=true npx nx run-many -t test -p @ptah-extension/skill-synthesis
   @ptah-extension/skill-synthesis-ui --parallel=1 --maxWorkers=2` (header must say 2 projects). Then, one at a time:
   `npx nx typecheck <p> --parallel=1` and `npx nx lint <p> --parallel=1` for each of vscode-lm-tools, rpc-handlers,
   skill-synthesis-ui, cli-agent-runtime, agent-sdk, skill-synthesis; host guards: `npx jest -c apps/ptah-extension-vscode/jest.config.ts
   apps/ptah-extension-vscode/src/di --coverage=false --maxWorkers=2`, Electron `npx jest -c apps/ptah-electron/jest.config.ts
   apps/ptah-electron/src/di --coverage=false --maxWorkers=2`, ptah-cli Jest (below); degradation audit TOTAL 296.
3. Commit in the foreground, separately: 39a (vscode-lm-tools), 39b (rpc-handlers outcome handler + skill-synthesis-ui),
   39c (cli-agent-runtime), 39d (agent-sdk + skill-synthesis), 40a (rpc-handlers agent-rpc.handlers*). Update the batch
   headers in `batches.md`. Push in the background.
4. Spawn in parallel (file-disjoint, max 3): Batch 38c (subagent backend-developer, `batches.md` "Batch 38c"), Batch 40b
   (subagent frontend-developer: P4 S-3 UI part, M-4, visual Serious 1-2, the 40a "not read" note, the two visual Minors),
   Batch 40c (subagent backend-developer: safe detail text in `decision-model.config.ts` + spec). No Nx/Jest inside them.
5. Mode 2 for 38c/40b/40c, commit, push. Visual re-check of the Decision model card (dark + light) in `646-after-shots`
   at the new commit (decision #58 allows `build-dev` + `copy-renderer-dev` there; one heavy process at a time).
6. Reviews (one fix round already spent for P4/P5/P6, so each is the final review; on defects report to the user and stop):
   - P6: codex independent review of the 38c commit.
   - P5: Anthropic code-logic + code-style re-review scoped to the 39a-39d commits; P5 visual (B8 Agents tab after shots vs
     `visual/batch-8-before/`, Electron script `visual/batch-8-before/capture-agents-tab.cjs`, prefix `after`).
   - P4: codex re-review scoped to the 40a/40b/40c commits + the visual re-check.
7. Team-leader Mode 3 completion (write-path trace inputs in `reports/batch-30-report.md`). Mark PR #731 ready only when
   P4, P5 and P6 are accepted.

## Verification commands (one at a time, prefix `NX_NO_CLOUD=true`)

- Lib: `npx nx test <project> --parallel=1 --maxWorkers=2`, `npx nx typecheck <project> --parallel=1`, `npx nx lint <project> --parallel=1`.
- Specs: `npx jest -c <lib>/jest.config.ts <specs> --coverage=false --maxWorkers=2` (`ptah-cli`, `cli-engine`: `jest.config.cjs`).
- ptah-cli: `PTAH_ALLOW_SKIP_UNBUILT=1 npx jest -c apps/ptah-cli/jest.config.cjs apps/ptah-cli/src --coverage=false --maxWorkers=2`. Never `nx test ptah-cli`.
- Electron/VS Code apps: Jest on the specs + `npx tsc -p apps/<app>/tsconfig.app.json --noEmit`. Never `nx test ptah-electron`.
- Audits: `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` must stay `TOTAL 296`, no FAIL; di-lint runs on pre-push.
- Save long outputs to a file (`> /tmp/x.txt 2>&1`) and grep it; do not re-run a check only to read its output.
- Never commit while a lane or subagent edits the worktree. Commit in the foreground, push in the background, never `--no-verify`.
