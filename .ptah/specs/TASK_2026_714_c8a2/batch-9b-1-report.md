# Batch 9b-1 report

## Changes

- Task 9b-1.1: `libs/shared/src/lib/types/agent-adapter.types.ts:184,242` adds optional `consumer` to start and resume configs, using `Extract<RuntimeConsumer, 'chat' | 'gateway'>`. The type-only import has no reverse dependency. JSDoc defines the default and Claude behavior.
- Task 9b-1.2: `libs/shared/src/lib/types/session-runtime.types.ts:44` adds optional `nativeCodexGateway` with the gateway parity gate, dev override, and absent-is-false semantics. `nativeCodex` is unchanged.
- Task 9b-1.3: `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts:282` selects the start capability with an exhaustive consumer switch. The existing provider check remains short-circuited by the capability.
- Specs: `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.spec.ts:877-963` adds the five cases below. It checks the complete native gateway seed, exact Claude branch results, and provider lookup short-circuiting.

## Added spec cases

- `selects native Codex for a gateway turn with the gateway capability and Codex provider`
- `keeps a gateway turn on Claude when only the chat capability is enabled`
- `keeps a chat turn on Claude when only the gateway capability is enabled`
- `keeps a lane turn on Claude when both native capabilities are enabled`
- `keeps a gateway turn on Claude when the provider is not Codex`

## Deviation

The existing parameterized credential-free seed spec at `workspace-provider-profile-resolver.spec.ts:847` expected gateway and lane to start native Codex from `nativeCodex: true`. That contradicts the required gateway gate and lane behavior. I removed those two parameter values, kept its chat expectation unchanged, and added the explicit gateway and lane cases above.

## Absolute paths of files written

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\shared\src\lib\types\agent-adapter.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\shared\src\lib\types\session-runtime.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\auth-providers\src\lib\auth\workspace-provider-profile-resolver.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\auth-providers\src\lib\auth\workspace-provider-profile-resolver.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-9b-1-report.md`

No verification was run; the team leader verifies.
