# Sweep S1 report: root and repository docs

## Files

| Path | Action | Main changes | Evidence |
| --- | --- | --- | --- |
| `README.md` | edited | Removed the docs-clips table. Renamed "What's new in v2" to "Highlights" and dropped the legacy-grid note. Title-bar tabs now list Reviews. Plan-window vendors add Ollama Cloud and drop the "5-hour or 7-day" wording. Tree-sitter language list corrected (was JS/TS/Python/Go only). Removed "Other hosts see a download prompt", "Electron-only" and several "On Electron" qualifiers. Development: dropped exact stack versions and the tree that named a VS Code extension host. Everything else already matched code (9 running, 20 tiles, 150k resume gate, 10 min idle, 3 s decision timeout, 90-day window, 85% budget, 24 h catch-up, task types, six task statuses, harness targets, landing clips). | `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:250-333`, `libs/frontend/canvas/src/lib/canvas-running-cap.ts`, `canvas-layout-intent.ts:11`, `libs/backend/workspace-intelligence/src/ast/languages/`, `libs/backend/auth-providers/src/lib/quota/readers/`, `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-resume-gate.ts:46-49`, `libs/backend/lane-routing/src/lib/routing-constants.ts`, `libs/shared/src/lib/types/task-spec.types.ts`, `libs/web/landing/src/lib/live-demo/live-demo-catalog.ts`, `apps/ptah-docs/public/screenshots/` |
| `PRODUCT.md` | edited (rewritten) | Was a VS Code extension + CLI + 100-day trial + Thoth marketing brief. Now: free MIT Electron desktop app, download from GitHub releases, principles tied to the landing. | `apps/ptah-landing-page/src/index.html`, `apps/ptah-landing-page/src/app/pages/download/platforms.ts:2` |
| `DESIGN.md` | edited (rewritten) | Was the old Egyptian gold/Cinzel system. Now the live `operator` daisyUI theme: ink backgrounds, amber primary, Inter and JetBrains Mono, GSAP motion, asset folders. | `apps/ptah-landing-page/tailwind.config.js`, `apps/ptah-landing-page/src/index.html`, `libs/web/landing/src/lib/**` (gsap imports) |
| `CONVENTIONS.md` | edited | Removed the dead `.ptah/specs/TASK_2025_291` source line, `platform-vscode` (layer table, exceptions, cheatsheet), the VS Code `contributes.configuration` bullet, and the `Result<T, E>` claim (no such type in `@ptah-extension/shared`). Prescriptive rules kept. | `libs/backend/` listing, `libs/shared/src` grep, `libs/backend/platform-electron/src/implementations/electron-workspace-provider.ts:94`, `libs/backend/platform-core/src/file-settings-keys.ts` |
| `CONTRIBUTING.md` | kept | Claims hold (commitlint, `npm run verify -- -p`, renderer in `apps/ptah-extension-webview`). | `.commitlintrc.json`, `package.json` scripts |
| `SECURITY.md` | edited | Scope: removed the VS Code extension and the license server (`api.ptah.live`), which no longer live in this repo. | `apps/` listing |
| `CLAUDE.md` | kept, no change | Every path, script and lock rule checked: `scripts/verify.mjs` flags (`--status`, `--exec --task`, `-p`, `-t`), `PTAH_VERIFY_*` vars, 120 minute takeover, `nx.json` `parallel: 1`, `jest.preset.js` `maxWorkers: 2`, pre-push `di-lint` and `validate-deps`, `.husky/pre-commit` TASK_2026_224 comment, `.claude-worktrees/` in `.gitignore`. No factual error found, so no policy text touched. | `scripts/verify.mjs`, `scripts/verify-lock.mjs:50`, `nx.json`, `jest.preset.js`, `.husky/*`, `.gitignore:56` |
| `.github/copilot-instructions.md` | edited | Removed the EventBus line (no EventBus in libs). Security section: "VS Code extensions" became the Electron app; CSP/webview/extension-permission bullets became renderer window flags, preload/RPC validation, least privilege. | `apps/ptah-electron/src/windows/main-window.ts:23-24`, `display-window.ts:147-149`, `libs/backend/vscode-core/src/config/config-manager.ts:11` |
| `docs/design-system/ptah-content-brand.md` | edited (rewritten) | Was the Egyptian gold/Cinzel/Three.js brand. Now a short positioning and rules page pointing to `DESIGN.md`. | `apps/ptah-landing-page/src/index.html` |
| `docs/design-system/designs-systems.md` | deleted | See below. | |
| `docs/development/electron-local-production.md` | kept | Matches the scripts and Nx target. | `apps/ptah-electron/scripts/backup-local-production-data.js`, `package-local-production.js`, `verify-local-production-unsigned.js`, `apps/ptah-electron/project.json:455`, `update-manager.ts:147` |
| `docs/development/memory-skills-evaluation.md` | edited | Replaced the exact-sentence reason-code table with a pointer to `curatorRunMessage` (wording goes stale first). Identifiers, DB paths, migration 0070, handler strings spot-checked. | `libs/backend/memory-curator/src/lib/curator-llm/curator-activity-log.ts`, `libs/backend/persistence-sqlite/src/lib/db-path.ts`, `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts`, `tools/mcp-bench/project.json:262,333` |
| `docs/deployment/research-vscode-extension-publishing.md` | deleted | See below. | |
| `docs/benchmarks/memory-skills-bench/posts/*.md` (4 files) | deleted | See below. | |
| `apps/ptah-docs/SCREENSHOTS.md` | edited (rewritten) | Dropped the per-page shot tables (most files and target pages are gone), counts, "Pending" rows and the removed-references log. Kept the spec, `check-screenshots` and `screenshots` workflow, harness notes. | `apps/ptah-docs/project.json:20-37`, `apps/ptah-docs/scripts/check-screenshot-refs.mjs`, `apps/ptah-electron-e2e/src/docs-screenshots/_harness/*.ts`, `docs-screenshots.config.ts` |
| `apps/ptah-electron-e2e/README.md` | edited | One fix: the messaging-gateway row said the `gateway:*` RPC still answers; the code says only `gateway:status` reads settings. All targets, fixtures, `PTAH_E2E` gates, 30 s warmup and `workers: 1` verified. | `apps/ptah-electron-e2e/project.json`, `playwright.config.ts:22`, `electron-launcher.ts:109-114`, `start-messaging-gateway.ts:44-52`, `boot-coordinator.ts:250`, `update-manager.ts:138-160` |
| `apps/ptah-electron/src/assets/icons/README.md` | edited (rewritten) | The old file claimed `electron-builder.yml` points `mac.icon`/`win.icon` at `icons/`; it only sets top-level `icon: assets/icons/icon.png`. Replaced with a file map plus the appx tile regeneration command; dropped the sips/ImageMagick recipes and design tips. | `apps/ptah-electron/electron-builder.yml:133`, icon folder listing, `scripts/generate-appx-assets.mjs` |

## Deleted files

- `docs/deployment/research-vscode-extension-publishing.md`: research for publishing the removed VS Code extension.
- `docs/design-system/designs-systems.md`: a generic white/indigo style essay that never described Ptah. Not backed by any product surface.
- `docs/benchmarks/memory-skills-bench/posts/01-record-replay-cassettes.md`, `02-when-the-scorecard-lies.md`, `03-long-recordings-and-timeouts.md`, `README.md`: dated engineering diary posts. They carry run times and smoke ids, a "no valid result yet" status snapshot, `file:line` citations that go stale on any edit, and cite spec files that do not exist (`TASK_2026_620_a13e/HANDOFF.md`, `follow-up-recordings.md`). The code they describe still exists in `tools/mcp-bench`.

## Inbound links to fix

- `.claude/skills/ui-ux-designer/DEVELOPER-HANDOFF.md:450` and `plugins/ptah-core/skills/ui-ux-designer/DEVELOPER-HANDOFF.md:450` link `docs/design-system/designs-systems.md` (deleted). Point them at `DESIGN.md`.
- `apps/ptah-electron-e2e/src/docs-screenshots/_harness/shooter.ts:8,31,96` call `SCREENSHOTS.md` "the shot list and the spec". It is now the spec only.
- `apps/ptah-electron-e2e/docs-screenshots.config.ts:10-13` says the shots reuse "mocked RPC" fixtures. The harness and the new SCREENSHOTS.md say the opposite (real backend).
- `tools/mcp-bench/questions/7910f34cf/file-tools.json:17040-17042` use `designs-systems.md` lines as ground truth. The corpus is pinned to commit `7910f34cf` (`tools/mcp-bench/corpus.config.json`) and `.md` is not in `eligibleExtensions`, so this should not break; confirm if the benchmark ever reads HEAD.
- `.claude/agents/*` and `.claude/skills/*` (technical-content-writer, ui-ux-designer) tell agents to read `docs/design-system/`. That folder now holds only `ptah-content-brand.md` and `design-3.png`.

## Out-of-scope leftovers (not markdown, not touched)

- `docs/design-system/design-3.png` (4 MB) is an unreferenced reference image of the old style. Candidate for deletion.
- `docs/benchmarks/memory-skills-bench/cassette-charts.html`, `cassette-stats.json`, `generate-cassette-charts.mjs` lost their README and are only referenced by the deleted posts. The generator reads a private cassette outside the repo. Candidates for deletion.
- `libs/backend/platform-core/src/di/tokens.ts`, `libs/backend/cli-agent-runtime`, `libs/backend/workspace-intelligence/src/services/file-system.service.ts` and others still mention `platform-vscode` in comments or specs.
- `apps/ptah-extension-webview/src/app/app.config.ts` comment says the router seam serves "both hosts".
- `.commitlintrc.json` scope enum still lists `vscode`, `cli`, `tui`, `video-studio`, `platform-vscode`, which no longer exist. Not in my scope.
- `apps/ptah-electron/scripts/backup-local-production-data.js` still refuses to run next to VS Code and `ptah-cli`/`ptah-tui` processes (old installs may share `~/.ptah`), so `electron-local-production.md` keeps that wording; it matches the script.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| - | -------- | ------- | -------- | ---------- |
| 1 | Rewrote `DESIGN.md` and `ptah-content-brand.md` from the live landing theme instead of deleting them. | Delete both; keep the old gold system; rewrite. | Agents are told to look in `docs/design-system/`; the landing uses the `operator` theme (amber, Inter, no Cinzel). | yes (git) |
| 2 | `CLAUDE.md` left unchanged. | Edit any wording. | No factual error found; the file is binding policy. | n/a |
| 3 | Deleted the benchmark posts. | Keep with trimmed status line; delete. | Time-stamped logs, stale line citations, missing cited files. | yes (git) |
| 4 | Kept `electron-local-production.md` VS Code / CLI wording. | Remove it. | The backup script still enforces it. | yes |
| 5 | Did not add a remote-machines section to the README. | Add a short bullet. | D7 forbids expansion; gap listed. | yes |

## Gaps (topics in code, not covered here)

- Remote machines (`libs/backend/remote-machines`, `libs/frontend/machines-ui`): ssh transport, pairing, registry. Not in README or any doc in scope.
- MCP caller authentication (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-caller-policy.ts`) is not documented in README.
- Not verified line by line in the README: Discord command set, named Claude account certification steps, GitHub plugin consent token, task-id allocation across worktrees. Spot checks found the surrounding code; the exact wording was left as written.
