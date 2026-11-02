# Code Style Re-review — `TASK_2026_714_c8a2` (Phase P6 fix round, batch 6f)

Range under review: `78e5eebcc..47e28da09` (f8dfd61cc codex-runtime + gateway-chat-bridge
`model/list`; 47e28da09 agent-sdk P6 fixes). Context range: `ef4e34932..47e28da09`.
Inputs read: code-style-review-p6.md, decisions.md rows "P6 fix 1..11", batches.md §6f, all five
batch-6f-*-report.md files. Review only: no source edited, no git operations. No lint/test run by
this reviewer. `ptah_get_diagnostics` on register.ts, codex-chat-adapter.ts,
session-runtime-identity-cache.ts and codex-runtime-composition.ts: 0 errors. Lint/test evidence is
taken from the batch 6f result in batches.md (agent-sdk lint: 2 known-noise errors in
session-query-executor.accounts.spec.ts, nothing in 6f files).

## Summary

| Metric          | Value    |
| --------------- | -------- |
| Overall score   | 7/10     |
| Assessment      | APPROVED |
| Blocking issues | 0        |
| Serious issues  | 1        |
| Minor issues    | 10       |
| Files reviewed  | 31       |

Score rationale. Above 6: the blocking cast is gone, the identity cache moved out of register.ts,
and the two routers now share one resolver with one precedence rule. Coded store errors, a named
ports interface, an injected Logger and a 44-line `open()` all landed as agreed. Below 8: the
public surface still exports two internals that the fix decision said to drop (S5 residue). The fix
also adds a small spread of new uncoded errors, a code-name drift inside the store, and a
token-usage mapping copied four times.

## Status of first-review findings

| ID | Finding | Status | Evidence |
| --- | --- | --- | --- |
| B1 | `record.detail as unknown as SessionMetadata` | **Resolved** | session-metadata-store.ts:888 now reads `validateAccountLinkage(record.detail)`, the same parser used at :1183. A scan of all added lines in the range finds no `as unknown as`, `as any`, `@ts-ignore` or `eslint-disable`. |
| S1 | Identity cache and metadata adapter in register.ts | **Resolved** | Moved to wiring/session-runtime-identity-cache.ts (132 lines) and wiring/codex-chat-metadata-port.ts (25 lines), each with a same-stem spec. register.ts shrinks 1237 → 1112 (pre-P6 959). `registerCodexChatServices` (register.ts:984-1098) now only binds tokens. The cache reads the stored value back through `store.get` (cache.ts:110-112), so it no longer normalizes a second time. |
| S2 | Identity resolution copied into two routers, with drift | **Resolved** (minor residue M1) | One `resolveSessionRuntimeIdentity` in codex-app-server/session-runtime-identity.ts:29-59, with a single precedence rule (`live ?? persisted`, :35), placed next to `SessionRuntimeRoutingError` (:17). Both routers call it (routing-agent-adapter.ts:184-189, session-runtime-router.ts:127-132), and both now default to legacy. The runtime check is still `=== 'codex-app-server'` rather than an exhaustive switch (M1). |
| S3 | Errors discarded silently; no logger port | **Resolved** (minor residue M2) | `CodexChatAdapterPorts.logger: Logger` (codex-chat-adapter.ts:70) is injected from `TOKENS.LOGGER` (register.ts:1089). Every former silent catch now logs: adapter :230, :324, :329, :499, :511; sink :117, :122, :137, :166, :182, :186. `stream()` and `safe()` rethrow `CodexChatAdapterError` unchanged (:512, :500). The messages carry no prefix and no code (M2). |
| S4 | Plain `Error` on new store failure paths | **Resolved** (minor residue M3) | `CodexSessionMetadataError` with a closed six-code union (session-metadata-store.ts:123-138) is used at every refusal site (:900-948, :990-1010) and exported (index.ts:51). |
| S5 | Public API exports internals and a self-invoked registrar | **Partial** (serious S1-R) | Removed: `registerCodexChatServices`, `CodexChatApprovalSink`, `CODEX_CHAT_APPROVAL_CHOICES`, `CodexChatEvents`, `RoutingAgentAdapter`. Routers and `LegacySessionControls` are now `type`-only (index.ts:166-185). Still exported as values: `createCodexChatMetadataPort` (index.ts:151) and the `CodexChatAdapter` class (index.ts:156). See S1-R. |
| S6 | `ConstructorParameters` tuple as a public contract | **Resolved** | Named `interface LegacySessionControlPorts` (wiring/codex-runtime-composition.ts:12-18), adapted by `createLegacySessionControls` (:20-30) and bound at register.ts:1011-1017. The constructor stays positional but is no longer public, which is the "destructure in the factory" option. |
| S7 | `open()` 125 lines, six responsibilities | **Resolved** | `open()` is codex-chat-adapter.ts:196-239 (44 lines). It reads as a sequence: `prepareProfile` (:241), `checkOpening` (:255), `createScope` (:263), `openContext` (:273), `buildSink` (:333), `persistMetadata` (:285), `publishSession` (:297), `cleanupOpen` (:317). The late-bound `sink`/`session` are passed as explicit getters (`() => sink`, `() => session`) rather than captured in the middle of the method. |
| m1 | Home-key rule copy, no contract test | **Resolved** | codex-home-path.spec.ts:7-28 pipes `normalizeCodexHomeKey` outputs (drive root, UNC, POSIX, `..` segments) through `SessionRuntimeIdentitySchema`. |
| m2 | `AuthOperationContext` not exported; no assignability check | **Partial** (accepted deferral) | Exported (index.ts:153). The cross-project assignability check is deferred to 7a/8a with a reason (batches.md §6f). |
| m3 | Non-null assertions in the adapter | **Resolved** | No `x!` in added lines. `session.turnId` is captured in a `const` (codex-chat-adapter.ts:587). |
| m4 | Three approval correlation-key derivations | **Partial** (M8) | `sessionApprovalKey` is now exported from session-approval-router.ts:19-25 and used by the adapter (codex-chat-adapter.ts:349, :360). The sink keeps its own tuple key (codex-chat-approval-sink.ts:217-225), which is a different identity scope and acceptable. The new `cancel()` adds a fourth, linear-scan matcher (:197-208). |
| m5 | `string` where the phase uses `SessionId` | **Partial** (M8) | Fixed in the store (session-metadata-store.ts:876), the sink (codex-chat-approval-sink.ts:43, :47, :80) and the cache (cache.ts:12). `SessionApprovalAddress.sessionId` (session-approval-router.ts:9) and the new `CodexApprovalOwnerSink.sessionId` (:14) are still `string`. |
| m6 | Workspace normalization twice, with `process.platform` read directly | **Partial** (M9) | The register.ts wrapper is gone. The store still holds two workspace rules that read `process.platform` (session-metadata-store.ts:319-322, :921-924). |
| m7 | Duplicate import of session-metadata-store in register.ts | **Resolved**, but the same pattern recurs (M6) | One import at register.ts:59. A new duplicate import of routing-agent-adapter appears at :36-39 and :47. |
| m8 | Unguarded registrations next to guarded ones | **Resolved** (documented) | JSDoc at register.ts:982-983 says SDK-owned tokens are registered once and hosts override only the guarded nullable ports. The orchestrator accepted this option (batches.md §6f). |
| m9 | `const metadata = merged` alias | **Resolved** | `persistMetadata(metadata: SessionMetadata)` (session-metadata-store.ts:1051). |
| m10 | `title?` promises persistence | **Resolved** | JSDoc at codex-chat-adapter.ts:54 states the title is not persisted yet. |

## Five style questions

### 1. What breaks in six months?

- A third member of `SessionRuntimeIdentity['runtime']` compiles silently and routes to legacy in
  both routers, because each router compares against one literal (routing-agent-adapter.ts:185-188,
  session-runtime-router.ts:128-131). The precedence drift is gone. The missing exhaustiveness is
  the only part of the original S2 risk that remains.
- A host that calls `createCodexChatMetadataPort(store)` with the raw store, not the initialized
  lookup, persists native identity without updating the routing cache. Only a JSDoc line warns
  against it (codex-chat-metadata-port.ts:4), and the factory is public (index.ts:151). The DI
  factory already wires it correctly (register.ts:1093).
- Any caller of the composition guard can only detect its failure by string-matching "Runtime ports
  must be bound". The spec already does this (codex-runtime-composition.spec.ts:23-28), and the text
  exists in two copies (codex-runtime-composition.ts:48, :60).

### 2. What would a new team member misread?

- `wiring/codex-runtime-composition.ts` holds the Claude legacy-controls factory and the
  native-composition guard. The file name says "codex", but most of its content is the legacy
  (Claude) port shape (:1-30).
- In one file, `SessionAccountBindingError` uses the code `'unavailable-storage'`
  (session-metadata-store.ts:116, :142) and `CodexSessionMetadataError` uses
  `'storage-unavailable'` (:129) for the same condition. A reader switching on codes will get one of
  them wrong.
- `CodexChatAdapter` is resolved and typed as a `NativeChatAdapter` (register.ts:1040), but the class
  declares only `implements IAgentAdapter` (codex-chat-adapter.ts:114). The `listSessionModels`
  contract is satisfied structurally and is invisible at the declaration.

### 3. What does this cost to maintain?

- The rule "both input and output tokens are defined, so emit `{input, output}`" is written four
  times: codex-chat-events.ts:185-196 and :232-241, codex-chat-adapter.ts:418-422 and :473-477. If
  the usage shape changes, all four must be edited.
- Seven new plain-`Error` sites in host-facing wiring (cache.ts:104, :114;
  codex-chat-metadata-port.ts:12; codex-runtime-composition.ts:48, :60) sit beside three new coded
  error classes. That is cheap now and tends to grow.
- register.ts is still 1112 lines against the 700 `max-lines` warning. It shrank in this round,
  so this is noted, not counted.

### 4. Where is this inconsistent with the rest of the repository?

- Log messages: the sibling `SdkAgentAdapter` logs `'[SdkAgentAdapter] …'` with the error as
  context (sdk-agent-adapter.ts:317-320, :537-540). The new cache follows the `[AgentSDK]` prefix
  (cache.ts:71), but the adapter and the sink log bare sentences with no prefix and no
  `CodexChatAdapterError.code` (codex-chat-adapter.ts:230, :511; codex-chat-approval-sink.ts:117).
  Dropping the raw error is the agreed sanitization. Dropping the code and the error name is not
  required by it.
- `CodexSessionMetadataError(code, message)` takes a free-form message. The sibling
  `SessionAccountBindingError(code)` derives the message from the code (session-metadata-store.ts:117).
- Spec logger helper: `mockLogger()` builds `Object.assign(Object.create(Logger.prototype),
  createMockLogger())` (codex-chat-adapter.spec.ts:52-54 and three other copies). This follows
  existing agent-sdk precedent (permission/host-attention-coordinator.spec.ts:87,
  helpers/subagent-budget-stop-callback-registry.spec.ts:7). It avoids the `as unknown as` that the
  dominant `asLogger` bridge uses (helpers/history/agent-correlation.service.spec.ts:31). See
  "Spec helper check" below.

### 5. What would you have done differently?

- Drop the value exports of `createCodexChatMetadataPort` and `CodexChatAdapter`, keeping a
  `type CodexChatAdapter` export if hosts need the name. The factory in register.ts:1080-1097 is
  then the only way to build the adapter, and logger, approvals and the cache-backed metadata port
  cannot be bypassed. This is better, not merely other: the wiring report itself says "the internal
  factory supplies approvals, metadata write-through and logger" (batch-6f-wiring-report.md, host
  contract item 4). A public constructor contradicts that.
- Replace both ternaries with one helper,
  `selectByRuntime(identity, { 'claude-sdk': a, 'codex-app-server': b })`, in
  session-runtime-identity.ts. Its object-literal key check makes a new runtime fail to compile.
- Add one `tokenUsage(usage): {input, output} | undefined` helper in codex-chat-events.ts and use it
  at all four sites.

## Blocking issues

None. Checked: no new banned casts or suppressions in the added lines. No `console.*`. No
deep relative import into another lib's `src/`. The new imports go through barrels
(`@ptah-extension/shared`, `@ptah-extension/shared/schemas`, `@ptah-extension/codex-runtime`,
`@ptah-extension/vscode-core`). Type-only `Logger` from vscode-core is the established agent-sdk
pattern (107 non-spec agent-sdk files import vscode-core already) and is no new leak.

## Serious issues

### S1-R. Two internals remain value exports in the agent-sdk public API (S5 residue)

- File: libs/backend/agent-sdk/src/index.ts:151 (`createCodexChatMetadataPort`), :156
  (`CodexChatAdapter`)
- Problem: decision "P6 fix 10" says "index.ts exports cut to what 8a/8d/8e need (no
  registerCodexChatServices, no internals)". Both symbols are built only inside
  `registerCodexChatServices` (register.ts:1080-1097), and no file outside agent-sdk uses them
  (a grep of apps/ and libs/ finds 0 uses). The wiring report lists them under "Values/factories"
  but names no consumer. `createCodexChatMetadataPort` is correct only when it is given the
  initialized lookup (JSDoc, codex-chat-metadata-port.ts:4). Given the raw store, it type-checks,
  because both satisfy `Pick<SessionMetadataStore, 'updateCodexExecution'>`, but it skips the
  routing-cache write-through.
- Tradeoff: removing both now is free because there are no consumers. Removing them after P8 hosts
  import them is a breaking change, and until then a misuse path stays open.
- Recommendation: remove `createCodexChatMetadataPort` from index.ts. Change `CodexChatAdapter` to a
  `type` export (as was done for `SessionRuntimeRouter`/`SessionApprovalRouter`/
  `LegacySessionControls`, index.ts:166-185). Keep `CodexChatAdapterError` as a value.

## Minor issues

- **M1** Non-exhaustive runtime selection, written twice: routing-agent-adapter.ts:184-189 and
  session-runtime-router.ts:127-132. Both use `?.runtime === 'codex-app-server' ? native : legacy`.
  Use a keyed map or a switch with a `never` default in session-runtime-identity.ts.
- **M2** Log lines without the sibling prefix or a code: codex-chat-adapter.ts:230, :324, :329,
  :499, :511; codex-chat-approval-sink.ts:117, :122, :137, :166, :182, :186. Add
  `[CodexChatAdapter]` and `{ code, operation, errorName }` as context. That stays content-free.
- **M3** Error-code naming drift in one file: `'storage-unavailable'` (session-metadata-store.ts:129)
  against `'unavailable-storage'` (:116, :142, :852). The free-form `message` parameter (:136)
  also differs from the sibling, whose message is derived from the code (:117).
- **M4** New uncoded `Error`s in host-facing wiring: session-runtime-identity-cache.ts:104, :114;
  codex-chat-metadata-port.ts:12; codex-runtime-composition.ts:48 and :60 (the same literal twice;
  the spec string-matches it at codex-runtime-composition.spec.ts:23-28). Hoist the guard message
  to one constant at least. A small coded error would match the three classes this phase added.
- **M5** wiring/codex-runtime-composition.ts mixes two responsibilities under a codex-specific name:
  the Claude legacy-controls port and factory (:12-30) and the native composition guard (:33-65).
  Split them, or rename the file to `session-runtime-composition.ts`.
- **M6** Duplicate import of one module in register.ts: `type { RuntimeAdmissionPort,
  NativeChatAdapter }` at :36-39 and `{ RoutingAgentAdapter }` at :47, both from
  `../codex-app-server/routing-agent-adapter`. This is the same pattern the first review flagged,
  moved to a new module.
- **M7** The token-usage projection is duplicated four times: codex-chat-events.ts:185-196,
  :232-241; codex-chat-adapter.ts:418-422, :473-477. `project()` also takes an inline anonymous
  `base` type (codex-chat-events.ts:93-99). Name it.
- **M8** Approval identity is still loose. `SessionApprovalAddress.sessionId` and the new
  `CodexApprovalOwnerSink.sessionId` are `string` (session-approval-router.ts:9, :14).
  `CodexChatApprovalSink.cancel()` matches by a linear scan with `String(requestId)`
  (codex-chat-approval-sink.ts:197-208) instead of a key lookup.
- **M9** The store has two workspace-key rules that read `process.platform`. The local
  `normalizeWorkspaceId` (session-metadata-store.ts:319-322) lowercases and trims. The
  `normalizeCodexWorkspaceKey(…, process.platform)` call (:921-924) uses `path.normalize` semantics.
  Inject the platform once, or document why comparison and persistence use different rules.
- **M10** `CodexChatAdapter` declares `implements IAgentAdapter` (codex-chat-adapter.ts:114), but
  it is resolved as `NativeChatAdapter` (register.ts:1040). Declare
  `implements NativeChatAdapter` so `listSessionModels` (:401) is tied to the contract at the
  declaration.

Noted, not counted:

- register.ts is 1112 lines, still over the 700 `max-lines` warning, but down 125 in this round
  (the brief's "must not grow" holds). codex-chat-adapter.ts grew 531 → 686, mostly from the S7
  helpers and `listSessionModels`. It is under 700 but is the next file to watch.
- The session-metadata-store.ts diff carries formatter churn on pre-existing lines
  (accountBindingSchema, `SessionAccountBindingError`). This is formatter territory.
- Routed to code-logic-reviewer, not a style finding: `RuntimeContext.listModels()`
  (codex-runtime.ts:671-708) converts its own "pagination limit"/repeated-cursor error into
  `onFailure()` plus a generic error. A catalog quirk therefore fails the context. There is also the
  batch's open note on `CodexModelInfo.id` = wire `Model.id` against `Model.model`. The new
  `model/list` schema itself (codex-protocol-methods.ts:108-158) follows the strict-object style of
  its siblings in the same table, and `listModels()` uses the file's sanitized plain-Error idiom
  (cf. :562, :590, :734).
- The folder rename `codex-app-server/` → `session-runtime/` is deferred with a reason
  (batches.md §6f).

## Spec helper check (task 3)

- `mockLogger()` in codex-chat-adapter.spec.ts:52-54, codex-chat-approval-sink.spec.ts:33-35,
  session-runtime-identity-cache.spec.ts:11-13 and register.codex-runtime.spec.ts:14-16 builds a
  `Logger`-prototyped object carrying `createMockLogger()`'s `jest.fn`s. Precedent in agent-sdk:
  permission/host-attention-coordinator.spec.ts:87 and
  helpers/subagent-budget-stop-callback-registry.spec.ts:7 use `Object.create(Logger.prototype)`.
  The other common pattern is a per-file `asLogger(mock)` bridge that uses `as unknown as Logger`
  (10 files, for example helpers/history/agent-correlation.service.spec.ts:31). Per-file helpers are
  the norm, so four local copies match the repository. The chosen shape avoids the banned double
  cast. **Conforms.**
- Small tradeoff, not counted: `Object.create` returns `any`, so the declared `Logger` return type
  is not checked against the mock, and the `jest.Mocked` handle is lost. Assertions such as
  `expect(logger.warn)` (session-runtime-identity-cache.spec.ts:219) still work at runtime. If a
  shared helper is ever extracted, return `{ logger: Logger; mock: MockLogger }`.
- Other spec conventions hold. `jest.Mocked<CodexContext>` fixtures (codex-chat-adapter.spec.ts:58),
  child containers per test (codex-runtime-composition.spec.ts:17) and `reflect-metadata` imports
  match the register.*.spec.ts siblings.

## File-by-file

### codex-app-server/session-runtime-identity.ts (59, new)

Score 8/10. 0 blocking, 0 serious, 1 minor (M1, shared). One resolver, one precedence rule and one
coded error, next to the lookup port it consumes (:7-15). The comment at :28 states why a missing
binding is not an error.

### codex-app-server/session-runtime-router.ts (74, −47)

Score 8/10. 0/0/1 (M1). It now only delegates. The release and follow-up gating are explicit
(:115-125).

### codex-app-server/routing-agent-adapter.ts (190)

Score 8/10. 0/0/1 (M1). `RuntimeAdmissionPort` is a small named port (:12-16). The comment at :79
states why an admission failure propagates.

### codex-app-server/codex-chat-adapter.ts (686, +155)

Score 7/10. 0/0/4 (M2, M7, M10, plus the S1-R export). `open()` decomposition is clean
(:196-323), and every catch logs. Weak points are the bare log text and the usage-mapping copies.

### codex-app-server/codex-chat-approval-sink.ts (226)

Score 7/10. 0/0/2 (M2, M8). The timeout constructor argument is replaced by the Logger, matching
decision P6 fix 6. `cancel()` duplicates key matching.

### codex-app-server/session-approval-router.ts (105)

Score 8/10. 0/0/1 (M8). `sessionApprovalKey` is exported and reused. The `CodexApprovalOwnerSink`
port (:13-18) removes the type dependency on the concrete sink class. That is a real improvement.

### codex-app-server/codex-chat-events.ts (262, +64)

Score 7/10. 0/0/1 (M7). `project()` is split from the `message_start` framing (:77-90). The switch
stays exhaustive.

### wiring/session-runtime-identity-cache.ts (132, new)

Score 7/10. 0/0/1 (M4). It lives beside session-metadata-events.ts as recommended, has a same-stem
spec, and uses the `[AgentSDK]` log prefix (:71). It is still one long closure. That is acceptable
at this size.

### wiring/codex-chat-metadata-port.ts (25, new)

Score 7/10. 0/1/1 (S1-R, M4). It is small and correct when given the lookup. The public value export
is the problem.

### wiring/codex-runtime-composition.ts (65, new)

Score 6/10. 0/0/2 (M4, M5). The guard is documented as a startup contract, not a revocation
mechanism (tokens.ts:28-31), which is honest. The file has two responsibilities and a duplicated
message.

### di/register.ts (1112, −125)

Score 7/10. 0/0/1 (M6). `registerCodexChatServices` only binds now. The guarded nullable ports loop
(:999-1006) and the doc comment (:982-983) settle the old guard inconsistency.

### di/tokens.ts (+6)

Score 9/10. 0/0/0. `RUNTIME_ADMISSION_PORT` is a `Symbol.for` inside `SDK_TOKENS`. The composition
order is documented on the token itself (:28-31, :39).

### src/index.ts (agent-sdk)

Score 6/10. 0/1/0 (S1-R). It is much tighter than in the first review. Two value exports remain.

### session-metadata-store.ts (2013, +98 net) and spec

Score 7/10. 0/0/2 (M3, M9). B1 and S4 are properly fixed, and the alias is removed. There is
code-name drift with the sibling error and two workspace rules.

### codex-runtime: codex-protocol-methods.ts, codex-runtime.ts, codex-runtime.types.ts, src/index.ts

Score 8/10. 0/0/0. `model/list` is added in the same strict-schema table. `CodexModelInfo` is
readonly, and the barrel exports it type-only (src/index.ts:24), matching its neighbours. Behaviour
notes are routed to logic.

### Specs (adapter, sink, events, routers, identity, cache, metadata port, composition, register, store)

Score 8/10. 0/0/0. Same-stem specs exist for every new implementation file, and the logger helper
follows precedent (see "Spec helper check").

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| No new `as any` / `@ts-ignore` / `as unknown as` | PASS | scan of added lines in `78e5eebcc..47e28da09` (0 hits); session-metadata-store.ts:888 |
| Cross-lib imports via barrels / secondary entry points | PASS | session-metadata-store.ts:37 (`@ptah-extension/shared/schemas`); codex-chat-adapter.ts:4-22 |
| Runtime logic outside DI registration files | PASS | wiring/session-runtime-identity-cache.ts; register.ts:984-1098 binds only |
| Metadata-change wiring lives in `lib/wiring/` | PASS | wiring/session-runtime-identity-cache.ts beside wiring/session-metadata-events.ts |
| Tokens are `Symbol.for` in a token object | PASS | tokens.ts:40 |
| Nullable host ports registered with `useFactory: () => null` behind `isRegistered(token, true)` | PASS | register.ts:999-1006 |
| Injected Logger, no silent catch, no `console.*` | PASS (with M2) | codex-chat-adapter.ts:230, :324, :329; codex-chat-approval-sink.ts:117-186 |
| Coded errors for caller-distinguishable failures | PARTIAL | session-metadata-store.ts:123-138 PASS; cache.ts:104, :114, composition.ts:48, :60 plain |
| Ports as named interfaces, not positional tuples | PASS | codex-runtime-composition.ts:12-18 |
| Public API minimal, no internals | FAIL | index.ts:151, :156 |
| Branded `SessionId` across the phase | PARTIAL | session-approval-router.ts:9, :14 |
| Same-stem spec for each new file | PASS | wiring/*.spec.ts, session-runtime-identity.spec.ts |
| `max-lines` (700 warn) not worsened | PASS | register.ts 1237 → 1112; new files ≤ 132 |
| Spec mocks avoid double casts and follow local precedent | PASS | codex-chat-adapter.spec.ts:52-54; host-attention-coordinator.spec.ts:87 |

## Maintenance debt

- Introduced: 3 small wiring files, 1 shared resolver, 1 coded error class, a composition guard, and
  a `model/list` schema and method. It also adds 4 copies of the usage mapping, about 7 plain-Error
  sites and 2 leaked value exports.
- Retired: about 140 lines of runtime logic in register.ts, a drifted pair of identity resolvers, a
  public positional-tuple contract, a banned double cast, 5 public internals and every silent catch
  in the adapter and sink.
- Net: clearly down. The residue is small and local.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for the status of each finding (each was checked at the cited lines). MEDIUM for
  the overall score, because lint and tests were taken from the batch record and not re-run.
- Key concern: `createCodexChatMetadataPort` and `CodexChatAdapter` are still public values. That
  leaves a type-correct way to persist native identity without updating the routing cache. Fix it
  before 8a binds hosts to the surface (two lines in index.ts).
- What a 10/10 version would do differently:
  - Export `CodexChatAdapter` as a type only and drop `createCodexChatMetadataPort` from index.ts.
  - Select the runtime through one exhaustive helper in session-runtime-identity.ts.
  - Use one `tokenUsage()` helper for the four usage projections.
  - Add `[CodexChatAdapter]`-prefixed logs that carry `{ code, operation }`.
  - Align `storage-unavailable` with `unavailable-storage` and derive messages from codes.
  - Hoist the guard message into one constant (or a coded error), and give the legacy-controls
    factory its own file.
  - Brand `SessionApprovalAddress.sessionId` as `SessionId` and declare
    `CodexChatAdapter implements NativeChatAdapter`.
