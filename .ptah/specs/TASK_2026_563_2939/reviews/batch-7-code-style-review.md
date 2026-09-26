# Code Style Review — `TASK_2026_563_2939`, Batch 7

## Summary

| Metric          | Value                            |
| --------------- | -------------------------------- |
| Overall score   | 8/10                             |
| Assessment      | APPROVED                         |
| Blocking issues | 0                                |
| Serious issues  | 0                                |
| Minor issues    | 1                                |
| Files reviewed  | 1 file (649 lines), read in full |

Scope: `libs/backend/memory-curator/src/lib/quarantine.round-trip.spec.ts`. All operations strictly confined to `D:\projects\ptah-extension-memory-quality-source`.

The implementation of Batch 7 delivers the end-to-end integration criterion (TASK_2026_563 M5 criterion 6) in a cohesive, readable, single-cycle spec running on real SQLite and `sqlite-vec`:

1. **Clear Chronological Structure:** The spec is structured around clear section comments (`Arrange`, `Apply 0049`, `Frozen while quarantined`, `Assert exclusion`, `Act: restore`, `Assert byte-for-byte unchanged`, `Assert inclusion`, `timeline restored`), making the 649-line cycle straightforward to follow from start to finish.
2. **Effective Helper Encapsulation:** The internal `readEverything` helper (`spec:329-376`) abstracts the 10+ assertion queries across reader entry points, avoiding duplicated assertion query blocks between pre-restore and post-restore phases while ensuring fresh calls are issued.
3. **Appropriate Test-Support Reuse:** Reuses `openRetentionTestDb`, `migrationSql`, and `removeRetentionTempDirs` from `retention-sqlite.test-support.ts` (`spec:46-52`). The local `seedRow` helper (`spec:107-147`) is justified because the shared `seedMemory` helper hardcodes `subject: NULL`, which would prevent migration 0049's R4 rule (`subject LIKE '%commitlint%' AND content LIKE '%scope%'`) from triggering.
4. **Strict Boundary and Resource Discipline:** Relies only on allowed imports and clean cleanup (`afterEach`, `afterAll` at `spec:184-188`). Passes fast on real SQLite with vector extensions loaded (2.75s).

The score sits firmly at 8/10 (sound band). Inclusion of transient code-review changelog commentary in the permanent file header comment keeps it below the exemplary 9–10 band.

## Five style questions

### 1. What breaks in six months?

- **Vector dimension hardcoding:** In `libs/backend/memory-curator/src/lib/quarantine.round-trip.spec.ts:55`, `EMBED_DIM = 384` is fixed as a module constant and used in `zeroEmbedder` (`:68-71`) and raw buffer seeding (`:146`). If the embedder model or schema changes dimensions (e.g. 768 or 1536), this spec's raw vector insertions will fail vector constraint validation.
- **Migration sequencing coupling:** `spec:254` executes `migrationSql(49)` explicitly on top of a database migrated through 0048 (`openRetentionTestDb({ memorySchema: true, vec: true })` at `spec:193`). If migrations are squashed or renumbered, or if the R4 migration criteria are updated, this hardcoded reference will need updating.

### 2. What would a new team member misread?

- **Review changelog in file header:** Lines `spec:17-31` detail review revision history (`Revision (code-logic-review batch-7, NEEDS_REVISION 5/10) fixed four gaps: ...`). A developer unfamiliar with the workflow might misinterpret this as a persistent specification requirement or wonder why code review metrics are recorded in production test headers instead of git history.
- **Asymmetric handling in `readEverything`:** In `spec:343-354`, `searchPage`, `indexQueried`, and `indexFiltered` evaluate to `null` when `ws === null` because those API methods accept `workspaceRoot: string` rather than `string | null`. A newcomer might misread this as omitting NULL-workspace testing, unless they notice the subsequent unscoped calls at `spec:437-450` and `spec:583-600`.

### 3. What does this cost to maintain?

- **Local `seedRow` SQL synchronization:** Lines `spec:107-147` maintain an explicit `INSERT INTO memories (...)` statement. If new non-nullable columns without defaults are introduced to `memories` in future migrations, `seedRow` will fail until updated. (As noted, this was necessary because `retention-sqlite.test-support.ts:seedMemory` hardcodes `subject: NULL`).
- **Comprehensive API surface assertion:** Because `quarantine.round-trip.spec.ts` exercises almost all public read interfaces (`search`, `searchRich`, `searchIndex`, `listAll`, `findMergeCandidates`, `collect`, `getObservations`, `getActiveById`, `timeline`, and `getCorpusMemoriesForPriming`), signatures changes across `MemoryStore`, `MemorySearchService`, `CorpusStore`, or `MergeCandidateCollector` will require corresponding updates here. This maintenance cost is inherent to an end-to-end round-trip test.

### 4. Where is this inconsistent with the rest of the repository?

- **Embedded review score metadata:** Sibling test files (`memory-search.service.spec.ts`, `retention/memory-lifecycle.quarantine.spec.ts`) document task requirements, bug IDs, and architectural rationales in their header comments, but do not record internal review iteration scores.
- **Local fixture seeding:** Sibling retention tests (`memory-lifecycle.quarantine.spec.ts:27-30`) import `seedMemories` from `retention-sqlite.test-support.ts`, whereas this spec defines a local `seedRow` helper to accommodate specific `subject` and `createdAt` requirements.

### 5. What would you have done differently?

- Remove the transient review round scoring commentary (`spec:17-31`) from the file header, retaining only the explanation of the specific edge cases tested (timeline neighbor, queryless filter, vecExtensionLoaded reporting).
- Consider making `retention-sqlite.test-support.ts`'s `SeedMemoryOptions` accept optional `subject`, `createdAt`, `salience`, and `hits` in a future refactor, which would allow deleting `seedRow` and sharing the common helper. Keeping it local for Batch 7 is an acceptable choice that preserves batch isolation.

## Blocking issues

None found within the reviewed scope.

## Serious issues

None found within the reviewed scope.

## Minor issues

### 1. Transient review metadata in file header docstring

- **File:** `libs/backend/memory-curator/src/lib/quarantine.round-trip.spec.ts:17-31`
- **Problem:** The top-level file docstring includes review iteration notes and temporary assessment scores:
  ```ts
  * Revision (code-logic-review batch-7, NEEDS_REVISION 5/10) fixed four gaps:
  * 1. The NULL-workspace row now gets the SAME exclusion/inclusion matrix as...
  ```
- **Impact:** Leaves review workflow artifacts in the codebase's permanent documentation.
- **Fix:** Retain the bulleted explanations of why those specific edge cases exist, but remove the reference to `(code-logic-review batch-7, NEEDS_REVISION 5/10)`.

## File-by-file

### `libs/backend/memory-curator/src/lib/quarantine.round-trip.spec.ts`

Score 8/10 — 0 B, 0 S, 1 M.

- The 649-line file is well under the monorepo's 700-line soft ceiling.
- Clear, disciplined step comments partition the full cycle logically (`spec:192`, `spec:253`, `spec:266`, `spec:310`, `spec:378`, `spec:460`, `spec:469`, `spec:483`, `spec:490`, `spec:522`, `spec:615`).
- The `readEverything` closure (`spec:329-376`) eliminates duplication across the pre-restore and post-restore phases while maintaining fresh invocations.
- Reuses `openRetentionTestDb` and cleanup routines (`spec:184-188`) cleanly without resource leakage.
- Properly tests both named workspace (`WS`) and `null` workspace scopes, including corpus membership priming before and after restore (`spec:271-278`, `spec:420`, `spec:458`, `spec:567`, `spec:612`).
- Finding 1 notes the historical review metadata in the header comment.

## Pattern compliance

| Repository rule or nearby convention                        | Status         | Evidence                                                                                                 |
| ----------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------- |
| Soft file length ceiling (<700 lines)                       | PASS           | `libs/backend/memory-curator/src/lib/quarantine.round-trip.spec.ts` (649 lines)                          |
| Allowed imports / no deep cross-lib imports                 | PASS           | `spec:32-52` (only `@ptah-extension/vscode-core`, `@ptah-extension/persistence-sqlite`, and local `./*`) |
| Real SQLite harness cleanup via `afterEach`/`afterAll`      | PASS           | `spec:184-188` (`openDbs.splice(0)`, `removeRetentionTempDirs()`)                                        |
| Strict type safety (no `as any`, no `@ts-ignore`)           | PASS           | Strict typing throughout; mocks safely typed with `as unknown as`                                        |
| No leftover debug code (`console.log`, `debugger`, `.only`) | PASS           | None present in file                                                                                     |
| Parameterized SQL queries for test seeding                  | PASS           | `spec:110-146`, `spec:163-176`                                                                           |
| Step comments structuring long integration cycles           | PASS           | `spec:192`, `spec:253`, `spec:310`, `spec:378`, `spec:483`, `spec:490`, `spec:522`                       |
| Standalone / OnPush Angular conventions                     | NOT_APPLICABLE | Backend Jest integration test only                                                                       |

## Maintenance debt

- Introduced: A local `seedRow` helper (`spec:107-147`) duplicating low-level `memories` table inserts, necessitated by the shared test helper omitting `subject` configuration.
- Retired: None directly in code (test-only file). Resolves M5 criterion 6 by providing unified regression protection across all agent-facing memory retrieval and curation paths.
- Net: Neutral. High value regression barrier with well-bounded, self-contained test fixtures.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH — Full source inspection, comparison against sibling real-SQLite specs (`memory-search.service.spec.ts`, `retention/memory-lifecycle.quarantine.spec.ts`, `retention-sqlite.test-support.ts`), and verification of scoped test execution (`1 passed, 1 total, 2.756s`).
- Key concern: The review-specific changelog in the file header docstring (`spec:17-31`) should be trimmed of temporary review grading references in a subsequent polish pass.
- What a 10/10 version would do differently: Clean up the review round grading text in the header comment; promote `seedRow` parameters into `retention-sqlite.test-support.ts:SeedMemoryOptions` so that seeding is shared across the entire test suite.
