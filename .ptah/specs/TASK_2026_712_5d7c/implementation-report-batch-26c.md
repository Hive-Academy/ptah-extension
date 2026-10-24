# Backend implementation: `TASK_2026_712_5d7c`, batch 26c (D25 F3, read-only binding port)

**Tasks completed**
- Steps 1–3: read-only lane binding port, wiring and token move.
- Step 5: spec.
- Step 4: partial. `LaneAccountResumeError` is now exported from the barrel. The handler still matches by name; see Decisions.

**Files** (6, all in worktree `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e`)

- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts`
  - New optional dependency: `accountBindings?: () => LaneAccountBindingPort | null`.
  - The `accountBindings` getter now returns the first one available, in this order:
    1. the full persistence;
    2. the read-only bindings;
    3. `undefined`.
  - `prepareNamed` is unchanged. It still requires `accountPersistence?.()?.available`, so named admission stays refused.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/di/register.ts`
  - New exported function `createClaudeLaneReadOnlyBindings(source)`:
    - `lookupBySdkSession` rebuilds every result from its status alone:
      - `absent` stays `absent`.
      - `bound` is re-checked with `classifyProviderAccountBinding`, and the provider must be `claude`. Anything else becomes `invalid-bound`.
      - `invalid-bound` is passed on as `invalid-bound`.
      - Any other status, a missing service, a resolve that throws, or a lookup that throws gives `unavailable-storage`. The catch carries a `degradation-audit` justification.
    - `validateResume` returns `{ code: 'release-held' }`.
    - `persistReference` throws `LaneAccountResumeError('release-held')`.
    - `admitClaudeRoute` is never called.
  - The `ClaudeCliAdapter` factory builds one read-only instance. It resolves `ProviderAccountService` (the existing class token) lazily on each lookup, through `c.isRegistered(ProviderAccountService, true)`. A host that does not register the service still boots.
  - The token const was removed; it is now imported from `./tokens`.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/di/tokens.ts`
  - Adds `export const CLAUDE_LANE_ACCOUNT_PERSISTENCE = Symbol.for('ClaudeLaneAccountPersistence')`. The symbol key is unchanged.
  - It is kept outside `CLI_AGENT_RUNTIME_TOKENS`, so it stays optional and unregistered, and the registration log does not list it as a registered service.
- MODIFIED `libs/backend/cli-agent-runtime/src/index.ts`
  - Adds `export { LaneAccountResumeError } from './lib/cli-agents/lane-resume-gate';`.
- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`
  - Only the doc comment on `laneAccountRefusalCode` changed. The 26b matching logic, the safe mapping and the wire code are unchanged.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/di/register.agent-process-manager.smoke.spec.ts`
  - Imports the token from `./tokens`.
  - Updates two 26b tests that this change made wrong. The smoke container runs `registerAuthProvidersServices`, so the adapter now gets the read-only port instead of `undefined`.
  - Adds tests:
    - **(a)** An `absent` lookup makes `resolveLaneAccountResume` resolve `undefined` (ambient continue, no refusal).
    - **(b)** A `bound` lookup refuses `LaneAccountResumeError` with `release-held`.
    - **(c)** A missing service gives `unavailable-storage`. A service that throws an error with a path in it gives `{ status: 'unavailable-storage' }`, and the refusal text contains no path or SQLite text.
    - **(d)** `runSdk` with a named `accountAdmission` still rejects `release-held`. `admitClaudeRoute` and the lookup are never called.
    - Also: the read-only `persistReference` rejects with `release-held`.
  - The 26b test "passes the host-registered persistence port" still holds, because full persistence takes priority.

**Stack observed**
- tsyringe, with `instanceCachingFactory` and optional `isRegistered(token, true)` resolution (`cli-agent-runtime/src/lib/di/register.ts`, the `admission` and `planLimits` dependencies).
- The service is registered by its class token at `libs/backend/auth-providers/src/lib/di/register.ts:158` (`registerAuthProvidersServices`). The same instance is aliased to `SDK_PROVIDER_ACCOUNT_ADMISSION` at line 161.
- `cli-agent-runtime/package.json` already declares `@ptah-extension/auth-providers`. Both libs are tagged `scope:extension` and `type:feature`. `auth-providers` does not import `cli-agent-runtime`, so the new edge creates no cycle.

**Host registration (Electron first)**
- Electron: `apps/ptah-electron/src/di/phase-2-libraries.ts:205` calls `registerAuthProvidersServices`, which registers the service. That call runs before `registerCliAgentRuntimeServices` at line 297. No app edit was needed.
- VS Code: `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:188`.
- CLI: `libs/backend/cli-engine/src/lib/container.ts:694`.
- Result: on all three hosts, an ambient Claude lane continue resumes. A bound session refuses `release-held`. If the store fails, the continue refuses `unavailable-storage`.
- No host registers `CLAUDE_LANE_ACCOUNT_PERSISTENCE` (D7), so named launch stays refused.

**Verification**
- `ptah_get_diagnostics` (errors) on the 6 changed files: clean after one fix to the spec's test-double typing.
- One sibling error remains, not from this batch: `rpc-handlers/src/lib/services/lane-model-listing.adapter.ts:142`, TS7053, `'claude'` cannot index `AgentListCliModelsResult`. It is from Batch 26.
- nx, jest, tsc and lint were not run, per the batch rules. Suggested, one at a time:
  - `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/di/register.agent-process-manager.smoke.spec.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.spec.ts --coverage=false --maxWorkers=2`
  - `npx nx test rpc-handlers --parallel=1`. The barrel gained an export; the barrel mocks are unaffected.

## Decisions
- **Kept name matching in `agent-rpc.handlers.ts` (step 4).**
  - The module boundary allows the import: rpc-handlers already imports `@ptah-extension/cli-agent-runtime`, e.g. `services/lane-model-listing.adapter.ts:15`.
  - But all 7 `agent-rpc.handlers*.spec.ts` files `jest.mock` that barrel without `LaneAccountResumeError`. Under those mocks, `error instanceof LaneAccountResumeError` becomes `instanceof undefined`, which throws a TypeError. That would break the four 26b refusal tests in `agent-rpc.handlers.spec.ts`, which build the error by name.
  - The spec cap was one file, and the smoke spec had to be that file (see below), so I could not update those mocks.
  - Follow-up, reversible: add `LaneAccountResumeError: jest.requireActual(...)` (or a real class) to the `agent-rpc.handlers.spec.ts` mock, build real instances in its `laneAccountResumeError()` helper, then switch `laneAccountRefusalCode` to `instanceof`.
- **The spec file is the register smoke spec, not the adapter spec.** Two of its 26b tests asserted `accountBindings === undefined` with `ProviderAccountService` registered, so this change makes them wrong. It also imported the token from `./register`. It had to be edited either way.
- **The read-only port is a function in `register.ts`, resolved lazily per lookup.** This follows the prompt's placement and the file's existing lazy optional-resolve pattern. Because resolution happens per call, a failing resolve (for example, missing SQLite) maps to `unavailable-storage` instead of failing boot. Reversible.
- **The token lives outside `CLI_AGENT_RUNTIME_TOKENS`.** Putting it in that object would make it look like a registered service in the registration log and in any test that checks tokens against registrations. No old-path re-export was left in `register.ts`; the smoke spec was the only importer.
- **`bound` results are re-classified and rebuilt.** The service's object is never forwarded. The gate checks it again, but this port's own contract stays path-free.

**DI guard impact**
- No new `@inject` and no new registration. `ProviderAccountService` is only resolved optionally, and the persistence token stays unregistered.
- `apps/*/src/di/container.smoke.spec.ts` and `apps/ptah-extension-vscode/src/di/expected-resolvable.ts` need no change.
- `apps/ptah-electron/src/di/container.smoke.spec.ts:871` calls `registerCliAgentRuntimeServices`. It resolves nothing new eagerly.

**Existing specs that touch the changed members**
- `cli-agents/cli-adapters/claude-cli.adapter.spec.ts` builds the adapter without `accountBindings`, so its getter falls through to the old behaviour. Named-admission refusal is already pinned there at lines 379 and 585. Unaffected.
- `register.ptah-cli-registry.smoke.spec.ts` imports `./register`, which now loads the `@ptah-extension/auth-providers` barrel at runtime. The agent-process-manager smoke spec already loads that barrel, so the risk is low, but this has not been run.
- The rpc-handlers barrel mocks (7 agent-rpc specs, `lane-model-listing.adapter.spec.ts`, `cli-model-list.service.spec.ts`) do not reference the new export. Unaffected.
- `agent-process-manager.account-binding.spec.ts` belongs to Batch 26 and mocks adapters directly. Not touched.

**Plan deviations**
- Step 4: the class is exported, but the handler is not switched to `instanceof` (see Decisions).
- The one spec is the register smoke spec.

**Out-of-scope observations**
- `lane-model-listing.adapter.ts:142` has a TS7053 error (Batch 26's `claude` CliType addition).
- From 26b, still open: `agent:resumeCliSession` can surface `LaneAccountResumeError` through its generic catch.
