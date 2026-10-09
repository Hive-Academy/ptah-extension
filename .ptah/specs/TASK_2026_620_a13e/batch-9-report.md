# Batch 9 report: Blind labelling packet and CSV template

Executor: backend-developer sub-agent. Worktree
`D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench`. Nothing was committed.

Status: implemented, verified, and the real packet is built. Handoff to **U1**.

## Tasks

### 9.1 Stratified sample selector: done

Files:

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\labelling\select-rubric-sample.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\labelling\select-rubric-sample.spec.ts`

- `selectRubricSample(inputs)` is pure and deterministic. All ordering uses `sha256(seed + key)`, and
  the default seed is `TASK_2026_620`.
- **authored**: every git-tracked `.claude/skills/*/SKILL.md` at the pinned commit
  `d995a1e1a237193e011c46ab89d40d3133b338f5`, minus the 2 promoted skills, gives 23. This is read with
  `git ls-tree` / `git show <commit>:<path>` through argument arrays with a 30 s timeout.
  `ptah-surface-authoring` is untracked at that commit, so it is excluded. The selector re-checks this
  every time it runs.
- **promoted-synthesized**: 2, read from the repository at the pinned commit.
- **anchor-471**: the 10 ids and 471 totals from `TASK_2026_471_b3d1/skill-quality-criteria.md:78-87`.
  Each is resolved by candidate id, and by slug if the id is not found. The 471 totals go only to the
  private id-map, for the Batch 21 anchor-stability check.
- **suggestion**: all 18 `skill_suggestions` rows. Body and description come from the snapshot.
- **judged-model**: model-shaped body, `judge_score` set, transcript size known (98 in the pool).
  Transcript size is `MAX(turn_count)` in `skill_synthesis_queue` for the source sessions; it is read
  from the snapshot, so no transcript file is opened. There are 8 cells: 4 creation-week bands ×
  above/below the median of 190.5 turns. The week bands are contiguous, non-empty and as equal as
  possible (least squares, `weekBands`). A first version cut bands at quartile boundaries and left
  two cells empty because one week holds 46 of the 98; this was fixed and covered by a spec. The 20
  picks are allocated by `allocate`, and a cell's deficit moves to cells with spare candidates.
  Cells: 3/2/2/2/3/3/2/3.
- **fallback**: the assumption holds. A fallback body can be identified by the two fixed lines that
  `SkillSynthesizerService.synthesizeBody` writes ("This skill was synthesized automatically…" and
  `## Trajectory (normalized)`). 1,593 of the 2,745 copy bodies match. The `random` merge was
  implemented and specced, but it was not needed.
- **random**: 12, drawn uniformly from the remaining 2,694 candidates. Any shortfall in another
  stratum moves to `random`, so n stays 105; this is specced.
- Real run result: **105 documents, counts exactly 23/2/10/18/20/20/12, no shortfalls, no notes.**

### 9.2 Packet builder and CSV template: done

Files:

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\labelling\build-labelling-packet.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\labelling\build-labelling-packet.spec.ts`

- The packet is written only under `<benchData>/labelling/skill-rubric-v1/`. It is built in a staging
  directory and then renamed into place. The staging directory is removed on any error, and a spec
  covers this.
- Each document is one file, `documents/<opaqueId>.md`, with opaque id `SKD-` + 8 hex characters of
  `sha256(seed:opaque:key)`.
- Frontmatter: `name` is replaced by the opaque id. Only `description` and `when_to_use` are kept,
  re-emitted in one uniform double-quoted style. Other keys are dropped and recorded privately: 2
  authored skills carry `license`. Quoting style is also normalised, because authored skills use
  single-quoted descriptions and candidates never do.
- Hyphenated slugs are replaced by the opaque id in the body, description and references.
  Single-word slugs (for example `orchestration`, `tribunal`, `impeccable`) are left alone because
  they are ordinary words; 6 authored documents contain their own single-word name.
- Line endings are normalised to LF. Every document has the fixed separator
  `<!-- ===== REFERENCE FILES (inlined for labelling) ===== -->`, followed by the inlined
  `references/` (or `reference/`) markdown files, or by `_No reference files._`.
- The order is shuffled separately for each rater: `sort by sha256(seed:order:raterId:opaqueId)`. The
  seed and both orders are recorded in `private/packet-manifest.json`, and the builder fails if two
  raters would get the same order.
- `rater-<id>.csv` columns: `opaqueId,raterId,c1..c8,total,pass,ratedAt`. They match Batch 3's
  `rubricScoreRowSchema` key order and have no `note` column. Score cells are empty, and rows follow
  that rater's order.
- `notes-<id>.csv` (`opaqueId,raterId,note`) and `INSTRUCTIONS.md` sit in the rater folder. The
  instructions quote the 471 rubric table and pass rule verbatim.
- `private/id-map.json` maps each opaqueId to stratum, slug, candidateId or suggestionId, cell,
  anchor471Total, the rendered sha256, the source sha256, the reference count and the dropped keys.
- Rebuilding needs `overwrite`, and is refused if any rater CSV already holds a score, so labels in
  progress are never lost. Both cases are specced.

## Rater packets (U1)

| Rater | Packet folder (hand over this folder only) | CSV template |
|---|---|---|
| r1 | `C:\Users\abdal\AppData\Local\ptah-mcp-bench\labelling\skill-rubric-v1\raters\rater-r1\` | `C:\Users\abdal\AppData\Local\ptah-mcp-bench\labelling\skill-rubric-v1\raters\rater-r1\rater-r1.csv` |
| r2 | `C:\Users\abdal\AppData\Local\ptah-mcp-bench\labelling\skill-rubric-v1\raters\rater-r2\` | `C:\Users\abdal\AppData\Local\ptah-mcp-bench\labelling\skill-rubric-v1\raters\rater-r2\rater-r2.csv` |

Private, never given to raters:
`C:\Users\abdal\AppData\Local\ptah-mcp-bench\labelling\skill-rubric-v1\private\` (`id-map.json`,
`packet-manifest.json`).

### Short instructions for a rater

1. Take only your own folder (`rater-r1` or `rater-r2`) and work alone. Do not discuss documents with
   the other rater until you have handed your sheet in.
2. Open `rater-<id>.csv`. Its rows are your reading order. For each row, read
   `documents/<opaqueId>.md` in full, including the inlined references at the bottom.
3. Score C1-C8 from 0 to 10 using the rubric in `INSTRUCTIONS.md`. Fill in:
   - `total` (the sum);
   - `pass` (`true` only if total ≥ 64 and no criterion is below 6);
   - `ratedAt` (`YYYY-MM-DD`).
4. Do not change `opaqueId` or `raterId`, and do not reorder rows or columns. Put no commas in cells.
   In Excel, set the columns to Text first.
5. Optional free-text notes go in `notes-<id>.csv`. They stay on this machine.
6. Hand back the CSV or CSVs. Items where pass/fail differs, or where totals differ by more than 12,
   go to a third person for adjudication.

## Risks handled

- **R2 / blinding.** A real-packet audit read all 210 rater-visible documents and both CSVs. No
  stratum name, no slug in the CSVs, no own hyphenated slug in any document and no seed were found.
  The only hits were 4 `license:` strings, and these are body text (RPC/cache keys), not frontmatter.
  Pipeline scores never enter the selection input; the selector only gets `judged: boolean`.
- **R12.** The snapshot is opened `readonly` + `fileMustExist`. It is hashed before and after the
  read, the hash is pinned to `82cd16ac…d575a`, and the run fails if a `-wal`/`-shm`/`-journal`
  sidecar appears (helper from Batch 8). The hash was unchanged after the runs.
- **Frozen copy.** It is verified before sampling (Batch 8.1): 2,745/2,745 files, manifest hash OK.
- **Bench data dir guard.** The tool refuses a bench data dir under the real `~/.ptah` or inside the
  repository. Nothing under `~/.ptah` was read or written.
- `git status` in the worktree shows only source files under
  `tools/mcp-bench/src/memory-skills/{labelling,data}`. There is no data file.

## Verification

- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/labelling --maxWorkers=2`:
  2 suites, **23 tests passed**.
- `npx nx run-many -t typecheck,lint -p mcp-bench --skip-nx-cache`: **both succeeded**.
- `npx nx run mcp-bench:test --maxWorkers=2`: 15/16 suites, 175/176 tests. The one failure is
  619's `src/corpus/corpus.spec.ts`; it passes when re-run alone. It is a git-worktree spec that
  conflicts with the lanes running at the same time, and it is not in this batch's files.
- `npx prettier --check --ignore-unknown tools/mcp-bench/src/memory-skills/labelling tools/mcp-bench/src/memory-skills/data`:
  all files use Prettier code style.
- Real run: 105 documents and 2 rater templates in the bench data dir. Each rater folder has
  `documents/` (105 files), `rater-<id>.csv`, `notes-<id>.csv` and `INSTRUCTIONS.md`.

The real run was driven by an uncommitted temp script (`npx jiti <script>`). It calls
`verifyCandidateManifest` → `loadRubricSampleInputs({commitRef: 'd995a1e1a…'})` →
`selectRubricSample` → `buildLabellingPacket` with `createDocumentReader`. Batch 16's runner CLI is
where this becomes a committed command.

## Not done / follow-ups

- **`ratedAt` format.** Batch 3 types `ratedAt` as an ISO date-time, but raters write `YYYY-MM-DD`.
  The Batch 25 importer must normalise the date (`T00:00:00Z`) and convert the `pass` strings to
  booleans before it validates with `rubricScoreRowSchema`.
- **Document size.** Authored documents inline their references: median 48 KB, maximum 365 KB (the
  `impeccable` skill's `reference/` folder). Candidates are about 2-5 KB. This follows the design's
  blinding rule, but it adds a lot of rater effort, and the length gap partly reveals which
  documents are authored (a known limit, design §4.2).
- `reference/` (singular, used by `impeccable`) is treated as a reference folder, the same as
  `references/`. `scripts/`, `assets/` and `agents/` are not inlined.
- **Extra exports.** The bench-dir guard (`assertSafeBenchDataDir`) and the snapshot reader
  (`withReadonlySnapshot`) are exported from Batch 8's files and are not new files. Batch 16 replaces
  the guard with 619's `resolveBenchDataDir()`.

## Phase-1 revise round 1

- **Major 1.** `loadRubricSampleInputs` and `buildLabellingPacket` now validate `benchDataDir` with
  619's `resolveBenchDataDir`. The `guard` option is replaced by `benchDataRules`, which only specs
  use. The local guard is deleted; the Batch 8 section of this round gives the details.
- **Minor 5.** The order-collision guard now applies whenever there are at least 2 documents. It
  used to apply only above 2. A spec builds a 2-document packet over 16 seeds: every build either
  gives the raters different orders or throws `same document order`, and the guard fires at least
  once. With 3 or more raters and 2 documents, the builder always throws, because 2 documents allow
  only 2 distinct orders.
- **Specs added:** refusal under `~/.ptah` (619 message), refusal inside a given repository root,
  and the 2-document guard. `build-labelling-packet` and `select-rubric-sample` pass, as part of
  the 53/53 run.
- **Real packet not rebuilt.** Rendering, ids and orders are unchanged, so the packet built earlier
  under `C:\Users\abdal\AppData\Local\ptah-mcp-bench\labelling\skill-rubric-v1\` stays valid for U1.
