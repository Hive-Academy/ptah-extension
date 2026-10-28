# Batch 1 report - TASK_2026_719_4f64 (Contracts: auth-providers-tokens, shared)

Executor: Claude backend-developer subagent. Worktree:
`D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts`. No git state changed, no
verify run, `batches.md` / `task.md` untouched. 5 files changed (limit 6).

## Task 1.1: Additive contract types and token - COMPLETE

Every item comes from implementation-plan.md section "1. Contracts" (lines 140-166) and the B1
handoff row.

| Item | Where | Evidence |
| --- | --- | --- |
| `ClaudeCertifiedLaunchContext` (closed). Fields: `executable { command, prefixArgs, sdkExecutablePath, version, fingerprint { size, mtimeMs } }`, `env: Readonly<Record<string,string>>`, `envDigest`, `cwd`, `settingSources: readonly ('user'\|'project'\|'local')[]`, `policy { coverage, managedFile, managedDropIn, registry, remoteSignals: 'absent' }`, `accountClass: 'personal'`, `identityReference` | `provider-account-admission.port.ts` | The named sub-shapes are separate exported interfaces: `ClaudeCertifiedExecutable`, `ClaudeCertifiedExecutableFingerprint`, `ClaudeCertifiedLaunchPolicy`, `ClaudeCertifiedSettingSource`. Later batches can name them without restating the shape. The structure matches the plan exactly. |
| `ClaudeAccountNamedResolvedResourceContext.launch?` | same file | Optional, readonly. Doc comment cites D-K: it is optional only for fixture compatibility. |
| `ClaudeAccountAdmissionRequest.workingDirectory?` | same file | Optional, readonly. |
| `ClaudeAccountSelectionReader { readStoredSelection(workspaceRoot, scope): Promise<{ readonly profileId: string \| null }> }` | same file | `scope` is typed `ProviderAccountScope`, which this file already imports from `@ptah-extension/shared`. |
| `ClaudeLaunchBoundary = 'bootstrap' \| 'final'` and `ClaudeLaunchBoundaryOutcome` (`{ok:true}` \| `{ok:false; code:'unsupported-source'\|'identity-unproved'\|'route-changed'; terminated:boolean}`) | same file | Matches plan lines 156-158. |
| Token `SDK_PROVIDER_ACCOUNT_SELECTION_READER: Symbol.for('SdkProviderAccountSelectionReader')` | `tokens.ts` | Added after `SDK_PROVIDER_ACCOUNT_ACTIONS`, with a doc comment in the sibling style. |
| Barrel exports | `auth-providers-tokens/src/index.ts` | Type-only exports: `ClaudeAccountSelectionReader`, `ClaudeCertifiedExecutable`, `ClaudeCertifiedExecutableFingerprint`, `ClaudeCertifiedLaunchContext`, `ClaudeCertifiedLaunchPolicy`, `ClaudeCertifiedSettingSource`, `ClaudeLaunchBoundary`, `ClaudeLaunchBoundaryOutcome`. |
| `ProviderStartAccountSignInResult` gains `fallback?: { platform: 'win32'\|'posix'; script }` | `rpc-provider-accounts.types.ts` | Added on the `ok: true` branch through a new exported interface, `ProviderAccountSignInFallback`. `rpc.types.ts:19` re-exports it with `export *`. |
| `AgentContinueErrorCode` gains `'account_refused'` | `rpc-agents.types.ts` | Added before `'unknown'`, with a doc comment. |

Acceptance:
- All new types are exported from `auth-providers-tokens/src/index.ts`. Yes.
- Nothing has an implementer yet and nothing else changed. Yes. The token is declared only:
  nothing injects or registers it, and B8 registers it (plan line 714). This follows Rule 4.
- No new dependency edge. Yes. The only import is the existing `@ptah-extension/shared` type
  import.
- Both projects typecheck. Yes: `ptah_get_diagnostics`, scoped to the 5 files, reported
  "Errors: 0 | Warnings: 0", coverage clean.

## Files modified (absolute)

- MODIFIED D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers-tokens/src/lib/provider-account-admission.port.ts
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers-tokens/src/lib/tokens.ts
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers-tokens/src/index.ts
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/shared/src/lib/types/rpc/rpc-provider-accounts.types.ts
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/shared/src/lib/types/rpc/rpc-agents.types.ts
- CREATED this report

`git diff --stat`: 5 files, 115 insertions, 0 deletions. The change is purely additive.

## Specs that mock or pin changed members (Rule 5)

I searched for each changed member and none of these specs needs a change:

- `libs/shared/src/lib/types/rpc/rpc-provider-accounts.spec.ts:104,180`
  (`provider:startAccountSignIn`). It pins params and the method list only. `fallback` is
  optional on the result.
- `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts:61`. It pins the method name only.
- `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.spec.ts:246,294,696,717`.
  It sends params; the result type is a superset.
- `libs/backend/auth-providers/src/lib/di/register.spec.ts`,
  `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.activation.spec.ts:335` and
  `libs/backend/cli-agent-runtime/src/lib/di/register.agent-process-manager.smoke.spec.ts:358`.
  They resolve or register the existing admission and actions tokens only. None enumerates
  `AUTH_PROVIDERS_TOKENS` keys.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.spec.ts` and
  `libs/backend/agent-sdk/src/lib/session-importer.service.spec.ts`. They reference the admission
  and route types. `launch?` and `workingDirectory?` are optional, so their fixtures still compile.
- `AgentContinueErrorCode`: no spec references it. It is used in
  `agent-rpc.handlers.ts:65,1295`, which assigns the manager union
  (`agent-process-manager.service.ts:148`) to the shared union. The shared union is now a
  superset, so that assignment still compiles. B16 adds the manager-side code. No consumer under
  `apps/` references these types.
- Ambient-path pins (plan 943-953): none touched. This batch changes no runtime code.

## Risks

- Plan-validation risks that apply to B1: none is assigned to B1. All B1 changes are
  compile-time-only and additive, so the "ambient expectation drift" risk (HIGH) does not apply:
  no runtime branch changed.
- "Named path opened before its checks exist" (HIGH): nothing is opened. `launch` stays optional
  and unimplemented, and no producer exists yet.
- Rule 11 (no secret, path or URL in logs or RPC): the launch context is backend-only and kept
  out of every RPC type. The doc comments on the port say it is never logged. The RPC
  `fallback.script` doc comment states that it carries no secret, email, organization or
  directory.

## Plan deviations

None in contract shape. One addition: the nested shapes of the launch context are exported as
named interfaces (listed above) rather than inline object types. It is reversible, and the
structure is identical to the plan.

## Notes for the team-leader

- Formatting: the workspace `npx prettier` output differs from the base files in several places
  that already existed before this batch, for example
  `ClaudeAccountReservationPhase` at port line 162 and the `extends` wrapping in
  `rpc-provider-accounts.types.ts`. The new single-line union at port line 132 follows the style
  of that existing line 162. lint-staged formats staged files at commit time.
- Verification not run, per Rule 12. The batch command is
  `npm run verify -- -t lint,test,typecheck -p @ptah-extension/auth-providers-tokens,@ptah-extension/shared`
  (N = 2).
