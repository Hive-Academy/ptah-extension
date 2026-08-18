# TASK_2026_270 — E2E plan (Batch 5)

Harness: `apps/ptah-electron-e2e`, Playwright, serial (`workers: 1`,
`fullyParallel: false` — the Electron app owns global DI state). Driver:
`src/support/ui-driver.ts` (`goto`, `mockRpc`, `pushEvent`, `getObservedCalls`,
`waitForObservedCall`, `getObservedMessages`, `waitForObservedMessage`,
`prepare` for a renderer reload).

## The regression bar comes first

`src/specs/harness/new-project.spec.ts` (TASK_2026_263, 6 tests) MUST stay green
**without edits**. If Batch 4 forces a change there, that is a finding about
Batch 4, not a test to fix — the Node/TypeScript path is contractually
unchanged. Run it first, before writing anything new.

Known landmine, already paid for once: `SetupHubComponent` reads
`presets().length` unguarded, so any unmocked `harness:load-presets` returning
`{}` freezes the component's bindings on every change-detection pass while
`ptah-setup-hub` still renders. The existing spec's `test.beforeEach` mocks it to
`{ presets: [] }`. Keep that in any new spec that mounts the Setup Hub.

## New spec 1 — `harness/new-project-dotnet.spec.ts`

1. **Platform step precedes stack, and stack chips derive from the platform.**
   Open intake, assert `intake-platform-dotnet` exists; select it; assert the
   stack chips are the `dotnet` profile's `stackOptions` and NOT
   `angular-nestjs`/`react-nestjs`. Selecting `node-ts` restores them. This is
   the test that proves the mirrors were really deleted rather than duplicated.
2. **Intake payload carries the platform.** Fill and submit; assert
   `waitForObservedCall('harness:start-new-project')` params equal
   `{ intake: { platform: 'dotnet', what, audience, stack, ... } }` exactly.
3. **The seed prompt names the .NET skills, not the TypeScript ones.** Push
   `harness:open-workflow` with the built prompt; assert the observed
   `chat:start` prompt contains `dotnet-solution-initializer` and
   `nx-dotnet-workspace`, and does NOT contain `saas-workspace-initializer` or
   `nx-workspace-architect`.
4. **Transcript still shows the user's words.** First bubble is the intake
   summary; the instruction block never leaks (same invariant as 263).
5. **Toolchain-missing is stated, not discovered halfway.** With the probe
   reporting `dotnet` absent, assert the prompt carries the install hint.

## New spec 2 — `marketplace/external-marketplace.spec.ts`

The consent gate is the security property; these tests are its executable
statement.

1. **Add a marketplace by `owner/repo`.** `marketplace-add` stays disabled for
   malformed input; a valid slug is sent verbatim.
2. **Install is TWO calls, and the first writes nothing.** Click install →
   assert exactly ONE `plugins:install-external` call, carrying NO
   `consentToken`, and that nothing is reported installed.
3. **The dialog discloses before it asks.** Assert the rendered consent dialog
   contains the MCP `commandLine` VERBATIM, the script file names, and the
   skill count. This is the test that fails if someone ever makes install quiet.
4. **Confirm carries exactly the plan's token.** Second call has
   `consentToken === plan.consentToken`. Cancel issues NO second call.
5. **Version change forces re-consent.** A confirm answered `consent-required`
   re-renders the NEW plan, shows the re-approval banner, and does not install.
   The banner must not claim upstream changed — `approval-expired` also covers a
   lapsed TTL and a host restart.
6. **Deregistering a marketplace does not uninstall its plugins**, and those
   plugins remain visible in the flat Installed section so they can still be
   removed.

## New spec 3 — C# AST, real grammar

Unit-level coverage already exists (`csharp-grammar.integration.spec.ts`, 14
tests, loads the real 4.9 MB wasm). The e2e question is different and narrower:
**does the grammar actually ship and load in the packaged app?** A path or
copy-step regression would leave every unit test green.

Add to an existing Electron e2e spec rather than a new file: write a small `.cs`
file into the e2e workspace, drive the AST/symbol path through the real RPC
(`real-rpc-fixtures.ts`, no mocking), and assert C# symbols come back.
`verify-packed-wasm.js` guards the asar — extend it to include the C# grammar.

## Deliberately NOT covered

- Real network installs from `dotnet/skills`. The consent protocol is asserted
  against mocked RPC; hitting GitHub in CI is flaky and rate-limited. One
  `@nightly`-tagged live test is the right home for that, in its own carrier.
- `ptah-cli` / `ptah-tui` AST. The WASM copy step never ran for those apps and
  their npm `files` list omits `wasm/` — a pre-existing gap affecting all five
  grammars, deserving its own task and its own package-size decision.
