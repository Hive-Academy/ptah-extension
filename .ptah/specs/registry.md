# Task Tracking Registry

| Task ID       | Description                                                                                                                                           | Status      | Owner        | Created    | Completed  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------ | ---------- | ---------- |
| TASK_2025_280 | — (reserved) | — | — | — | — |
| TASK_2025_281 | — (reserved) | — | — | — | — |
| TASK_2025_282 | Ollama as Ptah CLI Provider — Enable Ollama/Ollama Cloud in Ptah CLI agent system, local provider handling (no API key), frontend + backend integration | ✅ Complete | orchestrator | 2026-04-14 | 2026-04-14 |
| TASK_2025_283 | Advanced Editor Features — Vim Mode, Multi-File Search, Split Panes for Electron Monaco editor | 🔄 Active | orchestrator | 2026-04-15 | |
| TASK_2025_284 | — (reserved) | — | — | — | — |
| TASK_2025_285 | — (reserved) | — | — | — | — |
| TASK_2025_286 | AdminJS Admin Panel — NestJS license server admin panel with WorkOS auth, email allowlist, CRUD views, marketing email action | ✅ Complete | orchestrator | 2026-04-18 | 2026-04-18 |
| TASK_2025_287 | Sentry Error Monitoring — Integrate Sentry across all backend libraries, instrument try/catch blocks, RPC handlers, agent SDK, DI services | ✅ Complete | orchestrator | 2026-04-21 | 2026-04-21 |
| TASK_2025_291 | Backend Library Audit Campaign — Comprehensive per-library review (architecture + logic + style + tests) across all 14 backend libraries, ordered most-shared to least-shared, producing non-breaking elevation roadmaps | 🔄 Active | orchestrator | 2026-04-21 | |
| TASK_2025_292 | Admin Panel Enhancements — Landing-page admin: cascade user deletion, bulk marketing email campaigns, complimentary license issuance (admin-configurable duration) | 🔄 Active | orchestrator | 2026-04-23 | |
| TASK_2025_293 | Remove deep-agent-sdk — Delete LangChain runtime, AgentRuntimeSelector, ptah.runtime setting, and all switching logic; wire SdkAgentAdapter directly | ✅ Complete | orchestrator | 2026-04-23 | 2026-04-23 |
| TASK_2025_294 | Systematic Testing Implementation — Workspace-wide test coverage audit, testing strategy, and test implementation across apps/libs (unit/integration/e2e) | ✅ Complete | orchestrator | 2026-04-24 | 2026-04-24 |
| TASK_2026_100 | Test Coverage Stabilization & Phase 2 Promotion — 9 bugfix+ratchet batches stabilizing pre-existing failures; Wave P1 (vscode-lm-tools deep coverage, 26 suites/453 tests), P2 (orchestrator.service.spec rewrite, 41 tests), P3 (Playwright webview E2E, 14 specs/65 tests + CI) | ✅ Complete | orchestrator | 2026-04-25 | 2026-04-25 |
| TASK_2026_101 | P1 Bugfixes + Playwright-Electron E2E — Wave A: 6 production bugs fixed in vscode-lm-tools (3 confirmed false-positives). Wave B: esbuild plugin for CJS-external named imports + Playwright-Electron harness + 60 E2E tests (46/14/0) + electron-e2e CI workflow | ✅ Complete | orchestrator | 2026-04-25 | 2026-04-25 |
| TASK_2026_102 | Test-Coverage Backlog — Unblock 14 skipped Electron E2E tests (PTY packaged build, git-watcher __test__ IPC, license-watcher mock server), fix agent-generation flake, promote test-electron/Stryker/visual-regression/load-testing/dashboard/TUI from deferred backlog | 📋 Planned | orchestrator | 2026-04-25 | |
| TASK_2026_103 | Frontend Library Audit Campaign — Mirror TASK_2025_291 backend sweep for libs/frontend/* (9 libs): per-lib LIBRARY_REVIEW.md, CROSS_LIBRARY_SYNTHESIS.md, TARGET_LIB_GRAPH.md (Nx type:* tag constraints), SURGICAL_FIX_PLAN.md (Wave A/B), EXECUTION_PLAN.md. Audit + plan only — no implementation. | 🔄 Active | orchestrator | 2026-04-25 | |
| TASK_2026_104 | A2A CLI Bridge (`@ptah-extensions/cli`) — Pivot ptah-tui → headless ptah-cli; strip Ink/React; add commander router with `config`/`harness`/`profile`/`run`/`execute-spec`/`interact`; JSON-RPC 2.0 stdio adapter for OpenClaw/NemoClaw A2A integration; reuse existing platform-cli + DI + in-process RPC transport; publish as standalone npm package. | 📋 Planned | orchestrator | 2026-04-25 | |
