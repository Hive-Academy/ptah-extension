# Batch 40 report

## Files changed

- `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`: the VS Code absent-method expectation now filters its historical method-name baseline through the live `RPC_METHOD_NAMES` set.

Read-only inspection found no pipeline-only DI token or service expectations in the named `expected-resolvable.ts`, `container.smoke.spec.ts`, or `surface-composition.spec.ts`. `plugin-activation.ts` uses the retained `resolveSkillsRoot` helper to locate skills for user-layer mirroring, so it was left intact.

## Absent-method derivation

`EXPECTED_ABSENT_METHOD_NAMES` preserves the host's exclusion baseline. `VSCODE_EXPECTED_ABSENT_METHODS` is that list filtered by membership in `new Set<string>(RPC_METHOD_NAMES)`. The spec still compares it with `deriveRpcSurface(profile).excluded` and checks that registered plus excluded equals the live registry length.

Before batch 59, all currently registered exclusions remain in the expected list. When batch 59 removes obsolete `skillSynthesis:*` methods from both handler `METHODS` and `RPC_METHOD_NAMES`, those names disappear from the filtered expectation as well as the derived surface. Surviving Library methods remain expected absent on the VS Code host. The equality assertion continues to catch a new excluded live method missing from the baseline.

## Decisions

- Preserve `resolveSkillsRoot` and `skillSynthesis.skillsRoot`: the plan explicitly retains the shipped-skill destination and the VS Code mirror still uses it.
- Preserve the `SkillsSynthesisRpcHandlers` absent expectation in `di/expected-absent.ts`: the handler survives for Library RPC methods, and that file is outside this batch's edit scope.
- No tests, typecheck, lint, build, serve, or e2e were run, as instructed. Verification was limited to scoped reads, searches, and the diff.

## Clarifications Needed

- `apps/ptah-extension-vscode/src/activation/plugin-activation.spec.ts` does not exist; no activation spec or test of `mirrorUserLayer` was found under this app's `src`. No replacement spec was created because the production activation code needed no change.
