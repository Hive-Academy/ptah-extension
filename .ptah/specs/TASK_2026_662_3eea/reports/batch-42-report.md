# Batch 42 report

## Files changed

- `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`: derive the RPC method count and live absent-method list from `RPC_HANDLER_MANIFEST`; check the `skillSynthesis:` namespace only while it exists in the manifest.
- No changes needed in `libs/backend/cli-engine/src/lib/container.ts`, `libs/backend/cli-engine/src/lib/surface-composition.spec.ts`, `apps/ptah-cli/src/di/container.smoke.spec.ts`, or `apps/ptah-cli/src/cli/router.ts`. They contain no pipeline-only DI expectations or registrations to remove.

## Tokens removed and kept

- Removed: none; the allowed files had no candidate-store consumer, drain, queue, curator, or judge token registrations or expectations.
- Kept: `registerSkillSynthesisServices` in the CLI smoke test and via `registerThothLibraries`, because the Library RPC handler still requires `SKILL_SYNTHESIS_SERVICE`. The skill trigger, spec harvester, foreground tracker, and skill telemetry seam remain untouched.

## Manifest-relative approach

The surface spec flattens the live `RPC_HANDLER_MANIFEST` methods to calculate the partition count. It intersects the CLI absent-method baseline with those methods and makes the `skillSynthesis:` namespace assertion conditional on the namespace still being in the manifest. Other backend namespace assertions remain required. This supports both the current registry and the batch 59 method contraction.

## Decisions

- Preserved the retained Library registration and telemetry seam; removing them would break current CLI composition.
- Kept the CLI command router and surface composition spec unchanged because they have no synthesis pipeline behavior to remove.
- Per task instruction, ran no tests, typecheck, lint, build, serve, or e2e. Reviewed only source and read-only diffs.

## Clarifications Needed

none
