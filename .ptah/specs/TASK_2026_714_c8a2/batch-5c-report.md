# Batch 5c report

Implemented execution-profile selection, same-home Codex owner resolution, additive exports and colocated regression tests. No consumers changed; the parity gate stays closed. No Batch 5a/5b files were edited. No git or dependency installation commands ran.

## Files changed

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/auth-providers/src/index.ts

## Design and evidence

- `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts:122`: added resolveExecutionProfile using the shared runtime contracts. Existing Claude identities remain legacy. Native resumes require nativeCodex and validate provider, workspace and home through sessionRuntimeIdentityMismatch; failures throw AuthRequiredError without proxy fallback. New sessions select native only for openai-codex plus nativeCodex.
- `workspace-provider-profile-resolver.ts:157`: candidate workspaceId uses workspacePath, compared literally to the persisted identity. No inferred hash or focused-workspace lookup.
- `workspace-provider-profile-resolver.ts:175`: native model resolution reuses resolveModel with an empty explicit environment and Codex registry metadata. This reads no global AuthEnv and materializes no credentials; native selection does not call buildProfile, configureAuthentication or proxyPool.acquire. The injected SDK_CODEX_HOME_RESOLVER supplies home, normalized through the codex-runtime public API. Existing identity passes through unchanged.
- `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:565`: owner lookup forwards home; unknown keys use explicit home or the captured default.
- `provider-owner.resolver.ts:583`: discovery reads that same home before resolving its owner. Omitted home keeps the original zero-argument getAccountUsage call.
- `libs/backend/auth-providers/src/index.ts:45`: additive exports of CodexHomeAuthService, resolveCodexProxyPolicy, CodexProxyPolicy, ICodexOwnerKeySource.
- Colocated specs cover all consumer seeds; zero buildProfile/proxy/auth calls; unchanged global/process env; matching identity passthrough; disabled-host refusal; provider/workspace/home mismatches; legacy identity/disabled-capability profiles; legacy refusal; explicit-home unknown/known owners, default owner isolation, read caching and original omitted-home call shape.

## Verification

Scoped ptah_get_diagnostics completed: TypeScript compiler, clean coverage, 0 errors and 0 warnings across all five changed files and owning-project siblings. Prettier ran on exactly the five owned source/spec files.

Exact command from the assigned worktree (PowerShell equivalent of tail -60, retaining the log for header inspection):

```powershell
npm run verify -- -p @ptah-extension/auth-providers 2>&1 | Tee-Object -FilePath "$env:TEMP/ptah-batch5c-verify.log" | Select-Object -Last 60; exit $LASTEXITCODE
```

Verification finished with exit code **1**. Nx reported three tasks: typecheck passed, test and lint failed. Launcher and acquired-lock header name exactly @ptah-extension/auth-providers; compact Nx rendering did not print a literal "1 project" header. No other project was requested.

- Tests: 74 passed suites, 2 failed, 1 skipped; 2002 passed tests, 7 failed, 10 skipped. Neither assigned resolver spec is among failures; the reporter suppresses passing-suite names.
- Batch 5b failure, outside ownership: codex-account-usage.service.spec.ts:378, "refuses an explicit home instead of returning default-home usage", passes /other/codex-home on Windows and rejects with "Absolute Codex home required" instead of resolving service-unavailable. Left unchanged for its owner.
- Known Windows integration noise: six translation-proxy.sdk.integration.spec.ts tests fail during cleanup with EPERM/ENOTEMPTY.
- Lint reports exactly three known errors: unused persistence-sqlite dependency (package.json:9), unexpected multiline call (provider-account.store.spec.ts:132), control-character regex (provider-account.store.ts:16). All 14 warnings are outside changed files; no new lint errors or warnings in batch-owned files.
- Cached test log: C:/Users/abdal/.nx/8b7110c7390b9603/cache/terminalOutputs/14165712987154004191
- Cached lint log: C:/Users/abdal/.nx/8b7110c7390b9603/cache/terminalOutputs/1728955970238562491

Actual output tail:

```text

> @ptah-extension/source@0.0.0 verify
> node scripts/verify.mjs -p @ptah-extension/auth-providers

[verify 2026-10-25T15:10:07.393Z] waiting on pid 43184 [verify lint,test,typecheck (@ptah-extension/auth-providers,@ptah-extension/auth-providers-tokens)] in D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration since 2026-10-25T15:07:34.385Z (queue position 3)
[verify 2026-10-25T15:10:23.586Z] waiting on pid 39072 [core-lint-detail] in D:\projects\ptah-extension\.claude-worktrees\provider-accounts-p1e since 2026-10-25T15:10:23.227Z (queue position 2)
[verify 2026-10-25T15:10:34.712Z] waiting on queued pid 36672 [verify lint,test,typecheck (@ptah-extension/shared)] in D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration since 2026-10-25T15:07:56.540Z
[verify 2026-10-25T15:10:35.715Z] waiting on pid 36672 [verify lint,test,typecheck (@ptah-extension/shared)] in D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration since 2026-10-25T15:10:35.464Z (queue position 1)
[verify 2026-10-25T15:10:58.976Z] lock acquired after 52s: verify lint,test,typecheck (@ptah-extension/auth-providers)
node.exe : 
At line:1 char:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
 NX   3 tasks: 1 succeeded, 2 failed


✖ nx run @ptah-extension/auth-providers:test
  full log: C:\Users\abdal\.nx\8b7110c7390b9603\cache\terminalOutputs\14165712987154004191

✖ nx run @ptah-extension/auth-providers:lint
  full log: C:\Users\abdal\.nx\8b7110c7390b9603\cache\terminalOutputs\1728955970238562491

Re-run with --output-style=static to inline logs.

  Run duration:      2m 36s
  Cache:             0/1 hit (0%)
  Critical path:     2m 4s (1 task)
  Recoverable time:  31.0s (20% of the run)

  Recommendations:
    - Drastically reduce your run duration by sharing a cache across your team and CI → https://cloud.nx.app/connect/v3PaMZ50li.
    - Speed up or split the longest tasks on the critical path:
        @ptah-extension/auth-providers:test    2m 4s
[verify 2026-10-25T15:13:38.556Z] lock released after 159.6s, exit code 1
```

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Reuse AuthRequiredError for unsupported hosts and identity mismatches, exposing only mismatch field names. | Existing SDK error; new exported error. | Existing resolver already uses this typed error and task explicitly permits it. | Yes, before consumer migration. |
| workspaceId convention at this seam is the literal supplied workspacePath. | Path; invented hash; copy stored ID without validation. | Input provides only workspacePath; shared mismatch helper compares IDs literally; plan requires workspace mismatch refusal. Future callers must persist the same convention or extend the explicit input contract. | Yes, before P7 consumers exist. |
| Reuse credential-free resolveModel with empty environment override and Codex registry metadata. | Pure reuse; requestedModel passthrough; materialize tiers/auth first. | resolveModel delegates to ModelResolver.resolve with explicit override; no credential reads or mutations are required. Alias fallback uses Codex static model metadata. | Yes. |
| Keep zero-argument usage call when home is omitted. | No argument; empty options; home: undefined. | Original method used no arguments, and batch requires old spy/caller shape. | Yes. |

Spawner report delivered successfully. Verification failures outside this batch remain for the coordinator and Batch 5b owner; no files outside ownership were changed to address them.
