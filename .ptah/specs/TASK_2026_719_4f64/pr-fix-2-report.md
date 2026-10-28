# PR #827 fix 2: certified executable for named Claude lanes

## Claim verdict: VALID

- `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts:262-265`:
  `direct = installation.useDirectExecution === true && installation.cliJsPath !== undefined`;
  `sdkExecutablePath = direct && installation.cliJsPath ? installation.cliJsPath : installation.path`.
  The certified executable equals the CLI JS path only on a direct-execution installation.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts:132`
  took `executable` from `loader.getCliJsPath()` (`agent-sdk/.../sdk-module-loader.ts:134`) and
  passed it to both named builders.
- `libs/backend/agent-sdk/src/lib/helpers/claude-certified-launch.ts:361` refuses with
  `route-changed` when `actual.executablePath !== launch.executable.sdkExecutablePath`. So on a
  non-direct installation the bootstrap assertion (`claude-sdk-lane-options.ts`, bootstrap
  builder) refused before any named lane started, and the final-options check in the lane
  runner would refuse as well.
- Main chat already uses the certified path: `agent-sdk/.../sdk-query-options-builder.ts:942,1522`
  and `sdk-model-service.ts:552`.

## Change

- `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-options.ts`
  - `buildClaudeLaneBootstrapOptions` (~:68-82): the `executable` parameter is removed.
    `pathToClaudeCodeExecutable` is now `launch.executable.sdkExecutablePath`. The doc comment
    now says why.
  - `buildClaudeSdkLaneOptions` (~:238-240): `pathToClaudeCodeExecutable` is now
    `certified ? certified.executable.sdkExecutablePath : executable`. `certified` is set only
    for a named route, so the ambient output is unchanged. `ClaudeSdkLaneOptionsInput.executable`
    stays because the ambient lanes still use it (`ptah-cli-registry.ts:759`, adapter).
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts:136-144`:
  the `executable` argument is removed from the bootstrap call. `getCliJsPath()` and its
  unavailable guard stay because the final options still receive `executable` for the ambient
  path, so the ambient path is byte-identical.
- `claude-sdk-lane-runner.ts`: no change was needed. It asserts whatever the options builder
  produced.

## Tests

- `claude-sdk-lane-runner.spec.ts`
  - The bootstrap fixture and the "bootstrap passes the bootstrap check" test drop the removed
    argument. The test now also asserts that the bootstrap uses the certified path. The old
    drifted-loader-path case is removed because the loader path no longer reaches named
    options. Executable drift is still covered by the existing refusal-code matrix entry
    (`pathToClaudeCodeExecutable: 'D:/other/cli.js'` gives `route-changed`).
  - New test "uses the certified executable when it differs from the loader path". It
    certifies `D:/install/claude.exe` (the non-direct case) against the loader path
    `D:/cli/cli.js`. The bootstrap and final named options both carry the certified path.
    `assertCertifiedLaunch` passes in `bootstrap` and `final` modes, and the ambient options
    keep `D:/cli/cli.js`.
- `claude-cli.adapter.spec.ts`: the test "refuses an executable that drifted" encoded the bug,
  so it is replaced. The new test "starts both named children on the certified executable,
  not the loader path" has the loader return `/sdk/bundled/cli.js` while `/claude/cli.js` is
  certified. Both `query` calls (bootstrap and final) receive `/claude/cli.js`, the binding
  commits and the lane completes. The existing ambient assertion (`pathToClaudeCodeExecutable:
  '/claude/cli.js'`, ~:231) is unchanged and passes.

## Checks

- `npx tsc --noEmit -p libs/backend/cli-agent-runtime/tsconfig.lib.json`: clean.
- `npx tsc --noEmit -p libs/backend/cli-agent-runtime/tsconfig.spec.json`: clean.
- `npx eslint` on the 4 changed files: 0 errors and 7 warnings. All 7 are existing
  `no-non-null-assertion` warnings in `claude-cli.adapter.spec.ts` on lines this fix did not
  touch.
- `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts .../claude .../cli-agents/cli-adapters --maxWorkers=2`:
  36 suites and 1013 tests passed.
- verify, build and git were not run, as instructed.

## Decisions

- Keep `executable` on `ClaudeSdkLaneOptionsInput`. The options were to remove it or to keep
  it for the ambient lanes. Keep it, because the ambient lanes (registry and adapter) read it.
  Reversible.
- Keep the adapter's `getCliJsPath()` guard for named lanes. A named lane still throws
  `Claude executable is unavailable` when the SDK loader has no CLI path. This matches the
  existing behaviour and keeps the ambient path identical.

## Out of scope

None. `agent-process-manager*` and `claude-login-console*` were not touched.
