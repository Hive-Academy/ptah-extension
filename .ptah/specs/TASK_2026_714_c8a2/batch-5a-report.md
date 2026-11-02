# Batch 5a — shared session runtime contracts

## Files changed

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/shared/src/lib/types/session-runtime.types.ts — plain readonly contracts and pure ordered mismatch helper; no Zod import. Reuses SessionId, PermissionLevel and EffortLevel.
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/shared/src/lib/types/session-runtime.schemas.ts — strict runtime identity schema, safe parser and parse outcome type, following the provider-account split.
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/shared/src/lib/types/session-runtime.types.spec.ts — acceptance, rejection, safe failure and mismatch precedence tests. Schema/parser imports use the relative schemas entry; plain contracts use the relative main index, complying with same-project Nx import rules.
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/shared/src/index.ts — additive export of the plain runtime contracts only.
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/shared/src/schemas.ts — additive export of the runtime schema module.
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/shared/src/index.zod-free.spec.ts — adds the runtime types module to the transitive Zod-free guard while preserving the existing surface guards.
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/shared/src/lib/types/permission.types.ts — optional readonly allowedDecisions field, documented as Codex-only.
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/shared/src/lib/types/messages/message-constants.ts — PERMISSION_PROMPT_CANCELLED constant.
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-5a-report.md — this report.

## Verification

After the correction, scoped ptah_get_diagnostics checked the changed types, schemas, specs and schemas entry: TypeScript compiler, clean coverage, 0 errors and 0 warnings.

Exact required command: `npm run verify -- -p @ptah-extension/shared`.

PowerShell wrapper preserves the exit code, extracts the Nx project header and prints the final 40 lines (PowerShell equivalent of `tail -40`):

```powershell
$verification = npm run verify -- -p @ptah-extension/shared 2>&1
$verificationExit = $LASTEXITCODE
$verification | Select-String 'Running target|Running targets'
$verification | Select-Object -Last 40
exit $verificationExit
```

**PASS — exit code 0.** All three tasks (lint, test, typecheck) succeeded. Scope was exactly one project: the invocation and lock-acquisition header name only `@ptah-extension/shared`. This Nx output style prints `3 tasks: 3 succeeded`, rather than a literal `Running targets ... for 1 project` header. Other project names in waiting messages identify unrelated lock holders only.

The first correction run passed tests and typecheck but failed lint on the spec's same-project package-alias import. Changed both imports to the relative index and schemas entry files, reran diagnostics (clean), then reran the required verification successfully. Eight existing lint warnings in unchanged files were left untouched. No baseline update was needed; shared tests passed without it.

Final tailed output (all captured lines, fewer than 40):

```text
> @ptah-extension/source@0.0.0 verify
> node scripts/verify.mjs -p @ptah-extension/shared

[verify 2026-10-25T15:07:56.543Z] waiting on pid 43184 [verify lint,test,typecheck (@ptah-extension/auth-providers,@ptah-extension/auth-providers-tokens)] in D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration since 2026-10-25T15:07:34.385Z (queue position 2)
[verify 2026-10-25T15:08:57.164Z] waiting on pid 43184 [verify lint,test,typecheck (@ptah-extension/auth-providers,@ptah-extension/auth-providers-tokens)] in D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration since 2026-10-25T15:07:34.385Z (queue position 2)
[verify 2026-10-25T15:09:58.062Z] waiting on pid 43184 [verify lint,test,typecheck (@ptah-extension/auth-providers,@ptah-extension/auth-providers-tokens)] in D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration since 2026-10-25T15:07:34.385Z (queue position 2)
[verify 2026-10-25T15:10:23.368Z] waiting on pid 39072 [core-lint-detail] in D:\projects\ptah-extension\.claude-worktrees\provider-accounts-p1e since 2026-10-25T15:10:23.227Z (queue position 1)
[verify 2026-10-25T15:10:35.466Z] lock acquired after 159s: verify lint,test,typecheck (@ptah-extension/shared)

 NX   3 tasks: 3 succeeded

Re-run with --output-style=static to inline logs.

  Run duration:      19.5s
  Cache:             0/3 hit (0%)
  Critical path:     10.0s (1 task)
  Recoverable time:  9.5s (49% of the run)
[verify 2026-10-25T15:10:58.905Z] lock released after 23.4s, exit code 0
```

## Validation notes

- All existing public contracts remain unchanged. PermissionRequest gains only an optional field; PermissionResponse remains untouched.
- SessionRuntimeIdentity is a readonly discriminated union. Strict schemas reject unknown versions/runtimes, extra top-level/nested keys, missing or empty Codex homes and Claude identities containing codex. Parse failures contain only a closed rejection code, never rejected data.
- Session IDs reuse the existing UUID validator and constructor. Provider/workspace/home strings must be nonempty. The mismatch helper compares providerId, workspaceId, runtime and normalizedHome in that order, intentionally ignoring sessionId.
- The main index exports only the plain runtime module. Schema/parser exports follow the existing secondary schemas entry. The new transitive guard checks even type-only relative imports for Zod dependencies.
- Shared has no new backend dependency. AppliedSettings and SessionApprovalDecision are shared-owned per P5-D2. CodexProfileSeed is credential-free, readonly data; no account-binding fields or secret-bearing inputs were added.
- No agent-adapter, RPC, host composition, frontend wiring, authentication implementation or task state documents were changed. Host typechecks belong to the team-leader.
- No any, @ts-ignore or as unknown as was introduced. Public cross-package imports use entry points; internal imports follow sibling-relative conventions.
- No install, git operation, workspace-wide check, build, serve or e2e was run.
- The original pre-correction verification exited -1 while queued for the FIFO lock; it did not verify the code. The correction run above supersedes that result.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep runtime contracts plain; expose validation through the schemas entry | Main-index schema export; separate schema module | Team-leader correction, schemas.ts header and provider-account split; avoids adding Zod to main-index consumers | Yes |
| Extend the existing transitive plain-module guard | Rely only on code review; add regression coverage | index.zod-free.spec.ts already walks all relative imports and re-exports, including type-only edges | Yes |
| Use ok/value or ok:false/code:rejected parse outcomes | Expose Zod issues; closed result | provider-account.schemas.ts parseWith pattern avoids echoing rejected boundary data | Yes |
| Validate SessionId using its existing validator before construction | Arbitrary string; existing UUID v4 contract | branded.types.ts SessionId.validate/from and the requirement to reuse SessionId | Yes |
| Keep host gating and consumer wiring outside this batch | Wire callers now; additive contracts only | P5-D4 through D6 and assigned ownership | Yes |