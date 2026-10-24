# Backend implementation: `TASK_2026_712_5d7c`, batch 26b (D25 F3)

**Tasks completed**
- F3a: `agent:continue` now maps `LaneAccountResumeError` to a typed refusal that carries no path, env value or credential.
- F3b: `ClaudeCliAdapter` now gets an account-persistence port through an optional DI token. When no host registers it, the adapter refuses fail-closed.

**Files** (4, all in worktree `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e`)

- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`
  - Adds a module helper, `laneAccountRefusalCode(error)`. It matches an `Error` with `name === 'LaneAccountResumeError'` and a `code` from the shared `PROVIDER_ACCOUNT_RESULT_CODES` whitelist (`ok` excluded).
  - On a match, `agent:continue` logs `warn('RPC: agent:continue account refused', { agentId, code })` and returns `{ success: false, code: 'unknown', error: 'Claude lane account resume refused (<code>).' }`.
  - The reply is rebuilt from the whitelisted code alone. The thrown text is never forwarded.
  - The `AgentContinueError` branch and the generic branch are unchanged. A continue that succeeds (ambient) is unchanged.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/di/register.ts`
  - Adds and exports `CLAUDE_LANE_ACCOUNT_PERSISTENCE = Symbol.for('ClaudeLaneAccountPersistence')`.
  - Passes `accountPersistence: () => c.isRegistered(TOKEN, true) ? c.resolve<ClaudeLaneAccountPersistence | null>(TOKEN) : null` to `ClaudeCliAdapter`. This is the same lazy, optional pattern the adapter's `admission` dependency already uses.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/di/register.agent-process-manager.smoke.spec.ts`
  - Adds 3 tests: no registration gives `adapter.accountBindings === undefined`; a `{ useFactory: () => null }` binding gives undefined; a registered port is passed through as the same object.
- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.spec.ts`
  - Adds `continueConversation` to the harness mock.
  - Adds 4 tests:
    - a refusal maps to the safe typed reply, and a credential-path message does not leak;
    - a specific code (`identity-unproved`) is preserved;
    - a code that is not on the whitelist (a path) falls through to the generic `Failed to continue agent conversation`;
    - an ambient success stays `{ success: true }`.

**Stack observed**
- tsyringe, with `instanceCachingFactory` registrations and an optional `isRegistered(..., true)` check before resolve (`register.ts:128-136`, the `admission` dependency).
- RPC goes through `rpcHandler.registerMethod`. Typed errors are mapped with `instanceof` (`agent-rpc.handlers.ts`, the `AgentContinueError` branch).
- The refusal-code whitelist is `PROVIDER_ACCOUNT_RESULT_CODES` from `@ptah-extension/shared` (`provider-account.types.ts:38`). `lane-resume-gate.ts:164` uses the same list.

**Which hosts register the token:** none. No implementation of `ClaudeLaneAccountPersistence` exists anywhere in the repository. Batch 20's report (line 58) and D7 defer it to host certification. So Electron, VS Code and CLI all resolve null:
- An account-scoped `claude` lane launch refuses with `release-held` (`claude-cli.adapter.ts:277-278`).
- A resume refuses with `unavailable-storage` (`lane-resume-gate.ts:214`).
- Every host still boots, because nothing is resolved eagerly.

## Decisions
- **New token instead of an "existing" one.** The batch prompt assumed the adapter expects a registered token. None exists.
  - `SDK_NAMED_ACCOUNT_PERSISTENCE` (`NamedAccountPersistencePort`) does not fit. It lacks `available`, `lookupBySdkSession` and `validateResume`, so reusing it would cause a runtime TypeError on resume.
  - I declared the token in `register.ts` rather than in `tokens.ts` to stay within the 4-file cap. Precedent: `LANE_OUTCOME_PIPELINE` is exported from `lane-outcomes/src/lib/di/register.ts:22`.
  - `Symbol.for` lets a host register it without a barrel import. Reversible: move it into `CLI_AGENT_RUNTIME_TOKENS` and the barrel when certification registers a real adapter.
- **Structural match instead of `instanceof`.** `LaneAccountResumeError` is not exported from the `@ptah-extension/cli-agent-runtime` barrel, and every agent-rpc spec mocks that barrel. Matching by fixed `name` plus a whitelisted `code` needs no barrel edit and cannot accept a forged path as a code.
  - Reversible: export the class and switch to `instanceof`.
- **Wire code `unknown`.** `AgentContinueErrorCode` is duplicated in shared (`rpc-agents.types.ts:529`) and in `agent-process-manager.service.ts:148`. Both are outside this batch.
  - `unknown` is the right fallback behaviour. `agent-follow-up-queue.service.ts:168-170` falls back to resume only for `not_found`, `released` and `unsupported`, and a resume would hit the same account gate.
  - The refusal code travels in the fixed `error` text and in the warn log.
  - Follow-up: add an `account_refused` code (or a typed `accountRefusal` field) to both unions and to the `agent:continue` result in `rpc.types.ts:1383`.

**Verification**
- `ptah_get_diagnostics` (errors) on the 4 changed files: clean.
  - Sibling error, not from this batch: `libs/backend/rpc-handlers/src/lib/services/lane-model-listing.adapter.ts:142`, TS7053, `'claude'` cannot index `AgentListCliModelsResult`. This looks like a consequence of Batch 26 adding `claude` to `CliType`.
- nx, jest, tsc and lint were not run, per the batch rules; the orchestrator runs them. Suggested:
  - `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.spec.ts --coverage=false --maxWorkers=2`
  - `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/di/register.agent-process-manager.smoke.spec.ts --coverage=false --maxWorkers=2`
- Risk: the smoke tests are the first in that suite to resolve `ClaudeCliAdapter`. Its factory eagerly resolves the SDK module loader, the spawn options, `ClaudeSdkLaneRunner`, the permission handler and the process spawner. All are registered by `registerSdkServices` / `registerCliAgentRuntimeServices`, but they were not exercised there before.

**DI guard impact:** no new `@inject`. No resolvable service is registered, because the token is only checked optionally. `container.smoke.spec.ts` and `expected-resolvable.ts` need no change.

**Existing specs that mock the changed members**
- `continueConversation` was not mocked by any rpc-handlers spec before this batch.
- The other agent-rpc specs (`list-rows`, `decision-endpoint`, `set-config`, `decision-model`, `resume-parent-session`, `migration`) mock the barrel with `AgentContinueError` and are unaffected.
- `claude-cli.adapter.spec.ts` builds the adapter directly with its own `accountPersistence` and is unaffected.

**Plan deviations**
- The token did not exist, so it was created (see Decisions).
- The typed wire code is `unknown` plus fixed text, not a new union member (see Decisions).

**Out-of-scope observations**
- `agent:resumeCliSession` may also surface `LaneAccountResumeError` through `prepareSdkHandleSpawn` / `resolveLaneAccountResume`. Only `agent:continue` was in scope; check that handler's generic catch.
- The `lane-model-listing.adapter.ts:142` TS7053 error above belongs to the Batch 26 owner.
- Named live launch stays fail-closed (D7). No host gains persistence availability from this batch.
