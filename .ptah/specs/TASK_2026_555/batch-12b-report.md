# Batch 12b report — sanitize raw RPC error text: ptah-cli + auth handlers (S2c follow-up)

Executor: backend-developer (subagent, in-process). Scope: exactly the four Batch 12b files. Batch 12c (agent-rpc +
provider-rpc) ran in parallel in the same test project and was not touched.

## Files

| Path (under ROOT) | Change |
| --- | --- |
| `libs/backend/rpc-handlers/src/lib/handlers/ptah-cli-rpc.handlers.ts` | New module constant `PTAH_CLI_RPC_ERRORS`. The five outer catches return fixed text instead of `error.message`. |
| `libs/backend/rpc-handlers/src/lib/handlers/ptah-cli-rpc.handlers.spec.ts` | 5 assertions deliberately changed. +5 leak cases (`it.each`, one per RPC). |
| `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts` | Fixed text in the `auth:copilotLogin` and `auth:setApiKey` outer catches. |
| `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.spec.ts` | 1 assertion deliberately changed. +3 leak cases (copilotLogin; setApiKey save and clear). |
| `.ptah/specs/TASK_2026_555/batch-12b-report.md` | This file. |

## Fixed messages (outer catch only)

| RPC | Was | Now |
| --- | --- | --- |
| `ptahCli:create` (`:152`) | `error.message` | `Could not create the Ptah CLI agent.` |
| `ptahCli:update` (`:211`) | `error.message` | `Could not save the Ptah CLI agent.` |
| `ptahCli:delete` (`:247`) | `error.message` | `Could not delete the Ptah CLI agent.` |
| `ptahCli:testConnection` (`:277-289`) | `error.message` | `Could not test the connection.` |
| `ptahCli:listModels` (`:359`) | `error.message` | `Could not load the model list.` (`models: []`, `isStatic: true` unchanged) |
| `auth:copilotLogin` (`:1144`) | `error.message` / `'Login failed'` | `GitHub sign-in failed. Try again.` |
| `auth:setApiKey` (`:1271`) | `error.message` | `Could not save the API key.` (used for both the save and the clear branch) |

Kept as they were:

- **Logging and Sentry** still receive the error object (`logger.error(…, error)`, `sentryService.captureException(error, …)`).
  No new log line was added, and no log line carries a params value.
- **Expected failures with fixed text** are untouched:
  - `ptahCli:listModels` `Agent not found` / `Provider not found`
  - `auth:copilotLogin`'s `login() === false` copy
  - `auth:setApiKey` `provider is required`
- **The `ptahCli:testConnection` inner result**, i.e. the registry's own `{ success:false, error }`, is still returned
  as is. That `error` is Batch 12's sanitized `reason`. The existing spec "forwards structured registry failures
  as-is" still passes unchanged.

About `auth:copilotLogin` and user-actionable failures: the device flow's two known outcomes, `expired_token` and
`access_denied`, already resolve `null` (`auth-providers/.../copilot-device-code-auth.ts:110-111, 179-184`), so
`login()` returns `false` and the existing fixed copy is used. The outer catch only ever sees unexpected throws, so it
uses the generic fixed text.

## Specs

- **One leak case per RPC** (7 RPCs, 8 cases; `auth:setApiKey` covers both the save and the clear branch).
  - Setup: the thrown `Error` message contains `sk-test-FAKEKEY123` and `C:\Users\someone\.ptah\settings.json`.
  - Assertions: `JSON.stringify` of the whole RPC response contains neither the key, nor `someone`, nor `settings.json`,
    and `data.error` equals the fixed text.
  - The ptah-cli cases also assert that Sentry still receives the original error object.
- **Existing assertions deliberately changed** (each asserted the raw message):
  - `ptah-cli-rpc.handlers.spec.ts:338`: `'Unknown provider: xyz'` → `'Could not create the Ptah CLI agent.'`
  - `ptah-cli-rpc.handlers.spec.ts:413`: `'Agent not found: a1'` → `'Could not save the Ptah CLI agent.'`
  - `ptah-cli-rpc.handlers.spec.ts:447`: `'disk full'` → `'Could not delete the Ptah CLI agent.'`
  - `ptah-cli-rpc.handlers.spec.ts:508`: `'network down'` → `'Could not test the connection.'`
  - `ptah-cli-rpc.handlers.spec.ts:589`: `'kaboom'` → `'Could not load the model list.'`
  - `auth-rpc.handlers.spec.ts:1677`: `'network down'` → `'GitHub sign-in failed. Try again.'`
- **No frontend dependency** on the old texts: grep of `libs/frontend` (non-spec) for `Unknown provider:`,
  `Agent not found:`, `network down` and `Login failed` returns no match.

## Verification

- Scoped: the two handler specs → 2 suites passed, 93 passed, 1 skipped (pre-existing skip).
- Batch 12b verify command, run in the foreground:
  `npx nx run-many -t typecheck,test,lint -p @ptah-extension/rpc-handlers --parallel=2` → EXIT=1.
  - `typecheck` passed.
  - `lint` passed; Nx reported "existing outputs match the cache", so the hash matched the current inputs.
  - `test`: 3412 passed, 4 skipped, 1 failed. The failure is the known pre-existing
    `harness/selection/harness-skill-selection-rpc.service.spec.ts` "never writes state.json", which is on the
    batches.md known-failure list and not in this batch's files.
- Gate G was not run by this executor: it is the team-leader's single-writer run at commit time, and no webview code
  changed.

## Plan deviations

None. The messages live in one small module constant in the ptah-cli handler, because five catches share the
pattern. The auth handler uses inline literals, as in the `auth:deleteStoredKey` precedent.

## Out of scope (recorded, not changed)

- **`ptahCli:list` rethrows** (`ptah-cli-rpc.handlers.ts`, `registerList` catch). The RPC dispatcher then returns the
  raw `error.message` (`vscode-core/src/messaging/rpc-handler.ts:241-252`). Its existing spec asserts
  `response.error === 'registry offline'`. It is not in Batch 12b's line list, and it is the dispatcher's generic path.
  It needs its own decision: a fixed message in the handler, or a generic sanitize in the dispatcher.
- The same dispatcher path applies to `auth:testConnection`, which also rethrows. Not in scope.
