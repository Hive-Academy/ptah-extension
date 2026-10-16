## Backend implementation — `TASK_2026_646_136a`, batch 9 (A4: matrix data)

**Tasks completed**: Task 9.1, capability matrix types, schema and seed.

**Files** (all CREATED; no existing file modified; `src/index.ts` untouched because A8 owns the exports):

- CREATED `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\matrix\matrix.types.ts`: `FAMILY_PROFILE_MODEL = '*'`, `MATRIX_CELL_SOURCES` (`seed`/`user`/`local`), `CAPABILITY_MATRIX_VERSION = 1`, and the readonly interfaces `UnknownMatrixCell`, `ValueMatrixCell`, `MatrixCell`, `MatrixCells` (`Record<OutcomeTaskKind, MatrixCell>`), `MatrixProfileKey`, `MatrixProfile`, `CapabilityMatrix`.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\matrix\matrix.schema.ts`: Zod 4 `.strict()` schemas (`UnknownMatrixCellSchema`, `ValueMatrixCellSchema`, `MatrixCellSchema` discriminated on `kind`, `MatrixCellsSchema`, `MatrixProfileSchema`, `CapabilityMatrixSchema`). Each one is checked with `satisfies z.ZodType<…>` against the interfaces, so the schema and the types cannot drift apart.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\matrix\seed-matrix.ts`: the seed data (`SEED_MATRIX_ROWS`), `SEED_SOURCE_REF`, `SEED_NOTE`, `isStale(asOf, nowMs)` and `buildSeedMatrix(nowMs)`.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\matrix\seed-matrix.spec.ts`: checks the seed against the schema, Req 6.2 and 6.3, the staleness boundary, family/model matching, and the schema's rejection cases.

**Stack observed**:
- Zod 4.6.5 (`package.json:207`).
- The schema style follows `contracts/route-decide-result.schema.ts` and `route-decide-args.schema.ts` (Batch 5): `.strict()` objects, and `superRefine` issues written as `code: 'custom'` with a `path`.
- Constants are imported from `routing-constants.ts`: `SCORE_MAX` :18, `SEED_LABEL_SCORE` :24, `STALENESS_AGE_MS` :144, `MINIMUM_SAMPLE_COUNT` :147.
- Task kinds come from `OUTCOME_TASK_KINDS` (`libs/shared/src/lib/types/lane-outcome.types.ts:17`).
- No DI and no registration in this batch.

### Per-task evidence (Task 9.1)

- **Profile key.** A profile is keyed by `{ family, model }`. `model = '*'` marks the family-level profile (part-a §3, line 190).
- **Cells.** A cell is `{ kind:'unknown' }` or `{ kind:'value', score, source:'seed'|'user'|'local', asOf, stale, note?, sampleCount? }` (part-a line 192). There is one cell per task kind. The spec pins the cell key set to `OUTCOME_TASK_KINDS` through `MatrixCellsSchema.shape`.
- **Score.** An integer from 0 to 100 (S scale).
- **`asOf`.** An ISO date or an ISO date-time with an offset. Seed rows use a date. Local cells (A4b) can carry the timestamp of the newest record.
- **Rules between fields** (in `ValueMatrixCellSchema.superRefine`):
  - A `seed` value needs `sourceRef` and `note` (Req 6.2).
  - A `local` value needs `sampleCount ≥ MINIMUM_SAMPLE_COUNT` and has no `sourceRef` (Req 6.6).
  - Only a `local` value may carry `sampleCount`.
- **Matrix level.** Duplicate `(family, model)` keys are rejected, and the issue path names the entry (`['profiles', i, 'model']`). This is the groundwork for the Req 6.7 "message naming the entry"; A4b formats the message. Profiles are capped at 1000 to bound the validation work on a hand-edited file.
- **Seed.**
  - Only the implement kind holds a value. Every other kind is built as `unknown` (Req 6.3).
  - Each value carries `source: 'seed'`, `sourceRef` (the SWE-bench Verified board URL), `asOf` (the result's publication date), `note: 'backend implementation only'`, and `stale` computed at `nowMs` with the boundary `now - asOf > STALENESS_AGE_MS`.
  - There is no family-level profile in the seed: the benchmark scores models, so a family value would be inferred.
- **Req 6.9.** The only table that maps a vendor to a task is the matrix seed itself.

### Seed row matching (plan rule: "family stated in the row and model id exactly as the lane lists it")

Source rows: `research-routing-landscape.md:19-41`. Rates and dates: `:51-66`.

| Research row (label [1]) | Result | Evidence |
| --- | --- | --- |
| GLM-5 high (Z.ai), strong, 2026-02-17 | **Seeded** as family `z-ai`, model `glm-5`, score 80 | provider `id: 'z-ai'` `libs/shared/src/lib/providers/provider-registry.ts:265`; `staticModels` :285; `id: 'glm-5'` :341. The spec asserts the id is in that provider's shipped list |
| Claude Opus 4.5 high, Opus 4.6 (in-process) | omitted | the subagent lane offers tiers `opus`/`sonnet` only (`implementation-plan-part-a.md:774-775`) |
| GPT-5.2 high, GPT-5.2-Codex, GPT-5.1-Codex medium (Codex CLI) | omitted | not in `FALLBACK_MODELS` (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts:378-386`) |
| Claude Sonnet 4.5 high (cites Copilot CLI) | omitted | the Copilot shipped list has `claude-sonnet-4.6` but no 4.5 (`copilot-sdk.adapter.ts:115-142`) |
| Claude Haiku 4.5, GPT-5.1 medium, GPT-5 medium, GPT-5 mini medium, Gemini 3 Flash high, Gemini 3 Pro | omitted | the row names no Ptah lane, and the Gemini rows say "not confirmed as … Antigravity default" |
| GLM-4.6, GLM-4.5 | omitted | unlabelled ("no data", undisclosed scaffold) |

The seeded set is therefore one profile. That matches the research verdict that public evidence is thin (decisions.md #7). Every other lane resolves to "no profile" or neutral in A4b.

### Assumptions

No PA-* or other plan-owned assumption names Batch 9 or A4 (`batches.md:85-104`). Batch-local facts I checked:

- **`OUTCOME_TASK_KINDS` holds the six kinds.** Holds: `lane-outcome.types.ts:17-24`.
- **Constants exist in `routing-constants.ts`.** Holds (Batch 1): the lines are cited above.
- **The Z.ai Ptah CLI family key equals the provider id.** Holds: `laneFamilyOf` returns `providerId` for `ptah-cli` (`libs/shared/src/lib/utils/lane-family.ts`, `laneFamilyOf`).
- **Zod 4 `.superRefine` keeps a `ZodObject`, so `discriminatedUnion` accepts the refined value schema.** Holds: diagnostics are clean, and the spec runs it.

### Risks and edge cases

- **Rule 9.** The source files import only `zod`, the lib's own `routing-constants` and `@ptah-extension/shared` (type and runtime). The spec also imports `ANTHROPIC_PROVIDERS`, `SYSTEM_CLI_TYPES` and `SUBAGENT_FAMILY` from `@ptah-extension/shared`. Nothing imports `vscode-core` or `platform-core`.
- **Strict TypeScript.** No `any`, no `@ts-ignore`, no `as unknown as`, and no casts.
- **R-8 (cycle).** No new edges beyond `shared`.
- **A seed row matched to the wrong family or model** (task-description risk at line 592). Mitigated by the omission rule above and by the spec check that each provider-family row's model id is in the shipped `staticModels`.
- **Staleness boundary.** `isStale` is `false` at exactly `STALENESS_AGE_MS` and `true` 1 ms later. An `asOf` that does not parse counts as stale.
- **Shared mutable state.** `buildSeedMatrix` returns fresh objects on every call; the spec checks this.

### Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| The cell's `source` stays the plan's provenance enum (`seed`/`user`/`local`). The dataset or URL goes in an added optional `sourceRef` field, required for `seed` | (a) make `source` a free string holding the URL; (b) a union of cells per source | Part-a:192 types `source` as the enum, and A4b precedence and the A7 reason templates consume it. Req 6.2 asks for the dataset or URL to be recorded and Req 6.5/6.6 for the provenance kind, so both are needed. A flat shape keeps `cell.sampleCount` readable without narrowing | yes |
| `SEED_SOURCE_REF` is the BenchLeader "SWE-bench Verified (any scaffold)" URL, not `swebench.com` | `https://www.swebench.com/` | Research source [1] is the page the rates and publication dates were read from; it cites swebench.com upstream | yes (one constant) |
| `isStale` lives in `seed-matrix.ts` | `matrix.types.ts` | The seed is its only consumer today. A4b may import it or move it | yes |
| The seed holds no family-level (`'*'`) profiles | derive them from the model rows | Req 6.3 spirit and the plan's "without guessing" rule | yes |

**Verification**:
- `ptah_get_diagnostics` (typescript-compiler) on the four files: **0 errors, 0 warnings**. The first run found one error at `seed-matrix.spec.ts:31` (`staticModels` possibly undefined); I fixed it and re-ran clean.
- Per the spawner's instruction (decision #53, RAM), I ran no Nx or Jest command. Batch verification `J(libs/backend/lane-routing, libs/backend/lane-routing/src/lib/matrix/seed-matrix.spec.ts)` is left to the team-leader:
  `npx jest -c libs/backend/lane-routing/jest.config.ts libs/backend/lane-routing/src/lib/matrix/seed-matrix.spec.ts --coverage=false --maxWorkers=2`.
- Lint has not been run. The wave-3 shared check is `npx nx lint @ptah-extension/lane-routing`.

**Plan deviations**: the `sourceRef` field (see Decisions). Nothing else.

**Out-of-scope observations**: `src/index.ts` does not yet export the Batch 5 contracts or the matrix modules. That is A8's job, as planned.
