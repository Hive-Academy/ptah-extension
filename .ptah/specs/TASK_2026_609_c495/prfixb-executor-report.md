# PR-FIX-B executor report — TASK_2026_609_c495

**Comment**: CodeRabbit on PR #635, `libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts` line 469. On the Agents tab, `HarnessHealthStore` was not re-verified when `workspaceRoot` changed, so the sync chips could describe the previous workspace. Verified against HEAD dc5bc09f3: the finding still applies, so it is fixed.

## Change

MODIFIED `libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts`
- Added the private field `lastWorkspaceRoot = ''`, next to `wasOnAgentTab`.
- The existing Agents-tab effect now also tracks `this.vscodeService.config()?.workspaceRoot ?? ''`. This is the same source `AgentModelsStore` uses (agent-models.store.ts:112).
- The behaviour has three cases:
  - **On tab entry:** unchanged. It runs one `harness.refresh({ refresh: true })` and one `agentModels.load()`.
  - **Workspace changes while the Agents tab stays active:** the `else if` branch runs exactly one `harness.refresh({ refresh: true })` inside `untracked`. It does not call `agentModels.load()`, because that store already follows the root itself.
  - **Workspace changes while the tab is not active, or in VS Code:** no call. The tab's next entry verifies fresh anyway.
- If you enter the tab and change workspace in the same effect run, the code takes the entry branch only. That gives one refresh, not two.
- The existing pattern is kept: OnPush, `inject()`, `effect` + `untracked`. No new catch site was added.

## Spec

MODIFIED `libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.spec.ts`
- New test in `Agents tab harness wiring`: "re-verifies once on a workspace switch while the Agents tab is open, and not elsewhere". It drives the stub's `config` signal through `TestBed.inject(VSCodeService)` and checks these cases:
  - **Switch on the Skills tab:** 0 refreshes.
  - **Enter Agents:** 1 refresh.
  - **Switch while on Agents, plus an extra `detectChanges`:** exactly 2 refreshes, the last called with `{ refresh: true }`.
  - **Leave the tab, then switch:** still 2.

## Checks

- `npx nx run-many -t test -p @ptah-extension/skill-synthesis-ui --maxWorkers=2 --output-style=static --skip-nx-cache`
  - `Test Suites: 35 passed, 35 total`
  - `Tests: 611 passed, 611 total`
- `npx nx run-many -t typecheck,lint -p @ptah-extension/skill-synthesis-ui`
  - `Successfully ran targets typecheck, lint`
  - `✖ 5 problems (0 errors, 5 warnings)`
  - The 5 warnings are max-lines and no-empty-function warnings that were already there. None of them comes from this change.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`
  - Exit 0.
  - `libs/frontend/skill-synthesis-ui: 5 ok (baseline 5)`

## Scope

- Only the two files above were changed. The other files that show in `git diff --stat` belong to the parallel agent-generation agent.
- Nothing was committed. `batches.md` was not touched.
