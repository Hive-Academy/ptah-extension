## Backend implementation — `TASK_2026_646_136a`, batch 16 (A4b: capability matrix store and local derivation)

**Tasks completed**: Task 16.1. The store merges seed, user-file and local-derived cells (Req 6.4–6.8). Local derivation is a pure function of `LaneOutcomeSummary` rows.

**Files** (all CREATED; no existing file modified; `src/index.ts` left for Batch 33):

- CREATED `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\matrix\capability-matrix.store.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\matrix\local-derivation.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\matrix\capability-matrix.store.spec.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\matrix\local-derivation.spec.ts`

**Stack observed**:

- Reuses Batch 9 (`55a58c96b`): `CapabilityMatrixSchema` (`matrix.schema.ts`), `isStale` and `buildSeedMatrix` (`seed-matrix.ts`), `FAMILY_PROFILE_MODEL`, `CAPABILITY_MATRIX_VERSION`, `ValueMatrixCell` (`matrix.types.ts`). Schemas are not redeclared.
- Constants from `routing-constants.ts`: `NEUTRAL_SCORE`, `OUTCOME_WINDOW_MS`, `MINIMUM_SAMPLE_COUNT`, `SCORE_MIN`, `SCORE_MAX`.
- Shared: `LANE_DEFAULT_MODEL`, `SUBAGENT_LANE_ID`, `OUTCOME_TASK_KINDS`, `LaneOutcomeReader`, `LaneOutcomeSummary`.
- File IO is `IFileSystemProvider` from `@ptah-extension/platform-core`. Logger is the lib-local `LaneRoutingLogger` (`lane-routing-logger.ts`).
- No `@injectable`. `LANE_ROUTING_TOKENS.CAPABILITY_MATRIX_STORE` already exists; AB14 constructs `new CapabilityMatrixStore(...)`. `register.ts` and `src/index.ts` were not edited.

### PA-2

platform-core has no exported home-path helper. Grep of `'.ptah'` under `libs/backend/platform-core/src` finds only private joins:

- `libs/backend/platform-core/src/agent-pack-download.service.ts:97` — `this.ptahDir = path.join(homedir(), '.ptah')`
- `libs/backend/platform-core/src/content-download.service.ts:98` — same private field
- `libs/backend/platform-core/src/file-settings-manager.ts:89` — `this.dirPath = dirPathOverride ?? path.join(homedir(), '.ptah')` on `PtahFileSettingsManager` (`file-settings-manager.ts:55`). The override is a constructor argument, not a shared helper.

A function-name search for an exported `ptahHome` / home-path helper returned no match. The store takes the absolute directory by constructor injection (`capability-matrix.store.ts:72-75`, guard and path bind at `:165-170`). It does not expand `~` and rejects an all-whitespace directory. AB14 supplies the directory per host.

### Write path (Mode 3 trace)

Both files live under the injected directory. Helpers: `capabilityMatrixUserPath` (`capability-matrix.store.ts:64-66`) and `capabilityMatrixViewPath` (`:68-70`).

| Path | Format | Read | Write |
| --- | --- | --- | --- |
| `{ptahHome}/routing/capability-matrix.json` | Capability matrix v1 JSON, pretty-printed with a trailing newline. The empty template is `EMPTY_CAPABILITY_MATRIX_TEXT` (`:56-60`): `{ "version": 1, "profiles": [] }`. A later user edit is whatever JSON `CapabilityMatrixSchema` accepts, with every value cell `source: "user"`. | At most once per `load` (`readUserMatrix`, `:199-216`). | Only when the read is a missing file (`ENOENT`, `FileNotFound`, or `Error.name` starting with `EntryNotFound`, `:625-631`). `writeEmptyTemplate` (`:219-228`) writes the empty template. An existing file, including an invalid one, is never rewritten. |
| `{ptahHome}/routing/capability-matrix.view.json` | Pretty JSON plus a trailing newline (`serializeView`, `:519-521`). Document is `{ version, profiles }` (`viewDocument`, `:465-484`). Profiles are sorted by family, then model, with `*` first (`:523-533`). Each value cell always includes `source`, `sourceRef` (string, or `null` when the cell omitted it), `asOf`, `stale` (recomputed with `isStale` at `nowMs`), and `sampleCount` (number, or `null` when omitted). `note` is included only when the cell has one (`toViewCell`, `:504-517`). Unknown cells are `{ "kind": "unknown" }`. | At most once per store instance, to compare canonical text (`rememberedViewText`, `:332-346`). A missing view is not warned. | During `load`, after the merge, only when the canonical text differs from the remembered text (`writeViewIfChanged`, `:316-329`). A failed write is logged and retried on the next load whose text still differs. The view is output; a write failure adds no routing reason. |

`load` order (`:177-196`): finite `nowMs` check, then user file, then local derivation, then `buildSeedMatrix(nowMs)`, then the view write, then the snapshot.

### Per-requirement evidence

Precedence is user, then local, then seed, then unknown. An unknown cell does not hide a lower layer (`mergedCell`, `:448-462`). Layers are indexed in that order (`load`, `:186-190`).

**Req 6.4 — unknown cell or unseen family stays eligible at the neutral score, with a "no profile" signal.**

- Resolve: `resolveIndexed` (`capability-matrix.store.ts:400-420`). A missing value cell is `{ kind: 'unknown' }`, `score` is `NEUTRAL_SCORE` (50), and `noProfile` is true. The words "no profile" stay in the Batch 13 reason compiler, which reads `cell.kind === 'unknown'`. This batch does not import `reasons/`.
- Family fallback when the model has no profile row: `profileModelFor` (`:428-436`) returns `FAMILY_PROFILE_MODEL` (`*`). `lane-default` and `auto` always use `*`, even when a row is stored under that model id (`:423-427`). A profile of all-unknown cells still exists (`hasProfile`, `:439-446`) and blocks family fallback for that model.
- Spec: `capability-matrix.store.spec.ts:315` (`resolves an unseen family to the neutral score`). Unseen family and `z-ai` / `glm-5` / `plan` (seed value is implement only) both resolve unknown, score 50, `noProfile: true`. Family-fallback cases: `:619` and `:646`.

**Req 6.5 — a user edit is used from the next decision, source `user`, and stays when seed or local later changes.**

- A valid user file replaces `lastValidUser` (`acceptUserText`, `:258-259`) and is the first layer (`:186-187`). `mergedCell` returns the first value cell (`:456-460`) and refreshes `stale` with `isStale` without rewriting the user file.
- Spec: `capability-matrix.store.spec.ts:332` (`keeps a user value over the seed and over later local rows`). User implement score 42, source `user`, `sourceRef` `editor`, beats seed 80 and five local delivered runs (score 100). A later load past the staleness boundary keeps score 42 and source `user`.

**Req 6.6 — at the minimum sample count, a local value replaces the seed, with source `local`, a sample count, and `asOf` equal to the newest contributing record.**

- Pure function `deriveLocalMatrix` (`local-derivation.ts:60-75`). Window is `nowMs - OUTCOME_WINDOW_MS`; a row with `endedAt < sinceMs`, a null `taskKind`, a non-finite `endedAt`, or a blank family or model is skipped (`bucketFor`, `:124-133`).
- Delivered rate is delivered ÷ (delivered + no-deliverable + failed). Unverified is excluded from that denominator (`countSummary`, `:166-186`). Review pass is approved ÷ (approved + rejected); `finalReview: null` is excluded (`:187-201`). A rate qualifies at `MINIMUM_SAMPLE_COUNT` (5). `r` is the only qualifying rate, otherwise the mean (`scoreBucket`, `:277-307`).
- Score is `round(100 * r)`, half away from zero, on integers: `floor((200n + d) / (2d))` (`roundPercent`, `:314-318`). The mean uses the same half-up form after scaling (`roundMean`, `:322-335`). A product that is not a safe integer skips that cell (`safeMul` / `floorRatio`, `:344-368`).
- `asOf` is `new Date(newest.endedAt).toISOString()` (`cellFrom`, `:265-274`). `sampleCount` is the number of unique runs that contributed to the rate or rates used (`unionByRun`, `:371-378`). Source is `'local'` and the object has no `sourceRef`. `stale` is `isStale(asOf, nowMs)`.
- `lane-default` and `auto` are stored on `*` (`matrixModelKey`, `:155-159`). Duplicate `runId`s collapse before grouping; a finite `endedAt` beats `NaN`, a newer `endedAt` wins, and a tie uses a JSON key of verdict, final review, task kind, family and model (`dedupeByRun` / `preferSummary` / `tieKey`, `:88-122`).
- Store: five qualifying runs replace the seed because the local layer is above the seed (`:186-190`, `:456-460`). Fewer than five leave no local cell, so the seed remains. `deriveLocalMatrix` is called outside the outcome-read `catch` (`:296`), so a derivation throw is not relabeled `outcomes-unavailable`.
- Specs:
  - `local-derivation.spec.ts:96` — 4 delivered + 1 failed → score 80, `sampleCount` 5, source `local`, no `sourceRef`, `asOf` is the newest (failed) run, schema accepts the matrix.
  - `:115` five delivered → 100. `:121` four runs → no profiles.
  - `:125` review-only rate. `:132` mean of both rates → 60. `:149` half-up 1/8 → 13. `:165` mean of two 1/8 rates → 13.
  - `:182` `asOf` comes from the rate that qualified, not a newer row excluded from that rate.
  - `:203` null task kind, unverified, and `endedAt` before the window are excluded; `endedAt === sinceMs` is included.
  - `:216` families, models and task kinds are not pooled. `:225` `lane-default` and `auto` pool onto `*`. `:237` sort order. `:255` shuffle equality and duplicate `runId` (newer delivered wins). `:286` non-finite `nowMs` throws `nowMs must be a finite epoch millisecond`.
  - `capability-matrix.store.spec.ts:363` — four delivered runs keep seed 80; five replace it with local 100 and `sampleCount` 5. `:646` maps `lane-default` outcomes onto `*`.

**Req 6.7 — a malformed edit is rejected with a message that names the entry, and the last valid matrix is kept.**

- JSON parse failure: `matrix-invalid: capability-matrix.json (not valid JSON)` (`:235-241`). The parser text is not copied into the reason.
- Schema failure: each Zod issue is prefixed and names `family`, `model`, and task kind when the path is `['profiles', index, 'cells', kind]` (`schemaReasons` / `namedIssue` / `profileIdentity`, `:536-585`). An empty issue list still yields `matrix-invalid: capability-matrix.json (invalid)` (`:248-251`).
- Second pass, after the schema: a value cell whose source is `seed` or `local` is rejected. Unknown cells are allowed. Message shape: `matrix-invalid: family "…" model "…" task "…" source must be "user" (found "seed"|"local")` (`nonUserSourceReasons`, `:587-600`).
- At most 20 named reasons, then `matrix-invalid: N more entries` (`capReasons`, `:613-618`). One bad cell rejects the whole file. `lastValidUser` is replaced only after both passes succeed (`:254-259`). A missing file resets the in-memory copy to empty (`:205-208`). An unreadable file keeps the last valid copy and reports `matrix-invalid: capability-matrix.json (unreadable)` (`:210-214`).
- Spec: `capability-matrix.store.spec.ts:393` (source `seed` and source `local`, entry named, previous score kept). `:440` (score 101 names the implement entry and keeps the previous plan cell; invalid JSON reason is exact and a warning is logged; a duplicate profile names family and model). `:492` (24 bad cells → 21 reasons, the last is `matrix-invalid: 4 more entries`, family `a` task `docs` is shown, family `d` task `docs` is omitted). `:716` missing file keeps the seed and writes the template; `EACCES` reports the unreadable reason, writes nothing, and logs a warning.

**Req 6.8 — where the matrix is shown, every value carries source, asOf, and stale. TL-10 adds `sourceRef` and sample count.**

- View projection: `toViewCell` (`:504-517`) and the write rule in the table above. `stale` on the view and on `resolve` is recomputed (`mergedCell`, `:459`); the user file bytes are left as the user wrote them.
- Spec: `capability-matrix.store.spec.ts:534` (`writes the view with provenance only when its content changes`). First load writes `EMPTY_CAPABILITY_MATRIX_TEXT` once and reads the user file once. The seed implement cell in the view has source `seed`, `sourceRef` equal to `SEED_SOURCE_REF`, `asOf` `2026-02-17`, `stale: true` at the spec clock, `sampleCount: null`, and `note` equal to `SEED_NOTE`. The plan cell is `{ kind: 'unknown' }`. A second load on the same store does not write the view again and does not re-read it. A new instance reads the view once and skips the write. A user cell stored with `stale: false` and `asOf` `2020-01-01` is shown with `stale: true`, source `user`, `sourceRef` `editor`, and `sampleCount: null`, and the user path is not written again. `resolve(...).cell.stale` matches `isStale`.

### Outcome-reader reasons (SC-2)

- No reader: `outcomes-unavailable`, and `recentOutcomes` is not called (`:267-268`). Spec `:679`.
- `isPersistent()` false: `no outcome history`, and `recentOutcomes` is not called (`:274-275`). Spec `:665`.
- `isPersistent()` throws, returns a non-boolean, `recentOutcomes` throws, or a batch is not an array: `outcomes-unavailable` (`:270-272`, `:299-313`, `:375-385`). Spec `:679`.
- Persistent reader and an empty query list: no local cells and no reason (`:277-279`).
- Subagent queries call `recentOutcomes(SUBAGENT_LANE_ID, { sinceMs })` once per distinct lane id. A blank non-subagent lane id is skipped (`readerLaneIds`, `:362-372`). Spec `:698`.

### Needed `src/index.ts` exports (Batch 33; not edited here)

From `capability-matrix.store.ts`:

- `CapabilityMatrixStore`
- `CapabilityMatrixStoreDependencies`
- `MatrixOutcomeQuery`
- `MatrixLoadInput`
- `CapabilityMatrixSnapshot`
- `ResolvedMatrixCell`
- `CapabilityMatrixView`
- `MatrixViewProfile`
- `MatrixViewCell`
- `MatrixViewValue`
- `MatrixViewUnknown`
- `capabilityMatrixUserPath`
- `capabilityMatrixViewPath`
- `EMPTY_CAPABILITY_MATRIX_TEXT`
- `MATRIX_INVALID_PREFIX`
- `OUTCOMES_UNAVAILABLE_REASON`
- `NO_OUTCOME_HISTORY_REASON`

From `local-derivation.ts`:

- `deriveLocalMatrix`
- `AUTOMATIC_MATRIX_MODEL`

`ResolvedMatrixCell.cell` and the snapshot types refer to Batch 9's `MatrixCell` / `CapabilityMatrix` / `MatrixProfile` / `MatrixCellSource`. Those are still absent from `src/index.ts` and belong in the same barrel edit.

### Verification

- `npx eslint` on the four files: exit 0, no findings. (Node printed only the `NO_COLOR` / `FORCE_COLOR` warning.)
- `npx prettier --write` on the four files before the line citations above.
- Degradation audit, filtered in PowerShell with `Select-String -Pattern "lane-routing|FAIL|TOTAL"` because this shell has no `grep`. Tail:

```
degradation-audit: per-directory totals
degradation-audit: TOTAL 296 unsuppressed site(s)
```

No line contained `lane-routing` and no line contained `FAIL`. `tools/degradation-audit/baseline.json` has no `libs/backend/lane-routing` key, so the baseline is 0. The script lists a directory only when it has a finding or a baseline entry (`check-degradation.ts:812-838`) and prints `FAIL (baseline N)` when the count exceeds the baseline (`:823-824`). Absence means the lane-routing count is 0. The pipeline exit code is the filter's exit (0); the script still reached its TOTAL line.

- Jest and Nx were not run (decision #53). The team-leader owns `J(libs/backend/lane-routing, …/capability-matrix.store.spec.ts)` and `J(libs/backend/lane-routing, …/local-derivation.spec.ts)`.

### Decisions

| Decision | Choice | Evidence | Reversible |
| --- | --- | --- | --- |
| Home directory | Constructor `ptahHomeDir: string`. The store does not call `homedir()`. | PA-2 above. Guard at `capability-matrix.store.ts:166-167`. | yes, when platform-core grows a helper |
| User-file source check | Second pass after `CapabilityMatrixSchema`. Value cells must be `source: "user"`. Unknown cells stay valid. | Req 6.7. `nonUserSourceReasons` `:587-600`. Schema already requires `sourceRef` on seed and forbids it on local. | yes |
| Precedence grain | Per cell, first value wins. A profile row of unknown cells still counts as "has a profile" for family fallback. `lane-default` and `auto` always read `*`. | Plan "when the model is lane-default/auto or has no profile". `profileModelFor` `:428-436`, `mergedCell` `:448-462`. Locked by spec `:619`. | yes |
| Local model key | Derivation stores `lane-default` and `auto` as `*`, matching lookup. | `matrixModelKey` `:155-159`. Req 11.3. Spec `:225`, `:646`. | yes |
| Sample count and asOf | Unique runs that entered the qualifying rate or rates. `asOf` is the newest of those. | `cellFrom` `:265-274`, `unionByRun` `:371-378`. Spec `:182`. | yes |
| Rounding | Integer half-away-from-zero. An unsafe product skips the cell. | `roundPercent` `:314-318`, `roundMean` `:322-335`. Spec `:149`, `:165`. | yes |
| View nulls | The view writes `sourceRef: null` and `sampleCount: null` when the matrix cell omitted them. Local matrix cells still omit `sourceRef`, so `ValueMatrixCellSchema` still accepts them. | `toViewCell` `:504-517`. Local cells cannot carry `sourceRef: null` under the Batch 9 schema. Spec `:534`. | yes |
| Last valid copy | In memory only. A missing file resets it to empty and writes the template once. A bad edit keeps the previous copy and does not write the user file. | `:205-208`, `:243-259`. Spec `:393`, `:440`, `:716`. | yes |
| Outcome reasons | `isPersistent() === false` → `no outcome history` and no read. Missing reader, throw, non-boolean, or non-array → `outcomes-unavailable`. | `:262-313`. Spec `:665`, `:679`. | yes |
| "no profile" text | Store sets `noProfile: true`. The phrase stays in `compile-reasons.ts`. | Req 6.4. Avoids importing the other writer's reasons module. | yes |
| Degradation catches | Each swallowing `catch` starts with `// degradation-audit: reported - …` and calls `logger?.warn`. `readPersistent`'s catch returns `unavailablePersistence()` so the catch itself is not a string-literal sentinel. | `:203-204`, `:225-227`, `:235-237`, `:288-294`, `:309-312`, `:326-328`, `:339-345`. | yes |
| Template race | A user who creates `capability-matrix.json` between the missing-file read and `writeFile` can be overwritten. `IFileSystemProvider` has no exclusive create. Recorded, left as-is. | `writeEmptyTemplate` `:219-228`. | yes, if the port gains exclusive create |
| Barrel and DI | No edit to `src/index.ts` or `register.ts`. | Batch 33 owns the barrel. AB14 owns host wiring. Token already exists. | n/a |
| Tests | Specs written. Jest not executed in this batch. | Decision #53. | n/a |

### Not done

- `libs/backend/lane-routing/src/index.ts` was not updated. Exports are listed above for Batch 33.
- No DI registration and no host phase wiring (AB14).
- Jest / Nx / typecheck were not run. Specs are unexecuted.
- No git commit, push, or PR.
- `ptah_agent_report` is not on this session's MCP servers. `search_tool` for `ptah agent report`, `ptah`, `report`, and `agent spawn message list` found only the `tasks` automation tools (`tasks__list` and trigger helpers). The orchestrator summary is in the executor's final message.
