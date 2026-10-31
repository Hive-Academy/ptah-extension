# Batch 5b report

Implemented the home-aware usage boundary and DI registrations. Verification was launched once and remains queued on the machine-wide FIFO lock; this is not a test/lint pass.

## Files changed

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/auth-providers-tokens/src/lib/tokens.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/auth-providers/src/lib/providers/codex/codex-provider.types.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/auth-providers/src/lib/providers/register-providers.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/auth-providers/src/lib/providers/register-providers.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-5b-report.md (this deliverable)

## Design and evidence

- `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts:141`: inject the nullable public-index CodexAccountUsageClient, with a null constructor default preserving existing direct construction.
- Service `:149`: compare requested/default paths with normalizeCodexHomeKey and process.platform. Omitted home and lexical aliases use the existing default-home implementation.
- Service `:157`, `:170`, `:177`: other homes forward clearCache(home), currentOwnerKey(home), and read(home, {refresh, signal}); null clients return no-op/null/service-unavailable. No default-home state is used for other homes.
- The entire service suffix beginning with `const eligibility = await this.auth.getAccountUsageEligibility();` was compared against the pre-edit captured source and is byte-for-byte identical. This preserves the cache, miss backoff, flight join, owner-key construction, activity read, status mapping, and close implementation. close never closes the composition-owned client.
- `libs/backend/auth-providers/src/lib/providers/codex/codex-provider.types.ts:95`: document home-scoped usage, cache invalidation, and owner lookup; the DTO remains re-exported from the core public index. Omitted-home callers retain their signatures.
- `libs/backend/auth-providers-tokens/src/lib/tokens.ts:39`: stable Symbol.for tokens for SdkCodexHomeAuth and SdkCodexUsageClient.
- `libs/backend/auth-providers/src/lib/providers/register-providers.ts:63`: instanceCachingFactory resolves CodexHomeAuthService.forHost with the injected logger and workspace provider. This is the same ownership mechanism used by codex-auth.service.ts's constructor and codex-home-auth.service.ts:78 (WeakMap keyed by workspace provider).
- Registration `:72`: recursive isRegistered guard preserves both local and parent-container composition bindings; absent client uses the core registration.ts:62-72 nullable factory pattern.
- No parity routing was enabled, no registerCodexRuntime call was added, and no core process class was constructed in production code.
- `codex-account-usage.service.spec.ts:240` onward adds default/omitted and trailing-separator aliases, guarded Windows case aliases, explicit forwarding, null refusal, owner/cache isolation, composition-owned close, pre-aborted calls, and pending-call abort tests. Existing test bodies remain unchanged.
- `register-providers.spec.ts:15` adds shared owner, null default, stable token, and local/inherited binding preservation coverage.

## Verification

Required command launched from D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/:

```powershell
npm run verify -- -p @ptah-extension/auth-providers,@ptah-extension/auth-providers-tokens
```

Executed once with stdout/stderr captured through Tee-Object into the OS temporary file `ptah-batch-5b-verify.log` and filtered with `| tail -60`; the PowerShell tail function uses Select-Object -Last 60. No dependency installation or Git operation ran.

The command invocation names exactly the two requested projects. The Nx "2 projects" execution header has NOT appeared yet, so that header and completed test/lint results cannot yet be confirmed. The single completion check did not complete the queued run. The process remains running (exec session 94078); the coordinator should collect its final log, not launch another duplicate verification run.

Latest tailed result:

```text
> @ptah-extension/source@0.0.0 verify
> node scripts/verify.mjs -p @ptah-extension/auth-providers,@ptah-extension/auth-providers-tokens

[verify 2026-10-25T14:58:04.118Z] waiting on pid 24688 [verify lint,test,typecheck (ptah-cli,@ptah-extension/cli-agent-runtime,@ptah-extension/platform-core,@ptah-extension/rpc-handlers,@ptah-extension/core,@ptah-extension/shared,ptah-electron)] in D:\projects\ptah-extension\.claude-worktrees\provider-accounts-p1e since 2026-10-25T14:46:36.819Z (queue position 4)
[verify 2026-10-25T14:59:04.707Z] waiting on pid 24688 [verify lint,test,typecheck (ptah-cli,@ptah-extension/cli-agent-runtime,@ptah-extension/platform-core,@ptah-extension/rpc-handlers,@ptah-extension/core,@ptah-extension/shared,ptah-electron)] in D:\projects\ptah-extension\.claude-worktrees\provider-accounts-p1e since 2026-10-25T14:46:36.819Z (queue position 4)
[verify 2026-10-25T15:00:05.153Z] waiting on pid 24688 [verify lint,test,typecheck (ptah-cli,@ptah-extension/cli-agent-runtime,@ptah-extension/platform-core,@ptah-extension/rpc-handlers,@ptah-extension/core,@ptah-extension/shared,ptah-electron)] in D:\projects\ptah-extension\.claude-worktrees\provider-accounts-p1e since 2026-10-25T14:46:36.819Z (queue position 4)
```

Scoped ptah_get_diagnostics after the final source edit reports no diagnostics in the six requested files. It reports one sibling TS2322 error at `libs/shared/src/lib/types/session-runtime.types.ts:32`: the Zod discriminated-union output is not assignable to SessionRuntimeIdentity. That file belongs to the parallel lane and was not edited.

Prettier completed for the six changed source/spec files. Known Windows integration EPERM teardown and the three existing lint errors have not been observed in this run yet because execution is still queued; they are not claimed as results.

## Default-home cutover parity blockers

1. The core client has no activity read (`account/usage/read`), while the existing service returns lifetime/daily usage.
2. The core owner key derives from accountId instead of home + email. Changing it would break TASK_2026_712 owner-keyed quota rows without migration/parity work.
3. The core process enforces the pinned binary digest; default-home legacy reads currently accept the resolved native binary.

The parity gate stays closed; later composition owns real-client binding and a separately approved default-home cutover.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Delegate only explicit non-default homes; keep null refusal | Replace default reads; defer all delegation; explicit-home delegation | Authoritative P5-D1 and Task 5b.1; activity, owner-key and binary-pin differences | Yes, later composition/parity work |
| Default the added constructor client argument to null | Require every direct constructor caller to pass null; preserve existing constructors | Existing service specs and omitted-home compatibility requirement | Yes |
| Share forHost ownership and preserve existing client registrations recursively | Construct a second owner; replace composition bindings; use the specified guarded factories | CodexAuthService constructor, CodexHomeAuthService WeakMap, core nullable factory | Yes |
| Leave the shared-type diagnostic to its owning lane | Modify out-of-scope shared code; report it | Explicit file ownership and parallel shared lane | Yes, owner can fix |


## Fix round 1

Fixed invalid explicit-home handling in `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts:149`: homeKind catches normalization failures and distinguishes invalid, default, and valid explicit homes. At lines 162, 177 and 189, invalid homes return no-op, null, and service-unavailable respectively before delegation. No raw path is logged. The patch changes only classification and entry guards; the legacy default-home read/cache/activity implementation remains unchanged.

Added parameterized regression coverage at `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.spec.ts:346` using `relative/codex-home`, invalid on both Windows and POSIX. Both null and bound clients are covered across all three methods, asserting no core call and no change to the existing default-home cache or owner. The existing `/other/codex-home` refusal test remains unchanged and passes on this Windows run.

Files written this round (absolute paths):
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-5b-report.md

Scoped ptah_get_diagnostics after edits: 0 errors, 0 warnings. Prettier completed. No out-of-scope files were edited.

Exact verification command (worktree root):

```powershell
npm run verify -- -t test -p @ptah-extension/auth-providers -- --testPathPatterns=codex-account-usage
```

Executed once, with stdout/stderr captured through Tee-Object and filtered with `| tail -60` (PowerShell tail wrapper). Waited for the FIFO lock and completion. Exit code 0. Scope confirmed: the invocation names only auth-providers and Nx reports `1 task: 1 succeeded`; this output format does not emit the literal `1 project` header. No rerun was needed.

Real tailed output:

```text

> @ptah-extension/source@0.0.0 verify
> node scripts/verify.mjs -t test -p @ptah-extension/auth-providers -- --testPathPatterns=codex-account-usage

[verify 2026-10-25T15:12:28.700Z] waiting on pid 8204 [verify lint,test,typecheck (@ptah-extension/auth-providers)] in D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration since 2026-10-25T15:10:58.974Z (queue position 2)
[verify 2026-10-25T15:13:29.478Z] waiting on pid 8204 [verify lint,test,typecheck (@ptah-extension/auth-providers)] in D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration since 2026-10-25T15:10:58.974Z (queue position 2)
[verify 2026-10-25T15:13:38.585Z] waiting on queued pid 39116 [verify lint,test,typecheck (@ptah-extension/shared)] in D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration since 2026-10-25T15:11:51.842Z
[verify 2026-10-25T15:13:39.600Z] waiting on pid 39116 [verify lint,test,typecheck (@ptah-extension/shared)] in D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration since 2026-10-25T15:13:39.084Z (queue position 1)
[verify 2026-10-25T15:13:44.646Z] lock acquired after 76s: verify test (@ptah-extension/auth-providers)

 NX   1 task: 1 succeeded


Re-run with --output-style=static to inline logs.

  Run duration:      14.8s
  Cache:             0/1 hit (0%)
  Critical path:     14.7s (1 task)
  Recoverable time:  <1ms
[verify 2026-10-25T15:14:06.241Z] lock released after 21.6s, exit code 0
```
