# HANDOFF - TASK_2026_646_136a (2026-10-16, end of session 10)

Status at handoff: branch `feat/decision-model-routing` in worktree
`D:\projects\ptah-extension\.claude-worktrees\decision-model-routing`. All code is committed. HEAD is `d4dcdc6c1` plus
one docs commit with this file (pushed at the end of session 10; check with `git status -sb`). No lane, subagent or
Electron instance of this task is running. Draft PR https://github.com/Hive-Academy/ptah-extension/pull/731 stays a draft.

## Goal

An optional decision model for orchestration routing, plus a lane evaluation loop: a "Decision model" background role
(Ollama, TypeSafe Jev via `/v1/systemone`, or a structured-output model), the `ptah_route_decide` MCP tool, lane and subagent
outcome records with `ptah_outcome_report`, a capability matrix as data, and a spread rule across lanes.
Requirements: `task-description.md` (rev 3). Plan: `implementation-plan.md` (+ part-a, part-b). Work list: `batches.md`.
Final user decisions (do not reopen): #12, #13, #18 (as amended by #22), #19, #96. Keep `skillSynthesis.enabled=false` in
`~/.ptah/settings.json`. Leave memory untouched.

The user's goal for the next session: PR #731 tested, pushed, CI green, marked ready, merged.

## Done in session 10 (all committed; all pushed up to d4dcdc6c1 except where noted)

| Commit | What |
| --- | --- |
| b5e38c780 / 40dcfb9ae / 7f8f93adf / 81c1f5af9 | Batches 39a-39d (P5 fix round) + orchestrator spec fixes (VecStatus/Logger in DI specs, tab stub, audit marker form) |
| 86c2954a7 | Batch 40a (P4 config RPC) |
| f4cd90768 | Batch 38c (P6 bounded correction) + VS Code deactivate-order spec fix |
| 438bd3118 / f5d28d2f4 | Batches 40b (Decision model row) and 40c (fixed detail text; orchestrator log-meta correction) |
| b8c74c9e8 | Final P4/P5/P6 reviews + visual re-checks (docs) |
| 8253977e8 | CI: lane-outcomes esbuild `external` += vscode, better-sqlite3, sqlite-vec; content-manifest refreshed |
| e6c030f5b | 41d: lane-outcomes drain never rejects when the logger throws (P6 final Moderate) |
| dbccd23e4 | 41a: setConfig validates selection first, key rollback, shared `DECISION_MODEL_KEY_MAY_HAVE_CHANGED` shown by the row (P4 final Serious) |
| 0547f3da8 | 41b: outcome report accepts VS Code `FileNotFound`/`FileNotADirectory`; schema via `flattenOperationUnion` with per-kind notes (P5 Serious + style D1) |
| 27829fedf | 41c: Agents-tab outcome cell full row, container-query grid, titles, single "unavailable" (P5 visual Serious) |
| c779018ad | 41e: Orchestration settings tab in `@defer (on immediate)`; initial bundle -88 kB (CI budget) |
| cda1eb30e | 41f (revise round 1): keep the new key when the selection was stored; spec pins `setConfigQueue` serialization |
| d4dcdc6c1 | 41g (revise round 2): a stored selection after a late rejection reports success (combined key + selection path) |

Batch 41 was user-approved ("Fix all, then merge") after the final P4/P5/P6 reviews found defects.

Reviews: `reviews/p6-final-code-logic-review.md`, `p4-final-code-logic-review.md`, `p4-final-visual-review.md` (APPROVED 9/10),
`p5-final-code-logic-review.md`, `p5-final-code-style-review.md`, `p5-visual-review.md`, `batch-41-code-logic-review.md`,
`batch-41f-code-logic-review.md`, `batch-41g-code-logic-review.md`, `batch-41-visual-review.md` (APPROVED 8/10).
Reports: `reports/batch-38c..41e-report.md` (41f is in `batch-41a-report.md`).

## Open problems and decisions

1. **41g review: NEEDS_REVISION 7/10, one Moderate (revise cap reached).** A selection-ONLY save
   (`agent-rpc.handlers.ts:857-860`, branch `jevApiKey === undefined`) still reports failure ("unchanged") when
   `setSelection` rejects after the selection was stored. Trigger: only a throwing logger inside `clearMark`
   (`decision-model.config.ts:700-706`; `persistMark` already catches storage errors). Both revise rounds are used: per
   agent-lanes §6 the next session may make ONE bounded correction (apply the same `storedSelectionState` read-back to the
   selection-only branch + spec), then one independent codex review; if it still finds defects, report to the user and stop.
   Ask the user first, or present it with the CI fixes below.
2. **CI at c779018ad: CI and Content Manifest PASS; two E2E suites FAIL on outdated expectations** (not product bugs):
   - CLI E2E (run 38943465967): `mcp_tools_list_returns_seven` expects 7 tools, now 10 (`Expected length: 10`), and
     `mcp_session_describe_introspection` fails. Update the CLI e2e spec expectations to the new tool set
     (find them: `grep -rn "mcp_tools_list_returns_seven" apps libs`).
   - Webview E2E (run 38943465955): 6 failures in
     `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-orchestration.e2e.spec.ts` (around :351-362):
     expects "6 roles" / count 6 (now 7 with the Decision model card) and `consumer-table` hidden; the tab is now behind
     `@defer`, so scenes may also need to wait for `[data-testid="provider-consumer-assignments"]`.
   - CI for 41f/41g (cda1eb30e, d4dcdc6c1) was not read yet.
3. **The branch is behind `main`** (`main` raised the webview budget to 3.70 MB; this branch's `project.json` still has
   3.50 MB). CI builds the merge ref. Before marking ready: `git merge origin/main` (no rebase, no force push), resolve
   conflicts, re-run scoped checks.
4. Later tasks (record, do not fix here): P4 defect 2 (a persisted unsupported mark from a dev build can hold raw text;
   not on `main`), P5 Minors (logic 2-4, style D2-D8 except those fixed in 41c), drawer shows "Outcome data unavailable"
   twice (`clone-detail-drawer.component.ts:181-188`), `outcomeReadFailures` never read, `route-tools.ts:49` private
   flattener copy, visual M1 (cold-start `agent:getConfig` 5 s timeout `decision-model-row.component.ts:55`), visual m1/m2,
   plus the older LT-P4/P5/P6 lists in `batches.md`.
5. Electron is shared with other sessions (649, 678, 681): before any launch send "Electron: <session> launching" to the
   live peers (`ListAgents`), after close send "Electron: free". Never use port 9333 (stale).
6. Visual worktrees `646-base-shots` and `646-after-shots` (detached `c779018ad`, has a dev build) stay. Capture scripts
   with the Ollama guard (unseeded scenarios use `127.0.0.1:1`): `visual/batch-40-recheck/capture-decision-card.cjs`,
   `visual/batch-8-after/capture-agents-tab-settled.cjs`. Screenshots are git-ignored (`.gitignore:141`).

## Key files

- Config RPC: `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts` (`writeDecisionModel`, `storedSelectionState`,
  `setConfigQueue`) + `agent-rpc.handlers.decision-model.spec.ts`; shared text `libs/shared/src/lib/types/rpc/rpc-agents.types.ts`.
- Decision model: `libs/backend/lane-routing/src/lib/decision-model/{decision-model.config.ts,decision-model.detail.ts}`.
- Row: `libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.ts`; tab `settings.component.{html,ts}`.
- MCP: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/{tools/outcome-report.tool.ts,surface-tools.ts,route-tool-handlers.ts}`.
- Drain: `libs/backend/lane-outcomes/src/lib/di/start.ts`; build config `libs/backend/lane-outcomes/project.json`.
- Agents tab: `libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-card.component.ts`.

## Next steps (in order)

1. `git -C D:\projects\ptah-extension\.claude-worktrees\decision-model-routing status -sb` (expect clean, in sync).
2. Read CI for the HEAD commit: `gh run list --branch feat/decision-model-routing --limit 12` and `gh run view <id> --log-failed`.
3. Fix the E2E expectations (open problem 2) via a subagent or CLI lane (frontend/devops), in this worktree.
4. Ask the user whether to use the one bounded correction for open problem 1, or record it as a later task.
5. `git fetch origin && git merge origin/main` in the worktree; resolve conflicts; scoped checks for touched projects.
6. Commit in the foreground, push in the background, wait for CI green.
7. Team-leader Mode 3 completion (write-path trace inputs in `reports/batch-30-report.md`), then `gh pr ready 731`.
   The user merges (or asks you to).

## Verification commands (one heavy check at a time, prefix `NX_NO_CLOUD=true`)

- Libs: `npx nx run-many -t test -p <A> <B> --parallel=1 --maxWorkers=2` (header must say N projects), then
  `npx nx run-many -t typecheck lint -p <A> <B> --parallel=1`.
- Specs: `npx jest -c <lib>/jest.config.ts <specs> --coverage=false --maxWorkers=2`.
- ptah-cli: `PTAH_ALLOW_SKIP_UNBUILT=1 npx jest -c apps/ptah-cli/jest.config.cjs apps/ptah-cli/src --coverage=false --maxWorkers=2`.
  Never `nx test ptah-cli` or `nx test ptah-electron`.
- Apps: `npx tsc -p apps/<app>/tsconfig.app.json --noEmit`; DI guards
  `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/di --coverage=false --maxWorkers=2` (same for
  `apps/ptah-extension-vscode/src/di`).
- Audit: `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` must say `TOTAL 296`, no FAIL.
- Manifest: `npm run manifest:check`.
- Builds only to reproduce CI (user approved for CI fixes): `npx nx build @ptah-extension/lane-outcomes`,
  `npx nx build ptah-extension-webview` (at most one at a time).
- Never commit while a lane or subagent edits the worktree; never `--no-verify`; never raise a degradation baseline.
