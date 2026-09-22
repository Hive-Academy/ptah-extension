## Files changed

- `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc\rpc-auth.types.ts` — Promoted EffectiveRouteProvider, EffectiveRouteResult and SettingScope; added three RPC DTO pairs, ScopedSettingEntry and SCOPED_SETTING_KEYS.
- `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts` — Added only the three Batch A method-map entries, their type imports and boolean-table entries.
- `D:\projects\ptah-extension\libs\shared\src\index.ts` — Exported the public scope/route contracts and allowlist.
- `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\auth\effective-route.ts` — Type-only re-exports; widened every result branch with driverProviderId, retaining route/ready/blocker logic.
- `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\auth-state.service.ts` — Replaced the local SettingScope declaration with a shared type import; no other frontend change.
- `D:\projects\ptah-extension\libs\backend\settings-core\src\scope\workspace-scope-resolver.ts` — Added inspect<T>(), returning ordered defined candidates through the existing traversal and store.
- `D:\projects\ptah-extension\libs\backend\settings-core\src\scope\workspace-scope-resolver.spec.ts` — Added inspection regressions for precedence, no writes, false/null/zero/empty values, absent keys and workspace changes.
- `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\auth-rpc.handlers.ts` — Registered auth:getEffectiveRoute, reused existing status RPCs and ModelResolver, imported the moved scope parser and exposed cache invalidation for scope clears.
- `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\setting-scope.ts` — Moved the existing resolveScopeFromKey implementation unchanged into a shared local module.
- `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\config-scope-rpc.handlers.ts` — Added validated, allowlisted scope inspection and clear-only handlers with SDK reset and cache invalidation.
- `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\index.ts` — Exported ConfigScopeRpcHandlers.
- `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\index.ts` — Exported ConfigScopeRpcHandlers through the package barrel.
- `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\host-profile\manifest.ts` — Added configScope with requires: [] and the class METHODS array.
- `D:\projects\ptah-extension\apps\ptah-electron\src\di\phase-4-handlers.ts` — Registered ConfigScopeRpcHandlers as a singleton in the existing Electron handler phase.
- `D:\projects\ptah-extension\apps\ptah-electron\src\di\expected-resolvable.ts` — Added ConfigScopeRpcHandlers to the positive DI manifest.
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\phase-3-handlers.ts` — Registered ConfigScopeRpcHandlers as a singleton in the VS Code handler phase.
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\expected-resolvable.ts` — Added ConfigScopeRpcHandlers to the positive DI manifest.
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\expected-absent.ts` — Documented why ConfigScopeRpcHandlers is intentionally absent from the negative list.
- `D:\projects\ptah-extension\.ptah\specs\TASK_2026_523_c3df\batch-a-report.md` — Replaced the blocker report with implementation, verification, accepted decisions and merge notes.

## Contract

The three entries landed in RpcMethodMap:

```ts
'auth:getEffectiveRoute': {
  params: AuthGetEffectiveRouteParams;
  result: AuthGetEffectiveRouteResult;
};
'config:getScopes': {
  params: ConfigGetScopesParams;
  result: ConfigGetScopesResult;
};
'config:clearScopeOverride': {
  params: ConfigClearScopeOverrideParams;
  result: ConfigClearScopeOverrideResult;
};
```

Public DTO shapes (the route result below expands its inherited fields):

```ts
type SettingScope = 'global' | 'app' | 'workspace';

interface AuthGetEffectiveRouteParams {
  refresh?: boolean;
}
interface AuthGetEffectiveRouteResult {
  route: AuthStrategyType | 'unresolved';
  ready: boolean;
  blockers: readonly string[];
  driverProviderId: string | null;
  resolvedAuthModality: 'api-key' | 'oauth' | 'cli' | 'local' | 'unknown';
  resolvedModel: { kind: 'model'; id: string } | { kind: 'tier'; tier: ProviderModelTier } | { kind: 'unresolved' };
  storedAuthMethodDiagnostic: string | null;
  storedAuthMethodScope: SettingScope;
  providers: readonly EffectiveRouteProvider[];
  lastSuccessfulProbeAt: string | null;
  lastFailedProbeAt: string | null;
  probedAt: string;
  fromCache: boolean;
}
interface ScopedSettingEntry {
  key: string;
  scope: SettingScope;
  hasOverride: boolean;
  effectiveKey: string;
  supportedTargets: readonly SettingScope[];
  fallbackPreview: { scope: SettingScope; value: unknown } | null;
  credentialSource: 'machine-secret-store' | 'host-supplied' | 'not-a-secret';
  runtime?: string;
}
interface ConfigGetScopesParams {
  keys: readonly string[];
}
interface ConfigGetScopesResult {
  activePath: string | null;
  entries: readonly ScopedSettingEntry[];
}
interface ConfigClearScopeOverrideParams {
  key: string;
  target?: 'nearest' | 'all-above-global';
}
interface ConfigClearScopeOverrideResult {
  success: boolean;
  cleared: readonly string[];
  resolvesFrom: SettingScope;
}
```

All three methods have a typed METHODS entry, RpcMethodMap entry, and boolean-table entry. ConfigScopeRpcHandlers is also in the common runtime manifest and both host DI roots. ALLOWED_METHOD_PREFIXES was not edited.

The scope allowlist covers the exact target-key families, with explicit concrete orchestration/lane keys. Dynamic provider key families accept only the selected-model/reasoning-effort/tier suffixes and registered provider IDs; physical workspace/app keys, credential keys, placeholder literals, and unknown keys are rejected with INVALID_PARAMS. Global-only settings return global provenance and cannot have their global values deleted by this clear-only API. The allowlisted keys contain plain configuration, so credentialSource is not-a-secret.

auth:getEffectiveRoute passes the raw scopeResolver.read<string>('authMethod', true) ?? null to resolveEffectiveAuthRoute. It composes the registered auth:getAuthStatus and llm:getProviderStatus paths, preserving existing cache/coalescing/probe ceilings. refresh invalidates auth status first. A concurrent auth invalidation or workspace switch rejects the stale snapshot. Model identity uses the already-registered ModelResolver; an SDK-selected opaque default remains unresolved. No new connection/inference probe, setting write, or editor is introduced by this read.

## Verification

Runtime/tooling observed: Node 24.x, TypeScript 6, tsyringe constructor injection and Zod boundary validation, from package.json/package-lock.json and the neighboring RPC handlers. The backend is the shared host runtime, not NestJS. Imports use package barrels. The existing provider-model resolver token is reused; no new dependency registration was introduced.

Final commands and observed output excerpts are quoted below. Every listed final check exited 0.

```powershell
npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/auth-providers @ptah-extension/settings-core @ptah-extension/rpc-handlers @ptah-extension/core ptah-electron ptah-extension-vscode --parallel=2 --skip-nx-cache
```

```text
√  nx run @ptah-extension/shared:typecheck
√  nx run @ptah-extension/core:typecheck
√  nx run @ptah-extension/settings-core:typecheck
√  nx run @ptah-extension/auth-providers:typecheck
√  nx run @ptah-extension/rpc-handlers:typecheck
√  nx run ptah-electron:typecheck
√  nx run ptah-extension-vscode:typecheck

 NX   Successfully ran target typecheck for 7 projects

Output of 7 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

  Run duration:      1m 15s
  Cache:             Skipped (--skip-nx-cache)
```

```powershell
npx nx run-many -t lint -p @ptah-extension/shared @ptah-extension/auth-providers @ptah-extension/rpc-handlers @ptah-extension/core ptah-electron ptah-extension-vscode --parallel=2 --skip-nx-cache
```

```text
√  nx run @ptah-extension/core:lint
√  nx run @ptah-extension/shared:lint
√  nx run @ptah-extension/auth-providers:lint
√  nx run ptah-electron:lint
√  nx run @ptah-extension/rpc-handlers:lint
√  nx run ptah-extension-vscode:lint

 NX   Successfully ran target lint for 6 projects

Output of 6 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

  Run duration:      40.0s
  Cache:             Skipped (--skip-nx-cache)
```

settings-core has no lint target; npx nx show project @ptah-extension/settings-core --json identified its existing inferred eslint:lint target:

```powershell
npx nx run @ptah-extension/settings-core:eslint:lint --skip-nx-cache
```

```text
> nx run @ptah-extension/settings-core:"eslint:lint"

> eslint .

✖ 13 problems (0 errors, 13 warnings)
  0 errors and 4 warnings potentially fixable with the `--fix` option.

 NX   Successfully ran target eslint:lint for project @ptah-extension/settings-core
```

The warnings are in existing encryption/migration/schema/settings-core tests and v1-migration.ts; none is in the changed resolver or its spec. No automatic fixes were run.

```powershell
npx nx run @ptah-extension/settings-core:test --runInBand --testPathPatterns=workspace-scope-resolver.spec.ts --skip-nx-cache
```

```text
Test Suites: 1 passed, 1 total
Tests:       40 passed, 40 total
Snapshots:   0 total
Time:        5.763 s
Ran all test suites matching workspace-scope-resolver.spec.ts.

 NX   Successfully ran target test for project @ptah-extension/settings-core
```

```powershell
npx nx run @ptah-extension/rpc-handlers:test --runInBand --testPathPatterns="auth-rpc.handlers.spec.ts|manifest.spec.ts|rpc-allowlist.spec.ts" --skip-nx-cache
```

```text
Test Suites: 2 passed, 2 total
Tests:       1 skipped, 73 passed, 74 total
Snapshots:   0 total
Time:        48.371 s, estimated 84 s
Ran all test suites matching auth-rpc.handlers.spec.ts|manifest.spec.ts|rpc-allowlist.spec.ts.

 NX   Successfully ran target test for project @ptah-extension/rpc-handlers
```

The filter matched two suites; this is not a claim that three suites ran.

```powershell
npx nx run @ptah-extension/auth-providers:test --runInBand --testPathPatterns=effective-route.spec.ts --skip-nx-cache
```

```text
Test Suites: 1 passed, 1 total
Tests:       14 passed, 14 total
Snapshots:   0 total
Time:        8.671 s
Ran all test suites matching effective-route.spec.ts.

 NX   Successfully ran target test for project @ptah-extension/auth-providers
```

Jest printed the repository's Nx executor deprecation and TypeScript config module-loading warnings. Existing file-settings integration cases logged missing temporary settings files; their assertions still passed.

The first typecheck run failed on a newly used error code outside RpcUserErrorCode:

```text
libs/backend/rpc-handlers/src/lib/handlers/config-scope-rpc.handlers.ts(95,72): error TS2345: Argument of type '"INTERNAL_ERROR"' is not assignable to parameter of type 'RpcUserErrorCode'.
```

That code was removed. Unexpected storage/reset failures now produce a fixed, sanitized Error message, with only the error class name logged. The final typecheck above supersedes the failed run.

Post-edit ptah_get_diagnostics on rpc-auth.types.ts returned:

```text
Source: typescript-compiler
Errors: 0 | Warnings: 0 — No issues found.
```

The earlier scoped baseline diagnostic call timed out after 45 seconds; it was not claimed as a pass. LSP references were inspected before widening the route result and extending the auth constructor. No git command was run.

## Deviations

- Used Electron's existing phase-4-handlers.ts and VS Code's existing phase-3-handlers.ts, as authorized.
- Added the authorized read-only resolver inspection method and common runtime manifest entry. The scope parser was moved, not copied.
- The existing provider status RPC has no independent cache; it reads credential presence. The route handler reuses that registered implementation and the auth handler's existing caches rather than inventing probes or a parallel status implementation.
- The available status sources do not supply evidence of an inference/connection success or failure. lastSuccessfulProbeAt and lastFailedProbeAt therefore remain null; credential presence and CLI installation are not manufactured connection timestamps. probedAt is the snapshot time and fromCache describes reuse of the auth-status cache. The UI must preserve this distinction.
- Reused the existing SDK_MODEL_RESOLVER token through an optional trailing constructor dependency. Its absence in stripped harnesses yields unresolved model identity. No runtime registration or existing auth behavior changed.
- Provider tier keys in the plan are legacy keys. ProviderModelsService writes agent usage scopes through ConfigManager (provider-models.service.ts:522–530) and reads the legacy fallback at :1176–1192; these are global storage operations, not workspace writes. Their supportedTargets is therefore ['global']. No extra modern tier-key family was admitted beyond the requested target map, and the tier write path was not modified.
- There is no Electron expected-absent file. Both positive manifests were updated; the VS Code negative manifest now documents that this universally available handler must stay out of its absent list.

## Not done

- No Batch A implementation item is outstanding; required project typechecks and lint passed.
- No live-host warm-cache latency measurement or packaged-host UI smoke test was run. Those are not implied by compile/lint/unit success.
- Dedicated cross-feature behavior pins remain Batch E's assignment. Other lanes' files and draft verification methods were not edited.
- No editor, dependency package, runtime allowlist change, commit, staging, or push was created.

## Decisions taken

1. Accepted YES / option A: extend WorkspaceScopeResolver with additive inspection over the existing candidate traversal and add colocated regressions.
2. Accepted YES / option A: add configScope to RPC_HANDLER_MANIFEST with requires: [], retaining composition-root singleton registration.
3. Accepted corrections: use Electron phase 4; do not search again for deleted CLAUDE.md files; permit only the SettingScope type promotion in auth-state.service.ts under frontend.

## Merge notes

Exact line added to AuthRpcHandlers.METHODS:

```ts
    'auth:getEffectiveRoute',
```

Exact lines added to RpcMethodMap:

```ts
  'auth:getEffectiveRoute': {
    params: AuthGetEffectiveRouteParams;
    result: AuthGetEffectiveRouteResult;
  };
  'config:getScopes': {
    params: ConfigGetScopesParams;
    result: ConfigGetScopesResult;
  };
  'config:clearScopeOverride': {
    params: ConfigClearScopeOverrideParams;
    result: ConfigClearScopeOverrideResult;
  };
```

Exact lines added to the boolean table:

```ts
  'auth:getEffectiveRoute': true,
  'config:getScopes': true,
  'config:clearScopeOverride': true,
```

The associated type imports added to rpc.types.ts are:

```ts
  AuthGetEffectiveRouteParams,
  AuthGetEffectiveRouteResult,
  ConfigGetScopesParams,
  ConfigGetScopesResult,
  ConfigClearScopeOverrideParams,
  ConfigClearScopeOverrideResult,
```

Retain the other lane's auth:verifyDraftConnection and auth:cancelDraftVerification entries when merging. This batch did not add or edit either method.
