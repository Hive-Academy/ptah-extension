# Code Style Review, Phases A and B — TASK_2026_864_1376

Score: 7/10. Verdict: REVISE (no Blocking findings; two Serious, five Moderate, four Minor).

Scope: the 15 commits named in the request, reviewed through `git show` and whole-file reads of the new public surface. No nx, verify or jest was run. Runtime failure modes are left to the logic review.

## What passes

- Boundaries. `auth-providers` and `codex-runtime` are both `scope:extension` / `type:feature`. `codex-runtime` was already a declared dependency of `auth-providers` (`libs/backend/auth-providers/package.json:16`). The only dependency change is dropping `persistence-sqlite` (297faedac).
- Frontend imports use barrels only: `@ptah-extension/core`, `@ptah-extension/shared` and `@ptah-extension/chat`. No frontend file imports a backend lib.
- No `any`, `@ts-ignore` or `eslint-disable` in the non-spec production files of these commits.
- Token naming follows the neighbours: `SDK_CODEX_LOGIN: Symbol.for('SdkCodexLogin')` and `SDK_CODEX_READINESS: Symbol.for('SdkCodexReadiness')` (`auth-providers-tokens/src/lib/tokens.ts`). Both are added to `expected-resolvable.ts`.
- Shared contracts are additive and live in the domain file `rpc-auth.types.ts`. `rpc.types.ts` only gets registry entries.
- `CodexReadinessBinary` is a proper discriminated union.
- The two Codex fakes sit in `rpc-handlers/src/test-utils/codex-fakes.ts`, next to `kimi-code-fakes.ts`.
- Shared helpers moved to `providers/cli-login-output.ts` and Kimi now imports them (8b5b51c84). The Kimi duplication is removed rather than copied.

## Findings

### Serious

1. **Electron composition keeps hidden module-level mutable state.**
   - `apps/ptah-electron/src/di/codex-login-composition.ts:19-25,45`. `let created` is assigned inside the `instanceCachingFactory`. The exported `codexSignInQuitHandle` object reads it. `shutdown.ts` then takes it through a `DisposalDeps.codexSignIn` structural type.
   - Kimi's login is registered through `register-providers.ts:141` and shares the container lifecycle. Codex's shutdown reach goes through a singleton that outlives any container.
   - Tests and any second container (a smoke or replay run) share the stale `created`. `isActive()` and `stop()` are only correct while there is exactly one factory call.
   - Fix: build the service eagerly in the registration function and return or register a handle. Or register the quit handle as a token and resolve it in `main.ts`, so the lifetime follows the container.

2. **Request validation is hand-rolled where the same lib uses zod.**
   - `libs/backend/rpc-handlers/src/lib/handlers/auth/codex-readiness-method.ts:20-36`. It does five `typeof` checks and `as` casts, plus a local `TRIGGERS` array.
   - In the same change set, `provider-account-rpc.schema.ts:128-132` validates the identical `trigger` with `z.enum(['mount','follow-up','recheck'])`.
   - The same applies to `interactive-login-methods.ts` for `auth:codexLogin`. It does `raw as Record<string, unknown>` and `mode === 'device' ? 'device' : 'browser'`. That quietly coerces bad input instead of rejecting it, while the readiness method throws `INVALID_PARAMS`. Two validation policies sit in one feature.
   - Fix: put `CodexReadinessParamsSchema` and `CodexLoginParamsSchema` beside the existing schemas and use `.parse`. Derive the casts from them.

### Moderate

3. **The same literal unions are re-declared in five places, with drift risk.**
   - `ReadinessTrigger` (`shared/.../rpc-auth.types.ts:149`) is repeated in `provider-account-rpc.schema.ts:131` and in `TRIGGERS` (`codex-readiness-method.ts:7`).
   - `CodexLoginStatus`, `CodexLoginMode` and `CodexLoginErrorCode` are re-listed as `STATUSES`, `MODES` and `ERRORS` in `core/.../codex-login.ts:3-5`.
   - Outcome, source and reason `Set`s are re-listed in `codex-readiness.service.ts:10-15`.
   - `codex-fakes.ts:6,16` inlines `'browser' | 'device'` instead of `CodexLoginMode`.
   - Fix: export `as const` arrays from `@ptah-extension/shared` and derive the types from them. Then the zod enum, the runtime guards and the fakes all use one source.

4. **`CodexLoginState` is a flat bag of optionals.**
   - `rpc-auth.types.ts` (batch 1, the `CodexLoginState` interface). `status`, `errorCode`, `error`, `exitCode`, `verificationUrl` and `userCode` are independent optionals, so `status: 'succeeded'` with an `errorCode` type-checks.
   - The sibling `CodexReadinessBinary` in the same file is a discriminated union.
   - The cost shows up in `core/.../codex-login.ts:34-54`. Its `parseCodexLoginState` has to re-derive every cross-field rule by hand and uses a `-readonly` mapped type to build the result.
   - Fix: make the terminal states a union (`failed` carries `errorCode`, `awaiting-user` carries `verificationUrl`). Or accept the flat shape and say in a comment that it is intentional, mirroring Kimi.

5. **The "login in progress" predicate is duplicated.**
   - `codex-sign-in-block.component.ts:5-6` defines `isRunning` (starting, running or awaiting-user).
   - `providers-connection-setup.service.ts` (58f83c685) re-lists the same three statuses inside a nested ternary that produces `signInState`.
   - `codex-login.ts` already owns `isFinalCodexLogin`.
   - Fix: add `isActiveCodexLogin` to `codex-login.ts` and use it in both places. Replace the nested ternary with a small mapping function.

6. **A static `role` input on a custom element.**
   - `chat-view.component.html:157`, `credentials-tab.component.ts:192` and `provider-panel.component.ts:246` use `role="chosen"` or `[role]`. The block declares `role` as an input.
   - A literal `role="chosen"` attribute on `<ptah-codex-sign-in-block>` can also land on the host element as an invalid ARIA role, because Angular keeps static attributes on the DOM node.
   - It also collides in meaning with the template's own `[attr.role]`.
   - Fix: rename the input to something like `emphasis` or `relevance`.

7. **Repeated predicate in the replay sanitizer.**
   - `apps/ptah-electron/src/replay/scenario-sanitizer.ts` (314dfe114) repeats `method === 'auth:codexLogin' || method === 'auth:codexLoginCancel' || !allowedRpc.has(method)` in three places.
   - A fourth Codex method would have to be added three times.
   - Fix: add a `NEVER_REPLAYED_RPC` set and a single `isReplayableRpc(method)` helper. The same applies to the push type list.

### Minor

8. `isCodexHomeExplicitlyEmpty` is exported from the `@ptah-extension/auth-providers` barrel (`src/index.ts:115`) but is only used inside the lib (`codex-readiness.reader.ts:4`). It widens the public surface for no consumer. Keep it in `codex/index.ts` only.
9. File naming in `frontend/core`. `codex-login.ts` and `codex-commands.ts` have no role suffix, and the first clashes in name with the backend `codex-login.service`. They are pure helper modules, and `main-connection-target.ts` has the same shape, so this is consistent with its neighbour. A `codex-login-state.ts` name would read better. All six new modules are re-exported with `export *` (`core/src/index.ts:3-7`). That makes helpers like `codexLoginRank` and `acceptsCodexLogin` public API.
10. `AuthCodexLoginResponse` keeps mutable fields (`success`, `error`, `state?`) while every other new type uses `readonly`. This is defensible because the existing fields were mutable, but the new `state?` could be `readonly`.
11. Style drift in new files. `codex-fakes.ts`, `codex-login-composition.ts` and the new `interactive-login-methods.ts` branch have lines of 100 or more characters and dense one-liners, unlike the neighbouring Kimi files. This is formatter territory, so I raise it only because the files are visibly unformatted.
12. `codex-sign-in-block.component.ts` is 162 lines with a large inline template and several `@case` blocks of repeated loader markup. The Kimi progress component is the named pattern. If a third phase variant arrives, split it into a presentational part and a container.

## Five style questions (short)

1. What breaks in six months: a new Codex RPC or status needs edits in the shared type, the zod enum, the hand guard, the frontend `Set`s and the sanitizer (findings 3, 7). The module singleton in the Electron composition also breaks any second container (finding 1).
2. What a newcomer misreads: `role="chosen"` reads as ARIA (6). Codex is registered in the Electron app while Kimi is registered in `register-providers.ts` (1). `codexLoginRank` looks like a general ordering but is a guard.
3. Maintenance cost: the repeated lists and predicates above, and an `auth:codexLogin` path that coerces input differently from the readiness path.
4. Inconsistent with the repo: manual validation versus the zod schemas (2). A flat state versus the discriminated `CodexReadinessBinary` (4).
5. What I would do differently: put the enum arrays in `shared`, use zod schemas for both new RPC params, register the quit handle in the container, and add one `isActiveCodexLogin` helper. Each of these removes a place that has to be edited in step.

## Pattern compliance

| Rule | Status | Evidence |
| --- | --- | --- |
| Nx scope and type tags, dependency direction | PASS | `auth-providers/project.json:6`, `codex-runtime/project.json:6`, `auth-providers/package.json:16` |
| No deep relative imports across libs | PASS | all new cross-lib imports use `@ptah-extension/*` barrels |
| Frontend does not import backend | PASS | core and chat import only `shared` and `chat` |
| Token naming (`Symbol.for`, `SDK_` prefix) | PASS | `tokens.ts` |
| DI resolvable list updated | PASS | `expected-resolvable.ts` |
| Optional injection for host-specific services | PASS | `auth-rpc.handlers.ts` `isOptional: true` |
| Types use readonly and unions where the codebase does | PARTIAL | findings 4 and 10 |
| Request validation matches the same lib's convention | FAIL | finding 2 |
| Barrel exports limited to consumers | PARTIAL | findings 8 and 9 |
| Test fakes placed in `test-utils` | PASS | `rpc-handlers/src/test-utils/codex-fakes.ts` |
| Reuse of Kimi login helpers | PASS | 8b5b51c84 |

## Maintenance debt

- Introduced: the duplicated literal lists and predicates (3, 5, 7) and the singleton quit handle (1).
- Retired: the duplicated Kimi helper code, and `AuthStateService.codexLogin()`, which was the CLI terminal path.
- Net: slightly negative until findings 1 to 3 are addressed.

## Verdict

REVISE. No boundary or type-safety blocker. Findings 1 to 3 are cheap to fix now and expensive once more Codex methods or states exist.
