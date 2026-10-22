# Lane B CI report

## Measured durations

Sources: `gh run view 39841937068 --repo Hive-Academy/ptah-extension --log` and the same command for `39834581739`; logs captured once to temporary files, filtered before inspection.

**Limitation:** successful Nx task lines contain completion timestamps, not individual runtimes; successful Jest output is suppressed. The seconds below are measured gaps between successive test completions in each shard, first measured from test-step start. Dependency builds and overlap at `--parallel=2` contaminate these estimates. They are scheduling proxies, NOT isolated project durations. Failed-task logs are included where a completion line exists. The committed weights average available observations; unobserved projects use 30 seconds.

| Project | Seconds (completion-gap proxy) | Source run |
|---|---:|---|
| @ptah-extension/agent-generation | 53.658 | 39841937068 |
| @ptah-extension/agent-generation | 17.926 | 39834581739 |
| @ptah-extension/agent-sdk | 125.032 | 39834581739 |
| @ptah-extension/auth-providers | 1.928 | 39834581739 |
| @ptah-extension/canvas | 41.165 | 39834581739 |
| @ptah-extension/chat | 55.049 | 39834581739 |
| @ptah-extension/chat-execution-tree | 10.699 | 39834581739 |
| @ptah-extension/chat-routing | 1.160 | 39834581739 |
| @ptah-extension/chat-state | 18.419 | 39834581739 |
| @ptah-extension/chat-streaming | 32.671 | 39834581739 |
| @ptah-extension/chat-ui | 14.863 | 39834581739 |
| @ptah-extension/cli-agent-runtime | 53.434 | 39841937068 |
| @ptah-extension/cli-agent-runtime | 137.239 | 39834581739 |
| @ptah-extension/cli-engine | 163.303 | 39841937068 |
| @ptah-extension/cli-engine | 4.799 | 39834581739 |
| @ptah-extension/command-center | 72.849 | 39834581739 |
| @ptah-extension/core | 37.196 | 39834581739 |
| @ptah-extension/cron-scheduler | 20.185 | 39834581739 |
| @ptah-extension/cron-scheduler-ui | 16.232 | 39834581739 |
| @ptah-extension/dashboard | 26.820 | 39834581739 |
| @ptah-extension/declarative-dashboard | 12.279 | 39834581739 |
| @ptah-extension/gateway-chat-bridge | 111.453 | 39841937068 |
| @ptah-extension/gateway-chat-bridge | 46.827 | 39834581739 |
| @ptah-extension/git-ui | 41.087 | 39834581739 |
| @ptah-extension/harness-builder | 51.295 | 39834581739 |
| @ptah-extension/harness-sync | 32.359 | 39834581739 |
| @ptah-extension/lane-outcomes | 95.712 | 39834581739 |
| @ptah-extension/lane-routing | 9.064 | 39834581739 |
| @ptah-extension/marketplace | 88.025 | 39834581739 |
| @ptah-extension/mcp-apps-page | 49.740 | 39834581739 |
| @ptah-extension/memory-curator | 80.215 | 39834581739 |
| @ptah-extension/memory-curator-ui | 28.024 | 39834581739 |
| @ptah-extension/messaging-gateway | 30.280 | 39834581739 |
| @ptah-extension/messaging-gateway-ui | 18.319 | 39834581739 |
| @ptah-extension/notification-center | 18.823 | 39834581739 |
| @ptah-extension/output-styles | 20.711 | 39834581739 |
| @ptah-extension/persistence-sqlite | 164.140 | 39834581739 |
| @ptah-extension/platform-cli | 31.291 | 39834581739 |
| @ptah-extension/platform-core | 42.116 | 39834581739 |
| @ptah-extension/platform-electron | 73.316 | 39834581739 |
| @ptah-extension/platform-vscode | 34.080 | 39834581739 |
| @ptah-extension/plugin-marketplace | 11.271 | 39834581739 |
| @ptah-extension/rpc-handlers | 192.663 | 39841937068 |
| @ptah-extension/rpc-handlers | 28.292 | 39834581739 |
| @ptah-extension/session-organization | 23.438 | 39834581739 |
| @ptah-extension/settings-core | 28.919 | 39834581739 |
| @ptah-extension/setup-wizard | 0.336 | 39834581739 |
| @ptah-extension/shared | 210.114 | 39834581739 |
| @ptah-extension/skill-synthesis | 50.904 | 39841937068 |
| @ptah-extension/skill-synthesis | 11.126 | 39834581739 |
| @ptah-extension/skill-synthesis-ui | 2.126 | 39834581739 |
| @ptah-extension/task-specs | 4.341 | 39834581739 |
| @ptah-extension/tasks-ui | 26.035 | 39834581739 |
| @ptah-extension/thoth-runtime | 72.968 | 39841937068 |
| @ptah-extension/thoth-runtime | 0.698 | 39834581739 |
| @ptah-extension/thoth-shell | 14.564 | 39834581739 |
| @ptah-extension/tool-output-reducers | 85.368 | 39834581739 |
| @ptah-extension/tribunal-panel | 47.170 | 39834581739 |
| @ptah-extension/ui | 145.243 | 39834581739 |
| @ptah-extension/usage-analytics | 0.456 | 39834581739 |
| @ptah-extension/voice-providers | 0.713 | 39834581739 |
| @ptah-extension/vscode-core | 11.983 | 39834581739 |
| @ptah-extension/vscode-lm-tools | 360.343 | 39841937068 |
| @ptah-extension/vscode-lm-tools | 6.143 | 39834581739 |
| @ptah-extension/workspace-indexing | 14.928 | 39834581739 |
| @ptah-extension/workspace-intelligence | 52.273 | 39834581739 |
| api-admin | 24.732 | 39834581739 |
| api-billing | 3.183 | 39834581739 |
| api-community | 26.697 | 39834581739 |
| api-forum | 35.808 | 39834581739 |
| api-identity | 17.088 | 39834581739 |
| api-learning | 33.952 | 39834581739 |
| api-licensing | 15.803 | 39834581739 |
| api-marketing | 10.412 | 39834581739 |
| api-member-hub | 28.265 | 39834581739 |
| api-membership | 13.310 | 39834581739 |
| api-notifications | 20.023 | 39834581739 |
| mcp-bench | 26.216 | 39841937068 |
| mcp-bench | 140.640 | 39834581739 |
| ptah-cli | 93.693 | 39841937068 |
| ptah-cli | 93.942 | 39834581739 |
| ptah-electron | 68.429 | 39841937068 |
| ptah-electron | 47.431 | 39834581739 |
| ptah-extension-vscode | 31.420 | 39841937068 |
| ptah-extension-vscode | 63.299 | 39834581739 |
| ptah-extension-webview | 6.008 | 39834581739 |
| ptah-license-server | 36.170 | 39834581739 |
| ptah-tui | 101.446 | 39841937068 |
| ptah-tui | 111.118 | 39834581739 |

## Shard plan

Greedy longest-processing-time assignment, descending weight, lexical project tie-break, lowest shard index on equal load. Four shards retained: two observations do not establish a benefit from more runners; startup/install costs apply to every runner. Deduplicate input, validate names/weights/arguments, retain `projects=` GitHub output. Keep `nx show projects --affected -t test --json`; Nx 24 documentation explicitly supports affected project selection with a target: [Nx affected](https://nx.dev/docs/features/ci-features/affected).

Before uses actual logged bucket membership; after applies the new algorithm to the same affected set. All columns use the SAME averaged weight model, so these are expected **proxy-load totals**, not predicted wall-clock seconds (dependency graph and two simultaneous tasks are not modeled).

| Source affected set | Before shards 1 / 2 / 3 / 4 (s) | After shards 1 / 2 / 3 / 4 (s) |
|---|---|---|
| 39841937068 | 408.7 / 283.4 / 184.3 / 168.2 | 262.4 / 266.5 / 268.7 / 247.1 |
| 39834581739 | 996.5 / 636.2 / 908.1 / 849.8 | 847.5 / 847.7 / 847.7 / 847.7 |

## Cache keys

`.github/workflows/ci.yml`: save `nx-${runner.os}-checks-${github.sha}` and `nx-${runner.os}-test-${matrix.shard}-${github.sha}`. Restore job prefix first (`nx-${runner.os}-checks-` / `nx-${runner.os}-test-${matrix.shard}-`), then `nx-${runner.os}-`. Composite input already accepts multiline restore keys; updated its description. Pinned cache action SHA unchanged.

`gh api repos/Hive-Academy/ptah-extension/actions/cache/usage`: **10,736,226,040 bytes, 34 entries**, almost 10 GiB. `gh cache list --repo Hive-Academy/ptah-extension --limit 12 --json key,sizeInBytes` showed Nx shard entries ~3,535,879?3,539,314 bytes; five full Nx copies cost ~17.7 MB per run. Dependency entries were 861 MB?1.224 GB each; they dominate existing eviction pressure. Safe choice: keep the existing five small Nx snapshots and job-local restoration, introduce no additional binary/dependency caches. This does not solve existing repository-wide eviction, and per-SHA generations still accumulate. Broad fallback may copy another job cache on a cold start. Do not claim the repository is free of eviction risk.

Cache-pressure cause: large node_modules snapshots across OS/job namespaces and PR-scoped generations dominate storage; the small Nx snapshots are not the primary cause. Applied fix: restore each job's prior Nx cache first, with OS fallback, without adding cache copies. Recommendation: audit obsolete dependency-cache generations and PR refs, then establish retention/cleanup ownership before deleting anything; preserve the existing job isolation documented in ci.yml. No cache deletion or retention policy change was performed.

## Pre-push hook

Removed automatic main/develop full build/typecheck block and unused branch lookup. Retained DI invariant lint and Electron validate-deps on every push. Paranoid opt-in uses `nx affected -t build --base=origin/main --head=HEAD`, excluding uncommitted changes. CI owns PR validation. Note: inspected CI explicitly runs affected build, not a standalone affected typecheck; removing the hook follows the requested policy, not proof of identical typecheck coverage.

## Type error fix

done by orchestrator.

This role prohibits application-source edits (devops-engineer.md, Output contract); sent the parent the narrowing guard. Parent has independently updated artifact-containment.spec.ts with an `in` / function-type guard before invocation. This lane did not edit that file or run TypeScript. Behavior remains invoking the fixture function, with an explicit missing-function failure. Parent owns typecheck evidence.

## Other changes

Guard ripgrep installation with `command -v rg`; guard xvfb installation with both `xvfb-run` and `xauth`. Only absent tools cause apt metadata refresh/package installation. Electron downloader remains, because setup-ci skips lifecycle scripts. Export affected-project JSON only after a standalone successful Nx query so a failing command substitution cannot silently select an empty shard. No trigger, release, secret, action SHA or coverage/concurrency changes.

Surface inspected: `.github/workflows/ci.yml`, `.github/actions/setup-ci/action.yml`, `.husky/pre-push`, `package.json`, `apps/ptah-electron/project.json`, `apps/ptah-electron-e2e/project.json`, `apps/ptah-license-server/project.json`; `CLAUDE.md` requires scoped memory-safe checks and parent-owned Git; `CONTRIBUTING.md` documents setup and quality commands; README inspected for delivery context. AGENTS.md absent. Task directory absent initially (`ptah_search_files` zero hits and one native rg fallback); parent created assigned directory after escalation. No batch/context/plan was available initially.

Applicable existing CI targets: `di-lint:self-test`, `di-lint:lint`, `degradation-audit:self-test`, `degradation-audit:lint`, `npm run test:scripts`, affected `build`, affected `validate-deps`, `npm run gate:eager-closure`, affected project selection then test run-many, `ptah-license-server:prisma:generate`, `@ptah-extension/vscode-core:test-real-git`, filtered ptah-electron/platform-electron tests. Existing trigger remains pull_request to main, original paths-ignore and bot guards. No publishing surface changed.

Verification: Node/YAML parser (`yaml.parseDocument`, unique keys) passed both YAML files. Node subprocess sample invoked `node tools/ci/assign-test-shard.mjs <1..4> 4` for all 76 observed names: totals 847.5 / 847.7 / 847.7 / 847.7; exact-once coverage, reversed-input determinism, empty input, unknown default, duplicate input, invalid name and invalid shard checks passed. `git diff --check` passed (only CRLF normalization notices before files normalized to LF). No Nx test/typecheck/lint/build/e2e/run-many/install executed. Scoped ptah diagnostics requested; result recorded below.

## Recommendations not applied

- Capture real per-task start/end durations (Nx task history/profile artifact) before treating these proxy weights as calibrated runtimes; remeasure after Nx 24 and dependency graph changes. Current data cannot demonstrate real wall-time improvement.
- Investigate the unconditional Linux platform `npm install`: logs show 31?40 seconds per warm shard despite a node_modules cache hit. Keep the documented npm/cli#4828 workaround until binary-presence checks and lockfile side effects are verified.
- Prisma cache path emitted Path Validation Error in both runs; inspect the actual generator output before fixing its path (outside this batch).
- Audit large repeated node_modules entries and retention across PR refs; do not add Electron/apt caches while near capacity. No remote cache deletions performed.
- Shared dependency builds repeat across shards; task-based affected may reduce them, but further graph changes belong to the Nx lane.
- Real-git jobs are isolated runners, so their npm ci is not duplicate installation within a job. Preserve OS coverage and cache isolation (existing comments document incomplete-artifact collision risk).

## Decisions

| Decision | Options | Evidence | Reversible |
|---|---|---|---|
| Four LPT shards with explicit timing proxies | Count round-robin; proxy LPT; add runners | Two run logs, no isolated durations, four existing jobs | Yes: restore inline assignment / tune JSON |
| Job-first keys with OS fallback, no new caches | Same broad restore; job-first; extra binary caches | Nx ~3.5 MB vs dependency caches ~1 GB; repo nearly 10 GiB | Yes: restore prior key strings |
| Check installed OS tools before apt | Always apt; command checks; cache apt | Both existing steps update apt, tools may already exist | Yes |
| Delegate source fix to parent | Edit forbidden source; report narrowing guard | Role Output contract forbids application edits | Parent-owned |
| Remove branch-only hook checks | Preserve duplicate checks; requested CI ownership | Explicit assignment and existing CI build | Yes: restore hook block |

## Not done / blockers

No isolated per-project duration measurements could be extracted from suppressed successful test output. Committed weights are transparently labeled proxies; actual wall-time gain remains unverified. No workflow run or heavy local validation performed, as requested. Type fix and typecheck owned by parent. No Git mutations. No remote caches deleted. Other lane files were observed modified and left untouched.

Scoped diagnostics outcome: `ptah_get_diagnostics` returned unavailable: JavaScript TypeScript check still running after 45 seconds (not cancelled), shell hook language unrecognised, three files non-source. No clean diagnostic result claimed; no retry or additional heavy check started. Node sample execution and YAML parsing provide the available local proof.
