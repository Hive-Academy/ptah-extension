# Findings — TASK_2026_194 (atomic task-ID allocation)

## The chosen fix already exists in code (shipped under TASK_2026_179)

- **Pure scan step:** `libs/backend/task-specs/src/lib/id-allocator.ts:14` `allocateTaskId(folderNames)` — scans folder names for max `NNN`, returns next. `registry.md` is never read. Not the reservation.
- **The reservation (the actual fix):** `libs/backend/task-specs/src/lib/task-writer.service.ts:218` `TaskWriterService.create` runs allocate → exclusive-claim → retry (`:248-267`) against `this.fs.createDirectoryExclusive(...)` — the `IFileSystemProvider` port's compare-and-swap (`platform-core/src/interfaces/file-system-provider.interface.ts:92`, contracted to throw `EEXIST`). On `EEXIST` it re-scans and retries; after 5 collisions it returns a typed `ID_ALLOCATION_EXHAUSTED` (writing nothing) rather than clobbering. The carrier write runs only after a successful exclusive dir claim, so the folder is provably empty — no overwrite is structurally possible. `adoptFolder` separately aborts with `CARRIER_EXISTS` (`:366`).
- **RPC surface:** `tasks:create` → `writer.create` (`rpc-handlers/.../tasks-rpc.handlers.ts:595`). `tasks:generateRegistry` → `RegistryGeneratorService` (deterministic, write-if-changed).

No new production code was needed; adding a second allocator would violate DRY. Verified and documented instead.

## What was added for 194

1. **Race regression test** — `libs/backend/task-specs/src/lib/task-writer.create-race.spec.ts` (new file):
   - Criterion 1: two parallel `create` calls on one shared fs resolve to distinct ids (`_001`/`_002`), both carriers valid.
   - Criteria 1+2: a stale-scan interleaving (session B re-proposes `_001` that A already owns) — B hits `EEXIST`, retries to `_002`, and A's carrier is byte-identical before/after. This is the precise 188/189 regression.
2. **Skill prose (source copy)** — atomic-reserve algorithm written into `.claude/skills/orchestration/references/task-tracking.md` and `SKILL.md`.
3. **registry.md regenerated** — was 4 weeks stale (157/159 only) → current (42 included / 0 excluded), mirroring `RegistryGeneratorService`. Throwaway script removed after running.

## Acceptance criteria status

1. Concurrent allocation cannot clobber — proven by the new race test. ✅
2. Carrier write into an occupied folder fails loudly — structurally guaranteed by exclusive dir claim; asserted by the test. ✅
3. Orchestration-skill prose reflects atomic reserve — done in the `.claude/skills` source; **PORT to the tracked asset copy is the remaining shipping step** (see below). ⚠️→ (resolved: asset copy ported after 179 committed)
4. registry.md regenerated and not an allocation input. ✅

## Cross-session reconciliation (was blocked on 179, now resolved)

`.claude/skills/*` and `.ptah/specs/registry.md` are gitignored, so the source-prose edit and the regenerated registry are local-only. The tracked/shipping skill copy is `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/{SKILL.md,references/task-tracking.md}`, which the 179 session held uncommitted at the time of this work. After 179 committed, the atomic-reserve prose was ported into that tracked asset copy so the fix actually ships.

## Verification

- `npx nx typecheck task-specs` → Success.
- `npx nx test task-specs` → 15 suites, 375 passed / 23 skipped.
- `task-writer.create-race` isolated → 2 passed.
