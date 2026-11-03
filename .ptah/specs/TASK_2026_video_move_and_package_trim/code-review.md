# Independent code review: video move and package trim

## Verdict: CHANGES REQUIRED

The video-source removal, production edits, configuration edits, and retained Electron e2e suite are consistent with the task. The branch does not satisfy the explicit requirement to leave no unused root packages. Nine pre-existing direct package entries have no live consumer in the retained repository. One stale comment also names a deleted showcase scene.

## Findings

### 1. Medium — Nine unused direct package entries remain

All nine entries also exist on `main`, so this is pre-existing dependency debt rather than a regression from the video move. The task explicitly includes orphaned packages in scope.

| Package | Root entry | Audit result |
|---|---|---|
| `@angular/cdk-experimental` | `package.json:71` | Only the root declaration was found. |
| `@angular/platform-browser-dynamic` | `package.json:77` | No import or required peer was found. Installed `jest-preset-angular@17.0.0` does not require it. |
| `node-pty` | `package.json:131` | Only comments and package declarations were found. No import or `require` was found. |
| `nodejs-whisper` | `package.json:132` | No import or `require` was found. `libs/backend/rpc-handlers/project.json:32` only lists it as external. Retained Whisper code uses `@huggingface/transformers`. |
| `@eslint/js` | `package.json:156` | The only import is in migration documentation. Active ESLint configs do not import it. |
| `@typescript-eslint/utils` | `package.json:180` | No direct source or config import was found. `angular-eslint` and `typescript-eslint` bring it in transitively, so the direct root declaration is redundant. |
| `@xterm/headless` | `package.json:181` | Only the root declaration was found. |
| `adm-zip` | `package.json:182` | Only the root declaration was found. |
| `tree-kill` | `package.json:209` | Only comments and the root declaration were found. No import or `require` was found. |

Remove these direct declarations and regenerate the lockfile. Also remove the stale `nodejs-whisper` external declaration if the package is removed. Keep transitive lockfile entries where retained packages still require them.

### 2. Low — A retained comment references a deleted showcase scene

`libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.table.ts:1682` names `apps/ptah-electron-e2e/src/showcase/settings-tour.scene.ts`, which this branch deletes. The adjacent docs-screenshot reference remains valid. Update the comment to describe only the retained consumer.

## Correctness and removed-reference review

No production defect was found in the reviewed edits.

- `libs/backend/agent-generation/src/lib/services/agent-recommendation.service.ts` removes the only opt-in catalog member. The remaining unconditional `recommended: true` mapping is consistent.
- `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.ts` removes the duplicate video catalog entry and preserves the remaining setup recommendations.
- `libs/backend/agent-generation/src/lib/services/subagent-tool-allowlist.ts` removes only the video role restriction.
- `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts` removes only `ptah-video` from the available plugin catalog.
- `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/prompt-catalogue.ts` removes only `/video-showcase`.
- Updated template counts from 15 to 14, prompt counts from 26 to 25, narrower-role counts from 9 to 8, and renderer e2e target counts from three to two match the deleted entries.
- Generic template, recommendation, allowlist, quarantine, model-frontmatter, launcher, renderer-wiring, and gitignore regression assertions remain.
- Searches of retained production, configuration, hooks, workflows, docs, and skills found no live reference to the removed video agent, plugin, skill, projects, or packages. The remaining `remotion` hits are an external skills.sh skill and a documentation search example. Historical fixtures and benchmark data are non-runtime records.

## Electron e2e integrity

The real Electron e2e suite remains intact.

- `apps/ptah-electron-e2e/project.json` retains `e2e`, `e2e:nightly`, and `typecheck`. Only `showcase` and `showcase:lane-review` were removed.
- `apps/ptah-electron-e2e/playwright.config.ts` still uses `testDir: './src/specs'` and `testMatch: ['**/*.spec.ts']`. Its global setup remains `./src/support/build-precheck.ts`.
- `apps/ptah-electron-e2e/tsconfig.spec.json` includes retained specs, support, docs-screenshots, and both Playwright configs.
- Git tracks 103 files under the retained specs, support, docs-screenshots, and docs configuration paths. The branch deletes none of them.
- The renderer cache-key spec still checks renderer wiring for both `e2e` and `e2e:nightly`.

No e2e target was run, as required by the review limits.

## Configuration validation

- `git diff main --check` passed.
- JSON parsing passed for the edited root and Electron e2e configuration files.
- `node --check eslint.config.mjs` passed.
- Every remaining TypeScript path target in `tsconfig.base.json` exists.
- No retained project owns the removed `scope:app`, `scope:api`, or `scope:api-contracts` tags.
- The edits to `.gitignore`, `.nxignore`, `.sonarcloud.properties`, and `.commitlintrc.json` remove entries for deleted projects or tooling.
- All 17 planned React, Remotion, and Three direct packages are absent from both root dependency sections and the lockfile root package.

## Full root dependency audit

Method: search retained source, specs, styles, project configuration, packaging, scripts, hooks, workflows, and installed peer metadata. `KEEP` means at least one live consumer or a required tooling/peer role was found. `REMOVE` means no live consumer justifies the direct root entry. `D` is `dependencies`; `DD` is `devDependencies`.

| Section | Package | Decision | Consumer or basis |
|---|---|---|---|
| D | `@agentclientprotocol/sdk` | KEEP | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/acp/acp-permission-policy.spec.ts:4`; Electron external at `apps/ptah-electron/project.json:42`. |
| D | `@angular/cdk-experimental` | REMOVE | No consumer; root-only entry at `package.json:71`. |
| D | `@angular/common` | KEEP | Retained Angular sources and skill assets import it. |
| D | `@angular/compiler` | KEEP | `libs/frontend/chat/src/lib/components/organisms/session-inspector/session-inspector.component.spec.ts:2`. |
| D | `@angular/core` | KEEP | Retained Angular application and library components import it. |
| D | `@angular/forms` | KEEP | `libs/frontend/canvas/src/lib/canvas-orchestra/orchestra-canvas.component.ts:16`. |
| D | `@angular/platform-browser` | KEEP | `apps/ptah-extension-webview/src/main.ts:1`; required peer of `jest-preset-angular`. |
| D | `@angular/platform-browser-dynamic` | REMOVE | No consumer or installed peer requirement; `package.json:77`. |
| D | `@angular/platform-server` | KEEP | Required peer of retained `@angular/ssr`. |
| D | `@angular/router` | KEEP | `apps/ptah-extension-webview/src/app/app.config.ts:15`. |
| D | `@angular/ssr` | KEEP | `apps/ptah-landing-page/src/app/app.config.server.ts:2`. |
| D | `@anthropic-ai/claude-agent-sdk` | KEEP | `libs/backend/agent-sdk/src/lib/helpers/sdk-module-loader.ts:65`; Electron external. |
| D | `@anthropic-ai/sdk` | KEEP | `libs/backend/auth-providers/src/lib/translation/responses-stream-translator.spec.ts:29`. |
| D | `@astrojs/starlight` | KEEP | `apps/ptah-docs/astro.config.mjs:3`. |
| D | `@codemirror/commands` | KEEP | `libs/frontend/git-ui/src/lib/spot-editor/codemirror-setup.ts:10`. |
| D | `@codemirror/language` | KEEP | `libs/frontend/git-ui/src/lib/spot-editor/codemirror-setup.ts:16`. |
| D | `@codemirror/language-data` | KEEP | `libs/frontend/git-ui/src/lib/spot-editor/codemirror-setup.ts:17`. |
| D | `@codemirror/state` | KEEP | `libs/frontend/git-ui/src/lib/spot-editor/codemirror-setup.ts:23`. |
| D | `@codemirror/view` | KEEP | `libs/frontend/git-ui/src/lib/spot-editor/codemirror-setup.ts:30`. |
| D | `@cursor/sdk` | KEEP | Retained Cursor adapter and `cursor-cli.adapter.spec.ts:81`; Windows spawn patch and Electron packaging. |
| D | `@floating-ui/dom` | KEEP | Retained canvas components and `canvas-rail-card.component.spec.ts:47`. |
| D | `@hive-academy/angular-gsap` | KEEP | Retained Angular GSAP skill assets and landing animation code. |
| D | `@huggingface/transformers` | KEEP | `libs/backend/memory-curator/src/lib/embedder/embedder-worker.ts:137`; voice pipelines and Electron packaging. |
| D | `@modelcontextprotocol/sdk` | KEEP | Required peer of retained `@anthropic-ai/claude-agent-sdk`. |
| D | `@openai/codex-sdk` | KEEP | `scripts/windows-hide-patch/patch-windows-hide-deps.js:47`; Electron external at `apps/ptah-electron/project.json:41`. |
| D | `@parcel/watcher` | KEEP | `libs/backend/platform-cli/src/workspace-watch/workspace-watch-host.entry.ts:43`. |
| D | `@pierre/diffs` | KEEP | `libs/frontend/git-ui/src/lib/renderer/pierre-config.ts:7`. |
| D | `@sentry/node` | KEEP | `libs/backend/vscode-core/src/services/sentry.service.spec.ts:2`; Electron packaging. |
| D | `@slack/bolt` | KEEP | `libs/backend/messaging-gateway/src/lib/adapters/slack/bolt.adapter.ts:85`. |
| D | `@tavily/core` | KEEP | `libs/backend/vscode-lm-tools/src/lib/code-execution/services/providers/tavily.provider.ts:15`. |
| D | `@vscode/tree-sitter-wasm` | KEEP | `apps/ptah-electron/src/services/electron-ide-capabilities.spec.ts:35` resolves its retained runtime assets. |
| D | `astro` | KEEP | `apps/ptah-docs/astro.config.mjs:2`. |
| D | `axios` | KEEP | Retained auth-provider imports and specs. |
| D | `better-sqlite3` | KEEP | `apps/ptah-electron-e2e/src/support/skill-telemetry-db.ts:103`; retained persistence code. |
| D | `bottleneck` | KEEP | Electron external dependency at `apps/ptah-electron/project.json:90`. |
| D | `chokidar` | KEEP | Retained platform filesystem and watcher code. |
| D | `chrome-launcher` | KEEP | Retained browser-capability implementation and specs. |
| D | `chrome-remote-interface` | KEEP | Retained browser-capability implementation and specs. |
| D | `croner` | KEEP | `libs/backend/cron-scheduler/src/lib/croner-loader.ts:30`. |
| D | `cross-spawn` | KEEP | Retained process-spawn code and CLI detector specs. |
| D | `culori` | KEEP | `apps/ptah-extension-webview/src/app/base-content-muted.spec.ts:34`. |
| D | `discord.js` | KEEP | `libs/backend/messaging-gateway/src/lib/adapters/discord/discord.adapter.ts:119`. |
| D | `dompurify` | KEEP | `libs/frontend/chat-ui/src/lib/organisms/mermaid/mermaid-diagram.component.ts:2`. |
| D | `eventemitter3` | KEEP | `libs/backend/agent-sdk/src/lib/helpers/callback-registry.base.ts:1`. |
| D | `exa-js` | KEEP | `libs/backend/vscode-lm-tools/src/lib/code-execution/services/providers/exa.provider.ts:16`. |
| D | `fast-glob` | KEEP | `libs/backend/platform-cli/src/implementations/cli-file-system-provider.ts:168`. |
| D | `ffmpeg-static` | KEEP | Retained Electron screen recorder at `apps/ptah-electron/src/di/phase-2-libraries.ts:553`. |
| D | `gifenc` | KEEP | Retained Electron screen recorder at `apps/ptah-electron/src/services/screen-recorder.service.ts:89`. |
| D | `gpt-tokenizer` | KEEP | `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.spec.ts:1`. |
| D | `grammy` | KEEP | `libs/backend/messaging-gateway/src/lib/adapters/telegram/grammy.adapter.ts:71`. |
| D | `gray-matter` | KEEP | Retained agent template parsing and `template-sharing.guard.spec.ts:24`. |
| D | `gridstack` | KEEP | `apps/ptah-extension-webview/src/styles.css:13`. |
| D | `jpeg-js` | KEEP | Retained Electron screen recorder at `apps/ptah-electron/src/services/screen-recorder.service.ts:82`. |
| D | `json2md` | KEEP | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-read.view.ts:27`. |
| D | `jsonrepair` | KEEP | `libs/shared/src/lib/utils/json.utils.ts:19`. |
| D | `kokoro-js` | KEEP | Dynamic module ID at `libs/backend/voice-providers/src/lib/worker/kokoro-pipeline.ts:74-75,138`; Electron packaging. |
| D | `lru-cache` | KEEP | `libs/backend/memory-curator/src/lib/memory-search.service.ts:9`. |
| D | `lucide-angular` | KEEP | `apps/ptah-extension-webview/src/app/app.ts:11`. |
| D | `marked` | KEEP | Retained markdown reducers and `markdown.reducer.spec.ts:1`. |
| D | `mermaid` | KEEP | `libs/frontend/chat-ui/src/lib/organisms/mermaid/mermaid-diagram.component.ts:87`. |
| D | `minimatch` | KEEP | `libs/backend/agent-generation/src/lib/services/generated-section-validator.spec.ts:12`. |
| D | `node-pty` | REMOVE | No import or `require`; `package.json:131`. |
| D | `nodejs-whisper` | REMOVE | No runtime consumer; only an external declaration at `libs/backend/rpc-handlers/project.json:32`. |
| D | `picomatch` | KEEP | `libs/backend/agent-generation/src/lib/services/analysis-fingerprint.ts:3`. |
| D | `reflect-metadata` | KEEP | Retained Electron startup and `boot-heavy-services.install-scope.spec.ts:21`. |
| D | `rxjs` | KEEP | Retained Angular and backend reactive code. |
| D | `shiki` | KEEP | `libs/frontend/git-ui/src/lib/renderer/pierre-config.ts:33`. |
| D | `sqlite-vec` | KEEP | `apps/ptah-electron/scripts/validate-deps.js:37`. |
| D | `temporal-polyfill` | KEEP | Jest transform exception at `libs/web/ui/jest.config.cts:19`. |
| D | `tsyringe` | KEEP | Retained dependency-injection code and Electron specs. |
| D | `ulid` | KEEP | `libs/backend/agent-generation/src/lib/services/analysis-storage.service.ts:19`. |
| D | `uuid` | KEEP | `libs/backend/agent-sdk/src/lib/permission/permission-description.ts:13`. |
| D | `web-tree-sitter` | KEEP | `apps/ptah-electron/src/services/electron-ide-capabilities.spec.ts:38` resolves its retained runtime. |
| D | `which` | KEEP | Retained CLI detector code and specs. |
| D | `zod` | KEEP | `apps/ptah-electron/src/artifacts/artifact-protocol.ts:2`. |
| D | `zone.js` | KEEP | Webview polyfill at `apps/ptah-extension-webview/project.json:16`. |
| DD | `@angular-devkit/core` | KEEP | Required peer of retained `@nx/angular` and `angular-eslint`. |
| DD | `@angular-devkit/schematics` | KEEP | Required peer of retained `@nx/angular` and `angular-eslint`. |
| DD | `@angular/build` | KEEP | Webview executor at `apps/ptah-extension-webview/project.json:10`. |
| DD | `@angular/cdk` | KEEP | `apps/ptah-extension-webview/src/styles.css:10`. |
| DD | `@angular/compiler-cli` | KEEP | Required peer of `@angular/build` and `jest-preset-angular`. |
| DD | `@axe-core/playwright` | KEEP | `libs/frontend/webview-e2e-harness/src/lib/scenarios/onboarding/onboarding-ready-capture.ts:19`. |
| DD | `@commitlint/cli` | KEEP | `.husky/commit-msg:6`. |
| DD | `@commitlint/config-conventional` | KEEP | `.commitlintrc.json:2`. |
| DD | `@eslint/js` | REMOVE | Only migration documentation; active ESLint configs do not import it. |
| DD | `@jest/globals` | KEEP | `apps/ptah-electron/src/services/electron-setup-wizard.service.spec.ts:2`. |
| DD | `@nx/angular` | KEEP | Retained Angular executors, generators, and ESLint configs. |
| DD | `@nx/esbuild` | KEEP | Electron executor at `apps/ptah-electron/project.json:10`. |
| DD | `@nx/eslint` | KEEP | Nx plugin at `nx.json:90`. |
| DD | `@nx/eslint-plugin` | KEEP | `eslint.config.mjs:4`. |
| DD | `@nx/jest` | KEEP | `jest.config.ts:2`. |
| DD | `@nx/js` | KEEP | Nx JavaScript tooling at `nx.json:9`. |
| DD | `@nx/web` | KEEP | Webview tooling at `apps/ptah-extension-webview/project.json:136`. |
| DD | `@nx/workspace` | KEEP | Retained Nx workspace tooling and dependency of `@nx/js`. |
| DD | `@playwright/test` | KEEP | `apps/ptah-electron-e2e/playwright.config.ts:1`. |
| DD | `@schematics/angular` | KEEP | Required peer of retained `@nx/angular`. |
| DD | `@swc-node/register` | KEEP | Required peer of retained `nx`. |
| DD | `@swc/core` | KEEP | Required peer of retained `@swc-node/register`. |
| DD | `@swc/helpers` | KEEP | Required peer of retained `@swc/core`. |
| DD | `@types/chrome-remote-interface` | KEEP | Types for retained `chrome-remote-interface` consumer. |
| DD | `@types/cross-spawn` | KEEP | Types for retained `cross-spawn` consumer. |
| DD | `@types/culori` | KEEP | Types for retained `culori` consumer. |
| DD | `@types/jest` | KEEP | `apps/ptah-electron/tsconfig.spec.json:8`. |
| DD | `@types/json2md` | KEEP | Types for retained `json2md` consumer. |
| DD | `@types/node` | KEEP | `apps/ptah-electron-e2e/tsconfig.spec.json:7` and retained Node projects. |
| DD | `@types/picomatch` | KEEP | Types for retained `picomatch` consumer. |
| DD | `@types/vscode` | KEEP | `libs/backend/agent-generation/package.json:15`; `libs/shared/tsconfig.lib.json:6`. |
| DD | `@types/which` | KEEP | Types for retained `which` consumer. |
| DD | `@typescript-eslint/utils` | REMOVE | No direct consumer. It remains available transitively through retained ESLint tooling. |
| DD | `@xterm/headless` | REMOVE | No consumer; root-only entry at `package.json:181`. |
| DD | `adm-zip` | REMOVE | No consumer; root-only entry at `package.json:182`. |
| DD | `angular-eslint` | KEEP | Angular ESLint plugins and required `typescript-eslint` peer relationship. |
| DD | `autoprefixer` | KEEP | `apps/ptah-extension-webview/postcss.config.js:4`. |
| DD | `axe-core` | KEEP | `apps/ptah-electron-e2e/src/support/axe.ts:58`. |
| DD | `cross-env` | KEEP | Root script at `package.json:9`. |
| DD | `daisyui` | KEEP | Webview styling and `base-content-muted.spec.ts:36`. |
| DD | `electron` | KEEP | Electron app, tests, and `apps/ptah-electron/__mocks__/electron.ts`. |
| DD | `electron-builder` | KEEP | `apps/ptah-electron/scripts/package-local-production.js:79`. |
| DD | `esbuild` | KEEP | Electron build plugins and retained Angular/Nx build tooling. |
| DD | `eslint` | KEEP | Retained flat configs and lint targets. |
| DD | `gsap` | KEEP | `libs/web/landing/src/lib/console/alwayson-loop-diagram.component.ts:19`. |
| DD | `husky` | KEEP | Root `prepare` script and `.husky` hooks. |
| DD | `jest` | KEEP | `jest.config.ts:1` and retained test targets. |
| DD | `jest-environment-jsdom` | KEEP | `nx.json:43`. |
| DD | `jest-environment-node` | KEEP | `nx.json:44`. |
| DD | `jest-preset-angular` | KEEP | `apps/ptah-extension-webview/src/test-setup.ts:1`. |
| DD | `jest-util` | KEEP | Required peer/dependency of retained `ts-jest` and `jest-preset-angular`. |
| DD | `jsonc-eslint-parser` | KEEP | `libs/backend/agent-generation/eslint.config.mjs:19`. |
| DD | `lint-staged` | KEEP | `.husky/pre-commit:19`. |
| DD | `marked` | KEEP | Same retained markdown consumers as the runtime entry; duplicate section entry is not needed for execution but is not an unused package. |
| DD | `ng-packagr` | KEEP | `libs/frontend/markdown/ng-package.json:2`; Nx Angular tooling peer. |
| DD | `ngx-markdown` | KEEP | Retained Angular markdown components and specs. |
| DD | `nx` | KEEP | `scripts/verify.mjs:76` and all retained Nx targets. |
| DD | `postcss` | KEEP | Webview PostCSS config and required `@angular/build` peer. |
| DD | `prettier` | KEEP | `scripts/vendor-brand-icons.mjs:74`. |
| DD | `svgo` | KEEP | `scripts/brand-icons/extract-artwork.mjs:12`. |
| DD | `tailwindcss` | KEEP | `apps/ptah-extension-webview/tailwind.config.js:4` and PostCSS config. |
| DD | `tree-kill` | REMOVE | No import or `require`; `package.json:209`. |
| DD | `ts-jest` | KEEP | `apps/ptah-electron/jest.config.ts:6`. |
| DD | `ts-morph` | KEEP | `tools/migration/extract-domain.ts:23`. |
| DD | `ts-node` | KEEP | `tools/degradation-audit/run-self-test.js:11`; root eval scripts. |
| DD | `tslib` | KEEP | Electron external dependency at `apps/ptah-electron/project.json:67`. |
| DD | `typescript` | KEEP | Retained TypeScript projects and required Angular/ESLint peer. |
| DD | `typescript-eslint` | KEEP | Required peer of retained `angular-eslint`; TypeScript ESLint rules remain active. |

Audit totals: 76 dependencies and 68 devDependencies reviewed. Nine direct entries are removal candidates. The other 135 entries have a retained consumer or required tooling/peer role.

## Scoped test result

The single permitted command was run once:

```sh
npm run verify -- -t test -p @ptah-extension/rpc-handlers,@ptah-extension/agent-generation,@ptah-extension/harness-sync -- --testPathPatterns="setup-rpc|agent-recommendation|subagent-tool-allowlist|user-layer|orchestrator.service|template-sharing|gitignore-writer"
```

Result: **failed because of two unchanged Windows symlink tests**.

- Nx ran three project tasks. Two succeeded and one failed.
- `@ptah-extension/rpc-handlers:test` passed.
- `@ptah-extension/harness-sync:test` passed.
- `@ptah-extension/agent-generation:test` failed.
- Agent-generation result: 16 suites passed and one failed. 644 tests passed, two failed, and one was skipped.
- `user-layer-reap.spec.ts:799` failed with `EPERM` during symlink creation.
- `user-layer-reap.spec.ts:827` failed with `EPERM` during symlink creation.
- `user-layer-reap.spec.ts` is unchanged by this branch. No changed spec failed.

The failed command was not rerun. No workspace-wide check, build, serve, dev, e2e, or package target was run. The private moved-video destination was not accessed.
