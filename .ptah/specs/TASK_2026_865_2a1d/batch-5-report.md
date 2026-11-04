# Batch 5 report: registration and RPC wiring

Executor: backend-developer subagent. Worktree:
`/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765`.
I ran no git commands that change state. I did not edit `batches.md`, `task.md` or anything under
`libs/frontend`. The frontend files in `git diff --stat` belong to the parallel frontend agent.

## Verification status: NOT CONFIRMED locally (CI is the gate, decisions.md row 51)

- di-lint: `node scripts/verify.mjs --exec --task di-lint-b5 -- npx nx run di-lint:lint` gave
  `NX 1 task: 1 succeeded`. The lock reported `exit code 0` (65.5 s, cache 0/1).
- `ptah_get_diagnostics` (`files` = the 8 changed files, severity `error`): I ran it twice. Both
  runs returned "Unavailable: TypeScript check still running after 45s", so I have no diagnostics
  result, clean or otherwise.
- As row 51 requires, I did not run `npm run verify`, nx test/typecheck, jest or tsc. The batch's
  `npm run verify -- -p @ptah-extension/rpc-handlers,ptah-electron,@ptah-extension/cli-engine` is
  left for CI on draft PR #914.
- I checked every import and symbol against source by hand:
  - `CHAT_TOKENS`, `ChatCarryOverService.check` and `.carryOver` (`chat-carry-over.service.ts:131,
    144`)
  - the four `ChatCarryOver*` types in `@ptah-extension/shared` (`rpc-chat.types.ts:471-506`)
  - `RpcUserError(message, errorCode)` (`vscode-core/src/messaging/rpc-types.ts:87`)
  - `SDK_TOKENS.SESSION_HISTORY_ROUTER` and `SDK_SESSION_METADATA_STORE`
  - `AUTH_PROVIDERS_TOKENS.SDK_WORKSPACE_PROVIDER_PROFILE_RESOLVER` (`@ptah-extension/auth-providers`)
  - `SETTINGS_TOKENS.MODEL_SETTINGS` (`@ptah-extension/settings-core`)

## Files

- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/tokens.ts`: adds `CHAT_TOKENS.CARRY_OVER =
  Symbol.for('ChatCarryOverService')`.
- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/di.ts`: registers a singleton right after
  `SESSION` and adds a `CARRY_OVER` row to the order comment.
- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/di.spec.ts`: adds the `isRegistered` assertion
  at the `:59-60` pattern and a singleton resolution case.
- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/session/index.ts`: exports
  `ChatCarryOverService`, `CarryOverLaunch` (type), `CARRY_OVER_PROVIDER_CHANGED` and
  `CARRY_OVER_START_FAILED` (batch-4-report request).
- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts`: adds the two `.strict()`
  schemas.
- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts`: adds the injection,
  the `METHODS` entries, both wires and the debug-list entries.
- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.spec.ts`: adds the
  constructor argument, the `METHODS` order, delegation, refusal and `INVALID_PARAMS` cases.
- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/session/chat-session-history-page.spec.ts`: adds
  one positional `{} as never` for the new constructor parameter. See Deviations.

## Task 5.1: Token and DI registration

- `CARRY_OVER` is registered with `container.registerSingleton(CHAT_TOKENS.CARRY_OVER,
  ChatCarryOverService)` directly after `SESSION`. The order comment row reads
  `CARRY_OVER ← SESSION, HISTORY_READ, RUNTIME_PROFILE`.
- P3, container resolution. Both hosts call `registerChatServices`:
  - Electron: `apps/ptah-electron/src/di/phase-4-handlers.ts:96`
  - cli-engine: `libs/backend/cli-engine/src/lib/container.ts:975`
- So the new token is bound wherever `ChatRpcHandlers` resolves, and no host-specific
  registration is needed. The required dependencies the service adds beyond what
  `ChatSessionService` already needs:
  - `SDK_TOKENS.SESSION_HISTORY_ROUTER` is registered by `registerSdkServices`
    (`agent-sdk/src/lib/di/register.ts:312`). Both hosts call that before chat services:
    cli-engine at `container.ts:702`, Electron through its phase-2 libraries, and it is listed
    in `expected-resolvable.ts:46`.
  - `LOGGER`, `SDK_SESSION_METADATA_STORE`, the profile resolver and `MODEL_SETTINGS` are already
    required injections of `ChatSessionService`, so both hosts already satisfy them.
  - The plan says `expected-resolvable.ts` needs no edit, and I made none.
- Optional choice per token (set in Batch 4's constructor; I checked it against
  `ChatSessionService`):

| Token | Carry-over service | `ChatSessionService` | Why |
| ----- | ------------------ | -------------------- | --- |
| `AUTH_PROVIDERS_TOKENS.SDK_ACTIVE_PROVIDER_RESOLVER` | `isOptional: true` | `isOptional: true` (`:390`) | Same treatment. Absent means fail closed: nothing is eligible. |
| `CHAT_TOKENS.RUNTIME_PROFILE` | `isOptional: true` | `isOptional: true` (`:394`) | Same treatment. Absent means the Claude-only probe branch. |
| `AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH` | `isOptional: true` | not injected | Optional, so a host without Codex auth still resolves. Absent means a Codex target is not eligible. |

- di-lint passed (above). Every `@inject` token in the new service already has a `register*`
  call, and `CARRY_OVER` now has one too.

Spec and the AC it proves (`di.spec.ts`):

- "registers the chat services once the precondition is met" also asserts
  `isRegistered(CHAT_TOKENS.CARRY_OVER)`.
- "resolves CARRY_OVER to one shared ChatCarryOverService" follows the
  ChildChatSessionHostAdapter precedent: stand-ins are bound after registration, and the
  optional active-provider and Codex-auth tokens are left unbound. It proves
  `toBeInstanceOf(ChatCarryOverService)` and that two resolves return the same instance
  (singleton).

## Task 5.2: Schemas and handler wiring

- Schemas (`chat-rpc.schema.ts`), both `.strict()`:
  - `ChatCarryOverCheckParamsSchema`: `{ sessionId: uuidString, workspacePath:
    string.min(1).max(4096) }`
  - `ChatCarryOverParamsSchema` adds `tabId: uuidString`, `name: string.max(200).optional()` and
    `ptahUiFence: boolean.optional()`.
  - The caps are named module constants.
- Handler (`chat-rpc.handlers.ts`):
  - Injects `@inject(CHAT_TOKENS.CARRY_OVER) carryOver: Pick<ChatCarryOverService, 'check' |
    'carryOver'>` after `permissionHandler` and before the two optional parameters.
  - Appends `'chat:carry-over-check'` and `'chat:carry-over'` to `METHODS` and wires them in the
    same order, after `agent:backgroundList`.
  - Adds both names to the debug list.
  - Each wire calls `safeParse`. On failure it throws `RpcUserError('Invalid carry-over request',
    'INVALID_PARAMS')`, then delegates to the service.
  - There is no logging beyond `runRpc`.
  - Every host refusal comes back from the service as a result (Batch 6 request). The only RPC
    error is a malformed request.
- `ChatRpcHandlers.METHODS` feeds the manifest, and `rpc.types.ts:3415-3416` already lists both
  methods (Batch 1). So `rpc-allowlist.spec.ts`, `register-shared-rpc-handlers.spec.ts` and both
  `rpc-surface.spec.ts` files should pass unchanged. That is not confirmed locally (CI).

Specs and the ACs they prove (`chat-rpc.handlers.spec.ts`):

- `METHODS` order test (`:231`): the two new names are at the end. The existing "wires exactly
  the METHODS entries, in order" and "registers %s with a function handler" tests cover the new
  wires automatically.
- Constructor argument (`:116`): a `carryOver` mock is inserted after `permissionHandler`.
- `chat:carry-over-check delegates to ChatCarryOverService.check` and `chat:carry-over delegates
  to ChatCarryOverService.carryOver`: the exact params are passed through, the result is
  returned, and the other method is not called.
- "returns a host refusal as a result, not an RPC error": a `{ success:false, reason:
  'NOT_ELIGIBLE' }` result resolves as-is, with no Sentry capture.
- External boundary, 8 cases. Each one rejects with an `RpcUserError` whose code is
  `INVALID_PARAMS` and whose message is the fixed text. The service is never called, nothing
  goes to Sentry, and the rejected value (`'private'`) never appears in debug logs:
  - check: a non-UUID `sessionId`, an empty `workspacePath`, an extra key, no params
  - carry-over: a non-UUID `sessionId`, a non-UUID `tabId`, a `name` over 200 characters, an
    extra key

## Decisions

| Decision | Options | Evidence | Reversible |
| -------- | ------- | -------- | ---------- |
| Use `safeParse` and throw fixed-text `RpcUserError`, not `.parse()` | `.parse()` like the other chat methods, which lets the dispatcher return the ZodError text | Batch quality requirement: `RpcUserError('Invalid carry-over request', 'INVALID_PARAMS')`. Fixed text cannot echo a rejected value. This follows the `:372-385` pattern. | Yes |
| Type the injected collaborator as `Pick<ChatCarryOverService, 'check' \| 'carryOver'>` | The full class type | It matches the narrow `Pick<...>` style of the Batch 4 service and keeps the spec mock honest. The token still resolves the concrete class. | Yes |
| Wire the two methods after `agent:backgroundList` | Insert them next to the other `chat:*` methods | `METHODS` and the wire order must match (spec `:246`). The plan says to "append". | Yes |

## Plan deviations

- `chat-session-history-page.spec.ts` is not in the batch file list. Its `chat:history-page
  boundary` suite builds `ChatRpcHandlers` positionally with 9 arguments. The new required
  parameter would make that a TS2554 arity error under typecheck. I added one `{} as never`
  argument and changed nothing else.
- `chat/session/index.ts` is not in the batch file list either. I added the barrel exports
  because batch-4-report asked for them. The handler itself imports through a relative path,
  like its siblings.

## Out-of-scope observations

- `ptah_get_diagnostics` still cannot finish a scoped TypeScript check on this machine (2 of 2
  attempts unavailable, the same as in Batch 4).
- The schema file header says the chat schemas use `.passthrough()`. The two new carry-over
  schemas and the existing viewport and history-page schemas are `.strict()`. The header is
  slightly stale, and I left it unchanged.
