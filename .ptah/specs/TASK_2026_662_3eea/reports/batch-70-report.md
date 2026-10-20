# Batch 70: managed skill retirement

Retirement is wired at the start of `mirrorAll` (`user-layer-mirror.service.ts:352`) and `reconcile` (`:533`), which `reconcileAll` invokes before the deleted-upstream sweep. The two exact slugs are held in `RETIRED_MANAGED_SKILL_SLUGS` (`:47`). Mirror and reconcile source loops skip them (`:1418`, `:1473`, `:1898`).

`retireManagedSkills` (`:575`) resolves the skills root through `getUserLayerRoots`, uses `lstat` to require a real skills root and direct real clone directory, checks the sidecar with `readSidecar` and `parseOriginSidecar`, and compares live content with the existing `computeSourceHash` against `sidecar.sourceHash`. Missing sidecars, modified clones, invalid origins and unsafe paths are preserved, returned with reasons and logged. Per-slug failures are logged without stopping the pass. A missing root or removed slug is a no-op.

Removal reuses `UserLayerFsOps.snapshotDirToRootHistory` and `removePath` (`user-layer-mirror.service.ts:622-623`). A snapshot is kept at the skills root under `.history/<slug>/<timestamp>`; the clone directory and its sidecar are removed. The filesystem guard remains in `removePath`. `UserLayerFsOps` excludes the two retired slugs from its skills-root subdirectory listing (`user-layer-fs-ops.ts:43`, `:284`), preventing the later orphan sweep from marking preserved copies.

Focused specs were added in `user-layer-mirror.service.spec.ts:120`: managed unchanged removal with retained root history, modified preservation and report through `reconcileAll`, missing-sidecar preservation, second-run no-op, symlinked slug safety, unrelated skill untouched, and startup ordering with no re-seed.

## Decisions

- Preserve any clone without a valid origin sidecar or whose live hash differs from the sidecar's source hash.
- Keep the existing root-level history snapshot behavior used by the orphan reaper.
- Keep retired slugs out of both source reconciliation and the later orphan sweep.

## Could not do

- No Nx, Jest, TypeScript, lint, build or e2e checks were run, as instructed. The orchestrator owns scoped verification.
- The real user layer was not touched.