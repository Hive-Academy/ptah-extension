# Code Style Review — TASK_2026_578_3b00

## Batch 2

Scope: `libs/backend/platform-core/src/file-settings-keys.ts`, `file-settings-keys.spec.ts`, `apps/ptah-docs/src/content/docs/skill-synthesis/settings.md`. Read in full around the diff, plus sibling context (`file-settings-manager.ts`, `skill-synthesis.service.ts`, the rpc handler and schema, `skill-clustering.service.ts`).

Checks run: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/platform-core --skip-nx-cache` — typecheck, test and lint all passed (filtered output).

### BLOCKING

None.

### MODERATE

1. Docs absolute count is off against the registry (`settings.md:8`). The registry has 50 literal `skillSynthesis.*` keys in `FILE_BASED_SETTINGS_KEYS` (file-settings-keys.ts:154-430) plus 32 lane keys spread at :165, so 82 in total. The docs say 80 (48 named + 32). The delta (+2 for the retirement keys) is correct (HEAD had 48 literal; docs said 46), so this is an inherited 2-key undercount, not a Batch 2 regression. Undocumented in the registry: `skillsRoot`, `judgeProvider`, `enhanceTimeoutMs`, `triggers.bootScanDelayMs`, `triggers.bootScanIdleBackoffMs` (the 5 may be covered by prose, not backticks). The batch's claim that "80 / 48" is "accurate" is therefore not verified. Fix: either correct to 82 / 50, or reword to avoid a hard number.
2. Docs overclaim until Batch 7 lands (`settings.md:43-44`). "Pinned and user-authored skills are exempt" matches the plan (implementation-plan.md:736-738: `row.pinned` or registry `clone_status IN ('authored','diverged')`). "its directory deleted" matches plan :741-742 (guarded `rmSync` of `dirname(bodyPath)`). Both are accurate for the planned behaviour. But the keys currently have no runtime reader (A6) so the page documents unshipped behaviour. This is acceptable only because Batch 7 ships in the same PR; do not release the docs without it. Note the exemption is wider than "user-authored" (it includes `diverged`, i.e. user-edited clones); consider "pinned, user-authored and user-edited".

### MINOR

1. Clumsy wording `settings.md:44`: "Days of remaining dormant without use after which a skill is retired". Suggest: "Days a skill must stay dormant without use before it is retired and its directory deleted." Also the key is cumulative (retire at N+M idle days, plan :740); the dormantAfterDays row ("Days of inactivity") and this row should say retirement counts from the dormancy start, otherwise users will read M as total idle time.
2. Docs row placement: the retirement rows sit between `suggestionMaxCandidates` and `trayKeepalive` in the Core table, splitting the curator rows from the Electron-only row. Fine, but a "Retirement" sub-heading would match how Triggers/lanes are grouped (`settings.md` Triggers section). Preference only.
3. Table alignment: the whole Core table was re-padded to the new longest key (diff noise on 18 unchanged rows) — this is prettier-driven, correct, and not a defect. Retirement-row padding is consistent with the others.
4. Spec naming (`file-settings-keys.spec.ts:653`): `'skillSynthesis retirement and pool keys (TASK_2026_578)'` matches neighbouring `(TASK_2026_180, Phase 1)` describe naming. `it.each(Object.entries(...))` with `%s to %s` formatting is fine. The `suggestionMaxCandidates` test asserts only the default and Set membership; it does not pin the runtime fallback split (see write-path), which is correct for this lib.

### Structure and consistency (check 1)

- Placement: both retirement keys sit in the Set directly after `suggestionMaxCandidates` (:244-246) and in DEFAULTS directly after it (:535-537), before the TASK_2026_180 drain block. Same order in both maps; matches the registry's grouping of the curator/core block. A6 satisfied: both keys in BOTH maps (verified by grep at :245-246 and :536-537, and asserted by the spec via `FILE_BASED_SETTINGS_KEYS.has` and `isFileBasedSettingKey` and defaults).
- Naming: `skillSynthesis.retirement.dormantAfterDays` / `retireAfterDormantDays` follow the dotted sub-tree shape already used by `skillSynthesis.triggers.*` and `drain.*`; matches plan :142-143.
- Plan prescribed 30/30 defaults: matches. No TODO/stub in any of the three files.
- No stray edits: `skill-synthesis.service.ts:153` still `suggestionMaxCandidates: 200` (unmodified, no diff in `libs/backend/skill-synthesis`). Check 4 passes.

### Write-path trace for suggestionMaxCandidates 200 to 1000 (check 2)

Confirmed against code:
- `file-settings-manager.ts` resolves stored value, then caller default, then registered default (as the team-leader stated).
- Runtime: `skill-synthesis.service.ts:1366-1369` passes `SETTINGS_DEFAULTS.suggestionMaxCandidates` (`:153`, 200), so the caller default wins; `skill-clustering.service.ts:46` slices to 200 for users with no stored value until Batch 10 changes the literal.
- Panel: `skills-synthesis-rpc.handlers.ts:529-549` reads `FILE_BASED_SETTINGS_DEFAULTS[configKey]` and also passes it as the fallback, so `getSettings` shows 1000 now. Zod max is 5000 (`skills-synthesis-rpc.schema.ts:91`), so 1000 validates.
- Persistence: the panel submits the whole form, so saving any panel setting writes `suggestionMaxCandidates: 1000` as an explicit stored value. From then on the runtime reads 1000 (stored wins), so the interim split self-resolves for users who save, and the stored 1000 is also what Batch 10 would deliver. Users with an existing explicit value (e.g. 200) are unaffected. Net effect of the split: only users with no stored value, who have not saved the panel, run on 200 while the panel displays 1000.
- Side note: existing rpc tests hardcode 200 as a fixture value (`skills-synthesis-rpc.handlers.spec.ts:2972`, `skills-synthesis-rpc.schema.spec.ts:96`); they pass explicit values, so they are not coupled to the default and are unaffected.

Assessment: the split is cosmetic and low-risk. The panel is ahead of runtime by at most one PR, the larger pool only widens candidate consideration, and there is no data hazard. Acceptable inside a single PR that also ships Batch 10.

### Score and verdict

Score: 8/10. Registry edit, spec, and docs are correct, minimal, and match conventions; typecheck/test/lint green. Held from 9 by the unverified/incorrect absolute key count in the docs (inherited 2-key undercount presented as "accurate") and the retirement-row wording.

The batch is acceptable to commit as long as Batch 10 (SETTINGS_DEFAULTS 200 to 1000 at `skill-synthesis.service.ts:153`) and Batch 7 (retirement reader) land in the same PR; do not ship Batch 2 alone, since the docs describe retirement behaviour with no runtime reader and the panel/runtime defaults would stay split. Recommended (non-blocking): fix the key count at `settings.md:8` and reword `settings.md:44`.

Verdict: APPROVED


## Batch 10

Scope: `libs/backend/skill-synthesis/src/lib/diagnostics.types.ts`, `diagnostics.service.ts`, `diagnostics.service.spec.ts`, `skill-synthesis.service.ts`, `skill-synthesis.service.spec.ts`.
Context: Shared files with TASK_2026_586 (PR #620). Minimal-edit rule (risk R-e in `batches.md`).

### Summary

| Metric          | Value        |
| --------------- | ------------ |
| Overall score   | 9/10         |
| Assessment      | APPROVED     |
| Blocking issues | 0            |
| Serious issues  | 0            |
| Minor issues    | 0            |
| Files reviewed  | 5            |

### Five style questions

#### 1. What breaks in six months?

If new lifecycle states or candidate counters are introduced to `SkillCandidateStats` (`types.ts:351-365`), `SkillCandidateStatusCounts` (`diagnostics.types.ts:48-61`) and `readStats` (`diagnostics.service.ts:47-76`) will require synchronous updates. Because `SkillSynthesisDiagnosticsSnapshot['byStatus']` requires all properties declared on `SkillCandidateStatusCounts`, omitting any new field produces a TypeScript compilation failure at build time rather than a runtime gap.

#### 2. What would a new team member misread?

A new team member might observe the slight naming divergence between `SkillCandidateStats.candidates` (plural, in `types.ts:352`) and `SkillCandidateStatusCounts.candidate` (singular, in `diagnostics.types.ts:49`), mapped at `diagnostics.service.ts:51` (`candidate: s.candidates`). This asymmetry is inherited from the 586 diagnostics contract; Batch 10 maintains consistency with the established DTO and appends the 4 new lifecycle fields (`active`, `dormant`, `merged`, `retired`) with 1:1 identical names across store, diagnostics, and snapshot.

Additionally, a reader might look for defensive null-coalescing (`?? 0`) on `s.active` / `s.dormant` / etc. in `readStats()`: it was deliberately omitted because `SkillCandidateStats` types all 8 count fields as required non-nullable `number`, and the enclosing `try/catch` already provides a clean zero-fallback for database/query failure.

#### 3. What does this cost to maintain?

Negligible maintenance cost. The diff is strictly additive and surgical:
- 4 interface fields with descriptive docstrings.
- 4 direct property assignments in the try block and 4 zero literals in the catch block.
- 1 numeric default literal update (`suggestionMaxCandidates: 1000`) in `SETTINGS_DEFAULTS` and its corresponding spec expectation.

#### 4. Where is this inconsistent with the rest of the repository?

It is fully consistent. The formatting, JSDoc comment styling, Jest assertion idioms, and type-safe error boundaries directly match the patterns established in `libs/backend/skill-synthesis` and the sibling 586 PR.

#### 5. What would you have done differently?

Nothing differently. Under risk constraint R-e (minimal edits to 586-shared files), any broader refactoring or renaming (e.g. normalizing `candidate` to `candidates` in `SkillCandidateStatusCounts`) would risk downstream breaking changes across RPC consumers in `libs/shared` and `libs/backend/rpc-handlers`. The executor correctly performed only the specified minimal modifications.

### Blocking issues

None.

### Serious issues

None.

### Minor issues

None.

### File-by-file

#### `libs/backend/skill-synthesis/src/lib/diagnostics.types.ts`

Score: 10/10 — 0 blocking, 0 serious, 0 minor.
Appends `active`, `dormant`, `merged`, and `retired` to `SkillCandidateStatusCounts` (lines 53-60) with accurate JSDoc comments matching domain terminology. No other lines touched.

#### `libs/backend/skill-synthesis/src/lib/diagnostics.service.ts`

Score: 10/10 — 0 blocking, 0 serious, 0 minor.
`readStats()` maps the 4 new fields directly from `store.getStats()` without redundant fallback operators (`?? 0`), respecting the required type contract of `SkillCandidateStats`. The catch block properly returns zero for all 8 counts when the store fails.

#### `libs/backend/skill-synthesis/src/lib/diagnostics.service.spec.ts`

Score: 10/10 — 0 blocking, 0 serious, 0 minor.
`makeStore` helper now explicitly types `stats: SkillCandidateStats` (importing `SkillCandidateStats` from `./types`) and defaults all 8 fields to 0. Both snapshot success and error fallback test cases assert all 8 status counts.

#### `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts`

Score: 10/10 — 0 blocking, 0 serious, 0 minor.
Only `SETTINGS_DEFAULTS.suggestionMaxCandidates` is changed from 200 to 1000 (line 155). `recentEvents`, `RING_CAPACITY`, and all 586 logic remain untouched.

#### `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.spec.ts`

Score: 10/10 — 0 blocking, 0 serious, 0 minor.
Default settings assertion updated from 200 to 1000 (line 1022) to align with `SETTINGS_DEFAULTS`. No other tests touched.

### Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| ------------------------------------ | ------ | -------- |
| R-e minimal edits to 586-shared files | PASS   | Only named lines modified in all 5 files (`git diff`) |
| No alterations or reordering of 586 code | PASS | All 586 features (`recentEvents`, `triggers`, etc.) untouched |
| Strict type precision (no redundant `?? 0`) | PASS | `diagnostics.service.ts:55-58` maps non-nullable fields directly |
| Explicit test typing                 | PASS   | `diagnostics.service.spec.ts:68` explicitly typed as `SkillCandidateStats` |
| JSDoc style matches domain terms     | PASS   | `diagnostics.types.ts:53-60` matches `types.ts:355-362` |
| Scoped test verification             | PASS   | `diagnostics` (4/4 passed), `skill-synthesis.service` (79/79 passed) |

### Specific checks evaluation

1. **Named changes only**:
   - `SkillCandidateStatusCounts` gained `active`, `dormant`, `merged`, `retired` (appended, documented).
   - `readStats` maps them with zero fallbacks in the try block and returns zeros in the catch block.
   - `SETTINGS_DEFAULTS.suggestionMaxCandidates` changed 200 -> 1000; `recentEvents` and `RING_CAPACITY` untouched.
   - Spec pinning 200 updated to pin 1000.
2. **No 586 code altered or reordered**: Confirmed via `git diff`.
3. **Naming and doc-comment style**: Confirmed matching repository standards.
4. **Omission of per-field `?? 0`**: ACCEPTED. `SkillCandidateStats` declares all count fields as required `number`. Adding nullish coalescing would be redundant defensive coding that weakens type trust.
5. **Type precision in spec**: Confirmed `makeStore(stats: SkillCandidateStats = { ... })`.

### Maintenance debt

- Introduced: None.
- Retired: Discrepancy between runtime default (previously 200) and registry default (`FILE_BASED_SETTINGS_DEFAULTS`, 1000) resolved.
- Net: Neutral to positive (consistency restored between settings registry and runtime default).

### Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: None. The batch is a clean, minimal surgical change adhering strictly to R-e.
- What a 10/10 version would do differently: The implementation is exemplary for a constrained patch; 9/10 reflects the inherited singular/plural naming difference (`candidate` vs `candidates`) originating in 586 that cannot be altered without cross-lib breakage.

Verdict: APPROVED

## Batch 14

Scope: in-process logic and style review (replaces the CLI lane; a later lane re-review becomes fix-up commits) of the uncommitted `libs/frontend/skill-synthesis-ui` diff: `skill-diagnostics-state.service.ts` (+ spec), `skill-pipeline-status.component.ts` (+ spec), `skill-synthesis-state.service.ts` (+ spec). Read the full diff, `SkillDiagnosticsResult` in `libs/shared/.../rpc-curator-diagnostics.types.ts:248-262`, `loadStats`, the tab wiring and the diagnostics polling path. Team-leader's test/lint/typecheck and degradation audit results were taken as given.

Style checks: PASS. The component stays standalone/OnPush with signal input `byStatus` (`skill-pipeline-status.component.ts:386`). The three new cells copy the sibling Promoted/Rejected cell markup exactly (interpolation only, no `[innerHTML]`). `SkillByStatusCounts` stays `readonly number` fields. The new specs follow the file's `it('refresh() ...')` naming. The tab binds the whole object (`skill-synthesis-tab.component.ts:484`, `:763`), so no tab edit was needed.

Logic checks:
- DTO: `totalMerged/totalRetired/totalDormant` are declared required `number` (`rpc-curator-diagnostics.types.ts:259-261`), so the `?? 0` in `applySnapshot` is purely defensive. It matches the existing sibling lines, which are also on required fields, and the "older backend" spec exercises it. Correct and consistent.
- No stubs, TODOs or mock data in production code.
- Accept then a stats failure: `loadStats` swallows its own error and sets `error`. The accept and the list refresh have already landed, and `suggestionsLoading` resets in `finally`, so the state is sensible. The only oddity is that the user sees a stats-read error after a successful accept.

### BLOCKING
None. The plan's literal criterion (implementation-plan.md:898-913, `accept` awaits `loadStats()` after `refreshSuggestions()`) is met.

### MODERATE
1. `skill-synthesis-state.service.ts:444` plus `skill-pipeline-status.component.ts:203`: the counters the user sees do not refresh on accept.
   - The pipeline cells read `SkillDiagnosticsStateService.byStatus`, which is fed only by `diagnostics.refresh()`.
   - `accept()` refreshes `SkillSynthesisStateService.stats`, which feeds `ptah-skill-stats-strip` (`skill-synthesis-tab.component.ts:155`), not these cells.
   - The diagnostics snapshot refreshes on tab open (`:944`), the manual Refresh button (`:957`), or the 30 s poll (`skill-diagnostics-state.service.ts:13`, `:194`). That poll starts only from `skill-activity-feed.component.ts:83`, so it runs only while that component is mounted.
   - So Merged/Retired/Dormant and the pipeline Promoted count can lag after accept by up to 30 s, or until a manual refresh. The batch purpose "Promoted/Active rise immediately after accept" is met for the stats strip but not for the pipeline cells.
   - Suggested fix-up: have the tab (or `accept`'s caller) also call `diagnostics.refresh()` after `state.accept()`. Do not couple the two services inside `accept`. Add a spec for it. If the plan's literal scope is to stand, record this as an accepted limitation in the batch notes.
2. `skill-synthesis-state.service.spec.ts` (accept block, about `:165-195`): there is no test for "accept succeeds, stats rejects". The `loadStats` error surface after a successful accept is therefore unpinned. Add one asserting that the list is refreshed, `suggestionsLoading` is false, and `error` holds the stats message.

### MINOR
1. `skill-diagnostics-state.service.spec.ts:39`: the shared fixture's `activeSkills` was changed from 3 to 2 with no stated reason. No other assertion depends on it (only the new tests at `:122` and `:132` use 2, and they override it explicitly). It looks like noise. It does not mask a defect, since `activeSkills` is passed straight through. Revert it, or explain it in the commit message.
2. `skill-synthesis-state.service.ts:444`: `loadStats()` swallows errors by contract, so the `await` cannot throw. The `catch` stays valid for accept and list refresh, but a stats-only failure surfaces as the single shared `error` string with no distinction from an accept failure. Acceptable, with a one-line comment worth adding.
3. `skill-pipeline-status.component.ts:229-246`: the five cells are now near-identical copy-paste blocks. Three real uses meet the plan's threshold for a small `@for` over a label/value array, but the plan explicitly asked for "the same markup pattern", so this is optional.

Verdict: NEEDS_REVISION
(No blockers. MODERATE-1 is a user-visible staleness gap against the batch's stated purpose, so a fix-up is requested. The reviewer can downgrade to APPROVED if the team records it as an accepted limitation.)

### Batch 14 re-review (revision 1)

Scope: the 8 files under `libs/frontend/skill-synthesis-ui/src/lib/`, read in full for the touched regions, plus `refreshSuggestions`, `loadStats` and `SkillDiagnosticsStateService.refresh`. No blocking or moderate issue remains.

Prior findings:
- MODERATE 1 (accept did not refresh pipeline counters): RESOLVED. `skill-suggestions-view.component.ts:456-458` and `:511-513` call `refreshPipelineCounts()` (`void this.diagnostics.refresh()`) only on success. Specs at `skill-suggestions-view.component.spec.ts` assert one refresh, ordered after `accept` via `invocationCallOrder`, for both the card and the modal path.
- MODERATE 2 (no spec for accept succeeds, stats fails): RESOLVED. `skill-synthesis-state.service.spec.ts` "keeps the accept when the follow-up stats read fails" asserts `true`, the list kept, `stats()` null, `error()` 'stats-unavailable'. A failed-accept spec asserts `stats` is not called.
- MINOR 1 (fixture activeSkills 3 to 2): RESOLVED, with a nit (M1 below).

Claim verification:
- `accept()` returns `Promise<boolean>`; the only callers are the two in the suggestions view (grep over libs/ and apps/ finds no other `state.accept(` use; backend `store.accept` is an unrelated API). Both are updated. The `degradation-audit: reported` marker is truthful: the catch sets `error`, which the view renders at line 70 and in the toast.
- Boolean honesty: `refreshSuggestions` (365-376) and `loadStats` (331-338) both catch internally, so a successful accept followed by a failed list or stats read returns `true`. This is acceptable and correct: the accept did land, and returning `false` would invite a retry of a non-idempotent promote. The failure is not lost: `error` is set and the alert at line 70 shows. The result is a success toast plus an error alert. The docblock states this. Fine.
- Error toast message: on `false`, the rejection came from `acceptSuggestion` itself, so `refreshSuggestions` never ran and its `error.set(null)` cannot have cleared it. `error()` is therefore the accept error. The fallback string covers an empty message. Matches the existing save-failure pattern at line 504.
- Ordering and races: the diagnostics refresh starts only after `accept` resolved, so the backend has already promoted. Un-awaited is justified, since `refresh()` never rejects (its catch is at 149-150). The component holds no state that depends on it. Residual: `refresh()` has no sequence guard, so an in-flight activity-poll refresh that began before the accept could resolve after and overwrite with the older snapshot. This is pre-existing and narrow, and it is not introduced here (M2).
- Modal retry: on failure `onCloseReview` is skipped, `busyId` is reset in `finally`, and a spec pins that `reviewId` stays set and `clearSuggestionDetail` is not called.
- Standalone, OnPush, signals, inject(): unchanged and compliant. There is no `[innerHTML]` and no TODO or FIXME in the touched files. Spec stubs are typed (`StateStub`, `DiagnosticsStub`, `jest.Mock<Promise<boolean>, [string]>`), and the only cast is the existing `as unknown as` private-method access idiom.

New findings (all MINOR, none gating):
- M1 `skill-diagnostics-state.service.spec.ts:39`: the comment cites "Batch 11 (2c1c8840b)". Batch and commit ids rot; state the invariant only ("activeSkills is resident-only, so it cannot exceed totalPromoted").
- M2 `skill-diagnostics-state.service.ts:139`: `refresh()` has no last-request-wins guard. Now that accept adds a third caller (tab open, manual Refresh, poll, accept), an out-of-order reply could show stale counts. Pre-existing; track as a follow-up only.
- M3 scope noise: the diff also carries the Merged, Retired and Dormant additions (`skill-diagnostics-state.service.ts:84-86,109-111,264-266`, `skill-pipeline-status.component.ts:229-246`, and their specs) and an unrelated Prettier reflow of two hunks in `skill-diagnostics-state.service.spec.ts` (about lines 285 and 322). These are not in the stated revision. They are coherent and tested, with zero-defaults for older backends. Make sure they land in the right commit, and keep the reflow out of the fix-up.
- M4 `skill-synthesis-state.service.ts:437-444`: `accept()` now reads stats itself (`loadStats`) and the view also refreshes diagnostics, so two stats-shaped reads follow each accept. Harmless, as the two stores feed different surfaces; worth one line noting why both are kept.

Verdict: APPROVED

## Batch 12

Scope: Remove superseded paths (Tasks 12.1-12.4). In `libs/backend/skill-synthesis/src`: `lib/skill-clustering.service.ts`, `lib/skill-synthesizer.service.ts`, `lib/skill-suggestion.store.ts`, `lib/skill-candidate.store.ts`, `lib/digest/skill-gap-curator.service.ts`, `index.ts`, and the specs for each. Also the rpc-handlers spec mock keys and `tools/degradation-audit/baseline.json`. Read from the uncommitted `git diff`. I also ran `nx run @ptah-extension/skill-synthesis:lint`.

Score: 9/10

Verdict: APPROVED

### Findings

BLOCKING: none.

SERIOUS: none.

MODERATE: none.

MINOR
- M1. `skill-synthesizer.service.ts:89`: `CLUSTER_MEMBER_MAX_CHARS` is now used only by the umbrella prompt, at `:242` and `:467`. "Cluster" names the deleted path's vocabulary. The executor already adjusted the JSDoc to say "umbrella prompt", so the name is the one leftover. Renaming to `UMBRELLA_MEMBER_MAX_CHARS` would match the neighbouring `UMBRELLA_MAX_MEMBERS`. There is no behaviour cost.
- M2. `skill-gap-curator.service.spec.ts:~330`: the source scan changed from `'insertPending('` to `'.insert('`. It is still a valid guard, but weaker than before:
  - `insertPending(` was unique to the one call path. `.insert(` is a substring that would also fire on any unrelated `.insert(` in the curator, such as a Map or DB helper. A false positive would fail loudly, so that direction is safe.
  - The scan will not catch `store.insert (`, a destructured `const { insert } = store`, or a bracket call. Those are theoretical. The DB-count assertion still backs it up on a seeded pass.
  - The doc comments at `skill-gap-curator.service.ts:17` and `:760` now say `` `insert` is never called ``. This is accurate. `SkillSuggestionStore.insert` is the public method that survives (`skill-suggestion.store.ts`, around `:95`). Optionally say "`SkillSuggestionStore.insert`" for a reader who lacks the context.
- M3. `index.ts:144-146`, `:163`: `PoolExclusions`, `PoolMember`, `PoolPartition` and `CuratorPassStats` have zero consumers outside `libs/backend/skill-synthesis/src/lib` (`git grep` over `apps` and `libs` found none). This matches how the barrel already exports the return types of public service methods (`CuratorReport`, `SynthesizedSkill`). `CuratorPassStats` is reachable through `CuratorReport`, so exporting it is defensible. Not a defect.

### Checks 1-6

1. Deleted symbols.
   - `git grep` over `libs`, `apps` and `tools` found no match for `clusterCandidates`, `SkillCandidateCluster`, `ClusterMemberInput`, `synthesizeFromCluster`, `buildClusterPrompt`, `insertPending`, `hasExistingForCluster`, `listInvocations`, `RawInvocationRow` or `listActiveOrderedByActivity`.
   - The only `toInvocationRow` hits are the unrelated private method in `skill-scorecard.service.ts:151,217`. That matches the claim.
   - No orphans remain:
     - `SkillCandidateRow`, `SkillSynthesisSettings` and `agglomerate` are still used by `partitionPool` (`skill-clustering.service.ts:26-28,94`).
     - `SkillSynthesisSettings` is still used by the trajectory path (`skill-synthesizer.service.ts:214`).
     - `SkillInvocationRow` is still used by `listInvocationEvents`.
     - The prompt constants are still used (`CLUSTER_MEMBER_MAX_CHARS`, see M1).
   - Doc comments were updated: the clustering header, the synthesizer header and the "per-session / cluster" JSDoc. No remaining comment cites a deleted name.
2. The gap-curator source scan is still meaningful. See M2. It guards the invariant, with a slightly different shape, and the "never CALLS" intent is intact. The rename of the seed helpers to `insert(x, 'pending')` in the spec is mechanical and correct.
3. Barrel.
   - Every new export is defined and exported at its source:
     - `UmbrellaMemberInput` at `skill-synthesizer.service.ts:192`.
     - `PoolMember`, `PoolExclusions` and `PoolPartition` at `skill-clustering.service.ts:37,48,55`.
     - `CuratorPassStats` at `lib/lifecycle/curator-report.ts:13`.
   - No external consumer of the removed `ClusterMemberInput` or `SkillCandidateCluster` exists in `apps` or `libs`.
   - `CuratorPassStats` is re-exported from `./lib/skill-curator.service`. I did not check that the source file itself re-exports it, because the new `index.ts` entry sits in the block for that module. The executor ran typecheck, and a missing re-export would fail it. I judge this a low-risk assumption.
   - Consistent with the existing barrel style (`type` re-exports inside the grouped export blocks).
4. Spec deletions removed only cases for deleted code:
   - Four `clusterCandidates` cases in the clustering spec.
   - The `synthesizeFromCluster` describe in the synthesizer spec (6 cases).
   - Three `hasExistingForCluster` cases in the suggestion-store spec.
   - Surviving coverage is intact:
     - `partitionPool` has 10 cases covering fail-open, orphans, exclusions, the truncation cap, centroids, dimension mismatch and chaining.
     - `synthesizeUmbrella` has 8 cases. These include the empty cluster, no lane, the schema, and the member cap with clipping. The `user-action` lane case survives at `skill-synthesizer.service.spec.ts:495`, and the shared `runSynthesis` path is covered through it.
     - Rewriting `insertPending(x)` to `insert(x, 'pending')` across the suggestion-store spec (the roughly -100/+80 delta) is mechanical and loses no assertions.
   - Slight loss: the bounding-per-member case for the old cluster prompt is replaced by the umbrella's "each clipped" case at `:500`. Equivalent.
5. R-h holds. The lint output reports `skill-candidate.store.ts` at 1272 lines (`max-lines` warning at `1010:1`), which meets the target of ≤ 1272. The raw file went from 1825 to 1792 lines (HEAD to working tree). A row-mappers split is not needed. The unused `RawInvocationRow` and `toInvocationRow` were removed together with `listInvocations`.
6. Naming and maintenance.
   - `linkPromotedCandidate` is kept, as the Batch 9 carry requires.
   - The baseline went from 6 to 5, matching the carry.
   - `rpc.types.ts` is untouched and the batch's own diff does not touch it.
   - `skills-synthesis-rpc.handlers.spec.ts` lost only the two dead mock keys.
   - The net effect retires about 415 lines of superseded code and introduces none. The only residual naming debt is M1.
   - Lint's other warnings in the `skill-synthesis` lint output (for example the 906- and 757-line `max-lines` warnings in other files) are not in this diff's scope.
