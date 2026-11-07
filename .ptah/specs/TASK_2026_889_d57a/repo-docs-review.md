# Repository Documentation Evidence Sweep — Independent Review

## Verdict

**REVISE — 8/10**

The repository documentation sweep across the 36 kept/rewritten files and 13 deleted files is largely accurate and well-grounded in current source code. `CLAUDE.md` is untouched (`git diff -- CLAUDE.md` is empty), relative links in modified files resolve cleanly, and whole-file deletions remove only obsolete or one-shot historical artifacts.

However, **one Blocking defect** and **one Serious defect** require revision before approval:
1. **Blocking (Policy safety / false premise)**: `CONVENTIONS.md` had its `Result<T, E>` error-return convention removed in both §7 and §11 on the false claim (`sweep-s1-report.md:10`) that no `Result<T, E>` type exists in `@ptah-extension/shared`. In fact, `export class Result<T, E extends Error = Error>` exists in `libs/shared/src/lib/utils/result.ts:8` and is re-exported from `@ptah-extension/shared` (`libs/shared/src/index.ts:69`), and `libs/backend/agent-generation/src/lib/patterns/README.md:3-4` explicitly cites it.
2. **Serious (False export claim)**: `libs/backend/lane-routing/README.md:11-21` states that the public surface is `src/index.ts` and then lists `src/lib/routing-constants.ts` under the `| Export | File |` table (`line 20`), but `libs/backend/lane-routing/src/index.ts:1-90` does not export anything from `src/lib/routing-constants.ts`.

What separates this 8/10 from 9–10 is the false-negative grep that led to weakening `CONVENTIONS.md` and the unexported file listed in `lane-routing/README.md`'s export table; what separates it from 5–6 is that every other concrete claim across root docs, `docs/**`, `apps/ptah-electron*/**`, `libs/**/README.md`, `scripts/dev/README.md`, and `tools/**/*.md` matches the codebase.

---

## Defects

1. **[Blocking] Weakened convention in `CONVENTIONS.md` based on a false code claim**
   - **Doc**: `CONVENTIONS.md:94-97` (`## 7. Error types`) and `CONVENTIONS.md:130-140` (`## 11. Cheatsheet`), plus `sweep-s1-report.md:10`
   - **What it says**: Removed `- Result<T, E> from @ptah-extension/shared is the preferred return shape for operations with expected failure paths.` from §7 and `Return shape: Result<T, E> for expected-failure paths` from §11, claiming in `sweep-s1-report.md:10` that there is `(no such type in @ptah-extension/shared)`.
   - **What the code says**: `Result<T, E>` exists in `@ptah-extension/shared`: `export class Result<T, E extends Error = Error>` in `libs/shared/src/lib/utils/result.ts:8`, re-exported via `libs/shared/src/lib/utils/index.ts:1` and `libs/shared/src/index.ts:69`. It is actively imported from `@ptah-extension/shared` by backend libraries (e.g. `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts:20` and `libs/backend/agent-generation/src/lib/patterns/error-accumulation.ts:1`), and S2's `libs/backend/agent-generation/src/lib/patterns/README.md:3-4` explicitly documents that those helpers use `Result` from `@ptah-extension/shared`.
   - **Fix**: Restore `- Result<T, E> from @ptah-extension/shared is the preferred return shape for operations with expected failure paths.` in `CONVENTIONS.md` §7 and `Return shape: Result<T, E> for expected-failure paths` in `CONVENTIONS.md` §11.

2. **[Serious] Unexported internal file listed under `| Export | File |` in `libs/backend/lane-routing/README.md`**
   - **Doc**: `libs/backend/lane-routing/README.md:11-21` (specifically line 20)
   - **What it says**: Line 11 states `Public surface is src/index.ts: tokens, registerLaneRoutingServices, ports, RouteDecideService and the decision-model settings DTOs.` Immediately below, the table header is `| Export | File |` and row 4 (`line 20`) states `| Routing thresholds, budgets, and storage keys | src/lib/routing-constants.ts |`.
   - **What the code says**: `libs/backend/lane-routing/src/index.ts:1-90` does not export any symbol from `src/lib/routing-constants.ts`. Those constants (`SCORE_MIN`, `CLOSENESS_BAND`, `DECISION_REQUEST_TIMEOUT_MS`, `OUTCOME_WINDOW_DAYS`, `ROTATION_STORAGE_KEY`, etc. in `libs/backend/lane-routing/src/lib/routing-constants.ts:17-170`) are internal to `@ptah-extension/lane-routing`.
   - **Fix**: Either remove the `src/lib/routing-constants.ts` row from the `| Export | File |` table or move it to a prose note clarifying that `src/lib/routing-constants.ts` is internal and not re-exported by `src/index.ts`.

---

## Claims verified

| Doc file:line | Claim | Source file:line | Status |
| --- | --- | --- | --- |
| `CLAUDE.md:1-200` | `CLAUDE.md` must remain completely unchanged (`git diff -- CLAUDE.md` empty) | `CLAUDE.md:1` | OK |
| `README.md:21-31` | Hero and landing demo clips (`orchestration.mp4`, `tribunal-council.mp4`, `command-center.mp4`, `multi-agent.mp4` and `.jpg` posters) match the live catalog | `libs/web/landing/src/lib/live-demo/live-demo-catalog.ts:12-45` | OK |
| `README.md:37` | Title bar tabs with a workspace open: Chat, Voice, Apps, Tasks, Reviews, Analytics, and Setup | `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:250-334` | OK |
| `README.md:39` | Session rail caps at up to 20 session tiles and 9 running sessions at once | `libs/frontend/canvas/src/lib/canvas-layout-intent.ts:11`, `libs/frontend/canvas/src/lib/canvas-running-cap.ts:6` | OK |
| `README.md:45` | Plan windows supported for Claude, Codex, Kimi, Antigravity, OpenCode, Grok, and Ollama Cloud | `libs/backend/auth-providers/src/lib/quota/readers/claude-plan-usage.reader.ts:1`, `codex-plan-usage.reader.ts:1`, `kimi-code-plan-usage.reader.ts:1`, `antigravity-plan-usage.reader.ts:1`, `opencode-go-plan-usage.reader.ts:1`, `grok-account-plan-usage.reader.ts:1`, `ollama-cloud-plan-usage.reader.ts:1` | OK |
| `README.md:63` | Task types: `FEATURE`, `BUGFIX`, `REFACTORING`, `DOCUMENTATION`, `RESEARCH`, `DEVOPS`, `SAAS_INIT`, `CREATIVE`; Depths: `Full`, `Partial`, `Minimal` | `libs/shared/src/lib/types/task-spec.types.ts:23-32`, `libs/backend/lane-routing/src/lib/contracts/route-decide-args.schema.ts:1` | OK |
| `README.md:64-65` | Decision-model request timeout is 3 seconds (`3000` ms) and outcome window is 90 days | `libs/backend/lane-routing/src/lib/routing-constants.ts:116,169` | OK |
| `README.md:84` | Previous tab closes after auto-handoff only when `sessionBudget.closeSourceAfterAutoHandoff` is on | `libs/shared/src/lib/types/session-budget.types.ts:235-239` | OK |
| `README.md:95` | Completed lane is not resumed above 150,000 context tokens or after 10 minutes (`600_000` ms) idle | `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-resume-gate.ts:46-49` | OK |
| `README.md:134` | Tree-sitter indexing covers TypeScript, TSX, JavaScript, Python, Go, C#, Java, Kotlin, Rust, PHP, Ruby, and C++ (C sources use C++ grammar) | `libs/backend/workspace-intelligence/src/ast/languages/index.ts:21-36`, `libs/backend/workspace-intelligence/src/ast/language-registry.ts:38` | OK |
| `README.md:148` | Schedules catch up inside a 24-hour window; policy is `none`, `last`, or `all` | `libs/backend/cron-scheduler/src/lib/types.ts:31-35`, `libs/backend/cron-scheduler/src/index.ts:47` | OK |
| `README.md:162` | Tasks board has six statuses (`backlog`, `in_progress`, `in_review`, `blocked`, `done`, `cancelled`) and excludes folders without `task.md` | `libs/shared/src/lib/types/task-spec.types.ts:8-20` | OK |
| `README.md:171` | Harness write targets: `claude`, `codex`, `copilot`, `cursor`, `antigravity`, `opencode`, `vscode` | `libs/shared/src/lib/types/harness-sync.types.ts:20-28` | OK |
| `README.md:216,229-233` | Node engine is `24.x`; npm scripts `electron:serve`, `docs`, `landing`, `verify` exist | `package.json:5-10,24,55` | OK |
| `README.md:243,252` | Relative links `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE.md` resolve | `CONTRIBUTING.md:1`, `SECURITY.md:1`, `LICENSE.md:1` | OK |
| `PRODUCT.md:13` | Landing page source of truth and GitHub releases download URL (`https://github.com/Hive-Academy/PtahCode/releases/latest`) | `apps/ptah-landing-page/src/index.html:5-10`, `apps/ptah-landing-page/src/app/pages/download/platforms.ts:2` | OK |
| `PRODUCT.md:24` | Contrast spec `apps/ptah-landing-page/src/app/base-content-muted.spec.ts` checks text tokens | `apps/ptah-landing-page/src/app/base-content-muted.spec.ts:1-59` | OK |
| `DESIGN.md:3,11-14` | DaisyUI theme `operator` on `index.html`; `base-100` `#08090c`, `base-200` `#0e1015`, `base-300` `#171a21`, `base-content` `#e9ebef`, `primary` `#f5a524`, `accent` `#ffbb4d`, `secondary`/`success` `#34d399`, `info` `#38bdf8`, `warning` `#eab308`, `error` `#fb7185` | `apps/ptah-landing-page/src/index.html:2`, `apps/ptah-landing-page/tailwind.config.js:13-25,94-126` | OK |
| `DESIGN.md:12` | `base-content-muted` is 5.46:1 (`base-content-muted.spec.ts`) and `no-alpha-base-content.spec.ts` bans `text-base-content/NN` | `apps/ptah-landing-page/tailwind.config.js:111-114`, `apps/ptah-landing-page/src/app/no-alpha-base-content.spec.ts:36` | OK |
| `DESIGN.md:18-24,28` | Fonts Inter and JetBrains Mono (Cinzel removed); `8xl`/`9xl` sizes; `--rounded-box: 0.75rem`, `--rounded-btn: 0.5rem`; animations `glow-pulse`, `pulse-ring`, `divider-draw`, `status-blink` | `apps/ptah-landing-page/tailwind.config.js:50-64,127-129`, `apps/ptah-landing-page/src/index.html:89` | OK |
| `DESIGN.md:32-34` | Asset directories (`live-demo/`, `og/`, `images/showcase/`, `textures/`, `backgrounds/`, `icons/glyphs/`) exist | `apps/ptah-landing-page/public/assets/` | OK |
| `CONVENTIONS.md:34-35` | `platform-electron` and `platform-cli` use `src/implementations/` instead of `src/lib/services/` | `libs/backend/platform-electron/src/implementations/`, `libs/backend/platform-cli/src/implementations/` | OK |
| `CONVENTIONS.md:47` | Deep import `@ptah-extension/vscode-lm-tools/vscode` is declared in `tsconfig.base.json` | `tsconfig.base.json:280-282` | OK |
| `CONVENTIONS.md:94-97,130-140` | Removal of `Result<T, E>` convention on the claim that `Result<T, E>` does not exist in `@ptah-extension/shared` | `libs/shared/src/lib/utils/result.ts:8`, `libs/shared/src/index.ts:69` | WRONG |
| `CONTRIBUTING.md:10,20,23,29` | Scoped verify command `npm run verify -- -p`, commitlint, renderer in `apps/ptah-extension-webview` | `package.json:24,152-153`, `apps/ptah-extension-webview/` | OK |
| `SECURITY.md:9,28-29` | Security email `security@ptah.live`; scope covers Electron desktop app and website (`ptah.live`) | `SECURITY.md:9,28-29`, `apps/` | OK |
| `.github/copilot-instructions.md:54,64-67` | Electron main window sets `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; EventBus removed | `apps/ptah-electron/src/windows/main-window.ts:58-60`, `libs/backend/vscode-core/src/config/config-manager.ts:11` | OK |
| `docs/design-system/ptah-content-brand.md:7-11` | Title and description match `apps/ptah-landing-page/src/index.html` | `apps/ptah-landing-page/src/index.html:5,9-10` | OK |
| `docs/development/electron-local-production.md:16,50` | Commands `npm run electron:backup:production-data` and `npm run electron:package:local-production`; backup script still blocks VS Code and `ptah-cli`/`ptah-tui` processes | `package.json:61-62`, `apps/ptah-electron/scripts/backup-local-production-data.js:75-83`, `apps/ptah-electron/project.json:455-471` | OK |
| `docs/development/memory-skills-evaluation.md:9-14` | `resolvePtahDbPath` in `libs/backend/persistence-sqlite/src/lib/db-path.ts` selects `ptah.sqlite`, `ptah-dev.sqlite`, `ptah-test.sqlite`, overridden by `PTAH_DB_PATH` | `libs/backend/persistence-sqlite/src/lib/db-path.ts:11-15,54-65` | OK |
| `docs/development/memory-skills-evaluation.md:48-54` | `curatorRunMessage` in `curator-activity-log.ts` maps all 11 `CuratorRunReason` codes to fixed sentences | `libs/backend/memory-curator/src/lib/curator-llm/curator-activity-log.ts:115-147` | OK |
| `docs/development/memory-skills-evaluation.md:88-98` | `memory:rebuildIndex` logs `[memory] rebuildIndex failed` and throws `Could not rebuild the memory search index. See the logs for details.` | `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts:401-407` | OK |
| `docs/development/memory-skills-evaluation.md:118-132,209` | `boot-thoth-runtime.ts` joins `IndexingControlService`; migration `0070_indexing_last_run.ts` adds `last_run_json`; `.ptah/specs/TASK_2026_878_5513/open-review-items.md` exists | `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:92-100`, `libs/backend/persistence-sqlite/src/lib/migrations/0070_indexing_last_run.ts:1-3` | OK |
| `apps/ptah-electron-e2e/README.md:9-21,47` | Targets `e2e`, `e2e:ci`, `e2e:nightly` depend on `build-dev` and `copy-renderer-dev`; `workers: 1` | `apps/ptah-electron-e2e/project.json:9-48`, `apps/ptah-electron-e2e/playwright.config.ts:22` | OK |
| `apps/ptah-electron-e2e/README.md:58-63` | `PTAH_E2E=1` skips update check (`PTAH_E2E_ALLOW_UPDATE_CHECK=1` opts in), 30 s warmup barrier, messaging gateway start (`gateway:status` reads settings), and membership priming (`license:getStatus` still verifies) | `apps/ptah-electron/src/services/update/update-manager.ts:155-163`, `boot-coordinator.ts:250,271-277`, `start-messaging-gateway.ts:47-52`, `bootstrap.ts:123-136` | OK |
| `apps/ptah-electron/src/assets/icons/README.md:7-18` | `electron-builder.yml` sets top-level `icon: assets/icons/icon.png`; `mac/`, `win/`, `png/` exist; appx tiles come from `assets/appx` via `node apps/ptah-electron/scripts/generate-appx-assets.mjs` | `apps/ptah-electron/electron-builder.yml:133,185-186` | OK |
| `libs/backend/agent-generation/README.md:4-25` | `AgentGenerationOrchestratorService` runs 4 phases; exports `registerAgentGenerationServices`, `AGENT_GENERATION_TOKENS`, and the 8 listed services; tags `scope:extension`, `type:feature` | `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts:4-8`, `src/index.ts:14-30`, `project.json:6` | OK |
| `libs/backend/agent-generation/src/lib/patterns/README.md:3-11` | `generateWithPartialSuccess`, `GenerationPipeline`, `PromptBuilder`, `BasePromptBuilder` exported from `patterns/index.ts`; use `Result` from `@ptah-extension/shared` | `libs/backend/agent-generation/src/lib/patterns/index.ts:12-14`, `error-accumulation.ts:1,98` | OK |
| `libs/backend/agent-sdk/README.md:8-18` | `SdkAgentAdapter` implements `IAgentAdapter`; exports `SdkMessageTransformer`, `InternalQueryService`, `SessionMetadataStore`; tags `scope:extension`, `type:feature` | `libs/backend/agent-sdk/src/index.ts:12,18,49,52`, `project.json:6` | OK |
| `libs/backend/lane-routing/README.md:17-21` | `LANE_ROUTING_TOKENS`, `registerLaneRoutingServices`, `RouteDecideService`, `LaneRoutingLogger` are exported from `src/index.ts` | `libs/backend/lane-routing/src/index.ts:10-14,43,55` | OK |
| `libs/backend/lane-routing/README.md:20` | Lists `src/lib/routing-constants.ts` under `| Export | File |` after stating public surface is `src/index.ts` | `libs/backend/lane-routing/src/index.ts:1-90` | WRONG |
| `libs/backend/review-contracts/README.md:3-5` | Exports `review-*.schema.ts` and `github-review.port.ts`; tagged `scope:shared`, `type:util` | `libs/backend/review-contracts/src/index.ts:1-5`, `project.json:6` | OK |
| `libs/backend/rpc-handlers/README.md:3-6` | Exports `registerSharedRpcHandlers`, `registerHarnessServices`, `registerChatServices`; no `vscode` imports | `libs/backend/rpc-handlers/src/index.ts:4-6,116,131-132` | OK |
| `libs/backend/vscode-core/README.md:4-7` | Exports `TOKENS`, `Logger`, `ConfigManager`, `ErrorHandler`, `registerVsCodeCorePlatformAgnostic`; Electron calls it in `src/di/phase-1-infra.ts` | `libs/backend/vscode-core/src/index.ts:1-26`, `apps/ptah-electron/src/di/phase-1-infra.ts:94` | OK |
| `libs/backend/vscode-lm-tools/README.md:4-6` | Exports `CodeExecutionMCP`, `PtahAPIBuilder`, `DiagnosticsCacheInvalidator`, `registerVsCodeLmToolsServices` | `libs/backend/vscode-lm-tools/src/index.ts:7,12,35,113` | OK |
| `libs/backend/workspace-intelligence/README.md:8-9` | `test` target inputs include `scripts/tree-sitter-grammars.json` and `assets/tree-sitter/**/*` | `libs/backend/workspace-intelligence/project.json:26-32` | OK |
| `libs/frontend/chat/README.md:3` | Exports chat components, directives, services, settings, `UpdateDialogService`/`UpdateDialogComponent` | `libs/frontend/chat/src/index.ts:13-23` | OK |
| `libs/frontend/core/README.md:3` | Exports `VSCodeService` (`vscode.service.ts`), Codex readiness/sign-in, `SURFACE_FOCUS_ROUTER`; tagged `scope:webview`, `type:core` | `libs/frontend/core/src/index.ts:1-13`, `project.json:7` | OK |
| `libs/frontend/dashboard/README.md:3` | Exports `DashboardGridComponent`, cards, and `ThothStatusService` | `libs/frontend/dashboard/src/index.ts:1-17` | OK |
| `libs/frontend/setup-wizard/README.md:3` | Exports `SetupWizardStateService`, `WizardRpcService`, `WizardAnalysisRunner`, `GenerationPreviewStore` | `libs/frontend/setup-wizard/src/index.ts:1-6` | OK |
| `libs/frontend/thoth-shell/README.md:4-6` | `THOTH_TAB_IDS` are `memory`, `skills`, `cron`, `gateway`; routed as `/thoth/:tab` via `THOTH_ROUTES` | `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts:47`, `src/lib/thoth.routes.ts:36-45` | OK |
| `libs/frontend/ui/README.md:3` | Exports `overlays`, `selection`, `native`, `surfaces`, `motion`; tagged `scope:webview`, `type:ui` | `libs/frontend/ui/src/index.ts:36-40`, `project.json:7` | OK |
| `libs/frontend/webview-e2e-harness/README.md:14-38` | Exports `test`, `expect`, `installPostMessageBridge`, `installCspStub`, `startFixtureServer`; `useAppBuild` defaults to `false`; `e2e` target and `.github/workflows/webview-e2e.yml`; tags `scope:webview`, `type:test-harness` | `libs/frontend/webview-e2e-harness/src/index.ts:8-25`, `src/lib/test-fixtures.ts:62`, `project.json:6,14`, `.github/workflows/webview-e2e.yml:87-92` | OK |
| `libs/web/core/README.md:3` | `@ptah-web/core` exports `GitHubReleaseService` and `SeoService` | `libs/web/core/src/index.ts:1-2`, `tsconfig.base.json:286` | OK |
| `libs/web/landing/README.md:3` | `@ptah-web/landing` exports `LandingPageComponent`, hero section, and `AlwaysOnLoopDiagramComponent` | `libs/web/landing/src/index.ts:1-3`, `tsconfig.base.json:289` | OK |
| `libs/web/legal/README.md:3` | `@ptah-web/legal` exports `PrivacyPageComponent` and `TermsPageComponent`, lazy-loaded in `app.routes.ts` | `libs/web/legal/src/index.ts:1-3`, `apps/ptah-landing-page/src/app/app.routes.ts:30-38` | OK |
| `libs/web/ui/README.md:3` | `@ptah-web/ui` exports `FooterComponent`, `NavigationComponent`, `ConsoleGridBackgroundComponent` | `libs/web/ui/src/index.ts:1-3`, `tsconfig.base.json:287` | OK |
| `scripts/dev/README.md:6-19` | `seed-lane-outcomes.mjs` (`--db`, `--seed`, `--lanes`, `--rows`, `--profile`, `seed_meta` check, refuses `~/.ptah`) and `check-past-outcomes-live.mjs` (`--db`, `--lane-ids`, `--task-kind`, `--live`, `--ab` requires `--live`, `--base-url`, `--model`) | `scripts/dev/seed-lane-outcomes.mjs:30-45,65-85,98`, `scripts/dev/check-past-outcomes-live.mjs:15-31` | OK |
| `tools/mcp-bench/README.md:3-34` | Hosts `cli-headless` and `electron`; targets `bench`, `gate`, `record-baseline`, `measure-noise`, `generate`, `test`; model panel (`PANEL_UNRESOLVED_SHARE_CAP = 0.1`); `PTAH_MCP_BENCH_DATA_DIR` / `%LOCALAPPDATA%\ptah-mcp-bench` / `~/.cache/ptah-mcp-bench` | `tools/mcp-bench/src/bench-hosts.ts:84-86`, `project.json:206-255`, `src/memory-skills/labelling/model-panel.ts:56-61`, `src/bench-data.ts:6-8,29-30` | OK |
| `tools/process-sampler/README.md:15-67` | Defaults `--duration 60`, `--interval 2000`; exit codes `0`, `1`, `2`, `64`; overhead limit `1%`; groups `ptah-worker`, `electron`, `cli-lane`, `nx-jest`, `ollama-client`, `other` | `tools/process-sampler/src/sampler.js:18-36,152-183` | OK |

---

## Review family

- **Reviewer CLI family**: Antigravity CLI (Google DeepMind / Gemini 4 Argon)
- **Implementer CLI family**: claude
