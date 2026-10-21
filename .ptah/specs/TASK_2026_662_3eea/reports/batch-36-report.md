# Batch 36 report

## Files changed

- `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts`: Removed synthesis boot and stop, `refs.skillSynthesis` reads and writes, and the drain and backlog cleanup job imports, registration, and handlers. The skill trigger starts directly and still stops during disposal. Retained an optional legacy `ThothRefs.skillSynthesis` type field for existing consumers outside this batch.
- `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts`: Removed synthesis lifecycle and drain/cleanup fixtures and tests; kept the trigger, backup, memory retention, gateway, and disposal coverage aligned with the new runtime order.
- `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime-edge.spec.ts`: Removed synthesis lifecycle fixtures and its stop failure test; kept other disposal edge coverage.
- `libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts`: Documented why shared registration remains necessary for current RPC consumers.

The other listed files were left unchanged: `register-thoth-libraries.spec.ts`, `cli-skill-repropagation.ts`, its absent `cli-skill-repropagation.spec.ts`, and `harness-boot.ts`.

## What stays wired

- `SKILL_TRIGGER_SERVICE` startup and shutdown, backup and memory retention jobs, and the existing gateway and memory lifecycle.
- `SKILL_REPROPAGATION_TOKEN` to `CliSkillRepropagation`, the shipped skills root via `resolveSkillsRoot`, and shared registration for Library RPC services, `SpecHarvesterService`, and `ForegroundActivityTracker`.

## Acceptance rg result

`rg -n "SKILL_DRAIN_JOBS|skill-drain-jobs|skill-backlog-cleanup|refs\.skillSynthesis|skillSynthesis:\s" libs/backend/cli-engine/src` has no hits in the allowed files. It still reports four pre-existing hits outside the allowed files: `bootstrap/thoth-runtime.smoke.spec.ts:83,129,152` and `rpc/cli-host-profile.ts:28`. No tests, typecheck, lint, build, serve, or e2e were run, per instruction.

## Decisions

- Started the skill trigger directly because CLI synthesis boot no longer runs. Kept its guarded shutdown and non-fatal logging through the injected Logger.
- Kept `registerSkillSynthesisServices` for now because current RPC handler construction still injects its `SKILL_SYNTHESIS_SERVICE` and Library dependencies; removing that shared registration in this batch would break the host.
- Kept `ThothRefs.skillSynthesis` as an optional compatibility type only. Runtime code never populates, reads, or stops it.

## Clarifications Needed

- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:356-357` still requires `SKILL_SYNTHESIS_SERVICE`, so `registerSkillSynthesisServices` remains at `libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts:137`. The later RPC cut must remove this dependency before its registration can be removed.
- `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.smoke.spec.ts:83,129,152` still constructs legacy `skillSynthesis` refs; that spec is outside the permitted eight files. The optional type field remains for it. `libs/backend/cli-engine/src/lib/rpc/cli-host-profile.ts:28` retains the live `skillSynthesis` RPC namespace and is also outside this batch. These four hits prevent the requested repo-wide zero-hit acceptance result within this file scope.
- The named `libs/backend/cli-engine/src/lib/thoth/cli-skill-repropagation.spec.ts` does not exist in this worktree.
