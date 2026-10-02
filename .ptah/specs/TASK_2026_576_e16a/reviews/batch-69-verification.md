# Batch 69 - Task-wide scoped verification

Branch `feat/task-2026-576-cutover`, base `origin/main...HEAD`. Run one project at a time, `NX_DAEMON=false`, `NODE_OPTIONS=--no-experimental-require-module`, tests `--maxWorkers=2 --skip-nx-cache`.

Changed projects (from `git diff --name-only origin/main...HEAD`, excluding `.ptah/specs/**`): `shared`, `platform-core`, `platform-electron`, `vscode-core`, `agent-sdk`, `cli-engine`, `rpc-handlers`, `core`, `chat`, `git-ui`, `skill-synthesis-ui`, `ptah-extension-webview`, `ptah-electron`, `ptah-extension-vscode`, `ptah-electron-e2e`. (`nx show projects --affected` returns ~100 projects because `tsconfig.base.json`/`package.json` changed; direct-change set used instead.)

## Per-project results

| Project | typecheck | test | lint |
| --- | --- | --- | --- |
| shared | pass | 2277 passed (83 suites) | pass |
| platform-core | pass | 1005 passed, 4 todo | pass |
| platform-electron | pass | 666 passed, 4 skipped, 3 todo (37 suites) on rerun; first full run had 3 timeouts in `electron-state-storage-commit-store.spec.ts` (5000 ms, file untouched by the branch, machine load) - passes on rerun | pass |
| vscode-core | pass | 900 passed (45 suites) | pass |
| agent-sdk | pass | 2465 passed, 3 skipped | pass |
| cli-engine | pass | 208 passed | pass |
| rpc-handlers | pass | 3760 passed, 7 skipped, **1 failed** (known) | pass |
| core | pass | 976 passed | pass |
| chat | pass (rerun) | 1892 passed, 2 skipped after test-only fix (see below) | pass (rerun) |
| git-ui | pass | 926 passed (41 suites) (rerun) | pass (rerun) |
| skill-synthesis-ui | pass | 507 passed | pass |
| ptah-extension-webview | pass | 386 passed | pass |
| ptah-electron | pass | 1084 passed, 3 skipped | pass |
| ptah-extension-vscode | pass | 159 passed | pass |
| ptah-electron-e2e | pass | n/a (no `test` target; e2e not run per instructions) | pass |

Infrastructure notes: the first pass of `chat` (all three targets) and `git-ui` test failed with "Nx plugin worker exited" (concurrent Nx load from other agents), not product failures; both were rerun cleanly (above).

## Failures

1. rpc-handlers `harness-skill-selection-rpc.service.spec.ts` "never writes state.json - a derived decision is not a write": KNOWN machine-local failure, reproduced alone (1 failed, rest of the suite green). Also fails on main locally. Not touched.
2. chat `libs/frontend/chat/src/lib/components/templates/electron-shell.review-dock.spec.ts` (2 tests): REAL, deterministic, test defect. `NG0201: No provider found for InjectionToken MODEL_REFRESH_CONTROL` (path ClosedTabSessionEnderService -> TabManagerService, `chat-state/src/lib/tab-manager.service.ts:198`), then `Cannot read properties of undefined (reading 'destroy')` in afterEach. Cause: the spec's TestBed did not provide the token the shell's transitive services need. Test-only fix applied: added `{ provide: MODEL_REFRESH_CONTROL, useValue: { refreshModels: jest.fn().mockResolvedValue(undefined) } }` and the `@ptah-extension/chat-state` import (same shape as `chat-view.keepalive.spec.ts:140-153`), prettier-formatted. After the fix the whole chat suite is green (125 suites, 1892 passed). Uncommitted edit; no product code changed.

## Audits

| Check | Result |
| --- | --- |
| `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` | exit 0 (TOTAL 294 unsuppressed sites, within baselines) |
| `nx run ptah-extension-webview:verify-eager-bundle` | pass: "no forbidden markers in the eager closure"; electron-only chunks 126 of 592. (First attempt with the `--no-experimental-require-module` flag failed inside ng-packagr `require()` of an ESM dep - an ng-packagr build-tool artefact of the flag, not a product defect; build targets were run without the flag.) |
| `nx run ptah-electron:validate-deps` | exit 0 |
| `nx run @ptah-extension/vscode-core:test-real-git` | 181 passed, 2 skipped (14 suites); `remote-stash`/`hooks` did not flake |
| Manifest invariant | `rpc-allowlist.spec.ts` (host-profile manifest/allowlist invariants) is in the rpc-handlers run: green (only the harness spec failed in that suite) |

## `command:execute` allowlist invariant

`git diff origin/main -- libs/backend/rpc-handlers/src/lib/handlers/command-rpc.handlers.ts` : empty (0 lines).
`git diff 722d921ab -- ...command-rpc.handlers.ts` : empty (0 lines).
Allowlist at lines 29-40 unchanged: `ALLOWED_COMMAND_PREFIXES = ['ptah.']`; `ALLOWED_EXACT_COMMANDS = ['workbench.action.reloadWindow', 'workbench.action.files.openFolder']`.

## Risks (implementation-plan.md R1-R12, A1-A12)

| Item | Resolution recorded in |
| --- | --- |
| R1 Pierre slot/separator internals | batches.md Batch 22 Outcome (A1 read at `diffs-v1.5.1`, mapping spec); exact pin. No separate bump-gate note. Treated as resolved by Batch 22; version bump gate = mapping spec |
| R2 Pierre needs eval | batches.md Batch 22 Task 22.2 Outcome (no blocker); `reviews/gate-p4-pierre-csp.md` |
| R3 watcher regresses Windows | batches.md Batch 7/8 watcher batch (git-watcher e2e unchanged); real-git suite green here. Windows live e2e not rerun in this batch (e2e excluded): partially open |
| R4 write-lock deadlock | batches.md lines ~192, 414 (R4 notes, two-parallel-apply spec); `reviews/batch-5-code-logic-review.md` |
| R5 index.lock recovery | `reviews/batch-5-code-logic-review.md` section 2 (V7/R5) |
| R6 hook-timeout lane wait | batches.md ~449: commit start delay ~198-206 ms (< 1 s), no `lane` option needed |
| R7 card-to-turn join | batches.md Batch 31 Outcome (A7: time-window join with fallback). e2e reopen test not run here: open for live e2e |
| R8 per-turn baseline in worktree | batches.md Batch 26 Outcome (A6 `workspaceRoot: cwd`, `workingDirectory` fallback) |
| R9 `gh` output drift | batches.md Batch 49 Outcome (defensive parse, unknown to unavailable reason) |
| R10 Monaco removal | `parity-tests.md` (removal matrix, approved removals), batches.md Batch 64/65 |
| R11 `/services` entry vs lazy-load lint | batches.md ~1152 (R11 task); lint green on chat/git-ui here |
| R12 VSIX chunk filter | `bundle-measurements.md:159`: PASS on unit + packaging evidence; NOT proven by a live VS Code run (no applicable e2e exists) - open (live) |
| A1 / A2 | batches.md Batch 22 Outcomes; `reviews/gate-p4-pierre-csp.md` |
| A3 | batches.md Batch 28 Outcome (`vscode.changes` signature at 1.100.0, `extHostApiCommands.ts:452-488`) |
| A4 | batches.md Batch 34 Outcome (~1570) |
| A5 | batches.md ~926 (`removalPath` log field); live QA confirmation of which path fires: open |
| A6 / A7 | batches.md ~1309 / ~1444 |
| A8 | batches.md Task 65.1 Outcome (~2566, `stats.json` has `outputs[].inputs`); `bundle-measurements.md` |
| A9 | `reviews/gate-p4-a9-pierre-perf.md`; batches.md ~1722 |
| A10 | batches.md Batch 49 Outcome (~2101); not run against real `gh` >= 2.20 in this batch: open (live) |
| A11 | batches.md ~2202 |
| A12 | batches.md ~1845 (CRLF/LF/mixed round-trip specs) |
| V-items | not enumerated individually here; V5/V7/V8 cited in batches.md Validation notes. Batch 69 "all risks have a recorded resolution": open items listed below |

## Open

- R3 (Windows watcher live e2e), R7 (reopen e2e), R12 (live VS Code smoke), A5 and A10 (live confirmation): recorded only by unit/packaging evidence; full e2e deliberately not run in this batch.
- Known env failure `harness-skill-selection-rpc.service.spec.ts` remains.
- Uncommitted working-tree changes seen but not mine: six axe screenshots under `.ptah/specs/TASK_2026_576_e16a/screenshots/axe/` (another agent). Mine: `electron-shell.review-dock.spec.ts` (test-only) and this report.
