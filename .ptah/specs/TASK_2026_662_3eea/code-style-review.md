# Code Style Review — `TASK_2026_662` Phase A

Review family: implementer codex+Glm, reviewer Claude subagent.

## Summary

| Metric          | Value          |
| --------------- | -------------- |
| Overall score   | 6/10           |
| Assessment      | REVISE         |
| Blocking issues | 0              |
| Serious issues  | 3              |
| Moderate issues | 3              |
| Minor issues    | 4              |
| Files reviewed  | 14 (non-spec)  |

Scope: batches 2, 3, 5, 10, 12, 14, 15 as listed in the brief, read in full. Checks run: `prettier --check` on five files, import and `as unknown as`/`any`/`console` grep over the added production lines. No eslint or Jest run: no finding depends on one. Boundary direction was checked by reading imports; no `eslint-disable` of `@nx/enforce-module-boundaries` was added.

## Five style questions

### 1. What breaks in six months?

- The `sha256:<hex>` revision token is built in two libs with no shared helper. The producer is `skill-enhancer.service.ts:462`, and the verifier is `user-layer-mirror.service.ts` in both `saveDirCloneBody` and `saveFileCloneBody`. Change the format or add CRLF normalisation on one side and every save returns `stale-source` for no visible reason. The sibling `source-hash.ts` already normalises CRLF for the origin hash, so there are already two hash dialects in that folder.
- `migration-runner.ts` hard-codes `56` and `57` (`runVecCatchUp(sorted, appliedNow, 56, true)`, `migration.version >= 57`, `readPendingVecVersions().some(v => v >= 57)`). When `0057` is renumbered or a sibling migration lands first, the archive gate quietly stops guarding. The archive directory name `pre-0057-` in `skill-pipeline-archive.ts` repeats the same magic number.
- `SkillTaskGradeStore.findAttributions` encodes the source-to-kind mapping three times in one SQL string (`skill-task-grade.store.ts:100-102`, `:110-112`), and again in the `lane_outcome_records` branch. A new invocation `source` must be changed in every copy.

### 2. What would a new team member misread?

- `file-settings-keys.ts`: the comment now says the timeout default "governs both the legacy timeout and `skills.enhancement.timeoutMs`". Nothing in the keys file says the legacy keys are read only by the migration, or when they can be dropped.
- `positiveEvidenceForRun` returns `EvidenceClass | null`, but `isPositiveEvidenceClass` already narrows to three literals. The return type could say so (`session-verdict.store.ts`, new method).
- `SkillInvocationEventStore.recordSkillEvent` takes `source: string`. The valid values (`subagent`, `tool-use`, `prompt-expansion`, `slash-command`) appear only inside SQL literals in this store and in the grade store.

### 3. What does this cost to maintain that a simpler shape would not?

- `SkillTaskGradeStore` (200 lines) holds domain logic as well as persistence. It has the attribution-ambiguity grouping (`:131-143`), the lane/event merge (`:128-130`), and joins across three tables owned by other stores (`lane_outcome_records`, `session_task_links`, `skill_registry`). Schema changes in any of them now break this store invisibly.
- The mirror service's stale-source check is copy-pasted into the dir and file paths, including the whole 9-field `reason: 'stale-source'` result literal.

### 4. Where is this inconsistent with the rest of the repository?

- Row validation is inconsistent within one batch. `skill-invocation-event.store.ts` and `session-verdict.store.ts` parse rows with Zod `safeParse` and log on failure. `skill-task-grade.store.ts` casts every read (`as RawAttribution[]` `:120`, `:127`; `as RawAggregate` `:170`; `as RawGrade[]` `:184`; `as {…}[]` `:148`). It also injects a `Logger` and never uses it (`:68`; the only match for `logger` in the file).
- Several new/changed files are not Prettier-clean: `skill-task-grade.store.ts`, `skill-invocation-event.store.ts`, `skill-pipeline-archive.ts` and `migration-runner.ts` all fail `prettier --check`. Multi-argument `.run(...)` lines and 120-plus-column lines are packed. lint-staged would normally have formatted them, so check that the hook actually ran. This is the repository formatter's domain, so it is reported once and not itemised.
- `SKILL_TASK_GRADE_STORE` (`di/tokens.ts`, +1 line) is the only token in that neighbourhood without a doc comment (compare `SKILL_REGISTRY_STORE` and `SKILL_MD_MIGRATION_STATE_STORE` directly above and below).
- `skill-pipeline-archive.ts` is hand-rolled around the `'wx'` open flag, partial-write loops and a bespoke `isReceipt` guard, where the repository's Zod-at-boundaries convention would give a receipt schema for free. Its `receipt.json` is external input at verify time.

### 5. What would I have done differently?

- Put the `sha256:` helper beside `computeSourceHash` in `source-hash.ts`, export it from agent-generation, and import it in the enhancer. That is one definition and one place to change.
- Derive the migration gate from a named constant (`SKILL_PIPELINE_ARCHIVE_BEFORE_VERSION = 57`) shared by the runner and the archive's directory prefix.
- Split `SkillTaskGradeStore` into a storage store (`upsert`, `hasGradeForTask`, `getAggregates`, `listRecent`, `removeAbsent`) and a small attribution query or service, with Zod row schemas for both.

## Blocking issues

None. No boundary or invariant break found. `skills-root.ts` imports only the `IWorkspaceProvider` port from `@ptah-extension/platform-core`. The stores import `persistence-sqlite` and `vscode-core` `Logger`, which is the existing convention in this lib. `platform-core` does not import upward.

## Serious issues

### S1. `sha256:` revision token defined twice across libs

- File: `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts:462`, `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts` (the two `currentHash` lines in `saveDirCloneBody` and `saveFileCloneBody`)
- Problem: the producer and the verifier of one contract (`expectedSourceHash`, zod regex `/^sha256:[0-9a-f]{64}$/` in `skills-synthesis-rpc.schema.ts`) each rebuild the string. Three copies of the format exist, plus a fourth regex.
- Tradeoff: a shared helper in the `agent-generation` public barrel (skill-synthesis already depends on that direction in other places; confirm) removes the drift. The cost is one exported function.
- Recommendation: add `formatSourceHash(body)` to `source-hash.ts`, use it in all three sites, and derive the zod regex from it or leave a cross-reference comment.

### S2. Duplicated stale-source guard in the mirror service

- File: `user-layer-mirror.service.ts` (`saveDirCloneBody` and `saveFileCloneBody`, each with a block of about 15 added lines)
- Problem: identical read, hash, compare and 9-field return literal, differing only in `kind` and the path. Both are Phase A additions and have not diverged yet.
- Recommendation: extract `assertSourceUnchanged(path, expected): Promise<boolean>` and a `staleSourceResult(kind, slug)` builder. Two uses with identical text is where this repo's third-use rule is already met (hash helper counts as the third use, per S1).

### S3. Migration-runner version gate uses magic numbers

- File: `libs/backend/persistence-sqlite/src/lib/migration-runner.ts` (`ensureArchive` closure, `runVecCatchUp(sorted, appliedNow, 56, true)`, `migration.version >= 57` twice) and `skill-pipeline-archive.ts:` `'pre-0057-'`
- Problem: the contract "archive before the first destructive migration" is spread over four literals and across two files. `ensureArchive` is a 16-line closure inside `applyAll`, which is already long. `runVecCatchUp` gained two positional parameters (`maxVersion`, `fatal`) that change its failure semantics from warn-and-defer to throw.
- Recommendation: one exported constant in `skill-pipeline-archive.ts`, an options object for `runVecCatchUp`, and move `ensureArchive` to a private method. Also reconsider whether the runner (a generic engine) should name a skill-specific archive. A `Migration.preflight?` hook would keep the runner agnostic, but only do that if a second consumer is plausible. Otherwise keep it and just name the constant.

## Moderate issues

### M1. `SkillTaskGradeStore` skips Zod and holds unused `Logger`

- File: `skill-task-grade.store.ts:68`, `:120`, `:127`, `:148`, `:170`, `:184`
- Problem: unvalidated `as` casts on DB rows next to sibling stores that parse. `subject_kind` and `verdict` are typed as closed unions with no runtime check.
- Fix: Zod row schemas as in `SubagentRunRowSchema` (`skill-invocation-event.store.ts:12`), and either use or drop the Logger.

### M2. Domain logic and cross-store SQL inside a persistence store

- File: `skill-task-grade.store.ts:98-144`
- Problem: a 45-line `findAttributions` mixes three SQL statements, the source-to-kind mapping three times, an O(n²) `rows.some` merge and ambiguity grouping. A store named `*.store.ts` elsewhere in this lib is CRUD plus aggregate reads.
- Fix: extract the kind mapping to a SQL fragment constant, and move grouping into a pure function with its own tests.

### M3. Platform-core carries a skills-specific legacy key table and writes during `load()`

- File: `libs/backend/platform-core/src/file-settings-manager.ts` (`SKILL_SETTINGS_MIGRATIONS`, and the `if (migrated)` write block)
- Problem: a generic file-settings manager now knows four skill-synthesis legacy names, and `load()` has a write side effect with its own temp-file and rename code duplicating the existing persist path (it reuses `persistTempSequence` but not the persist method). The `console.warn` there pre-exists and platform-core has no logger port, so that part is not a finding.
- Fix: make the migration table a typed constant in `file-settings-keys.ts` (next to the keys it renames) and reuse the existing atomic write helper.

## Minor issues

- `skill-invocation-event.store.ts:36` `source: string` and `NewSkillInvocationEvent` could use a `SkillInvocationSource` union; the literals are currently scattered over two stores.
- `skill-invocation-event.store.ts:127-135` `getDominantSkillSlugForSessions` builds an unbounded `IN (...)` list while `listSkillsForScopes` chunks at 100. Pick one convention (chunking is the safer one for SQLite's variable limit). This is style-consistency, not a logic report.
- `di/tokens.ts` `SKILL_TASK_GRADE_STORE` has no doc comment.
- `skills-root.ts:5` and `index.ts`: `SKILLS_ROOT_SECTION` and `SKILLS_ROOT_KEY` are exported publicly only so that callers could read the setting. `resolveSkillsRoot` is the one entry point, so exporting the constants widens the public surface for no consumer. Verify and trim.

## File-by-file

### `skill-synthesis/src/lib/skills-root.ts` (batch 12)

Score 9/10. 0 B, 0 S, 1 M. Small, single responsibility, depends on the port, and fail-soft is stated in the doc comment. Four production call sites already use it (`harness-boot.ts:77`, `harness-fs.service.ts:179`, `skills-synthesis-rpc.handlers.ts:2610`, `plugin-activation.ts:304`). The index export is correct. Minor: constants over-exported.

### `skill-invocation-event.store.ts` (batch 3)

Score 7/10. 0 B, 0 S, 2 minor. Zod on both read paths, injected Logger, parameterised SQL, `Symbol.for`-free class registration like its siblings. Prettier fail; free-form `source: string`.

### `skill-task-grade.store.ts` (batch 5)

Score 5/10. 0 B, 0 S, 2 M. See M1 and M2. Tokenised in `tokens.ts` and registered in `register.ts` correctly. The new `SKILL_TASK_GRADE_STORE` token is undocumented.

### `platform-core` keys and `file-settings-manager.ts` (batch 2)

Score 7/10. 0 B, 0 S, 1 M. New `skills.enhancement.*` keys follow the existing dotted-key pattern with defaults and a spec. See M3.

### `rpc-skill-clone.types.ts`, `skills-synthesis-rpc.schema.ts`, `user-layer-mirror.service.ts` (batch 10)

Score 6/10. 0 B, 2 S. Types and Zod schema are paired and the optional field is additive, so the public contract is not broken. The inline anonymous `draft` object type in `SkillSynthesisPreviewEnhancementResult` should be a named exported `SkillEnhancementDraft` interface in the same file for reuse by the webview. `rpc-skill-clone.types.ts` (456 lines) is within limits. See S1 and S2.

### `session-verdict.types.ts` and `session-verdict.store.ts` (batch 14)

Score 8/10. 0 B, 0 S. Naming matches neighbours. Zod parse retained, and the join keys are an explicit `SessionVerdictJoin` interface. The guard `isEvidenceClass(value) && isPositiveEvidenceClass(value)` is redundant if the schema already restricts the enum; one is enough.

### `persistence-sqlite/src/lib/skill-pipeline-archive.ts` and `migration-runner.ts` (batch 15)

Score 5/10. 0 B, 1 S, 2 minor. No injected Logger and uses `os.homedir()` / `process`-level paths directly, so it bypasses the platform-path ports the hexagonal rules prefer (the default archive root is a hard-coded `~/.ptah/backups/skill-pipeline`; the runner takes none from the caller). Receipt parsing is a hand guard instead of Zod. Table name is interpolated into SQL (`SELECT * FROM "${table}"`), safe only because `TABLES` is a closed const array; add a comment. Prettier fail. See S3.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| No `eslint-disable` of module-boundaries | PASS | none added in diff |
| Cross-lib imports via barrel | PASS | `harness-fs.service.ts:36`, `plugin-activation.ts:34` import `@ptah-extension/skill-synthesis` |
| Runtime-agnostic libs depend on ports | PASS | `skills-root.ts:3` uses `IWorkspaceProvider` |
| Tokens are `Symbol.for` in the token object | PASS | `di/tokens.ts` new token |
| Token carries a doc comment like neighbours | FAIL | `di/tokens.ts` `SKILL_TASK_GRADE_STORE` |
| Stores register in `register.ts` | PASS | `register.ts` `SkillInvocationEventStore`, `SkillTaskGradeStore` |
| Public surface only through `src/index.ts` | PASS | `skills-root` export added; stores intentionally internal |
| Kebab-case with role suffix | PASS | `*.store.ts`, `skills-root.ts` |
| No `any` / `as unknown as` in production | PASS | grep on added lines: none |
| Row casts replaced by Zod at boundaries | FAIL | `skill-task-grade.store.ts:120,127,148,170,184` |
| Injected Logger, no `console.*` | PASS (with note) | only `console.warn` in `file-settings-manager.ts`, pre-existing pattern, no logger in platform-core |
| New port bound in all three adapters | NOT_APPLICABLE | no new port |
| File size | PASS | new files at or under about 200 lines; `skills-synthesis-rpc.handlers.ts` is 3169 lines, which was already oversized |
| Formatter clean | FAIL | 4 files fail `prettier --check` |

## Maintenance debt

- Introduced: a duplicated hash format, a hard-coded migration version gate, an unvalidated-row store with 3-way duplicated SQL mapping, and a settings migration table in a generic lib.
- Retired: the scattered `skillSynthesis.skillsRoot` readers (now one `resolveSkillsRoot`), the inline telemetry store logic in the scorecard service (about 300 lines removed from `skill-scorecard.service.ts` and its spec).
- Net: neutral to slightly positive overall, but Phase A adds four items that are cheaper to fix now than after Phase B builds on them.

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM-HIGH (static read only; no lint or Jest run)
- Key concern: the `sha256:` token duplication (S1/S2) and the hard-coded `56`/`57` archive gate (S3) will each fail silently if one side changes.
- What a 10/10 version would do differently:
  - A single exported source-hash helper and one stale-source guard.
  - A named constant for the archive gate, an options object for `runVecCatchUp`, and a Zod receipt schema.
  - A `SkillTaskGradeStore` split into storage and attribution, with Zod rows and no unused Logger.
  - All new files Prettier-clean and every new token documented.
  - A named `SkillEnhancementDraft` type instead of an inline object.
