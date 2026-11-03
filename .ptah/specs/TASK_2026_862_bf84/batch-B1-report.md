# Batch B1 report

## Files changed/deleted

- Changed `apps/ptah-electron/src/activation/bootstrap.ts`, `shutdown.spec.ts`.
- Changed `apps/ptah-electron/src/di/codex-runtime-composition.ts`, `codex-runtime-composition.spec.ts`, `codex-lane-composition.ts`, `codex-lane-composition.spec.ts`, `codex-binding.types.ts`, `container.smoke.spec.ts`, `expected-resolvable.ts`, `rpc-surface.spec.ts`, `surface-composition.spec.ts`.
- Changed `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts` and its spec.
- Changed `libs/backend/codex-runtime/src/lib/codex-account-usage-client.spec.ts` fixture.
- Deleted `apps/ptah-electron/src/di/codex-electron-admission.ts`.

## Behavior

- Electron creates one host-scoped `CodexSelectionSnapshot` from `createNodeCodexExecutableProbes`, using the existing bundled native resolver constrained to the packaged `app.asar.unpacked/node_modules` or dev `node_modules` root. Installed Codex >= 0.165.0 wins; the selector chooses the bundle otherwise. A missing dev bundle root leaves installed selection available. The snapshot logs `source`, `version`, and safe `reason` once for each selection or activated fallback through the injected Logger.
- Chat, lane runtime scopes, lane detection, and account usage reads share the snapshot. Bootstrap binds `CODEX_RUNTIME_TOKENS.SelectionSnapshot` before chat binding, so lanes keep the shared selector if chat binding fails; `RuntimeAdmissionPort` remains registered for session/auth routing. Chat and lane routing is enabled on all Electron OS/arch combinations. Pin, digest, parity, and development-route checks were removed from assigned host files.
- Lane catalog requests specify no model. A requested model stays in the lane identity unchanged. The account usage process keeps `CODEX_HOME` from `CodexHomeResolver` and uses the selected executable; other hosts keep their existing resolver fallback.

## Tests

- Updated Electron composition specs to cover packaged/unpackaged linux, darwin, and win32 on arm64 and x64; installed-first, below-floor bundle choice, and one-shot fallback.
- Updated lane composition spec for platform registration and detection through the shared snapshot; updated usage spec for executable and home selection; updated DI guard assertions for the new snapshot registration.
- No Jest/Nx tests were run, per lane instruction. `ptah_ast_analyze` parsed both rewritten composition specs and source files without syntax errors. Scoped `ptah_get_diagnostics` was requested after edits but remained unavailable after its 45-second timeout.

## TypeScript check

- Ran permitted Electron app `tsc --noEmit` three times, filtering diagnostics to owned files. The last captured output had two owned-file errors: `codex-lane-composition.ts:126` from assigning optional `options.model` to the still-required lane identity model; this was corrected to `options.model ?? ''` after the run; and `codex-runtime-composition.ts:665` because the concurrent `CodexChatHostPortsDeps` source still requires `platform`. The latter is a batch-4 contract update; this batch intentionally removed that argument as directed. No final post-fix app check was run because the three-call limit was reached. Other project errors from concurrent batches were not changed.

## Decisions

- **Single host snapshot with logging wrapper.** Options were logging separately in chat/lane/usage or wrapping one snapshot. The wrapper records the actual runtime choice and fallback in one place, while all consumers receive the same port. Reversible: yes.
- **Keep lane identity's empty-string sentinel until batch 7.** Options were an invalid `undefined` assignment or retaining the current required `CodexProfileSettings.model` shape. The current lane profile contract requires a string and batch 7 owns the adapter's final omitted-model behavior. Reversible: yes.
- **Account usage gets the snapshot through a bootstrap setter.** Options were changing the service constructor token for every host or configuring the Electron instance at the composition root. The latter preserves existing host DI and auth-home behavior. Reversible: yes.

## Open issues

- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:55-69` still picks `CodexChatAdapterPorts.platform`; batch 4 must remove it for the required Electron `createCodexChatHostPorts` call without `platform` to typecheck.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts:228-229` still applies `CODEX_LANE_DEFAULT_MODEL`; batch 7/8 must remove it so an omitted lane identity model reaches Codex as `undefined`. The explicit future ID is passed unchanged by this batch.
- No skill-loading tool was listed for this lane; no optional skill was loaded.

