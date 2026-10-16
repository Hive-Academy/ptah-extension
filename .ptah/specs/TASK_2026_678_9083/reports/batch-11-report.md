# Batch 11 report

## Tasks

- 11.1: Added the narrow `PROVIDER_BRAND_ART` value and `MarkArtwork` type entry (`libs/frontend/ui/src/provider-brand-art.ts:1`), pinned its value exports and import specifiers (`libs/frontend/ui/src/lib/native/brand-mark/brand-mark-barrels.spec.ts:71`), and added its alias (`tsconfig.base.json:224`). Existing brand barrels and slug mapping were left intact.
- 11.2: Added deterministic orbital projection, root/delegate/Tribunal/satellite positions, 24-node selection, completed overflow chip, parent-provider child labels, dense plate priority, one measurement per node per layout and halo-aware collision placement (`libs/frontend/command-center/src/lib/scene/scene-layout.ts:1`). No camera, zoom or pan.
- 11.3: Added detached Canvas 2D sprite caching with theme invalidation, node key reuse, provider-ID slug resolution, vendor artwork, two-letter fallback, Lucide shield, minimum satellite/mark size and DPR cap (`libs/frontend/command-center/src/lib/scene/sprite-cache.ts:1`). Gradients and `Path2D` are created only on cache misses.

## Files written

- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/ui/src/provider-brand-art.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/ui/src/lib/native/brand-mark/brand-mark-barrels.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/tsconfig.base.json`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/scene/scene-layout.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/scene/scene-layout.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/scene/sprite-cache.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/scene/sprite-cache.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/.ptah/specs/TASK_2026_678_9083/reports/batch-11-report.md`

## Specs and verification

- `brand-mark-barrels.spec.ts:71` pins the narrow entry's value export and both module specifiers.
- `scene-layout.spec.ts` asserts stable output, orbital kind classification, 24-node cap, active priority, completed count chip, child label naming, dense plate visibility, one measurement per node per call and halo clearance.
- `sprite-cache.spec.ts` stubs jsdom's missing 2D context and asserts cache reuse, one-time path parsing, DPR cap, provider slug lookup, monogram fallback, shield use, 32 px satellite minimum and theme rebuild.
- Scoped `ptah_get_diagnostics`: no errors in changed files. It reported seven errors in pre-existing sibling files (`tribunal-run-coordinator.spec.ts` and `capability-id-codec.ts`) that are outside batch ownership.
- `npx prettier --check` output: **All matched files use Prettier code style!**
- Jest and Nx were not run, per lane rule. The orchestrator owns the scoped command.

## Catch sites and degradation audit

No `catch` or `.catch` was added in non-spec code; no degradation-audit classification or marker is required.

## Decisions

| Decision                                                                         | Options                               | Evidence                                                                                           | Reversible |
| -------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------- |
| Expose artwork via its own secondary entry                                       | Narrow entry; existing brand barrel   | Batch 11.1 and R3-1 require no umbrella/barrel change                                              | Yes        |
| Prioritize selected, awaiting and failed nodes before completed nodes at the cap | Input order; state priority           | Batch 11.2 and design-spec scene grammar                                                           | Yes        |
| Keep sprite keys in a per-node map and reuse on unchanged snapshot references    | Assemble every draw; prepared key map | R3-13 forbids per-frame string joins                                                               | Yes        |
| Use parent node provider ID for child label prefix                               | Parent provider; inferred name        | `CommandWorkNode` has `providerId`; R3-10 asks for parent provider name                            | Yes        |
| Keep a displayed node's ancestors, or drop the node when its lineage cannot fit  | Keep ancestors; drop child            | A satellite or agent without its parent cannot be placed or understood; the 24-node limit is fixed | Yes        |

## Orchestrator fix round

- Tribunal layout: `scene-layout.ts:114` places ordinary nodes on the global rings, then `scene-layout.ts:177` places `lane:` satellites at deterministic angles around the final Tribunal core position. `scene-layout.ts:25` and `scene-layout.ts:249` expose `phase:` work on the core as `phases` and omit phase spheres. `scene-layout.spec.ts:79` asserts three lane positions, determinism, a 32 px minimum and phase attachment.
- Overflow and parent integrity: `scene-layout.ts:74` selects nodes with their ancestors within the 23 non-root node budget, while `scene-layout.ts:96` and `scene-layout.ts:256` count hidden completed and other work in the chip. `scene-layout.spec.ts:100` checks a running-node overflow chip and that every displayed child has its parent; `scene-layout.spec.ts:75` checks the completed-only count.
- Cache release: `sprite-cache.ts:52` prunes missing node IDs and sprites without live references. `sprite-cache.spec.ts:108` checks that a removed sprite is rebuilt and a shared live sprite is retained.

## Carry-over

`projectOwnedWork` gives direct child sessions `label: 'Child session'` and `providerId: null`; the root also has no provider ID. The layout cannot show `Codex · Builder` until the projection carries the session name and parent provider. `work-projection.ts` is outside Batch 11 ownership and was not changed.

## Remaining limits

If more than 23 non-root active nodes exist, the visual cap still applies and lower-priority active nodes stay in the work list with an overflow count chip.
