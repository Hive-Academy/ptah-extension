# Code Style Review — `TASK_2026_714_c8a2` (Phase P6, agent-sdk chat runtime consumer)

Range: `ef4e34932..f660c19bf` (6a a566781a5, 6c a65ff9595, 6d 8aaaa169c, 6b 027cc1a69, 6e f660c19bf).
Reviewer: Claude (code-style). Review only. No source edited, no checks run. Lint/test/typecheck
evidence is taken from the batch 6b and 6e results in batches.md (agent-sdk lint 2 known-noise
errors, no 6e file in lint output).

## Summary

| Metric          | Value          |
| --------------- | -------------- |
| Overall score   | 6/10           |
| Assessment      | NEEDS_REVISION |
| Blocking issues | 1              |
| Serious issues  | 7              |
| Minor issues    | 10             |
| Files reviewed  | 24             |

Severity mapping to the requested scale: Blocking = blocking, Serious = major, Minor = minor.

Why 6 and not 7: the new units follow the agreed plan layout (implementation-plan.md:375-376), use
public `@ptah-extension/*` aliases only (no deep `/src/` paths, no `vscode`/`electron` imports in the
new files), keep the dependency direction agent-sdk -> codex-runtime -> shared, register through
`SDK_TOKENS` `Symbol.for` constants with the existing `isRegistered(token, true)` /
`useFactory: () => null` idiom, and the specs carry no `any` casts outside the repo's mock-logger
pattern. It falls short of 7 because of one banned double cast that bypasses the store's own parser,
a stateful cache placed inside the DI registration file (which already exceeded the size limit), a
copied identity-resolution routine that has already drifted, and errors that are discarded with no
log. Why not 5: each of these has a small, local fix, and the architecture and boundaries are sound.

## Five style questions

### 1. What breaks in six months?

- A third runtime value, or a change to how live and persisted identities are reconciled, has to be
  made in two copies that already disagree. `RoutingAgentAdapter.adapter()` prefers
  `binding.persisted ?? binding.live` and sends any non-`codex-app-server` runtime to legacy
  (routing-agent-adapter.ts:168, :186). `SessionRuntimeRouter.controls()` prefers
  `binding.live ?? binding.persisted` and sends any non-`claude-sdk` runtime to native
  (session-runtime-router.ts:95, :119). Today the union has two members, so the results agree. With
  a third member the chat path and the controls path route the same session to different runtimes.
- P7/P8 callers of `updateCodexExecution` and `save` can only tell "legacy conversion",
  "binding change", "foreign workspace" and "invalid identity" apart by matching the message text.
  The store throws a plain `Error` for each (session-metadata-store.ts:830, :849, :859, :862, :902,
  :909, :912). The same file already has a coded error for the same purpose
  (`SessionAccountBindingError`, :92). Any rewording breaks the callers silently.
- The home-key rule exists twice and nothing links the copies: `isNormalizedHomeKey` in shared
  (session-runtime.schemas.ts:6-29) and `normalizeCodexHomeKey` in codex-runtime. If either one
  changes, valid homes are rejected at persistence and no test fails.

### 2. What would a new team member misread?

- `di/register.ts` reads as a wiring file. Lines 977-1117 actually contain a stateful identity cache
  (maps, sequence guards, a subscription, a write-through writer) and a metadata adapter. Someone
  looking for the routing cache will not look in DI registration. The repository already puts
  metadata subscription wiring in `lib/wiring/session-metadata-events.ts`.
- `registerCodexChatServices` is exported from the public index (index.ts:144), but
  `registerSdkServices` already calls it (register.ts:230). A host author will reasonably call it a
  second time. The second call overwrites the `instanceCachingFactory` singletons for the router and
  adapter tokens (register.ts:1142-1220).
- `CodexChatMetadataPort.save(sessionId, identity, title?)` (codex-chat-adapter.ts:41-47) promises
  a title. The only implementation drops it (register.ts:1097-1117). This is a known follow-up, but
  the interface still says the title is persisted.

### 3. What does this cost to maintain?

- Three separate derivations of an approval correlation key: `JSON.stringify(request)` for the
  release map (codex-chat-adapter.ts:235, :239), the tuple in the sink (`key()`,
  codex-chat-approval-sink.ts:206-214) and the address tuple in the router
  (session-approval-router.ts:92-98).
- Workspace-key normalization runs twice on the same write path. The lookup wrapper normalizes
  (register.ts:1078-1082) and then the store normalizes again (session-metadata-store.ts:838-841).
  Both read `process.platform` directly.
- `register.ts` grows from 959 to 1237 lines and is now further over the `max-lines` 700 warning
  (eslint.config.mjs:559-562). It is the agent-sdk composition file that every later phase edits.

### 4. Where is this inconsistent with the rest of the repository?

- `record.detail as unknown as SessionMetadata` (session-metadata-store.ts:820). Every sibling read
  of `records.get()` in the same file parses through `validateAccountLinkage(record.detail)`
  (:1080-1086, :408). The brief's rules forbid `as unknown as X`.
- `CodexChatAdapter` has no logger at all. `SdkAgentAdapter`, the sibling `IAgentAdapter`, logs
  through the injected `Logger`, and codex-runtime exposes a sanitized `CodexRuntimeLogger` port
  (codex-runtime/src/index.ts:37, codex-runtime-ports.ts:48) for exactly this "sanitized but
  diagnosable" need.
- The same function guards some tokens against pre-registration and overwrites others without a
  guard: `isRegistered` guards at register.ts:1122-1141, unconditional `container.register` at
  :1142, :1150, :1167, :1188, :1202.

### 5. What would you have done differently?

- Move `initializeSessionRuntimeIdentityLookup` and `createCodexChatMetadataPort` to their own file,
  for example `codex-app-server/session-runtime-identity-cache.ts` (or `wiring/`, beside
  `session-metadata-events.ts`), with the spec moved alongside. `register.ts` would then only bind
  tokens. This is better, not merely different, because it keeps the cache testable without the
  container and stops the composition file growing with each phase.
- Extract one `resolveSessionRuntime(binding, id): SessionRuntimeIdentity` helper next to
  `SessionRuntimeRoutingError` and use it from both routers. That gives one precedence rule and one
  runtime switch.
- Give `CodexChatAdapter` a `CodexRuntimeLogger`-shaped port and log the code and operation (never
  content) wherever it currently swallows an error.
- Export only what hosts compose with. Keep the projection, sink and choices constant internal.

## Blocking issues

### B1. Banned double cast bypasses the store's detail parser

- File: libs/backend/agent-sdk/src/lib/session-metadata-store.ts:820
- Problem: `existing = record ? record.detail as unknown as SessionMetadata : undefined;` The repo
  rule says no `as unknown as X`. `record.detail` is typed
  `Readonly<Record<string, unknown>>` (platform-core session-record-repository.interface.ts:36). Every
  other read of it in this file goes through a parser (`validateAccountLinkage`, :110, used at
  :1080-1086). The comment at :814-815 explains why the account gate is skipped. It does not explain
  why there is no validation at all.
- Impact: whatever shape is on disk flows into `existing.codexExecution`, `existing.name`,
  `existing.cliSessions` and `existing.isChildSession` (:829-878) with no type guarantee. This is the
  only path in the store that trusts persisted detail unchecked, and it is the sole writer of native
  identity.
- Fix: parse instead of casting. Use a lenient parse that skips the account gates (for example a
  `z.object({ name, createdAt, isChildSession, cliSessions, codexExecution:
  SessionRuntimeIdentitySchema.optional() }).passthrough()` subset, or a
  `parseDetailWithoutAccountGate(value: unknown)` helper beside `validateAccountLinkage`). Keep the
  existing `throw` when the parse fails.

## Serious issues

### S1. Stateful identity cache and metadata adapter live in the DI registration file

- File: libs/backend/agent-sdk/src/lib/di/register.ts:977-1117 (cache :989-1094, adapter :1097-1117)
- Problem: about 140 lines of runtime logic (four maps, a sequence guard, an `onMetadataChanged`
  subscription, a write-through writer, disposal) sit inside `register.ts`. That file was already
  959 lines before P6, against a `max-lines` warning of 700 (eslint.config.mjs:559-562), and is now
  1237 lines. The repository's place for metadata-change wiring is `lib/wiring/`
  (session-metadata-events.ts).
- Tradeoff: a dedicated file costs one import. Leaving it here makes the composition file the home
  of P7-P10 logic as well, and it hides the cache from anyone reading `codex-app-server/`.
- Recommendation: move both functions and `InitializedSessionRuntimeIdentityLookup` into
  `codex-app-server/session-runtime-identity-cache.ts`, or into `wiring/`, with a same-stem spec.
  Move the corresponding cases out of register.codex-runtime.spec.ts. Leave only token binding in
  `registerCodexChatServices`.

### S2. Identity resolution copied into two routers, and the copies have drifted

- File: libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.ts:165-187 and
  libs/backend/agent-sdk/src/lib/codex-app-server/session-runtime-router.ts:91-120
- Problem: both routers carry the same unknown/missing/sessionId/mismatch checks almost line for
  line. They differ in precedence (`persisted ?? live` at routing-agent-adapter.ts:168 against
  `live ?? persisted` at session-runtime-router.ts:95) and in their default branch
  (`=== 'codex-app-server'` at :186 against `=== 'claude-sdk'` at :119).
- Tradeoff: the copies agree today only because the runtime union has two members. One shared
  helper removes the drift and lets one spec cover both routers.
- Recommendation: export `resolveSessionRuntimeIdentity(lookup, id)` from session-runtime-router.ts,
  next to `SessionRuntimeRoutingError`. Pick one precedence and document it. Switch on `runtime`
  exhaustively, with a `never` check, so a new runtime fails to compile instead of falling through.

### S3. Errors are discarded with no log, and the adapter has no logger port

- File: libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:284-297, :364-365,
  :523-529; codex-chat-approval-sink.ts:121-128, :141-143, :169-171, :184-189
- Problem: the brief requires the injected Logger and no silent swallowing. `open()` replaces any
  failure with `runtime-failed/open`, and its cleanup `catch {}` blocks drop close and dispose errors.
  `stream()` replaces every failure, including a sanitized `CodexChatAdapterError` raised at :363,
  with `runtime-failed/turn`. `safe()` drops the cause. None of these failures is logged.
  Sanitization is the right intent (decision rows require content-free errors), but these blocks
  record nothing at all. Sibling `SdkAgentAdapter` logs through `Logger`, and codex-runtime ships
  `CodexRuntimeLogger` for sanitized logging.
- Tradeoff: one optional port in `CodexChatAdapterPorts` against no diagnostic trail when native
  chat fails in the field.
- Recommendation: add `logger: CodexRuntimeLogger` (or a `Pick<Logger,'warn'|'error'>`) to
  `CodexChatAdapterPorts`. In each catch, log the operation, the error class and the code, never
  content. In `stream()`, rethrow `CodexChatAdapterError` unchanged, the same way `safe()` does
  (:527).

### S4. New store failure paths throw plain `Error`, unlike the file's coded error

- File: libs/backend/agent-sdk/src/lib/session-metadata-store.ts:830, :849, :859, :862, :902, :909,
  :912
- Problem: seven new failure modes (legacy conversion, invalid identity, binding change, foreign
  workspace, wrong writer, provider change, account linkage on a Codex row) are all
  `new Error('<text>')`. The same file models comparable rejections with `SessionAccountBindingError`
  and a closed code union (:92).
- Tradeoff: P7 (rpc-handlers) and P8 (host composition) must map these failures to UI states. A
  coded error lets them switch on the code. Plain messages force string matching.
- Recommendation: add `SessionRuntimeMetadataError` with
  `code: 'legacy-conversion' | 'invalid-identity' | 'binding-immutable' | 'foreign-workspace' |
  'writer-restricted' | 'account-linkage'`, next to `SessionAccountBindingError`, and export it from
  the index.

### S5. The public API surface exports internals and a self-invoked registrar

- File: libs/backend/agent-sdk/src/index.ts:142-191
- Problem: P6 adds about 35 public symbols. No consumer outside agent-sdk uses any of them yet
  (grep across apps/ and libs/ finds 0 uses). Several are implementation details of
  `CodexChatAdapter`, which constructs them itself: `CodexChatEvents` (:187),
  `CodexChatApprovalSink` (:180), `CODEX_CHAT_APPROVAL_CHOICES` (:181) and
  `createCodexChatMetadataPort` (already used internally at register.ts:1218).
  `registerCodexChatServices` (:144) is already called by `registerSdkServices` (register.ts:230).
  Calling it again overwrites the cached singletons.
- Tradeoff: every exported symbol is a contract that P7-P16 can bind to. Shrinking the surface now
  is free. Shrinking it after hosts import these symbols is a breaking change.
- Recommendation: export the tokens, the port and types hosts implement (`CodexChatAdapterPorts`,
  `CodexChatApprovalPresentation`, `CodexChatEventCallbacks`, `SessionRuntimeIdentityLookup`,
  `LegacySettingsPersistence`, `LegacySessionLookup`, `LegacySlashCommands`), the error classes, and
  `initializeSessionRuntimeIdentityLookup`. Keep the projection, the sink, the choices constant, the
  metadata adapter and `registerCodexChatServices` internal until a consumer needs them.

### S6. `LegacySessionControlPorts` makes a constructor's positional order a public contract

- File: libs/backend/agent-sdk/src/lib/di/register.ts:977-979 (exported at index.ts:148), consumed
  at :1142-1148
- Problem: `type LegacySessionControlPorts = ConstructorParameters<typeof LegacySessionControls>`
  means a host must register a five-element tuple in exactly the constructor's parameter order.
  Reordering or inserting a constructor parameter breaks every host. `Pick<>`-typed slots that
  happen to be structurally compatible could even type-check in the wrong positions.
  `CodexChatAdapterPorts` (codex-chat-adapter.ts:56-83), in the same phase, uses a named-field
  interface.
- Tradeoff: a named interface costs one destructure in the factory and removes the ordering hazard.
- Recommendation: define `interface LegacySessionControlPorts { sessions; persistence;
  modelResolver; lifecycle; slash }`, take it as the `LegacySessionControls` constructor argument
  (or destructure it in the factory), and update the spec fixtures.

### S7. `CodexChatAdapter.open()` is a 125-line method with six responsibilities

- File: libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:177-301
- Problem: one method validates admission, prepares the profile, creates the scope, resolves the
  gated runtime, builds the sink, the presentation wiring and the follow-up closures (:222-260),
  saves metadata, registers the session and cleans up. Its five `let` bindings (:188-191) are
  captured by closures defined in the middle of the method (`sink!` at :233, `session` at
  :249-257). The brief requires small functions, and the rest of the file follows that: most methods
  are under 15 lines.
- Tradeoff: the cancel and generation checks (:194, :215-221, :266) are hard to verify by reading
  because the sink wiring sits between them.
- Recommendation: extract `private createSink(id, context, releases, getSession)` and
  `private assertOpenable(opening, generation)`. With that, `open()` reads as profile, scope,
  runtime, sink, save, register.

## Minor issues

- libs/shared/src/lib/types/session-runtime.schemas.ts:6-29 copies the home-key rule of
  codex-runtime's `normalizeCodexHomeKey`. The copy is justified, because shared is a leaf, but no
  test pipes `normalizeCodexHomeKey` outputs (drive root, UNC, POSIX) through
  `SessionRuntimeIdentitySchema`. Add that contract case to codex-home-path.spec.ts.
- libs/backend/agent-sdk/src/lib/auth-env.port.ts:4-14 is a hand-synchronized copy of
  auth-providers' `authOperationContextSchema` (auth-strategy.types.ts:20-31). The copy is justified,
  because auth-providers depends on agent-sdk. But method-parameter bivariance means drift may not be
  caught, `hostNativeCodex` is required here and `.default(false)` there, and the type is not
  exported from index.ts (:119 exports only `IAuthEnvProvider`, which references it). Export it, and
  add a type-level assignability check in auth-providers.
- Non-null assertions in new code: codex-chat-adapter.ts:233 (`sink!`), :256 (`session!`), :445
  (`session.turnId!`). Capture the narrowed value in a `const` instead.
- Three correlation-key derivations for one approval: codex-chat-adapter.ts:235/:239
  (`JSON.stringify(request)`), codex-chat-approval-sink.ts:206-214 and
  session-approval-router.ts:92-98. Key the release map by `SessionApprovalAddress` through the
  router's key.
- `string` where the rest of the phase uses `SessionId`: register.ts:984
  (`releaseSession(sessionId: string)`), session-metadata-store.ts:810
  (`updateCodexExecution(sessionId: string, ...)`) and codex-chat-approval-sink.ts:78.
- Workspace normalization runs twice with `process.platform` read directly: register.ts:1078-1082
  and session-metadata-store.ts:838-841. Keep the store as the single normalizer, since its JSDoc at
  :808 already calls it the only writer.
- register.ts:46 and :54 import from `'../session-metadata-store'` twice (type and value). Merge them.
- register.ts:1142, :1150, :1167, :1188, :1202 register without an `isRegistered` guard, while the
  same function guards :1122-1141. Either document that these are owned by agent-sdk and never
  overridden by a host, or guard them the same way.
- session-metadata-store.ts:953: `const metadata = merged;` aliases a parameter to avoid renaming the
  moved body. Rename the parameter instead.
- codex-chat-adapter.ts:41-47: `CodexChatMetadataPort.save(..., title?)` accepts a title that
  register.ts:1097-1117 ignores. This is a known follow-up, recorded in batches.md for 6d. Until the
  writer contract gains a title, remove the parameter or add a JSDoc note so the interface does not
  promise persistence.

Noted, not counted:

- The `codex-app-server/` folder holds runtime-neutral code (session-runtime-router.ts) and
  Claude-only code (legacy-session-controls.ts imports SDK internals at :9-12). The layout is
  plan-agreed (implementation-plan.md:375-376), so this is not a finding. It is still worth renaming
  to `session-runtime/` before P7 binds to it.
- The unformatted lines at session-metadata-store.ts:820-827 and the doubled blank line at :39-40 are
  formatter territory (lint-staged runs `nx format:write`).

## File-by-file

### codex-app-server/codex-chat-adapter.ts (531 lines)

Score 6/10. 0 blocking, 2 serious (S3, S7), 3 minor. The `IAgentAdapter` surface is complete and
typed through `Parameters<IAgentAdapter[...]>`, and the runtime comes only from
`resolveGatedCodexRuntime` (:208-212), as the plan requires. Its weaknesses are `open()` (:177-301),
errors swallowed with no logger (:284-297, :364, :523-529) and three non-null assertions.

### codex-app-server/routing-agent-adapter.ts (188 lines)

Score 7/10. 0 blocking, 1 serious (S2). A clean delegation shape. The capability default is
fail-closed (:20-22). The identity check at :165-187 duplicates session-runtime-router.ts and
differs from it.

### codex-app-server/session-runtime-router.ts (121 lines)

Score 7/10. 0 blocking, 1 serious (S2, shared). A clear error type with a closed code union
(:24-33), and the interrupt blocking is documented (:70, :86).

### codex-app-server/session-approval-router.ts (99 lines)

Score 8/10. 0 blocking, 0 serious, 1 minor (key derivation). Ownership is explicit through a
discriminated `Owner` (:16-24), and `register()` returns a release function.

### codex-app-server/codex-chat-approval-sink.ts (215 lines)

Score 7/10. 0 blocking, 1 serious (S3, shared), 1 minor. The Zod `.strict()` reply schema at the
boundary (:18-31) is correct. The silent catches at :121-128 and :184-189 should log the operation.

### codex-app-server/codex-chat-events.ts (198 lines)

Score 8/10. 0 blocking, 0 serious, 0 minor. The projection is pure and switches over the union
without a default, so a new event type fails typecheck. It is over-exported (S5) but sound in itself.

### codex-app-server/legacy-session-controls.ts (203 lines)

Score 7/10. 0 blocking, 1 serious (S6). Apply, save and rollback are factored cleanly (:165-185) and
the per-session serialization is small. The imports reach into `../helpers/...` inside the same lib,
which is acceptable.

### di/register.ts (1237 lines, +278)

Score 4/10. 0 blocking, 3 serious (S1, S5 shared, S6), 3 minor. The binding idiom matches its
siblings (`instanceCachingFactory`, nullable `useFactory: () => null`, `isRegistered(token, true)`),
but the file now holds runtime logic and has grown further past `max-lines`.

### di/tokens.ts (+10)

Score 9/10. 0 blocking, 0 serious, 0 minor. The tokens are `Symbol.for` constants in `SDK_TOKENS`,
named after their classes.

### src/index.ts (+45)

Score 5/10. 0 blocking, 1 serious (S5). The exports go through the barrel correctly, but the surface
is wider than any current consumer needs.

### session-metadata-store.ts (1915 lines, +149)

Score 5/10. 1 blocking (B1), 1 serious (S4), 3 minor. Making `updateCodexExecution` the single writer
on `enqueueWrite`, and extracting `persistMetadata`, is the right shape. The double cast and the
plain errors are not.

### auth-env.port.ts, sdk-agent-adapter.ts

Score 8/10. 0 blocking, 0 serious, 1 minor (the port's type is not exported). The context is
threaded through `initialize(context?)` with no behavior change when it is absent
(sdk-agent-adapter.ts:622).

### shared session-runtime.schemas.ts (+29), session-runtime.types.spec.ts

Score 8/10. 0 blocking, 0 serious, 1 minor (no cross-lib contract test). The new rule has no Node
dependency and comes with a thorough accept/reject table.

### Specs (codex-app-server/*.spec.ts, di/register.codex-runtime.spec.ts, legacy-runtime-auth.spec.ts, session-metadata-store.spec.ts)

Score 8/10. Each unit has a same-stem spec. The only cast is the repo-standard
`createMockLogger() as unknown as Logger` (register.codex-runtime.spec.ts:23).

## Pattern compliance

| Repository rule or nearby convention                              | Status         | Evidence                                                                                                    |
| ----------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------- |
| Imports only via `@ptah-extension/*` aliases, no deep `/src/`     | PASS           | codex-chat-adapter.ts:3-19; session-metadata-store.ts:36-38 (`shared/schemas` mapped, tsconfig.base.json:236) |
| Dependency direction agent-sdk -> codex-runtime -> shared         | PASS           | libs/backend/agent-sdk/package.json (codex-runtime dep added); no reverse import                            |
| No `vscode`/`electron` imports in new host-neutral files          | PASS           | codex-app-server/*.ts import lists                                                                          |
| Tokens are `Symbol.for` in the per-lib token object               | PASS           | di/tokens.ts:26-35                                                                                          |
| Nullable host bindings via `useFactory: () => null` + isRegistered | PASS           | register.ts:1122-1141 (matches pre-existing :220-222)                                                       |
| `container.resolve` only in composition                           | PASS           | resolves only inside register.ts factories                                                                  |
| No `as unknown as X` / `any` / `@ts-ignore` in production code    | FAIL           | session-metadata-store.ts:820                                                                               |
| Zod at boundaries                                                 | PASS           | codex-chat-approval-sink.ts:18-31; session-metadata-store.ts:833-850                                        |
| Injected logger, no silent swallowing                             | FAIL           | codex-chat-adapter.ts:284-297, :364, :523-529                                                               |
| Small files and functions; do not grow god files                  | FAIL           | register.ts 959 -> 1237 (max-lines 700); codex-chat-adapter.ts:177-301                                      |
| Minimal, well-named public API                                    | FAIL           | index.ts:142-191 (internals exported)                                                                       |
| Kebab-case filenames, same-stem specs                             | PASS           | codex-app-server/ listing; names match implementation-plan.md:375-376                                       |
| No duplication with drift                                         | FAIL           | routing-agent-adapter.ts:165-187 vs session-runtime-router.ts:91-120                                        |
| Coded domain errors (sibling `SessionAccountBindingError`)        | FAIL           | session-metadata-store.ts:830-912                                                                           |
| Port bound in each platform adapter / contract runner             | NOT_APPLICABLE | no new platform-core port                                                                                   |
| VS Code `expected-resolvable.ts` updated                          | NOT_APPLICABLE | new tokens are nullable and host wiring is P8; the list holds handler classes                               |

## Maintenance debt

- Introduced: about 280 lines of logic in register.ts; two copies of identity resolution; two
  hand-synchronized cross-lib copies (home-key rule, `AuthOperationContext`); about 35 public symbols;
  seven uncoded store errors.
- Retired: none. The P6 units are new, and the legacy path stays in `SdkAgentAdapter` by design.
- Net: debt increases, mostly on the public surface and in register.ts. Every item has a local fix
  before P7 binds to the exports.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for B1, S1, S2, S4, S5 and S6 (direct file evidence). MEDIUM for S3 and S7
  (judgment against the brief's rules and the sibling adapter).
- Key concern: the P7/P8 consumers are about to bind to an over-wide public API, a positional tuple
  port and message-only store errors. These are cheap to fix now and breaking to fix later.
- What a 10/10 version would do differently:
  - parse the record detail at session-metadata-store.ts:820 instead of double-casting it;
  - move the identity cache and metadata adapter out of register.ts into their own file with a
    same-stem spec;
  - use one `resolveSessionRuntimeIdentity` helper with an exhaustive runtime switch for both
    routers;
  - add a sanitized logger port to `CodexChatAdapterPorts` and log the code and operation in every
    catch;
  - add a coded `SessionRuntimeMetadataError` beside `SessionAccountBindingError`;
  - keep the projection, the sink, the choices constant, the metadata adapter and the registrar out
    of index.ts;
  - make `LegacySessionControlPorts` a named-field interface;
  - split `open()` into admission, sink construction and registration steps;
  - add a codex-runtime spec that pins `normalizeCodexHomeKey` outputs against the shared schema.
