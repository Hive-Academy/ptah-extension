# ptah-extension-vscode-e2e

[Back to Main](../../CLAUDE.md)

## Purpose

End-to-end activation gate for `ptah-extension-vscode`. Downloads VS Code via `@vscode/test-electron`, launches it with the built extension loaded into an isolated `--user-data-dir` profile, and asserts that `activate()` completes without throwing and without leaving pending unhandled rejections in the extension host.

Exists to catch the failure mode that shipped in `v0.2.30`: an unhandled rejection inside the activation chain (settings migration / SQLite open / agent adapter initialize) that killed the extension host with exit code 7 and was invisible to the unit-test layer.

## Entry Points

- `src/runner.mjs` — Node ESM script. Resolves the built extension path, allocates a temp `--user-data-dir` + `--extensions-dir`, calls `@vscode/test-electron`'s `runTests`.
- `src/suite/index.cjs` — CommonJS module loaded by VS Code inside the extension host. Exports `run()`. Uses Node's built-in `assert/strict` — no Mocha, no extra deps.

## Specs

1. extension is discovered by VS Code
2. `activate()` resolves without throwing
3. activation API surface is `object | undefined`
4. at least one `ptah.*` command is registered after activation
5. `package.json` declares ptah activation events
6. `~/.ptah/` contains no `.tmp` / `.partial` files after activation
7. no `unhandledRejection` fires during a 1.5s settle window after activation

## Build & Run

- `nx run ptah-extension-vscode-e2e:e2e` — `dependsOn` `ptah-extension-vscode:build`, then `node src/runner.mjs`. First run downloads VS Code (~213 MB) into `.vscode-test/` (gitignored).
- `node apps/ptah-extension-vscode-e2e/src/runner.mjs` — direct invocation, assumes `dist/apps/ptah-extension-vscode` is already built.

## Guidelines

- Tests must remain serial — only one VS Code window per run.
- Specs run inside the extension host, so they have full `vscode` API access but cannot import workspace `@ptah-extension/*` libs (those are bundled into `main.mjs`).
- The runner launches with `--disable-extensions` so only the Ptah extension is loaded. This is intentional — we're gating Ptah activation, not interaction with other extensions.
- When adding a state-dependent spec, seed the temp `--user-data-dir` BEFORE launching, not inside the suite (the host is already running by the time the suite executes).
