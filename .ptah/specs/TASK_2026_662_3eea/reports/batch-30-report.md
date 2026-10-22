## Changed and deleted files

- Updated `apps/ptah-cli/src/cli/router.ts`: removed the `skill-synthesis` import and all six candidate command registrations.
- Deleted `apps/ptah-cli/src/cli/commands/skill-synthesis.ts`, `skill-synthesis.spec.ts`, `skill-synthesis-extended.spec.ts`, and `apps/ptah-cli/tests/e2e/skill-synthesis.e2e.spec.ts`.

## Shared-contract greps

- Ran `rg -n` across `libs apps tools` for each deleted named export: `SkillSynthesisSubcommand`, `SkillSynthesisOptions`, `SkillSynthesisStderrLike`, `SkillSynthesisExecuteHooks`, and `execute`.
- The four specific names occur only in the deleted command file and its two deleted specs. `execute` is a generic export name (2,523 repository matches); the deleted module path and `skillSynthesisCmd` have no live importer outside the owned router/spec files. `tools/mcp-bench/questions/7910f34cf/*.json` contains historical path references only, not executable imports.

## Post-cut grep

- `rg -n "skill-synthesis|skillSynthesis" apps/ptah-cli/src` returns one retained hit: `src/di/container.smoke.spec.ts:48` imports `registerSkillSynthesisServices` for the surviving Library/backend registration. No live obsolete CLI command hit remains.
- `rg -n -F './commands/skill-synthesis.js' apps libs tools` returns no hits. All four deletion targets are absent.

## Preserve check

- Plan row 27 names removal of the entire candidate CLI command group. The deleted module implemented list/get/promote/reject/invocations/stats over retiring candidate RPCs; it contained no Library, clone, or telemetry command. The router's separate `skill` and `skills` commands remain registered.
- No test, e2e, build, lint, or Nx command was run, per batch instruction. Scoped `ptah_get_diagnostics` on the router returned unavailable because its TypeScript check was still running after 45 seconds; it reported no diagnostic result.

## Decisions

- Removed the whole `skill-synthesis` CLI group because plan row 27 explicitly selects all of it and source inspection found no kept command in that module. Alternative was partial retention; evidence is the command file's six RPC handlers and the plan row. Reversible: yes.
- Preserved `registerSkillSynthesisServices` in the CLI smoke spec because it is outside batch ownership and supports the retained Library service. Reversible: yes.

## Proposed Removals

- None.