# Batch 12 report

Moved the skills-root resolver and its settings keys into a dedicated module. The package index still exports the same public symbols, and the generator and harness mirror use the same resolver. Added default and alternate-root coverage for the resolver and the harness mirror.

## Files changed

- `libs/backend/skill-synthesis/src/lib/skills-root.ts:1-33` — resolver and settings keys moved here without changing behavior.
- `libs/backend/skill-synthesis/src/lib/skills-root.spec.ts:1-29` — default and configured alternate root specs.
- `libs/backend/skill-synthesis/src/lib/skill-md-generator.ts:19-37,75-85,137-140` — imports the moved resolver; retains a temporary export for its existing root spec.
- `libs/backend/skill-synthesis/src/index.ts:28-38` — public resolver and settings keys now export from `skills-root.ts`.
- `libs/backend/rpc-handlers/src/lib/harness/io/harness-fs.service.ts:168-179` — documents the configured mirror root; existing package import and call remain intact.
- `libs/backend/rpc-handlers/src/lib/harness/io/harness-fs.service.spec.ts:1-53` — verifies both default and alternate root delivery to `mirrorAll`.

## Importers

From `rg -n "resolveSkillsRoot" libs apps` (source imports and active call sites; specs also found in Electron activation, generator roots, and skills-synthesis RPC handlers):

- `apps/ptah-electron/src/activation/plugin-activation.ts:34,304`
- `apps/ptah-extension-vscode/src/activation/plugin-activation.ts:17,89`
- `libs/backend/cli-engine/src/lib/bootstrap/harness-boot.ts:48,77`
- `libs/backend/rpc-handlers/src/lib/harness/io/harness-fs.service.ts:36,179`
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:38,2601`
- `libs/backend/skill-synthesis/src/lib/skill-md-generator.ts:29,85,139`
- `libs/backend/skill-synthesis/src/index.ts:30`
- `libs/backend/skill-synthesis/src/lib/skills-root.ts:16` (definition)
- `libs/backend/skill-synthesis/src/lib/skills-root.spec.ts:5,10,12,27`
- `libs/backend/skill-synthesis/src/lib/skill-md-generator.roots.spec.ts:10,18,45,47,51,55,62,73`
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.spec.ts:28,1646`
- `apps/ptah-electron/src/activation/plugin-activation.spec.ts:96,99,239,255,257,261,347,600`

## Decisions

- Kept a re-export from `skill-md-generator.ts` until batch 61. The existing `skill-md-generator.roots.spec.ts` imports `resolveSkillsRoot` and the settings key from that module, and this batch does not own that spec. The package index itself exports directly from the new module. This compatibility export is reversible when the generator is removed.
- Exercised the harness mirror method directly in its new spec to verify the passed root without writing to the user's plugin directory. The public `createSkillPlugin` path already calls this method. This test choice is reversible.

## Verification

- Read-only source search confirmed the public importers still use `@ptah-extension/skill-synthesis` and the index points to `skills-root.ts`.
- All changed source and spec files have LF line endings.
- Tests, typecheck, lint, Nx, build, e2e, and diagnostics were not run, as requested for this batch. The orchestrator owns the project checks.
