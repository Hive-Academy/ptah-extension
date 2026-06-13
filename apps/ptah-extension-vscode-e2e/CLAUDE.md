# ptah-extension-vscode-e2e

[Back to Main](../../CLAUDE.md)

## Purpose

End-to-end activation + RPC registration gate for `ptah-extension-vscode`. Downloads VS Code via `@vscode/test-electron`, launches it with the built extension loaded into an isolated `--user-data-dir` profile, and asserts that `activate()` completes past the license gate, that the RPC registration contract holds (no missing / orphan handlers), and that no pending unhandled rejections remain in the extension host.

Exists to catch two failure modes that shipped to the Marketplace: the `v0.2.30` unhandled rejection in the activation chain, and missing / wrongly-excluded RPC handlers (the runtime verifier only logs in production, so nothing failed before publish).

## Entry Points

- `src/runner.mjs` — Node ESM script. Resolves the built extension path, allocates a temp `--user-data-dir` + `--extensions-dir`, sets `PTAH_E2E=1`, then calls `@vscode/test-electron`'s `runTests`. The env flag makes `bootstrap.ts` seed a `previousUserContext` into globalState (activation takes the community path instead of the license-blocked welcome page — extension-test instances run with **in-memory storage**, so state.vscdb cannot be seeded from outside) and makes `verifyAndReportRpcRegistration` throw on drift. The seed is double-gated on `ExtensionMode.Test`.
- `src/suite/index.cjs` — CommonJS module loaded by VS Code inside the extension host. Exports `run()`. Uses Node's built-in `assert/strict` — no Mocha, no extra deps.

## Specs

1. extension is discovered by VS Code
2. `activate()` resolves without throwing
3. activation API surface is `object | undefined`
4. at least one `ptah.*` command is registered after activation
5. `package.json` declares ptah activation events
6. extension activates past the license gate (community path, exports `getRpcVerification`)
7. every RPC method in the registry has a registered handler (no missing handlers)
8. no orphan RPC handlers (registered but not in registry / wrongly listed in `ELECTRON_ONLY_METHODS`)
9. `~/.ptah/` contains no `.tmp` / `.partial` files after activation
10. no `unhandledRejection` fires during a 1.5s settle window after activation

The RPC specs consume the extension's activation exports (`PtahActivationApi.getRpcVerification()` in `apps/ptah-extension-vscode/src/main.ts`), which surface the `verifyRpcRegistration` result computed during `RpcMethodRegistrationService.registerAll()`.

## Build & Run

- `nx run ptah-extension-vscode-e2e:e2e` — `dependsOn` `ptah-extension-vscode:build`, then `node src/runner.mjs`. First run downloads VS Code (~213 MB) into `.vscode-test/` (gitignored).
- `node apps/ptah-extension-vscode-e2e/src/runner.mjs` — direct invocation, assumes `dist/apps/ptah-extension-vscode` is already built.
- CI: `.github/workflows/vscode-e2e.yml` runs the suite on every PR to main; `.github/workflows/publish-extension.yml` runs it as a blocking gate against the packaged dist before `vsce publish`.

## Guidelines

- Tests must remain serial — only one VS Code window per run.
- Specs run inside the extension host, so they have full `vscode` API access but cannot import workspace `@ptah-extension/*` libs (those are bundled into `main.mjs`).
- The runner launches with `--disable-extensions` so only the Ptah extension is loaded. This is intentional — we're gating Ptah activation, not interaction with other extensions.
- When adding a state-dependent spec, seed the temp `--user-data-dir` BEFORE launching, not inside the suite (the host is already running by the time the suite executes).
