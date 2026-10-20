# Phase A fix D report

| Defect | Status | File:line evidence | Spec added |
| --- | --- | --- | --- |
| S1 | Fixed | `libs/backend/skill-synthesis/src/lib/skill-task-grade.store.ts:118-148` filters task-scoped event and lane rows by normalized roots in TypeScript, retaining session-link self-correlation. `libs/backend/skill-synthesis/src/lib/spec-harvester.service.ts:154-157` logs one bounded warning for batched specs with zero attributions. Grade upsert and `removeAbsent` continue to receive the normalized root. | `skill-task-grade.store.spec.ts:43-69` covers a trailing separator, a different root, and Windows drive-letter case. `spec-harvester.service.spec.ts:229-244` covers the warning and successful marker write. |
| M3 | Fixed | `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:658-671` writes `skills.enhancement.*` before the legacy setting. | `skills-synthesis-rpc.handlers.spec.ts:5069-5084` asserts both calls in order. |
| M4 | Fixed | `libs/backend/skill-synthesis/src/lib/spec-extractor.ts:78-81,108,113` normalizes spaces and hyphens and accepts `REJECT` / `REJECTED` and `NEEDS REVISION` variants. | `spec-extractor.spec.ts:58-61` covers the added verdict forms. |
| M5 | Fixed | `libs/backend/skill-synthesis/src/lib/spec-extractor.ts:109-111` scans field matches backward until one parses as terminal. | `spec-extractor.spec.ts:62` covers a trailing unrelated status after an approved verdict. |

## Decisions

- Followed O9: comparison normalizes stored and requested workspace roots after task-scoped SQL selection. Null roots do not match. The session-link subquery still compares each link root with its event root, and its uniqueness check still correlates `other.workspace_root = s.workspace_root`.
- Kept grade writes and pruning on the normalized harvester root. Empty attributions with batches emit one warning containing only task ID and counts; harvesting still succeeds.
- Used a portable trailing-separator test and guarded the Windows drive-letter test by platform because `normalizeWorkspaceRoot` uses host `path.resolve`.
- Did not run tests, typecheck, lint, build, or Nx/Jest commands, as instructed. `git diff --check` completed without findings before the final report edit.
