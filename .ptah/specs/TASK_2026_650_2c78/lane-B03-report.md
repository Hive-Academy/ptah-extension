# B03 lane report

Status: Complete. RPC publication, catalog mode, lifecycle guards, and host checks are verified.

## Files changed
- `libs/shared/src/lib/types/rpc.types.ts`
- `libs/shared/src/lib/types/rpc/rpc-setup.types.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/guidance-generation-run.supervisor.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.spec.ts`
- `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`
- `libs/backend/rpc-handlers/src/lib/host-profile/manifest.spec.ts`
- `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts`
- `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`
- `apps/ptah-electron/src/di/rpc-surface.spec.ts`
- `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`
## Acceptance evidence

1. Shared RPC registry and totality names: `libs/shared/src/lib/types/rpc.types.ts:1042,1215,3834,3877`.
2. Enhanced prompts registration routes cancel and lookup: `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.ts:87,122`.
3. Wizard registration routes lookup: `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts:185,222`.
4. Catalog request validation, workspace authorization, and static catalog reuse: `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.ts:500-675`.
5. Shared DI singleton registration for both supervisors: `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts:55-63`. Hosts call this shared registration; handler singletons then retain the same supervisor instance.
6. Host surface assertions: VS Code, Electron, CLI RPC surface specs. Manifest derives method lists from each handler's METHODS list; no direct manifest edit was necessary.
7. Same-workspace ownerTabId only, cross-workspace no owner/run, and tabless blocked lookup: `libs/backend/rpc-handlers/src/lib/handlers/guidance-generation-run.supervisor.spec.ts:86,98`; wizard handler equivalents at `wizard-generation-rpc.handlers.spec.ts:511`.
8. Agent and guidance supervisors run independently in both directions: `libs/backend/rpc-handlers/src/lib/handlers/guidance-generation-run.supervisor.spec.ts:20`.

## Specs added

- New `host-profile/manifest.spec.ts`: registry totality and four host identities.
- Enhanced prompts and wizard routing/registration assertions.
- Setup catalog and foreign workspace assertions.
- Allowlist and three host surface assertions.
- Supervisor independence regression in `guidance-generation-run.supervisor.spec.ts:20`; existing owner-disclosure, cancellation, and terminal-state specs were retained.

## Checks

- Prettier: pass, 14 prior files and 2 continuation specs.
- Nx typecheck/lint: pass, 8 projects and 16 targets. The prior TS2554 catalog error is resolved.
- Failing suite cause: `enhanced-prompts-rpc.handlers.spec.ts:338-339` called undefined `callRaw`; changed both calls to its existing `call` helper. The targeted suite then compiled and the 3-project gate passed.
- Nx test: pass, 3 projects. Nx confirmed `Running target test for 3 projects` and `Successfully ran target test for 3 projects`. The filtered gate output retained project counts, not per-project Jest counts. Before the fix, rpc-handlers had 1 failed suite, 160 passed suites, 4515 passed tests, and 7 skipped tests.
- Required 11-spec root Jest command: failed before tests because root config discovery could not load several project configs. Project-config fallback: pass, 11 suites and 149 tests (VS Code 2/40, Electron 3/27, CLI 4/43, CLI engine 1/13, chat 1/26).
- New independence spec: pass, 1 suite and 8 tests in its targeted project-config run.
- Scoped diagnostics: clean for the corrected enhanced-prompts spec; later two-file request timed out, while ts-jest compiled and passed the new supervisor spec.

## Singleton/DI finding

`EnhancedPromptsRpcHandlers` and `WizardGenerationRpcHandlers` are registered as singletons by `registerSharedRpcHandlers`. Both class-token supervisors are now explicitly registered as singletons there, so handler and any independent resolution share each host process instance.

## Final line counts of changed source files
- `libs/shared/src/lib/types/rpc.types.ts`: 4262 lines
- `libs/shared/src/lib/types/rpc/rpc-setup.types.ts`: 627 lines
- `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.ts`: 1138 lines
- `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.spec.ts`: 1069 lines
- `libs/backend/rpc-handlers/src/lib/handlers/guidance-generation-run.supervisor.spec.ts`: 180 lines
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts`: 1705 lines
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts`: 2593 lines
- `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.ts`: 1420 lines
- `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.spec.ts`: 1739 lines
- `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`: 112 lines
- `libs/backend/rpc-handlers/src/lib/host-profile/manifest.spec.ts`: 62 lines
- `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts`: 141 lines
- `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`: 227 lines
- `apps/ptah-electron/src/di/rpc-surface.spec.ts`: 53 lines
- `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`: 171 lines
## Decisions

- **Decision:** Reuse the existing multi-phase static catalog for explicit `workspace-catalog` requests. **Options:** duplicate catalog or share the existing branch. **Evidence:** setup-rpc.handlers.ts already maps all catalog IDs/categories to score 100. **Reversible:** Yes.
- **Decision:** Register both supervisors as singletons in shared host registration. **Options:** rely on handler singleton lifetime or register class tokens explicitly. **Evidence:** both are injected as class tokens and hold active run state. **Reversible:** Yes.
- **Decision:** Keep internal supervisor classes out of host expected-resolvable exports. **Options:** export internal tokens or test their host registration through the handler surfaces. **Evidence:** orchestrator direction and shared singleton registration at `register-shared-rpc-handlers.ts:58-62`; all three host smoke groups and RPC surface specs pass. **Reversible:** Yes.
- **Decision:** Leave the three container smoke specs and Electron surface-composition spec unchanged. **Options:** add method assertions there or rely on their existing purpose plus host RPC-surface specs. **Evidence:** none enumerates RPC methods; the VS Code, Electron, and CLI RPC-surface specs already assert all three names. **Reversible:** Yes.

## Open points

None. The root Jest command requires project-config fallback in this workspace; all requested specs passed through that fallback.

## Proposed Removals

None.
