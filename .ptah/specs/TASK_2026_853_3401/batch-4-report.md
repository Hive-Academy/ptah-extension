# Batch 4 report — `IDisplayWindowHost` port and desktop-only adapter

## Files (all under `libs/backend/platform-core/src`)

- CREATED `interfaces/display-window-host.interface.ts` — the `IDisplayWindowHost` port.
- CREATED `display-window/desktop-only-display-window-host.ts` — `DesktopOnlyDisplayWindowHost` for VS Code and CLI.
- CREATED `testing/contracts/run-display-window-host-contract.ts` — shared contract suite.
- CREATED `testing/contracts/run-display-window-host-contract.self.spec.ts` — runs the suite on the desktop-only adapter and on an in-memory supported host.
- MODIFIED `di/tokens.ts` — `PLATFORM_TOKENS.DISPLAY_WINDOW_HOST`.
- MODIFIED `index.ts` — exports `type IDisplayWindowHost` and `DesktopOnlyDisplayWindowHost`.
- MODIFIED `testing/contracts/index.ts` — exports `runDisplayWindowHostContract` and `type DisplayWindowHostContractSetup`.

## Port API

Types come from `@ptah-extension/shared` (batch 3, `rpc/rpc-display-window.types.ts`); none are redefined.

```ts
export interface IDisplayWindowHost {
  readonly supported: boolean;
  open(): Promise<DisplayWindowOpenResult>;          // opens or focuses; never rejects
  close(): Promise<boolean>;                          // true only when a window was closed
  isOpen(): boolean;
  publishState(snapshot: DisplayWindowSnapshot): boolean; // true when cached (+ forwarded)
  getState(): DisplayWindowSnapshot | null;
  relayAction(tabId: string, action: DisplayWindowAction): boolean; // true when delivered
}
```

Token: `PLATFORM_TOKENS.DISPLAY_WINDOW_HOST = Symbol.for('PlatformDisplayWindowHost')`.

`DesktopOnlyDisplayWindowHost` (plain class, zero-arg constructor, no tsyringe — platform-core has no
tsyringe import): `supported = false`; `open()` resolves `{ ok: false, reason: 'desktop-only' }`;
`close()` resolves `false`; `isOpen()` `false`; `publishState()` `false`; `getState()` `null`;
`relayAction()` `false`. Bind with `useValue: new DesktopOnlyDisplayWindowHost()` or `useClass`.

## Contract suite

`runDisplayWindowHostContract(name, setup)` where
`setup = { createHost(): IDisplayWindowHost | Promise<...>; relayed?(): readonly {tabId, action}[]; teardown?() }`.
Seven cases, branching on `host.supported`: starts closed with null state; `close` on nothing is
`false`; `open` result shape; second `open` keeps it open; `close` closes once; latest snapshot
wins (supported) or nothing is kept (unsupported); `relayAction` delivers and is recorded via
`relayed()` (required for a supported host) or returns `false`. `afterEach` calls `host.close()`.

For the Electron adapter: the suite expects `publishState` to return `true` after `open()`.

## Verification

- `npm run verify -- -p @ptah-extension/platform-core` -> `NX 3 tasks: 2 succeeded, 1 failed`
  (lint and typecheck succeeded; test failed).
- Test detail: `Test Suites: 2 failed, 48 passed, 50 total` / `Tests: 3 failed, 4 todo, 996 passed, 1003 total`.
  The failures are `src/file-settings-keys.spec.ts` (2) and `src/file-settings-manager.spec.ts` (1):
  "every key in FILE_BASED_SETTINGS_DEFAULTS is also in FILE_BASED_SETTINGS_KEYS" and
  "derives every default from the shared table, key for key". Cause: batch 3 added
  `display.autoOpenArtifacts` to the shared `ADVANCED_SETTINGS` table, which feeds
  `FILE_BASED_SETTINGS_DEFAULTS`, but the hand-kept key list in
  `libs/backend/platform-core/src/file-settings-keys.ts` (next to `'notifications.hostEnabled'`, ~line 271)
  does not list it. Not caused by and not in this batch's files.
- Display-window suites alone (`jest -c libs/backend/platform-core/jest.config.ts --maxWorkers=2
  .../run-display-window-host-contract`): `Tests: 14 passed, 14 total`.

## Out of scope — needs an owner

- Add `'display.autoOpenArtifacts'` to `FILE_BASED_SETTINGS_KEYS` in
  `libs/backend/platform-core/src/file-settings-keys.ts` (not in any batch's file list in
  the plan). Until then `platform-core:test` fails.
- Binding `DesktopOnlyDisplayWindowHost` in `platform-vscode/src/registration.ts` and
  `platform-cli/src/registration.ts`, plus `expected-resolvable.ts`, belong to other batches.
