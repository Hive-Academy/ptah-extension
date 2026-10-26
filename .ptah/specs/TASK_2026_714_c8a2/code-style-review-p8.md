# Code Style Review (P8 phase) — `TASK_2026_714_c8a2`

Scope: `git diff 64cad6713^..b35d78386` excluding `.ptah/specs`. Priority on the new public API and Electron DI. Read in full: `codex-runtime-composition.ts` (key ranges; the middle of `createScope` and the profile builder were only partly displayed), `codex-binding-registry.ts`, the index diffs, `codex-executable-pin.ts`, `codex-chat-event-callbacks.ts` (header), and the ipc-bridge, bootstrap, shutdown and adapter diffs. The four DI guard specs were read only through their diffs and the token census, not in full. No heavy checks were run.

## Summary

| Metric          | Value          |
| --------------- | -------------- |
| Overall score   | 6.5/10         |
| Assessment      | NEEDS_REVISION |
| Blocking issues | 0              |
| Serious issues  | 5              |
| Minor issues    | 6              |
| Files reviewed  | ~20 non-spec   |

No stated invariant is broken. The grep found no `as any`, `as unknown as`, `@ts-ignore` or `eslint-disable` in the new production code. Cross-lib imports go through barrels. Only the Electron composition root touches `vscode-core`, `rpc-handlers` and `agent-sdk` together. The serious findings are structural debt that grew in this phase.

## Five style questions

1. What breaks in six months?
   - `bindElectronCodexChat` (`codex-runtime-composition.ts:~210-455`) is one function of about 250 lines. It holds four mutable maps (`tabs`, `profiles`, `preparedTabs`, `scopes`) and monkey-patches `record.lifecycle.opened` and `.closed` after the object was already handed to `adapterPorts.sessions` (lines 429-441). Any change to session lifecycle ordering needs the whole function in your head. `controls` is referenced inside `closed` before its `const` declaration at line 457; this is correct only because of call timing.
   - `codex-chat-adapter.ts` is 823 lines (notes say 763; it grew by about 60 in this phase) against the 700 `max-lines` warning in `eslint.config.mjs:559`. Every later Codex feature lands here.
2. What would a new team member misread?
   - `ipc-bridge.ts` resolves `CODEX_CHAT_ADAPTER_PORTS` as `unknown` and duck-types `handlePermissionResponse`. That hides the real contract, which is `CodexChatHostPorts.handlePermissionResponse` (`codex-chat-host-ports.ts:67`).
   - `tabId(id)` falls back to the session id as a tab id (`composition:225`). This is silent and looks like a legitimate tab.
   - `EXPECTED_NULL_RUNTIME_TOKENS`, `EXPECTED_RUNTIME_TOKENS` and `ELECTRON_CODEX_BOUND_TOKENS` live in a file named `expected-resolvable.ts` and mix "nullable default" with "bound by Electron" semantics.
3. What does this cost to maintain?
   - A module-level mutable `Set` in `codex-binding-registry.ts:9`. Bootstrap, shutdown and tests share process-global state, so every spec that calls `bindElectronCodexChat` needs a matching dispose.
   - The `AggregateError` fan-out dispose is written twice: `codex-binding-registry.ts:27-33` and the binding's `dispose` at `composition:~305-313`, plus the scope-level one.
   - Unrelated reformatting churn in `bootstrap.ts` (the `createAttentionRendererReadiness` and `attachElectronHostAttention` hunks), `expected-resolvable.ts:29` and `rpc-surface.spec.ts` enlarges the diff and review surface for no behavioural change.
4. Inconsistent with the repo?
   - `rpc-surface.spec.ts:1-8` moves imports above the file's header doc comment and adds a top-level `it` outside the `describe`.
   - `ipc-bridge.ts` adds new `console.warn` calls (lines 413 and 423). That matches the file's own pre-existing style but not the Logger convention used by the composition and bootstrap code.
   - The ESM `require()` of the manifest JSON in a library (`codex-executable-pin.ts:6`) is unlike any sibling in `codex-runtime`; the other manifest code goes through typed imports. The documented cost is that the developer path `binaryPath` ends up in the bundle.
5. What would I do differently?
   - Split the composition into three cohesive units: a session-state holder (tabs, profiles, lifecycle), a controls and legacy-ports builder, and the scope factory. The lifecycle then becomes one object built once, not patched.
   - Export a narrow `CodexPermissionResponder` type from `agent-sdk` or `rpc-handlers` and have `ipc-bridge` resolve it typed.
   - Extract the dispose-all helper once.

## Blocking issues

None.

## Serious issues

### S1. `codex-chat-adapter.ts` is 823 lines and growing

- File: `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts` (823 lines; `max-lines` rule at `eslint.config.mjs:559`)
- Problem: the file exceeds the repo limit and gained about 60 lines in this phase (`sessions?.opened`/`closed` wiring, turn identity plumbing). The adapter mixes session registry, open/resume orchestration, turn streaming and cleanup.
- Tradeoff: the cost is real because the P8 follow-ups (compaction metadata, terminal slot, result block index) all land here.
- Recommendation: extract session-lifecycle bookkeeping (open/close/publish) or turn handling into a sibling file before more behaviour is added.

### S2. `bindElectronCodexChat` is one oversized function with patched lifecycle

- File: `apps/ptah-electron/src/di/codex-runtime-composition.ts:~210-455` (file is 595 lines)
- Problem: single responsibility is violated. Per-session state, port wiring, the legacy-settings derivation (lines 221-274, about 55 lines of inline validation) and DI registration all sit in one closure. `record.lifecycle.opened` and `.closed` are reassigned after `adapterPorts.sessions = record.lifecycle` captured the object (lines 429-441). This relies on mutation of a shared object and on `controls` being initialised later.
- Tradeoff: composing the lifecycle once (record lifecycle plus Electron side effects) removes the temporal coupling and makes the order testable.
- Recommendation: build `lifecycle = { opened, closed }` explicitly and pass it in. Move the legacy settings reader into its own function, for example in rpc-handlers next to `createLegacySessionControlPorts`, so the composition root only wires. This also resolves the known item that legacy settings derive the auth namespace from the workspace's current auth (lines 229-235).

### S3. IPC bridge resolves the Codex ports as `unknown` and duck-types

- File: `apps/ptah-electron/src/ipc/ipc-bridge.ts` (new block in the SDK permission-response branch)
- Problem: `resolve<unknown>(SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS)` followed by `'handlePermissionResponse' in codexPorts && typeof ... === 'function'`. It bypasses the repo rule of interfaces as contracts. A rename of the method fails at runtime, not at compile time. The agent-sdk port type `CodexChatAdapterPorts` does not declare the method; `CodexChatHostPorts` in rpc-handlers does.
- Recommendation: add a small exported port type (`handlePermissionResponse(response): boolean`) to the shared contract and resolve it typed. The `isRegistered(..., true)` plus null guard can stay.

### S4. Public API widened without a consumer or a narrow contract

- Files: `libs/backend/agent-sdk/src/index.ts:142-171` (`CodexChatAdapter` class, `registerCodexChatServices`), `libs/backend/rpc-handlers/src/index.ts:158-166`
- Problem:
  - The concrete `CodexChatAdapter` class is exported but no app imports it. The review list says it was exported to avoid deep relative imports, but the composition code never references the class (grep of `apps/`).
  - `registerCodexChatServices` is exported but is called only inside `register.ts:238`.
  - Both widen the barrel for no consumer. Hosts are meant to override only the nullable port tokens.
  - `CodexChatTurnIdentity` is exported correctly and is consumed by rpc-handlers.
- Recommendation: drop `CodexChatAdapter` and `registerCodexChatServices` from the barrel, or document the intended consumer. Keep the types and interfaces that cross the boundary.

### S5. Manifest loaded with `require()` in a library module

- File: `libs/backend/codex-runtime/src/lib/codex-executable-pin.ts:6`, exported at `libs/backend/codex-runtime/src/index.ts:74`
- Problem: the lint passes, but the esbuild bundle inlines the whole manifest, including the diagnostic developer `binaryPath` and method lists. The Zod projection strips them only at runtime. The module also couples a runtime-agnostic lib to CommonJS semantics.
- Recommendation: generate a minimal pin file (platform, arch, versions, hashes only) and import that, or use a typed JSON import with `resolveJsonModule` scoped to this project. The same applies to `rpc-handlers` consumers who call the new export.

## Minor issues

- `apps/ptah-electron/src/di/codex-binding-registry.ts:9`: process-global `Set`; duplicated aggregate-dispose logic (see Q3). Consider returning the handle from `bindElectronCodexChat` and having bootstrap own it.
- `apps/ptah-electron/src/activation/bootstrap.ts` (the reformat hunks), `apps/ptah-electron/src/di/expected-resolvable.ts:29`, `apps/ptah-electron/src/di/rpc-surface.spec.ts:1-8,70-75`: unrelated reformatting, and a spec `it` placed outside `describe` after moving the imports above the header comment.
- `apps/ptah-electron/src/ipc/ipc-bridge.ts:413,423`: new `console.warn` lines. This is consistent with the file but not with Logger use.
- `libs/shared/src/lib/types/branded.types.ts:~43`: `UUID_REGEX` now accepts v4 and v7 for every consumer of that regex, not only Codex thread ids. This is documented in the comment, but a Codex-specific brand or validator would keep the loosening local. Spec updated (`branded.types.spec.ts`).
- `apps/ptah-electron/src/di/codex-runtime-composition.ts:225`: `tabId` falls back to the session id (known item). Prefer returning `undefined` and letting callers skip tab-scoped delivery.
- `apps/ptah-electron/src/di/codex-runtime-composition.ts:179-190`: synchronous `readFileSync` and `execFileSync` on the Electron main thread during `createScope` (known item). This is a runtime concern for the logic reviewer; the style note is that the helper is inlined in the registration lambda instead of a named function.

## File-by-file

### apps/ptah-electron/src/di/codex-runtime-composition.ts

Score 6/10 — 0 B, 2 S (S2 and the file size), 2 M. Imports follow the barrel rule and the composition root is the right place for `vscode-core`, `rpc-handlers` and `agent-sdk`. The unit does too much (S2).

### apps/ptah-electron/src/di/codex-binding-registry.ts

Score 7.5/10 — 0 B, 0 S, 1 M. The split reflects a real boundary: shutdown must not import `rpc-handlers`. It is small and legible, but it is global state.

### apps/ptah-electron/src/activation/bootstrap.ts and shutdown.ts

Score 7/10 — 0 B, 0 S, 1 M. `bindElectronCodexChat` is called after `WEBVIEW_MANAGER` registration and before `attachElectronHostAttention`, which is the right order. Disposal is guarded by `hasElectronCodexBindings()` in both the shutdown path and `requiresDeferredDisposal`. The only issue is the unrelated reformatting.

### libs/backend/agent-sdk codex-chat-adapter.ts and index.ts

Score 6/10 — 0 B, 2 S (S1, S4), 0 M. The adapter change itself is small and well documented (`sessions` observer, turn identity). The size and the barrel widening are the issues.

### libs/backend/rpc-handlers (index.ts, codex-chat-event-callbacks.ts, codex-session-settings-record.ts, chat-message-handler.service.ts)

Score 8/10 — 0 B, 0 S, 0 M. Deps are typed with `Pick<...>`, logger errors carry real `Error` instances, and there are no casts. The callbacks file depends on `agent-sdk` only through its public barrel. Naming follows `codex-*` kebab-case with role suffixes.

### libs/backend/codex-runtime (codex-executable-pin.ts, index.ts)

Score 6.5/10 — 0 B, 1 S (S5), 0 M.

### libs/shared (branded.types.ts, payload-map.ts)

Score 8/10 — 0 B, 0 S, 1 M. `permission:prompt-cancelled` is registered in both `message-constants.ts:231` and `payload-map.ts:363`, as the typed contract requires. The UUID regex loosening is the only note.

### apps/ptah-electron/src/ipc/ipc-bridge.ts

Score 6/10 — 0 B, 1 S (S3), 1 M.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| Public-barrel-only cross-lib imports | PASS | `codex-runtime-composition.ts:5-59`, `codex-chat-event-callbacks.ts:1-14` |
| Only composition roots import host platforms and `vscode-core` | PASS | Electron composition root imports `vscode-core` TOKENS and Logger only |
| Hexagonal ports: agnostic libs depend on interfaces | PASS (with S3 caveat) | `CodexChatAdapterPorts.sessions?` observer; `ipc-bridge.ts` resolves `unknown` |
| No `as any` / `as unknown as` / `@ts-ignore` / `eslint-disable` in production | PASS | grep over the new production files returned none |
| Tokens are `Symbol.for` constants in a token object | PASS | `SDK_TOKENS.*` reuse, no new ad-hoc symbols (`HOST_ATTENTION_COORDINATOR_TOKEN` pre-existing) |
| DI census updated when the resolvable surface changes | PASS | `expected-resolvable.ts:73-99`, `rpc-surface.spec.ts`, `container.smoke.spec.ts` |
| `max-lines` 700 | FAIL | `codex-chat-adapter.ts` 823 lines; composition 595 (under the limit but one 250-line function) |
| Logger instead of console | FAIL (minor, pre-existing file) | `ipc-bridge.ts:413,423` |
| Typed webview message contract | PASS | `payload-map.ts:363`, `message-constants.ts:231` |
| Kebab-case file names with role suffixes | PASS | `codex-binding-registry.ts`, `codex-session-settings-record.ts` |
| Commit scopes in `.commitlintrc.json` | NOT_APPLICABLE | commits not reviewed here |

## Maintenance debt

- Introduced: a 250-line composition function with patched lifecycle, a process-global binding registry, an exported concrete adapter class and registration function with no consumer, a bundled manifest with diagnostic fields, and a duck-typed IPC hook.
- Retired: the deep relative imports into `agent-sdk` (replaced by public exports), the swallowed logger errors (`failed` now logs the real Error), and the duplicated message-id derivation (callbacks now match `CodexChatEvents`).
- Net: debt direction is up, mainly in the adapter file size and the composition function.

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM-HIGH (the middle of `createScope` and the DI guard spec bodies were read via diffs and excerpts, not in full)
- Key concern: the structural debt in `codex-chat-adapter.ts` (823 lines) and `bindElectronCodexChat` (one oversized function with mutated lifecycle) is growing at the exact seam that the remaining P8 follow-ups need to touch.
- What a 10/10 version would do differently:
  - Split the adapter below 700 lines by responsibility.
  - Build the session lifecycle once and compose it, instead of patching it.
  - Type the IPC permission hook through a shared port.
  - Trim the barrel to types and contracts that have consumers.
  - Ship a minimal pin file instead of inlining the whole manifest.
  - Own the binding handle in bootstrap, with no module-global `Set`.
  - Keep reformatting out of the feature diff.
