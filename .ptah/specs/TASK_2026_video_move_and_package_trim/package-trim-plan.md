# Root package trim plan

Decision rule: REMOVE only packages whose consumers are confined to deleted projects or the video source being moved. Root `package.json` has 86 dependencies and 75 devDependencies. The tables below decide all 161. `apps/ptah-electron/package.json` is reference evidence only and is not planned for editing.

## Search proof

`rg` failed to start here with `Access is denied`, so I used `git ls-files`, `git grep -l/-n -F`, and a read-only source scan. For each distinctive REMOVE package name (`@paper-design/shaders-react`, `@react-three/drei`, `@react-three/fiber`, every listed `@remotion/*`, `@types/react`, `@types/react-dom`, `@types/three`), this `git grep` search returned **zero files**:

```text
git grep -l -F '<package>' -- apps libs scripts tools .github plugins nx.json tsconfig.base.json eslint.config.mjs jest.preset.js .lintstagedrc.mjs ':!apps/ptah-video-studio' ':!apps/ptah-electron-e2e/src/showcase' ':!libs/showcase-manifest' ':!tools/hyperframes' ':!plugins/ptah-video' ':!tools/mcp-bench/questions' ':!tools/mcp-bench/baseline' ':!tools/mcp-bench/fixtures'
```

That search covers retained source, `project.json`, Jest configs/moduleNameMapper, tsconfig paths, ESLint, Nx plugins, scripts, tools, workflows and plugins. The excluded benchmark data is historical path snapshots, not package consumers. For generic names `react`, `react-dom`, `remotion`, `three`, I scanned all retained tracked `.ts/.tsx/.js/.mjs/.cjs/.jsx` for `from`, `require(` and dynamic `import(` package specifiers: **zero live imports**. Apparent React imports at `libs/backend/workspace-intelligence/src/quality/rules/framework-rules.spec.ts:1007,1035,1071` are template-string test inputs; `react-dom` mentions in framework detector specs are fixtures. Generic prose mentions do not require these packages. Root `package.json:9` and showcase Nx targets are the commands to remove.

The Electron package still declares `@sentry/node`, `@vscode/tree-sitter-wasm`, `ffmpeg-static`, `gifenc`, `jpeg-js` and `kokoro-js`; `apps/ptah-electron/project.json:44,78-89` includes their packaging externals. Retained backend packages still declare `@types/vscode` (`libs/backend/agent-generation/package.json:15`, `auth-providers/package.json:21`, plus `vscode-core/package.json` and `vscode-lm-tools/package.json`). `libs/backend/rpc-handlers/project.json` and `tools/mcp-bench/project.json` reference `nodejs-whisper`. These are KEEP. No `@nestjs/*`, Prisma/@prisma, Paddle, WorkOS, Resend, Ink/ink-*, `vsce` or VS Code extension publishing package is in the root manifest. `@vscode/tree-sitter-wasm` is a retained grammar package. Astro and Starlight stay for `apps/ptah-docs/project.json:16`. Nx/Jest/Angular/ESLint tools and peers stay for retained `nx.json:8-11,35-45,82-85,87-122,172-177` and project configs.

## Every root dependency

| Package (`package.json` line) | Decision | Reason |
| --- | --- | --- |
| `@agentclientprotocol/sdk` (:71) | **KEEP** | Retained provider CLI/agent runtime |
| `@angular/cdk-experimental` (:72) | **KEEP** | No move-only proof; defer independent unused-package audit |
| `@angular/common` (:73) | **KEEP** | Retained Angular renderer/landing/shared frontend |
| `@angular/compiler` (:74) | **KEEP** | Retained Angular renderer/landing/shared frontend |
| `@angular/core` (:75) | **KEEP** | Retained Angular renderer/landing/shared frontend |
| `@angular/forms` (:76) | **KEEP** | Retained Angular renderer/landing/shared frontend |
| `@angular/platform-browser` (:77) | **KEEP** | Retained Angular renderer/landing/shared frontend |
| `@angular/platform-browser-dynamic` (:78) | **KEEP** | Retained Angular renderer/landing/shared frontend |
| `@angular/platform-server` (:79) | **KEEP** | Retained Angular renderer/landing/shared frontend |
| `@angular/router` (:80) | **KEEP** | Retained Angular renderer/landing/shared frontend |
| `@angular/ssr` (:81) | **KEEP** | Retained Angular renderer/landing/shared frontend |
| `@anthropic-ai/claude-agent-sdk` (:82) | **KEEP** | Retained provider CLI/agent runtime |
| `@anthropic-ai/sdk` (:83) | **KEEP** | Retained provider CLI/agent runtime |
| `@astrojs/starlight` (:84) | **KEEP** | Retained Astro Starlight docs |
| `@codemirror/commands` (:85) | **KEEP** | Retained Angular renderer/landing/shared frontend |
| `@codemirror/language` (:86) | **KEEP** | Retained Angular renderer/landing/shared frontend |
| `@codemirror/language-data` (:87) | **KEEP** | Retained Angular renderer/landing/shared frontend |
| `@codemirror/state` (:88) | **KEEP** | Retained Angular renderer/landing/shared frontend |
| `@codemirror/view` (:89) | **KEEP** | Retained Angular renderer/landing/shared frontend |
| `@cursor/sdk` (:90) | **KEEP** | Retained provider CLI/agent runtime |
| `@floating-ui/dom` (:91) | **KEEP** | Retained Angular renderer/landing/shared frontend |
| `@hive-academy/angular-gsap` (:92) | **KEEP** | Retained Angular renderer/landing/shared frontend |
| `@huggingface/transformers` (:93) | **KEEP** | Retained Electron voice/browser media |
| `@modelcontextprotocol/sdk` (:94) | **KEEP** | Retained mcp-bench transport client |
| `@openai/codex-sdk` (:95) | **KEEP** | Retained provider CLI/agent runtime |
| `@paper-design/shaders-react` (:96) | **REMOVE** | Shader components only in moved studio |
| `@parcel/watcher` (:97) | **KEEP** | Retained Electron watcher/packaging |
| `@pierre/diffs` (:98) | **KEEP** | Retained Angular renderer/landing/shared frontend |
| `@react-three/drei` (:99) | **REMOVE** | 3D components only in moved studio |
| `@remotion/captions` (:100) | **REMOVE** | Remotion captions only in moved studio/skill |
| `@remotion/google-fonts` (:101) | **REMOVE** | Remotion fonts only in moved studio |
| `@remotion/install-whisper-cpp` (:102) | **REMOVE** | Remotion transcription installer only in moved studio/skill |
| `@remotion/media-utils` (:103) | **REMOVE** | Remotion media utilities only in moved studio |
| `@remotion/transitions` (:104) | **REMOVE** | Remotion transitions only in moved studio |
| `@sentry/node` (:105) | **KEEP** | Retained Electron and vscode-core Sentry use |
| `@slack/bolt` (:106) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `@tavily/core` (:107) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `@vscode/tree-sitter-wasm` (:108) | **KEEP** | Retained Electron IDE/WASM grammar use |
| `astro` (:109) | **KEEP** | Retained Astro Starlight docs |
| `axios` (:110) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `better-sqlite3` (:111) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `bottleneck` (:112) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `chokidar` (:113) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `chrome-launcher` (:114) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `chrome-remote-interface` (:115) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `croner` (:116) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `cross-spawn` (:117) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `culori` (:118) | **KEEP** | Retained Angular renderer/landing/shared frontend |
| `discord.js` (:119) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `dompurify` (:120) | **KEEP** | Retained Angular renderer/landing/shared frontend |
| `eventemitter3` (:121) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `exa-js` (:122) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `fast-glob` (:123) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `ffmpeg-static` (:124) | **KEEP** | Retained Electron voice/browser media |
| `gifenc` (:125) | **KEEP** | Retained Electron voice/browser media |
| `gpt-tokenizer` (:126) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `grammy` (:127) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `gray-matter` (:128) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `gridstack` (:129) | **KEEP** | Retained Angular renderer/landing/shared frontend |
| `jpeg-js` (:130) | **KEEP** | Retained Electron voice/browser media |
| `json2md` (:131) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `jsonrepair` (:132) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `kokoro-js` (:133) | **KEEP** | Retained Electron voice/browser media |
| `lru-cache` (:134) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `lucide-angular` (:135) | **KEEP** | Retained Angular renderer/landing/shared frontend |
| `marked` (:136) | **KEEP** | Retained Angular renderer/landing/shared frontend |
| `mermaid` (:137) | **KEEP** | Retained Angular renderer/landing/shared frontend |
| `minimatch` (:138) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `node-pty` (:139) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `nodejs-whisper` (:140) | **KEEP** | Retained Electron voice/browser media |
| `picomatch` (:141) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `react` (:142) | **REMOVE** | Live React imports only in moved studio; retained test examples are strings |
| `react-dom` (:143) | **REMOVE** | React renderer only; retained detector-test mentions are strings |
| `reflect-metadata` (:144) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `remotion` (:145) | **REMOVE** | Remotion runtime only in moved studio |
| `rxjs` (:146) | **KEEP** | Retained Angular renderer/landing/shared frontend |
| `shiki` (:147) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `sqlite-vec` (:148) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `temporal-polyfill` (:149) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `tsyringe` (:150) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `ulid` (:151) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `uuid` (:152) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `web-tree-sitter` (:153) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `which` (:154) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `zod` (:155) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `zone.js` (:156) | **KEEP** | Retained Angular renderer/landing/shared frontend |

## Every root devDependency

| Package (`package.json` line) | Decision | Reason |
| --- | --- | --- |
| `@angular-devkit/core` (:159) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `@angular-devkit/schematics` (:160) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `@angular/build` (:161) | **KEEP** | `apps/ptah-extension-webview/project.json` and `apps/ptah-landing-page/project.json` use Angular build |
| `@angular/cdk` (:162) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `@angular/compiler-cli` (:163) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `@axe-core/playwright` (:164) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `@commitlint/cli` (:165) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `@commitlint/config-conventional` (:166) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `@eslint/js` (:167) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `@jest/globals` (:168) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `@nx/angular` (:169) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `@nx/esbuild` (:170) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `@nx/eslint` (:171) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `@nx/eslint-plugin` (:172) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `@nx/jest` (:173) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `@nx/js` (:174) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `@nx/web` (:175) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `@nx/workspace` (:176) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `@playwright/test` (:177) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `@react-three/fiber` (:178) | **REMOVE** | 3D React renderer only in moved studio |
| `@remotion/cli` (:179) | **REMOVE** | Remotion CLI only in moved studio/skill |
| `@remotion/three` (:180) | **REMOVE** | Remotion 3D bridge only in moved studio |
| `@schematics/angular` (:181) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `@swc-node/register` (:182) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `@swc/core` (:183) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `@swc/helpers` (:184) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `@types/chrome-remote-interface` (:185) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `@types/cross-spawn` (:186) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `@types/culori` (:187) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `@types/jest` (:188) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `@types/json2md` (:189) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `@types/node` (:190) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `@types/picomatch` (:191) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `@types/react` (:192) | **REMOVE** | Types only for moved React studio |
| `@types/react-dom` (:193) | **REMOVE** | Types only for moved React renderer |
| `@types/three` (:194) | **REMOVE** | Types only for moved studio 3D code |
| `@types/vscode` (:195) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `@types/which` (:196) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `@typescript-eslint/utils` (:197) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `@xterm/headless` (:198) | **KEEP** | Retained Electron/backend/shared library or CLI lane; no move-only proof |
| `adm-zip` (:199) | **KEEP** | No move-only proof; defer independent unused-package audit |
| `angular-eslint` (:200) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `autoprefixer` (:201) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `axe-core` (:202) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `cross-env` (:203) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `daisyui` (:204) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `electron` (:205) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `electron-builder` (:206) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `esbuild` (:207) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `eslint` (:208) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `gsap` (:209) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `husky` (:210) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `jest` (:211) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `jest-environment-jsdom` (:212) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `jest-environment-node` (:213) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `jest-preset-angular` (:214) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `jest-util` (:215) | **KEEP** | No move-only proof; defer independent unused-package audit |
| `jsonc-eslint-parser` (:216) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `lint-staged` (:217) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `marked` (:218) | **KEEP** | Retained renderer markdown tooling |
| `ng-packagr` (:219) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `ngx-markdown` (:220) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `nx` (:221) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `postcss` (:222) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `prettier` (:223) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `svgo` (:224) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `tailwindcss` (:225) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `three` (:226) | **REMOVE** | Three.js runtime only in moved studio |
| `tree-kill` (:227) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `ts-jest` (:228) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `ts-morph` (:229) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `ts-node` (:230) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `tslib` (:231) | **KEEP** | Retained Nx/Angular/Jest tool, peer or type dependency |
| `typescript` (:232) | **KEEP** | Retained test, build, lint, hook or Electron tooling |
| `typescript-eslint` (:233) | **KEEP** | Retained test, build, lint, hook or Electron tooling |

**REMOVE total: 17** (10 dependencies, 7 devDependencies). `@angular/cdk-experimental` has no tracked direct hit, but has no established move-only association; KEEP pending an independent unused-package audit. An absent literal import for a build tool or types package is not move-only evidence; retain indirect and peer needs. Refresh `package-lock.json` only in the later implementation phase.

## Stale config and reference edits after transfer

| File:line | Planned action | Evidence / retained boundary |
| --- | --- | --- |
| `package.json:9` | Remove `studio` script | Only root script naming moved studio |
| `apps/ptah-electron-e2e/project.json:32-74` | Remove `showcase`, `showcase:lane-review` | Keep `e2e`, `e2e:nightly`, `typecheck` |
| `apps/ptah-electron-e2e/tsconfig.spec.json:8` | Narrow `src/**/*.ts` after move | Keep specs, support and docs shots |
| `tsconfig.base.json:20-22` | Remove showcase-manifest path alias | All 104 path targets currently exist; the other 103 stay valid |
| `nx.json:184` | Remove video studio from ESLint plugin include | No video target default or release config; other plugin include paths exist |
| `nx.json:14` | Update stale `vsce` example in target-default comment | VS Code publishing target is gone; generic run-command default stays |
| `eslint.config.mjs:207-213,365-367` | Remove video output ignores and replace showcase example | Keep `scope:e2e` for real e2e |
| `eslint.config.mjs:306,318,321-346,552` | Remove `scope:api-contracts` allowances, `scope:app`/`scope:api` rules and generated Prisma ignore | Project tag scan found zero projects with these tags; `libs/api/` is gone |
| `eslint.config.mjs:290-291,353,357-362` | KEEP `scope:extension` and `scope:cli` | 30 retained backend projects use `scope:extension`; `cli-engine` and `platform-cli` use `scope:cli` |
| `eslint.config.mjs:298-319` | KEEP `scope:web` rule; strip only api-contracts allowances | Four retained `libs/web/{core,landing,legal,ui}/project.json:7` use `scope:web` |
| `.gitignore:7-9,227-228,240-255` | Remove video output/studio/editor ignores after private transfer | Keep unrelated generic ignores |
| `.gitignore:11-12`, `eslint.config.mjs:206` | Candidate cleanup of `.vscode-test` ignore | No retained `.vscode-test` user found; unrelated to WASM grammars |
| `.gitignore:83-86,92` | Remove license-server heading and generated Prisma ignore; keep generic `.env` | License server and generated Prisma client are gone |
| `.prettierignore:1-23`, `.lintstagedrc.mjs:1-26`, `.husky/commit-msg`, `.husky/pre-commit`, `.husky/pre-push` | KEEP | Generic formatting/hooks, no moved-project paths |
| `.github/workflows/render-showcase.yml`, `.github/workflows/upload-recordings.yml` | Move workflows, then remove here | Video-only pipelines |
| `.github/workflows/ci.yml`, `publish-electron.yml`, `deploy-docs.yml`, `deploy-landing.yml`, `electron-e2e.yml`, `webview-e2e.yml`, `mcp-bench.yml` | KEEP | Retained projects/tools |
| `.github/dependabot.yml`, `.dockerignore`, tracked Dockerfile or compose | No entry to remove | None tracked by `git ls-files` |
| `.do/app.yaml:8-13,49-56`, `.do/docs-app.yaml:9,51-56` | KEEP | Landing/docs remain; app spec already says API is in external builders repo |
| `scripts/generate-license-keys.ts:1-18` | KEEP | Retained license verification refers to it from `libs/backend/vscode-core/src/services/license.service.ts:60` and `libs/shared/src/lib/constants/environment.constants.ts:58` |
| `apps/ptah-electron-e2e/README.md:82-125`, `README.md:19-36` | SPLIT | Remove showcase harness guide; preserve public clip links until asset URLs migrate |
| `apps/ptah-docs/src/content/docs/agents/built-in-agents.md:8,83-85`, `setup/setup-wizard.md:49`, `mcp-and-skills/popular-skills.md:75-79`, `plugins/index.md:32,51`, `plugins/marketplace.md:25`, `plugins/plugin-storage.md:20` | SPLIT | Remove video agent/plugin descriptions while keeping docs app |
| `apps/ptah-docs/src/content/docs/agents/agent-orchestration.md:11`, `getting-started/installation.md:9`, `getting-started/signing-in.md:12`, `mcp-and-skills/built-in-mcp-server.md:9`, `plugins/index.md:9`, `providers/index.md:13`, `setup/setup-wizard.md:9`, `workspace/project-analysis.md:11` | SPLIT | Eight live video embeds; rewrite URLs if finished MP4s move from docs `public/assets/videos/` |
| `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md` | No deleted-host/video path cleanup found | `AGENTS.md:32-41` correctly preserves Electron and CLI libraries; no removed-host guidance in these root files |

`nx.json` has no release block. Jest presets and configs have no video/showcase mapper entry. Keep retained `'^vscode$'` moduleNameMapper entries and `__mocks__/vscode.ts` for `vscode-core`/`vscode-lm-tools`. Keep the two `.do` deployment specs and docs deployment scripts.
