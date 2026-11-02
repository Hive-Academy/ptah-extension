# 01 — Project Profile: ptah-extension

> Phase 1 factual profile. Source data: root `package.json`, `nx.json`, `tsconfig.base.json`, per-project `project.json` / `package.json`, and `git ls-files` (tracked files only). Snapshot taken on branch `fix/settled-text-markdown-handoff-skill`.

---

## Tech Stack

### Languages
| Language | Version / Source |
|---|---|
| TypeScript | `typescript@6.0.3` (root devDependency) |
| JavaScript (ESM `.mjs`, CJS `.cjs`/`.cts`) | Build scripts, ESLint configs, tooling |
| SQL | Prisma migrations (`apps/ptah-license-server/prisma/migrations`) |
| HTML / CSS | Angular templates, Tailwind CSS |

**`tsconfig.base.json` compiler options:** `target: ES2022`, `module: esnext`, `moduleResolution: node16`, `lib: [es2022, dom]`, `experimentalDecorators: true`, `emitDecoratorMetadata: false`, `importHelpers: true`, `strict: false`, `skipLibCheck: true`, `esModuleInterop: true`; **115** path aliases.

### Runtime environment
| Item | Value |
|---|---|
| Node.js (root `engines`) | `24.x` |
| Node.js (`.nvmrc`) | `24` |
| VS Code engine (extension) | `^1.100.0` (`@types/vscode@^1.103.0`) |
| Electron | `^44.4.3` (packaged via `electron-builder@26.16.1`) |
| CLI package engine | `node >=20.12` |
| Database (license server) | PostgreSQL via Prisma `7.10.0` (`@prisma/adapter-pg`, `pg@^8.20.0`) |
| Local persistence (extension/desktop) | SQLite via `better-sqlite3@^13.0.3`, `sqlite-vec@0.1.9` |
| Containers | Docker Compose (`docker-compose.yml`, `docker-compose.prod.yml`), Caddy reverse proxy (`caddy/Caddyfile`) |

### Frameworks
| Framework | Version | Used by |
|---|---|---|
| Angular (core/common/forms/router/platform-*) | `22.1.7` (`@angular/ssr@22.1.8`, `@angular/build@22.1.8`) | Webview app, landing page, `libs/frontend/*`, `libs/web/*` |
| NestJS (common/core/config/jwt/schedule/event-emitter/platform-express) | `^12.0.x` (`@nestjs/throttler@^6.7.0`) | `ptah-license-server`, `libs/api/*` |
| Prisma | `7.10.0` | License server |
| Nx | `23.2.1` | Monorepo tooling |
| React / React DOM | `~19.2.0` | `ptah-video-studio` (Remotion), `ptah-tui` (Ink) |
| Ink | `^7.0.0` | `ptah-tui` terminal UI |
| Remotion | `4.0.484` | `ptah-video-studio` |
| Astro + Starlight | `^7.3.3` / `^0.42.2` | `ptah-docs` |
| Tailwind CSS + DaisyUI | `^3.4.18` / `^4.12.24` | Webview, landing page |
| tsyringe (DI) | `^4.10.0` | Backend libraries / extension host |
| RxJS | `7.8.2` | Angular apps |
| zone.js | `0.16.3` | Angular apps |
| Zod | `4.6.5` | Schema validation |

---

## Dependencies

### Count summary (root `package.json`)
| Category | Count |
|---|---|
| `dependencies` | 116 |
| `devDependencies` | 84 |
| **Total** | **200** |

Root `overrides`: `lucide-angular` (peer Angular pins), `@sentry/nestjs` (peer Nest pins), `tar >=7.5.11`, `onnxruntime-node 1.24.3`, `@hono/node-server ^1.19.13`, `@module-federation/dts-plugin → axios 1.15.0`.

### Notable production dependencies
| Area | Packages |
|---|---|
| AI / agent SDKs | `@anthropic-ai/claude-agent-sdk@0.3.278`, `@anthropic-ai/sdk@0.127.0`, `@openai/codex-sdk@^0.155.1`, `@cursor/sdk@^1.0.13`, `@agentclientprotocol/sdk@1.7.0`, `@modelcontextprotocol/sdk@^1.29.0` |
| Local ML / speech | `@huggingface/transformers@3.8.1`, `kokoro-js@1.2.1`, `nodejs-whisper@0.3.1`, `@remotion/install-whisper-cpp`, `gpt-tokenizer@^4.0.0` |
| Code intelligence | `web-tree-sitter@^0.27.0`, `@vscode/tree-sitter-wasm@^0.3.0`, `shiki@4.4.3`, `fast-glob@3.3.3`, `minimatch@10.2.6`, `picomatch@4.0.7`, `@parcel/watcher@2.6.0`, `chokidar@^5.0.0` |
| Terminal / process | `node-pty@1.1.0`, `cross-spawn@^7.0.6`, `which@^7.0.0` |
| Browser automation | `chrome-launcher@^1.2.1`, `chrome-remote-interface@^0.34.0` |
| Messaging gateways | `@slack/bolt@5.1.0`, `discord.js@14.27.0`, `grammy@1.46.0` (Telegram) |
| Web search | `@tavily/core@^0.7.2`, `exa-js@^2.22.1` |
| Billing / auth / email | `@paddle/paddle-node-sdk@^3.10.0`, `@paddle/paddle-js@^1.6.1`, `@workos-inc/node@^10.13.0`, `resend@^6.9.0` |
| Observability | `@sentry/nestjs@^10.75.0`, `@sentry/node@^10.75.0` |
| Editor / UI | `@codemirror/*` (6.x), `mermaid@^11.17.2`, `marked@^18.0.13`, `dompurify@^3.3.3`, `sanitize-html@^2.17.7`, `gridstack@^12.5.0`, `@fullcalendar/angular@^7.0.2`, `lucide-angular@^1.0.0`, `@hive-academy/angular-gsap@^1.1.0`, `@pierre/diffs@1.5.1` |
| Scheduling | `croner@^10.0.1`, `@nestjs/schedule` |
| CLI | `commander@^15.0.0`, `@clack/prompts@^1.8.1` |
| Utilities | `zod`, `jsonrepair@3.15.0`, `gray-matter@^4.0.3`, `lru-cache@^11.5.3`, `ulid@3.0.2`, `uuid@^11.1.0`, `eventemitter3@5.0.4`, `bottleneck@^2.19.5`, `temporal-polyfill@^1.0.2`, `culori@^4.0.2` |
| Media | `ffmpeg-static@5.3.0`, `gifenc@^1.0.3`, `jpeg-js@^0.4.4`, `@react-three/drei@10.7.7` |

### Notable dev dependencies
| Area | Packages |
|---|---|
| Nx plugins | `nx`, `@nx/angular`, `@nx/esbuild`, `@nx/eslint`, `@nx/eslint-plugin`, `@nx/jest`, `@nx/js`, `@nx/node`, `@nx/web`, `@nx/workspace` (all `23.2.1`), `@nx-tools/nx-prisma@^7.2.0` |
| Build | `esbuild@^0.28.2`, `ng-packagr@22.1.1`, `@swc/core@~1.16.2`, `@swc-node/register@~1.12.1`, `ts-node@^10.9.2`, `postcss@^8.5.6`, `autoprefixer@^10.4.22` |
| Testing | `jest@^30.0.2`, `ts-jest@^29.4.0`, `jest-preset-angular@17.0.0`, `jest-environment-jsdom@^30.3.0`, `@playwright/test@^1.50.0`, `@axe-core/playwright@^4.12.1`, `@vscode/test-electron@^3.1.0`, `@nestjs/testing@^12.0.3`, `@xterm/headless@^6.0.0` |
| Lint / format | `eslint@^10.11.0`, `typescript-eslint@^8.29.0`, `angular-eslint@22.5.0`, `prettier@^3.8.1`, `jsonc-eslint-parser@^3.1.0` |
| Git hooks / commits | `husky@^9.1.7`, `lint-staged@^17.5.1`, `@commitlint/cli@^21.2.3`, `@commitlint/config-conventional@^21.2.3` |
| Packaging | `@vscode/vsce@^4.0.0`, `electron@^44.4.3`, `electron-builder@26.16.1` |
| Code transforms | `ts-morph@^28.0.0` |

---

## File Structure

### Top-level tree (depth 2)
```
ptah-extension/
├── apps/                     # 13 Nx application projects
│   ├── ptah-extension-vscode/      ptah-extension-vscode-e2e/
│   ├── ptah-extension-webview/
│   ├── ptah-electron/              ptah-electron-e2e/
│   ├── ptah-cli/                   ptah-tui/
│   ├── ptah-license-server/        ptah-license-server-e2e/
│   ├── ptah-landing-page/          ptah-landing-page-e2e/
│   ├── ptah-docs/
│   └── ptah-video-studio/
├── libs/
│   ├── backend/              # 31 Node/extension-host libraries
│   ├── frontend/             # 28 Angular webview libraries
│   ├── api/                  # 15 NestJS server libraries
│   ├── api-contracts/        # 1 (community)
│   ├── web/                  # 10 Angular landing-site libraries
│   ├── shared/               # @ptah-extension/shared
│   └── showcase-manifest/
├── tools/                    # ai-migrations, degradation-audit, di-lint, hyperframes,
│                             # mcp-bench, migration, perf, video-editor
├── scripts/                  # build/packaging/maintenance scripts (~67 tracked files)
├── docs/                     # benchmarks, community, deployment, design-system,
│                             # development, video-scripts
├── caddy/                    # Caddyfile
├── .github/workflows/        # 22 workflow files
├── .husky/                   # git hooks
├── .ptah/                    # analysis, specs, handoffs, research, eval, screenshots
├── .claude/ .codex/ .opencode/ .cursor/ .agents/   # agent tool configs
└── __mocks__/  e2e  type-dts/  assets/
```

### Tracked files by top-level directory
| Directory | Files |
|---|---|
| `libs/` | 6,439 |
| `.ptah/` | 5,056 |
| `apps/` | 1,540 |
| `tools/` | 482 |
| `.claude/` | 238 |
| `docs/` | 71 |
| `scripts/` | 67 |
| `.github/` | 25 |
| `.codex/`, `.opencode/` | 15 each |
| **Total tracked** | **14,005** |

### Tracked files by extension (top)
| Ext | Count | Ext | Count |
|---|---|---|---|
| `.ts` | 6,718 | `.js` | 60 |
| `.md` | 3,024 | `.jsonl` | 49 |
| `.png` | 2,400 | `.svg` | 41 |
| `.json` | 803 | `.mdx` | 39 |
| `.mjs` | 234 | `.yml` | 28 |
| `.html` | 186 | `.cts` / `.css` | 27 / 27 |
| `.tsx` | 147 | `.cjs` | 24 |
| `.sql` | 23 | `.ndjson` | 22 |

Test files (`*.spec.ts(x)` / `*.test.ts(x)`): **2,678**.

---

## Entry Points & Configuration

### Application entry points
| Project | Entry point(s) | Build executor |
|---|---|---|
| `ptah-extension-vscode` | `apps/ptah-extension-vscode/src/main.ts` → packaged `main.mjs` | `build` = `nx:noop` orchestrating `build-esbuild` (esbuild) |
| `ptah-extension-webview` | `apps/ptah-extension-webview/src/main.ts` | `@angular/build:application` |
| `ptah-electron` | `apps/ptah-electron/src/main.ts` (main), `apps/ptah-electron/src/preload.ts` (preload); plus worker builds: embedder, integrity, workspace-watch-host, state-storage, voice | `nx:run-commands` (`esbuild.config.cjs`) |
| `ptah-cli` | `apps/ptah-cli/src/main.ts` → `main.mjs`; worker builds: embedder, integrity, workspace-watch-host | `nx:noop` → `build-esbuild` |
| `ptah-tui` | `apps/ptah-tui/src/main.tsx` | `@nx/esbuild:esbuild` |
| `ptah-license-server` | `apps/ptah-license-server/src/main.ts` (+ `instrument.ts` Sentry) | `@nx/esbuild:esbuild` |
| `ptah-landing-page` | `apps/ptah-landing-page/src/main.ts` | `@angular/build:application` |
| `ptah-docs` | `apps/ptah-docs/astro.config.mjs` | `nx:run-commands` (Astro) |
| `ptah-video-studio` | `apps/ptah-video-studio/remotion.config.ts` | Remotion CLI targets (`studio`, `render`, `narrate`, `caption`, …) |
| Backend libs | `libs/backend/<name>/src/index.ts` | `@nx/esbuild:esbuild` |
| `@ptah-extension/markdown`, `@ptah-extension/ui` | — | `@nx/angular:ng-packagr-lite` |

### Published package identities
| App | `package.json` name | Version |
|---|---|---|
| VS Code extension | `ptah-coding-orchestra` (publisher `ptah-extensions`) | 0.2.43 |
| Electron desktop | `ptah-desktop` | 0.1.70 |
| CLI | `@hive-academy/ptah-cli` | 0.2.6 |
| TUI | `@ptah-extension/ptah-tui` | 0.0.1 |

VS Code activation events include `onWebviewPanel:ptah-angular-spa`, `onView:ptah.main`, `onCommand:ptah.openFullPanel`.

### Top-level source folders of main hosts
| App | `src/` subfolders |
|---|---|
| `ptah-extension-vscode` | `activation`, `commands`, `core`, `di`, `integration`, `providers`, `services`, `assets` |
| `ptah-electron` | `activation`, `config`, `di`, `integration`, `ipc`, `menu`, `services`, `shims`, `windows`, `assets` |
| `ptah-cli` | `cli`, `di`, `services`, `skills`, `test-utils` |
| `ptah-license-server` | `admin`, `app`, `common`, `health`, `testing`, `assets` |

### Key configuration files
| Category | Files |
|---|---|
| Nx | `nx.json` (`parallel: 2`; cached target defaults for Angular build, ESLint, Jest, esbuild, tsc, ng-packagr-lite), `.nxignore`, per-project `project.json` |
| TypeScript | `tsconfig.base.json`; per-project `tsconfig.json`, `tsconfig.app.json`, `tsconfig.lib.json`, `tsconfig.spec.json`, `tsconfig.build.json`; Electron/CLI worker tsconfigs |
| ESLint | `eslint.config.mjs`, `eslint.angular.config.mjs`, `eslint.spec-change-detection.mjs`, per-project `eslint.config.mjs`; custom rules in `tools/` |
| Jest | `jest.config.ts`, `jest.preset.js`, per-project `jest.config.ts`/`.cjs`; `libs/api/jest.api-preset.cjs`; CLI `jest.e2e.config.cjs`, `jest.pty.config.cjs` |
| Formatting / style | `.prettierrc`, `.prettierignore`, `.editorconfig`, `.markdownlint.json` |
| Git hooks & commits | `.husky/`, `.lintstagedrc.mjs`, `.commitlintrc.json` (extends config-conventional; enforced type-enum and scope-enum) |
| Styling | `apps/ptah-extension-webview/tailwind.config.js`, `postcss.config.js`; `apps/ptah-landing-page/tailwind.config.js` |
| Electron packaging | `apps/ptah-electron/electron-builder.yml`, `electron-builder.local-production.cjs`, `esbuild.config.cjs`, `esbuild-plugins/` |
| Prisma | `apps/ptah-license-server/prisma/schema.prisma`, `prisma.config.ts`, `prisma/migrations`, `prisma/seed` |
| Docker / infra | `docker-compose.yml`, `docker-compose.prod.yml`, `apps/ptah-license-server/Dockerfile`, `Dockerfile.dev`, `.dockerignore`, `caddy/Caddyfile`, `.do/` |
| Static analysis | `.semgrep/`, `.sonarcloud.properties`, `.coderabbit.yaml` |
| Agent tooling | `.mcp.json`, `.claude/`, `.codex/`, `.opencode/`, `.cursor/`, `.agents/`, `CLAUDE.md`, `agent-pack-manifest.json`, `content-manifest.json` |
| Other | `.npmrc`, `.gitattributes`, `.vscode/` |

### CI/CD workflows (`.github/workflows/`)
`ci.yml`, `cli-e2e.yml`, `electron-e2e.yml`, `vscode-e2e.yml`, `webview-e2e.yml`, `nightly-coverage.yml`, `semgrep.yml`, `mcp-bench.yml`, `content-manifest.yml`, `connectors-probe.yml`, `model-lists-probe.yml`, `uptime-probe.yml`, `deploy-docs.yml`, `deploy-landing.yml`, `deploy-server.yml`, `license-server-image.yml`, `publish-cli.yml`, `publish-electron.yml`, `publish-extension.yml`, `render-showcase.yml`, `sync-release-branch.yml`, `upload-recordings.yml`, `authorize-workstation-key.yml`.

### Environment configuration files
| File | Notes |
|---|---|
| `.env`, `.env.example` | Root; keys include `DATABASE_URL`, `PORT`, `NODE_ENV`, `FRONTEND_URL`, `JWT_SECRET`, `JWT_EXPIRATION`, `ADMIN_API_KEY`, `ADMIN_SECRET`, `WORKOS_*`, `PADDLE_*`, `BUILDERS_CHECKOUT_ENABLED`, `CIRCLE_*`, `GOOGLE_OAUTH_*`, `GOOGLE_CALENDAR_ID`, `YOUTUBE_API_KEY`, `RESEND_API_KEY`, `FROM_EMAIL`, `FROM_NAME`, `LICENSE_SIGNING_PRIVATE_KEY`, `MAGIC_LINK_TTL_MS` |
| `.env.prod`, `.env.prod.example` | Production compose (`docker:prod` script) |
| `apps/ptah-license-server/.env.example` | License server |
| `apps/ptah-video-studio/.env.example` | Video studio |
| `apps/ptah-landing-page/proxy.conf.json` | Dev-server API proxy |

---

## Monorepo Structure

- **Tool:** Nx `23.2.1` (single root `package.json` / `package-lock.json`; no npm `workspaces` field).
- **Project count:** 13 applications + 86 libraries = **99** `project.json` projects.
- **Tagging scheme:** `scope:*` (`extension`, `webview`, `electron`, `cli`, `shared`, `api`, `api-contracts`, `web`, `landing`, `docs`, `e2e`, `video-studio`, `app`) and `type:*` (`app`, `e2e`, `feature`, `util`, `core`, `ui`, `data-access`, `test-harness`); some carry `platform:angular` or `domain:vscode`.

### Applications
| Project | Tags | Purpose (from structure/naming) | Tracked files / specs |
|---|---|---|---|
| `ptah-extension-vscode` | scope:extension | VS Code extension host | 277 / 14 |
| `ptah-extension-webview` | scope:webview | Angular SPA rendered in the VS Code webview and Electron renderer | 43 / 17 |
| `ptah-electron` | scope:electron | Electron desktop app (main, preload, workers) | 183 / 63 |
| `ptah-cli` | scope:cli | Headless CLI (`@hive-academy/ptah-cli`) | 186 / 85 |
| `ptah-tui` | scope:cli | Ink/React terminal UI | 138 / 26 |
| `ptah-license-server` | scope:app | NestJS + Prisma licensing/billing/community API | 61 / 7 |
| `ptah-landing-page` | scope:landing | Angular marketing site (SSR-capable) | 64 / 3 |
| `ptah-docs` | scope:docs | Astro Starlight documentation site | 207 / 0 |
| `ptah-video-studio` | scope:video-studio | Remotion marketing-video pipeline | 183 / 0 |
| `ptah-extension-vscode-e2e` | scope:e2e | VS Code E2E tests | 5 / 0 |
| `ptah-electron-e2e` | scope:e2e, scope:electron | Electron Playwright E2E + showcase capture | 147 / 73 |
| `ptah-landing-page-e2e` | scope:e2e, scope:landing | Landing-page Playwright E2E | 34 / 22 |
| `ptah-license-server-e2e` | — | License server E2E | 12 / 1 |

### Libraries — `libs/backend/` (31, Node / extension host; npm scope `@ptah-extension/*`)
| Library | Tags | Files / specs |
|---|---|---|
| agent-sdk | extension, feature | 354 / 157 |
| rpc-handlers | extension, feature | 358 / 150 |
| cli-agent-runtime | extension, feature | 238 / 105 |
| vscode-lm-tools | extension, feature, domain:vscode | 204 / 91 |
| workspace-intelligence | extension, feature | 197 / 70 |
| auth-providers | extension, feature | 175 / 69 |
| skill-synthesis | extension, feature | 171 / 88 |
| platform-core | shared, util | 157 / 47 |
| vscode-core | extension, util | 151 / 60 |
| persistence-sqlite | extension, util | 140 / 52 |
| agent-generation | extension, feature | 135 / 36 |
| harness-sync | extension, feature | 114 / 57 |
| memory-curator | extension, feature | 106 / 47 |
| platform-electron | electron, feature | 82 / 39 |
| cli-engine | cli, feature | 63 / 24 |
| settings-core | extension, core | 59 / 8 |
| messaging-gateway | extension, feature | 47 / 14 |
| platform-vscode | extension, feature | 47 / 18 |
| platform-cli | cli, feature | 43 / 15 |
| task-specs | extension, feature | 43 / 18 |
| voice-providers | extension, feature | 37 / 9 |
| tool-output-reducers | extension, util | 31 / 11 |
| output-styles | extension, feature | 29 / 9 |
| cron-scheduler | extension, feature | 24 / 5 |
| thoth-runtime | extension, feature | 23 / 7 |
| plugin-marketplace | extension, feature | 21 / 5 |
| session-organization | extension, feature | 19 / 6 |
| memory-contracts | extension, core | 16 / 0 |
| gateway-chat-bridge | extension, feature | 14 / 2 |
| voice-contracts | extension, core | 13 / 0 |
| auth-providers-tokens | extension, core | 6 / 0 |

### Libraries — `libs/frontend/` (28, Angular webview)
| Library | Tags | Files / specs |
|---|---|---|
| chat | webview, feature | 424 / 196 |
| chat-ui | webview, feature | 186 / 68 |
| marketplace | webview, feature | 155 / 66 |
| ui | webview, ui (ng-packagr-lite build) | 123 / 37 |
| git-ui | webview, feature | 114 / 44 |
| core | webview, core | 107 / 40 |
| skill-synthesis-ui | webview, feature, angular | 84 / 36 |
| webview-e2e-harness | webview, test-harness | 77 / 31 |
| declarative-dashboard | webview, ui, angular | 61 / 25 |
| tasks-ui | webview, feature, angular | 57 / 20 |
| setup-wizard | webview, feature | 53 / 13 |
| memory-curator-ui | webview, feature, angular | 51 / 18 |
| chat-streaming | webview, feature | 50 / 25 |
| tribunal-panel | webview, feature | 48 / 16 |
| dashboard | webview, feature, angular | 46 / 13 |
| chat-state | webview, data-access | 45 / 22 |
| mcp-apps-page | webview, feature, angular | 42 / 16 |
| canvas | webview, feature | 30 / 9 |
| markdown | shared, ui (ng-packagr-lite build) | 25 / 7 |
| harness-builder | webview, feature | 23 / 6 |
| messaging-gateway-ui | webview, feature, angular | 23 / 4 |
| cron-scheduler-ui | webview, feature, angular | 20 / 4 |
| chat-execution-tree | webview, feature | 18 / 3 |
| chat-routing | webview, feature | 18 / 6 |
| notification-center | webview, feature | 18 / 4 |
| thoth-shell | webview, feature, angular | 14 / 2 |
| workspace-indexing | webview, feature | 14 / 2 |
| chat-types | webview, util | 7 / 0 |

### Libraries — `libs/api/` (15, NestJS license-server domain; names `api-*`)
| Library | Type | Files / specs |
|---|---|---|
| community | feature | 79 / 19 |
| forum | feature | 74 / 21 |
| learning | feature | 73 / 22 |
| billing | feature | 42 / 8 |
| identity | util | 42 / 8 |
| marketing | feature | 40 / 5 |
| admin | feature | 30 / 5 |
| licensing | feature | 29 / 5 |
| member-hub | feature | 29 / 9 |
| core | util | 23 / 4 |
| notifications | util | 21 / 5 |
| youtube | util | 19 / 4 |
| membership | util | 17 / 3 |
| email | util | 14 / 2 |
| audit | util | 13 / 1 |

`libs/api-contracts/community` (`api-contracts-community`, type:util): 30 / 2.

### Libraries — `libs/web/` (10, Angular landing-site; names `web-*`)
| Library | Type | Files / specs |
|---|---|---|
| admin | feature | 145 / 24 |
| members | feature | 117 / 45 |
| core | util | 39 / 4 |
| panel-ui | ui | 34 / 5 |
| landing | feature | 30 / 0 |
| account | feature | 23 / 0 |
| auth | feature | 23 / 1 |
| ui | ui | 18 / 1 |
| pricing | feature | 15 / 0 |
| legal | feature | 14 / 0 |

### Shared libraries
| Library | Tags | Build | Files / specs |
|---|---|---|---|
| `@ptah-extension/shared` (`libs/shared`) | scope:shared, type:util | `@nx/esbuild:esbuild` (`src/index.ts`) | 349 / 112 |
| `@ptah-extension/showcase-manifest` | scope:shared, type:util | `@nx/esbuild:esbuild` | 6 / 0 |
| `@ptah-extension/platform-core` | scope:shared, type:util | `@nx/esbuild:esbuild` | 157 / 47 |
| `@ptah-extension/markdown` | scope:shared, type:ui | `@nx/angular:ng-packagr-lite` | 25 / 7 |

### Workspace tooling (`tools/`)
`ai-migrations`, `degradation-audit`, `di-lint` (DI lint gate run on pre-push), `hyperframes`, `mcp-bench`, `migration`, `perf`, `video-editor` — 482 tracked files.

### Notable root scripts
`build` / `lint` / `test` (extension + webview + shared), `package` (vsce), `electron:*` (serve/build/package/rebuild native), `cli:*`, `prisma:*`, `docker:*`, `manifest:*` (content manifest), `gate:eager-closure`, `test:native`, `test:e2e`, `eval:build` / `eval:run`, `postinstall` (native rebuild, ONNX patch, Windows-hide patch).

---

## Language Distribution

### Source/code files (tracked, excluding docs/assets/data)
| Language | Files | % of code files |
|---|---|---|
| TypeScript (`.ts`) | 6,718 | 90.1% |
| JavaScript ESM (`.mjs`) | 234 | 3.1% |
| HTML (`.html`) | 186 | 2.5% |
| TSX (`.tsx`) | 147 | 2.0% |
| JavaScript (`.js`) | 60 | 0.8% |
| CommonJS TS (`.cts`) | 27 | 0.4% |
| CSS (`.css`) | 27 | 0.4% |
| CommonJS (`.cjs`) | 24 | 0.3% |
| SQL (`.sql`) | 23 | 0.3% |
| Shell (`.sh`) | 8 | 0.1% |
| **Total** | **7,454** | 100% |

### All tracked files
| Category | Files | % of 14,005 |
|---|---|---|
| TypeScript (`.ts` + `.tsx` + `.cts`) | 6,892 | 49.2% |
| Markdown (`.md` + `.mdx`) | 3,063 | 21.9% |
| Images (`.png`, `.svg`, `.webp`) | 2,449 | 17.5% |
| JSON / JSONL / NDJSON | 874 | 6.2% |
| JavaScript (`.mjs` + `.js` + `.cjs`) | 318 | 2.3% |
| HTML / CSS | 213 | 1.5% |
| Other (yml, sql, toml, txt, fonts, audio/video, glb, etc.) | ~196 | ~1.4% |

Note: `.ptah/` accounts for 5,056 tracked files (specs, analysis, handoffs, research, screenshots), which contributes most of the Markdown and PNG counts.
