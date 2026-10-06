# Batch 12 report — manifest, eight-project run, webview build, eager-closure gate

Provenance: the backend-developer subagent ran Task 12.1 (`npm run manifest:generate`) and started the
eight-project run as a background command, then ended its turn waiting on a monitor that never fired
(the log stayed empty; no process remained). The orchestrator re-ran every Task 12.2 check in the
foreground on 2026-10-06 and wrote this report. No code was changed in this batch.

## Task 12.1 — manifest

- `npm run manifest:generate` (subagent) changed only `content-manifest.json` (+3/-2): adds
  `ptah-core/skills/ptah-surface-authoring/references/catalog.md` and the generator-owned hash fields.
- `npm run manifest:check` →
  `content-manifest.json is up to date (sha256:87362f5442fc021b668c060876942908a04e3dc4105ff256b1f2236bca44b5b7, 229 files).`

## Task 12.2 — verification

| Check | Result |
| --- | --- |
| `npx nx run-many -t typecheck,test,lint -p shared,declarative-dashboard,mcp-apps-page,vscode-lm-tools,rpc-handlers,cli-engine,ptah-extension-vscode,ptah-electron` | `Successfully ran targets typecheck, test, lint for 8 projects and 34 tasks they depend on`; lint 0 errors (warnings only). Repeated `migrationRunner.runMigrations is not a function (non-fatal)` lines are pre-existing CLI-test log noise. The code-outliner flake did not occur. |
| `npx nx build ptah-extension-webview` | `Successfully ran target build for project ptah-extension-webview and 3 tasks it depends on` |
| `npm run gate:eager-closure` | `[eager-closure-gate] eager inputs: 749; initial chunk bytes: 2967476`; exit code 0. No allowlist change. |
| `git grep -n "dashboard-catalog/2" -- libs apps` | Only intentional negative cases: `surface-view-model.spec.ts:218,222`, `surface-validator.spec.ts:303,311`. |

## Files modified

- `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/content-manifest.json` (generated)
- This report.

## Risks

- Eager closure: the six renderers are statically imported by `surface-node.component.ts`, like the
  existing kinds; the gate passes, so they stay outside the initial closure.
- Temporary log `tmp-b12-runmany.log` (empty) left by the stalled subagent was deleted, not committed.
