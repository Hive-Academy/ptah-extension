# B7 review fixes report

Verdict: **PASS - every actionable B7 review finding is fixed and regression-covered.**

## Finding resolution

| Finding | Status | Change | Regression spec |
|---|---|---|---|
| Shared App Server handle corrupts concurrent reads | Fixed | `codex-account-usage.service.ts:49-50,75-84,178` adds one per-service read single-flight plus per-handle active/closing collections. A refresh arriving during a read joins it. `closeChild` is idempotent and scoped to the child that the call owns. | `codex-account-usage.service.spec.ts:171` drives three overlapping callers through one App Server and asserts identical valid results/no orphan; line 189 closes two joined callers and asserts one kill. |
| Provider-switch response can write stale state | Fixed | `provider-account-state.service.ts:11,18-30` captures generation/provider id and discards a result when either identity is stale. Signals, OnPush, and zoneless behavior remain unchanged. | `provider-account-state.service.spec.ts:28` switches provider while the RPC is deferred and proves the result stays null. |
| int64 counters lose precision | Fixed | The reviewed 0.147.0 JSON Schema declares JSON `integer` with `format: int64`. `codex-account-usage.service.ts:34,241-242` preserves the raw decimal spelling before `JSON.parse`; `codex-account.schemas.ts:12,58-65` validates and projects it to a decimal string. Backend, generated projection, shared RPC types, and dashboard all use strings, never bigint over JSON. | `codex-account-usage.service.spec.ts:212` supplies raw unquoted values above 2^53 and asserts exact strings. `provider-account-card.component.spec.ts:7` renders `9007199254740993` exactly. |
| Version child cannot be externally closed | Fixed | Every spawn is tracked in `active`; `close()` snapshots and closes all tracked handles. Natural version exit removes itself, while abort/timeout/external close kills it exactly once. | `codex-account-usage.service.spec.ts:202` holds the version process open, calls public `close()`, and asserts one kill. |
| Resolver precedence/fallback untested | Fixed | `codex-home-resolver.ts:11-21` has optional injected environment and homedir seams; production still defaults to `process.env` and `homedir()`. | `codex-home-resolver.spec.ts` has 4 tests: override precedence, `CODEX_HOME`, synthetic homedir fallback, and resolve-once after env mutation. No real home is read. |
| Strict Windows home comparison | Fixed | `codex-account-usage.service.ts:29,115` resolves both paths and compares case-insensitively on Windows. | `codex-account-usage.service.spec.ts:223` changes only the synthetic drive-letter case and remains available. |
| Stale data does not show when refresh failed | Fixed | Stale results carry `staleSince` (`codex-account-usage.service.ts:101`), the shared/backend contracts expose it, and the account card shows the refresh-failure time (`provider-account-card.component.ts:34`). | Covered by full auth-provider/dashboard suites and Angular compilation. |

The review's analytics-template merge-conflict note is informational rather than a defect; no unrelated B5/pagination file was changed.

## Final B7 file list

- `libs/backend/auth-providers-tokens/src/lib/tokens.ts`
- `libs/backend/auth-providers/package.json`
- `libs/backend/auth-providers/src/index.ts`
- `libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts`
- `libs/backend/auth-providers/src/lib/providers/codex/codex-account.schemas.ts`
- `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts`
- `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.spec.ts`
- `libs/backend/auth-providers/src/lib/providers/codex/codex-auth.service.ts`
- `libs/backend/auth-providers/src/lib/providers/codex/codex-auth.service.spec.ts`
- `libs/backend/auth-providers/src/lib/providers/codex/codex-home-resolver.ts`
- `libs/backend/auth-providers/src/lib/providers/codex/codex-home-resolver.spec.ts`
- `libs/backend/auth-providers/src/lib/providers/codex/codex-provider.types.ts`
- `libs/backend/auth-providers/src/lib/providers/codex/codex-stream-parity.spec.ts` (**also B6**)
- `libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.spec.ts`
- `libs/backend/auth-providers/src/lib/providers/codex/index.ts`
- `libs/backend/auth-providers/src/lib/providers/codex/protocol/codex-account.generated.ts`
- `libs/backend/auth-providers/src/lib/providers/register-providers.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.custom-entries.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.schema.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.schema.spec.ts`
- `libs/frontend/dashboard/src/index.ts`
- `libs/frontend/dashboard/src/lib/components/analytics-card/analytics-card.component.html`
- `libs/frontend/dashboard/src/lib/components/analytics-card/analytics-card.component.ts`
- `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts`
- `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.spec.ts`
- `libs/frontend/dashboard/src/lib/services/provider-account-state.service.ts`
- `libs/frontend/dashboard/src/lib/services/provider-account-state.service.spec.ts`
- `libs/shared/src/lib/types/rpc.types.ts`
- `libs/shared/src/lib/types/rpc/rpc-providers.types.ts`
- `.ptah/specs/TASK_2026_411/b7-code-logic-review.md`
- `.ptah/specs/TASK_2026_411/b7-report.md`
- `.ptah/specs/TASK_2026_411/b7-fixes-report.md`
- `.ptah/specs/TASK_2026_411/agent-output-root.md`

No `libs/backend/auth-providers/src/lib/translation/**` file was changed while applying B7 fixes.

## Focused verification

- `codex-account-usage.service.spec.ts`: 1 suite / **12 tests passed**.
- `codex-home-resolver.spec.ts`: 1 suite / **4 tests passed**.
- `provider-account-state.service.spec.ts`: 1 suite / **2 tests passed**.
- `provider-account-card.component.spec.ts`: 1 suite / **1 test passed**.

## Aggregate gates

- `npx nx run-many -t test -p @ptah-extension/auth-providers @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/dashboard @ptah-extension/vscode-core`: Nx header confirmed **5 projects**. Auth-providers: 40 suites / **738 tests passed**. RPC handlers: 94 suites / **2,731 tests passed**, 31 skipped. Shared: 56 suites / **1,368 tests passed**. Dashboard: 6 suites / **46 tests passed**. VS Code core: 33 suites / **530 tests passed**. Command passed.
- `npx nx run-many -t typecheck -p @ptah-extension/auth-providers @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/dashboard @ptah-extension/vscode-core ptah-extension-vscode ptah-electron ptah-cli`: Nx header confirmed **8 projects**. Command passed for all eight, including `ptah-electron`; the noted build-artifact-gate baseline failure did not occur.

Additional lint evidence: dashboard passed cleanly; shared passed with two existing max-lines warnings; auth-providers passed with four existing warnings and zero errors.

All process tests use fake local children and synthetic homes. No real profile, credential, or authenticated provider request was used.

## Residual fixes (re-review)

All four residual findings and the requested Windows negative-path coverage are fixed.

| Finding | Status | Change | Regression spec |
|---|---|---|---|
| Provider switch does not refresh the Codex card | Fixed | `provider-account-state.service.ts:18-26` invalidates the generation, clears result/loading state, and starts a Codex load only when provider identity actually changes. `provider-account-card.component.ts:47-50` owns a dependency-narrowed Angular effect; replacing the old one-shot `ngOnInit` avoids a first-mount double load and Angular destroys the watcher with the card. The existing generation/provider stale-write checks remain. | `provider-account-card.component.spec.ts:29-68` mounts on Anthropic, switches to Codex, asserts exactly one RPC and rendered activity, switches away and asserts the result is null, then destroys the card and proves later identity changes cannot load. |
| Joined caller's `AbortSignal` is ignored | Fixed | `codex-account-usage.service.ts:43-67,104-106` wraps only a joiner's wait with its own abort listener. The joiner rejects with `AbortError`; the initiating caller retains ownership of the shared child, and every settle path removes the joiner's listener. | `codex-account-usage.service.spec.ts:208-225` aborts B while A owns the deferred read: B rejects, A receives valid data, one App Server is spawned and closed once, and B's listener is removed. |
| Failed version child leaves tracking before process close | Fixed | `codex-account-usage.service.ts:191-204` no longer deletes the version child in `assertVersion`; only the spawn close listener or an explicit `closeChild` removes it. Thus public `close()` can still reach the already-killed child during the fail-to-close window. | `codex-account-usage.service.spec.ts:248-264` defers the fake child's close event, aborts the version probe, proves the child remains active, then closes the service and asserts one kill plus empty active/closing collections. |
| int64 preservation/schema fields duplicated | Fixed | `codex-account.schemas.ts:10-18,65-81` defines the summary/daily field tuples once and type-checks the schema shapes against them. `codex-account-usage.service.ts:12,34-40` derives its raw-number preservation regex from the combined exported tuple. | `codex-account-usage.service.spec.ts:276-283` compares the actual Zod summary/daily shape keys with the preservation tuple exactly. |
| Distinct Windows paths lacked negative coverage | Fixed | Production comparison remains resolved, win32 case-insensitive equality; no behavior expansion was needed. | `codex-account-usage.service.spec.ts:290-293` supplies two genuinely different synthetic Codex homes and requires `service-unavailable`. |

No file was added to the B7 file list: all six implementation/spec files above were already listed. No B6 translation file and no `.ptah/specs/TASK_2026_411/agent-output-root.md` file was changed during this pass.

Focused verification:

- `npx nx test @ptah-extension/auth-providers --testPathPatterns=codex-account-usage.service.spec.ts --runInBand`: 1 suite / **16 tests passed**.
- `npx nx test @ptah-extension/dashboard --testPathPatterns=provider-account-card.component.spec.ts --runInBand`: 1 suite / **2 tests passed**.
- Additional state/card focused run, `--testPathPatterns="provider-account-(card.component|state.service).spec.ts"`: 2 suites / **4 tests passed**.

Aggregate gates:

- `npx nx run-many -t test -p @ptah-extension/auth-providers @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/dashboard @ptah-extension/vscode-core`: Nx header confirmed **5 projects**. Auth-providers: 40 suites / **747 tests passed**. RPC handlers: 94 suites / **2,731 passed**, 31 skipped. Shared: 56 suites / **1,368 passed**. Dashboard: 6 suites / **47 passed**. VS Code core: 33 suites / **530 passed**. Command passed; shared and VS Code core were served from local cache. Jest emitted its existing worker-force-exit warning during shared, with no failed suite or test.
- `npx nx run-many -t typecheck -p @ptah-extension/auth-providers @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/dashboard @ptah-extension/vscode-core ptah-extension-vscode ptah-electron ptah-cli`: Nx header confirmed **8 projects**. All eight passed, including VS Code, Electron, and CLI. Nx emitted a process `MaxListenersExceededWarning` after success; no target failed.
- `npx nx run-many -t lint -p @ptah-extension/dashboard @ptah-extension/auth-providers`: Nx header confirmed **2 projects**. Dashboard passed cleanly. Auth-providers passed with **0 errors / 4 warnings**: the existing `provider-models.service.ts` max-lines warning and three pre-existing B6 translation warnings (two non-null assertions and one max-lines warning).
- Scoped `git diff --check`: passed.

All new process coverage uses fake child handles and synthetic resolved paths. No real profile, credential, provider endpoint, or authenticated request was accessed.
