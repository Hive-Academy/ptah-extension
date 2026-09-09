# Batches - TASK_2026_403_403b

Total tasks: 17 | Batches: 4 | Complete: 4/4

Worktree root (ALL absolute paths below are under it):
`D:\projects\ptah-extension\.claude-worktrees\task-id-suffix`

## Plan validation

Status: PASSED WITH RISKS

The plan's 26 evidence rows were spot-checked against the files they cite. Everything
load-bearing held:

- `id-allocator.ts:12` `TASK_FOLDER_RE = /^TASK_(\d{4})_(\d+)/` is unanchored at the end;
  emit is `:32`. Confirmed — the scan half already tolerates suffixes.
- `task-writer.service.ts:231-238` constructor has exactly 3 injected params; the retry
  loop is `:270-289`; the allocator call is `:273`. Confirmed.
- `execGit` is exported from the `vscode-core` barrel (`libs/backend/vscode-core/src/index.ts:101-105`).
  `parseWorktreeList` is exported from `libs/shared/src/lib/utils/index.ts:7`. Confirmed.
- `subagent-metrics-extractor.ts:46` `SPECS_PATH_TASK_ID` and `:48` `BARE_TASK_ID` both end
  `\d{3}\b`; `.toUpperCase()` at `:64` and `:70`. Confirmed — `\b` cannot match before `_`,
  so a suffixed id matches NEITHER pattern.
- `tools/degradation-audit/baseline.json:33` = `"libs/backend/task-specs": 12`. The target is
  `degradation-audit:lint`. Confirmed.
- `/^TASK_\d{4}_\d{3}$/` mode-detection gate exists at line 130 in BOTH
  `.claude/skills/orchestration/SKILL.md` and the plugin copy. Confirmed — a suffixed id
  routes to NEW_TASK today.
- `npm run manifest:generate` / `manifest:check` / `validate-skill` all exist
  (`package.json:65-67`). `validate-orchestration-skill.ts` only checks file EXISTENCE
  (`:154`, `:419-422`); it does not pin the id regex.
- `task-index.port.ts:14-27` is exactly the port + `Symbol.for` + `@injectable()` NoOp shape
  component 3 copies. Confirmed.

Assumptions:

- The mainline ref is `origin/main`; a repo whose default branch differs degrades the remote
  half to nothing — verified by Task 4.2's `ls-tree-fails` branch test, not by a live fetch.
- `workspaceRoot` is a git repo/worktree root, so the `.ptah/specs/` pathspec resolves.
  Unverified for subdirectory-opened workspaces; degrades silently and self-heals — pinned
  only as a documented failure branch in Task 4.2.
- `git ls-tree` on a folder pathspec is non-recursive (all entries at depth 1). Verified in
  this worktree (176 entries) and asserted in the `-z` parser unit test, Task 4.2.
- Batch 3's prose edits must be byte-identical to `renderTaskSpecAgentBlock()`'s output.
  UNVERIFIED by any gate — see R-3. Task 3.6 carries a grep-based substitute.

| Risk                                                                                                                                                                                                                                                                                          | Severity | Mitigation                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R-1 — the plan's constructor-site inventory is incomplete.** It claims "9 sites across 6 spec files", all in `task-specs`. Measured: **11 sites across 7 files**, and the 7th is `apps\ptah-cli\src\cli\commands\ptah-spec.spec.ts:659`, which constructs `new TaskWriterService(fsProvider, logger, new NoOpTaskIndexNotifier())` positionally. A required 4th param breaks `ptah-cli` typecheck AND its test, in a project the plan's verification command list never mentions. | HIGH     | Task 4.5 owns that file; Batch 4's gate adds `ptah-cli` to the test/typecheck/lint sets. Mechanical fix inside the chosen design — not an architecture change.                                                                     |
| **R-2 — a naive split leaves `@ptah-extension/task-specs` transiently non-compiling and poisons the concurrent batches.** A required `suffix` param with the only caller (`task-writer.service.ts:273`) owned by a later batch means any concurrent batch that typechecks `task-specs` fails for reasons it did not cause. | HIGH     | Batch 1 owns the `:273` call site and every exact-id spec assertion, so it ends GREEN. Batch 3 was stripped of all `task-specs` files (see the note under Batch 3). No batch ever observes a red sibling project.                    |
| **R-3 — the plan names `contract.guard.spec.ts` as component 8's verification seam; it does not verify the allocation text.** Read at `:226-300`: it checks per-task document FILENAMES and dead spec roots. Nothing asserts the 15 agent files match the renderer.                              | MEDIUM   | Task 3.6 substitutes two greps: the retired phrase returns nothing in Batch 3's own files, and the new bullet appears in exactly 15 `.claude\agents\*.md`. The guard spec is still run because Batch 3 edits the tree it scans.     |
| **R-4 — `jest.spyOn(idAllocator, 'allocateTaskId')` at `task-writer.service.spec.ts:184` and `:206` asserts call arguments against the OLD 2-arg signature.**                                                                                                                                   | MEDIUM   | Called out explicitly in Task 1.3; those two sites are in Batch 1's file list.                                                                                                                                                     |
| **R-5 — three concurrent CLI lanes share ONE worktree and ONE Nx daemon.** `npx nx reset` is process-wide and would kill a sibling lane's daemon mid-run (root `CLAUDE.md`).                                                                                                                     | MEDIUM   | Every wave-1 batch prompt carries an explicit "do NOT run `npx nx reset`". No batch edits a `project.json`, so no reset is warranted.                                                                                              |
| **R-6 — `registry-generator.service.spec.ts` may pin the banner text Batch 4 rewrites.**                                                                                                                                                                                                        | LOW      | Task 4.7 requires reading that spec before editing the banner and updating the pinned expectation in the same task.                                                                                                                |
| **R-7 — three new degrading `catch` blocks land in `libs/backend/task-specs`, whose ratchet baseline is 12.** Unmarked, CI fails.                                                                                                                                                                | MEDIUM   | Task 4.2 requires BOTH the `// degradation-audit: reported — <code>` marker and a reporter call with a literal `code` on every guarded catch; `degradation-audit:lint` is in Batch 4's gate.                                       |
| **R-8 — a typo in the mirrored `Symbol.for('SdkProcessSpawner')` resolves `null` silently** and reopens the Electron main-thread `CreateProcessW` defect with zero test signal.                                                                                                                  | MEDIUM   | Task 4.6 pins the symbol description as a string literal in the DI spec, following `skill-synthesis/src/lib/di/tokens.ts:60-63`.                                                                                                   |

Edge cases:

- Legacy `TASK_2026_146_ORCHESTRA` still counts as 146 — Task 1.2 (allocator) and Task 2.1 (extractor).
- `TASK_2026_1000` (4-digit sequence, pinned at `id-allocator.spec.ts:36-38`) must still match the
  widened extractor patterns — hence `\d{3,}`, not `\d{3}` — Task 2.1.
- Same id in two cases in one prompt → one distinct id, returned verbatim — Task 2.1.
- git absent / not a repo → no worktree contribution AND skip the remote steps — Task 4.2.
- `fetch` fails or times out → CONTINUE to `ls-tree` against the stale ref — Task 4.2.
- A listed-but-deleted worktree whose `readDirectory` throws → that worktree only contributes
  nothing — Task 4.2.
- A `bare` / `detached` block in `git worktree list --porcelain` — Task 4.2 parser test.
- Union computed ONCE across a 3-attempt EEXIST retry while the local re-scan runs 3 times,
  with a FRESH suffix each attempt — Task 4.4.

### Batching strategy

Boundary = **nx project ownership**, not plan component order. Batches 1, 2 and 3 are mutually
file-disjoint AND project-disjoint, each ends with its own projects green, and they form wave 1.
Batch 4 depends on Batch 1 (it consumes the new allocator signature) and shares files with it —
which is safe precisely because the two never run concurrently.

---

## Batch 1: Suffixed id shape, end to end within task-specs — COMPLETE

- Commit: `864b2f0c2` — `feat(task-specs): append a random hex suffix to every allocated task id`

- Recommended executor: CLI lane x 1 — `ptah_agent_spawn cli: codex`
- Fallback executor: `backend-developer` sub-agent
- Execution mode: parallel (runs concurrently with Batch 2 and Batch 3)
- Rationale: pure functions with a signature the plan states verbatim, plus a mechanical
  assertion swap across five spec files. Precise spec, no design judgment, high volume —
  the exact shape the orchestrator reserved for codex. It carries the ONE-LINE writer call
  site (not the seam) solely so the project ends green; see R-2.
- Tasks: 4 | Depends on: none
- Files owned (no other batch may touch these):
  - `…\libs\backend\task-specs\src\lib\id-suffix.ts` (CREATE)
  - `…\libs\backend\task-specs\src\lib\id-suffix.spec.ts` (CREATE)
  - `…\libs\backend\task-specs\src\lib\id-allocator.ts`
  - `…\libs\backend\task-specs\src\lib\id-allocator.spec.ts`
  - `…\libs\backend\task-specs\src\lib\task-writer.service.ts` (line 273 ONLY)
  - `…\libs\backend\task-specs\src\lib\task-writer.service.spec.ts`
  - `…\libs\backend\task-specs\src\lib\task-writer.create-race.spec.ts`
  - `…\libs\backend\task-specs\src\lib\task-writer.metadata.spec.ts`
  - `…\libs\backend\task-specs\src\lib\task-writer.conflict.integration.spec.ts`
  - `…\libs\backend\task-specs\src\lib\task-doctor.service.spec.ts`

### Task 1.1: `id-suffix.ts` — the discriminator producer — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-id-suffix\libs\backend\task-specs\src\lib\id-suffix.ts` (CREATE)
  and `…\id-suffix.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:168-189 (component 2)
- Pattern to follow: `crypto` is already imported inside a backend lib at
  `libs\backend\vscode-core\src\services\git-info.service.ts:9`.
- Quality requirements: uniformly distributed over 65 536 values; lowercase hex only.
- Validation notes: a SEPARATE file from `id-allocator.ts` on purpose — the allocator must
  keep zero imports and stay trivially pure.
- Implementation details: export `randomIdSuffix(): string` returning
  `randomBytes(2).toString('hex')` (exactly two bytes — no slicing, no modulo bias), and
  `export const TASK_ID_SUFFIX_RE = /^[0-9a-f]{4}$/`. No try/catch, no fallback — this adds
  no degradation site. Spec: 1000 draws all match `TASK_ID_SUFFIX_RE`, AND the draw set has
  more than one member (a stubbed constant would pass a shape-only test).

### Task 1.2: `allocateTaskId` — required suffix parameter — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-id-suffix\libs\backend\task-specs\src\lib\id-allocator.ts`
  and `…\id-allocator.spec.ts`
- Depends on: Task 1.1
- Plan reference: implementation-plan.md:124-166 (component 1)
- Quality requirements: deterministic for a given `(folderNames, suffix, year)`.
- Validation notes: `TASK_FOLDER_RE` at `:12` is UNCHANGED — it is already suffix-tolerant.
  Only the emit line `:32` and the signature change. Do not rewrite the parser.
- Implementation details: new signature, positional, `year` keeps its position so the existing
  spec's third argument is the only thing that moves:

  ```ts
  export function allocateTaskId(
    folderNames: readonly string[],
    suffix: string,
    year: number = new Date().getFullYear(),
  ): string;
  ```

  `suffix` is REQUIRED, validated against `TASK_ID_SUFFIX_RE` imported from `./id-suffix`;
  a malformed value THROWS. Emit `TASK_${yearStr}_${String(next).padStart(3,'0')}_${suffix}`.
  Update the docblock at `:2-11`. Spec: re-assert every existing case with a fixed suffix
  (`'a1f2'`), plus — suffix appears verbatim in the output; `TASK_2026_146_ORCHESTRA` still
  counts as 146; a suffixed `TASK_2026_403_a1f2` counts as 403; `TASK_2026_999` still yields
  `TASK_2026_1000_<suffix>`; `''`, `'ABCD'`, `'abcde'`, `'xyz1'` each throw.

### Task 1.3: writer call site + exact-id assertions across five specs — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-id-suffix\libs\backend\task-specs\src\lib\task-writer.service.ts`
- Depends on: Task 1.2
- Plan reference: implementation-plan.md:309-355 (component 5 — the id-shape half only)
- Quality requirements: this task changes line 273 and its import block and NOTHING else in
  `task-writer.service.ts`. The constructor, the retry loop structure, `MAX_CREATE_ATTEMPTS`
  and the `ID_ALLOCATION_EXHAUSTED` path are Batch 4's, not yours.
- Validation notes (R-4): `task-writer.service.spec.ts:184` and `:206` call
  `jest.spyOn(idAllocator, 'allocateTaskId')` and assert against the OLD 2-arg signature.
  Both must be updated.
- Implementation details: at `:273` replace
  `allocateTaskId(await this.listFolderNames(specsDir))` with
  `allocateTaskId(await this.listFolderNames(specsDir), randomIdSuffix())`, importing
  `randomIdSuffix` from `./id-suffix` beside the existing `./id-allocator` import at `:19`.
  A fresh suffix per attempt is REQUIRED — a repeated one loses the same race twice.
  Then update every exact-id assertion in the five spec files below to
  `toMatch(/^TASK_\d{4}_\d{3,}_[0-9a-f]{4}$/)` plus a separate assertion on the numeric
  prefix where the test's point is the NUMBER. Known sites, all to be re-checked by grep:
  `task-writer.service.spec.ts:48,94`; `task-writer.create-race.spec.ts:94-95,123,149,155`;
  and any exact `'TASK_20..' ` literal in `task-writer.metadata.spec.ts`,
  `task-writer.conflict.integration.spec.ts`, `task-doctor.service.spec.ts`.

### Task 1.4: verify Batch 1 is green — COMPLETE

- Depends on: Task 1.3
- Implementation details: run the three commands in the Batch 1 verification block below and
  report their output verbatim.

### Batch 1 verification

- `npx nx run-many -t test -p @ptah-extension/task-specs` — the header must read
  `Running target test for 1 project`, and the whole suite must pass, not just the new specs.
- `npx nx run-many -t typecheck -p @ptah-extension/task-specs`
- `npx nx run-many -t lint -p @ptah-extension/task-specs`
- No file outside the owned list above is modified (`git status --short`).
- `@ptah-extension/task-specs` compiles and passes at the END of this batch — a red project
  would break the two lanes running beside it (R-2).

---

## Batch 2: Metrics extractor accepts the suffix — COMPLETE

- Commit: `90efd32fe` — `fix(skill-synthesis): accept suffixed task ids in the metrics extractor`

- Recommended executor: CLI lane x 1 — `ptah_agent_spawn cli: codex`
- Fallback executor: `backend-developer` sub-agent
- Execution mode: parallel (runs concurrently with Batch 1 and Batch 3)
- Rationale: two regexes and one case-normalization removal, in one file plus its spec. The
  plan states the replacement patterns character for character. Smallest, most precisely
  specified unit of work in the task — grunt work with a precise spec.
- Tasks: 1 | Depends on: none
- Files owned:
  - `…\libs\backend\skill-synthesis\src\lib\subagent-metrics-extractor.ts`
  - `…\libs\backend\skill-synthesis\src\lib\subagent-metrics-extractor.spec.ts`

### Task 2.1: widen both patterns, stop uppercasing the returned id — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-id-suffix\libs\backend\skill-synthesis\src\lib\subagent-metrics-extractor.ts`
  and `…\subagent-metrics-extractor.spec.ts`
- Plan reference: implementation-plan.md:391-431 (component 7)
- Pattern to follow: the file's existing three-step derivation rule, documented at `:52-58`.
- Quality requirements: no new import. This file parses free prose, not folders — it must NOT
  start importing `@ptah-extension/task-specs`.
- Validation notes: `\d{3,}` and not `\d{3}`, because `TASK_2026_1000` is a pinned allocator
  output (`libs\backend\task-specs\src\lib\id-allocator.spec.ts:36-38`). The optional group is
  deliberately WIDER than `[0-9a-f]{4}` so legacy `TASK_2026_146_ORCHESTRA` matches — this
  extractor must not be stricter than the folder scanner.
- Implementation details:
  - `:46` `SPECS_PATH_TASK_ID` → `/[\\/.]?ptah[\\/]specs[\\/](TASK_\d{4}_\d{3,}(?:_[A-Za-z0-9]+)?)\b/i`
  - `:48` `BARE_TASK_ID` → `/\bTASK_\d{4}_\d{3,}(?:_[A-Za-z0-9]+)?\b/gi`
    (the trailing `\b` survives because the optional group ends on a word character).
  - `:64` `return anchored[1].toUpperCase()` → `return anchored[1]` — return the matched text
    VERBATIM.
  - `:66-73` KEEP the case-insensitive dedup (`new Set(matches.map(m => m.toUpperCase()))` is
    what makes "exactly one distinct id" correct) but RETURN the first match's original text,
    not the uppercased set member.
  - Why the case change is not cosmetic: `taskIdFromVerdictSource`
    (`libs\backend\skill-synthesis\src\lib\skill-scorecard.service.ts:275-281`, used at `:169`)
    does no case normalization at all. Two producers write one `task_id` column; a lowercase
    hex suffix would make them write `TASK_2026_403_A1F2` and `TASK_2026_403_a1f2` for one
    task and the scorecard would group them apart.
  - Spec cases required: a specs path carrying a suffixed id; a bare suffixed id; legacy
    `TASK_2026_146_ORCHESTRA`; `TASK_2026_1000`; `TASK_2026_403_a1f2` named twice in different
    case → ONE distinct id returned in the case of the FIRST match; two genuinely different
    suffixed ids → `null`.

### Batch 2 verification

- `npx nx run-many -t test -p @ptah-extension/skill-synthesis` (header must read 1 project)
- `npx nx run-many -t typecheck -p @ptah-extension/skill-synthesis`
- `npx nx run-many -t lint -p @ptah-extension/skill-synthesis`
- Only the two owned files are modified (`git status --short`).

---

## Batch 3: The stated rule — renderer first, then its copies — COMPLETE

- Commit: `1ef1d40f1` — `docs(task-specs): teach the suffixed id allocation rule everywhere`

- Recommended executor: CLI lane x 1 — `ptah_agent_spawn cli: codex`
- Fallback executor: `backend-developer` sub-agent
- Execution mode: parallel (runs concurrently with Batch 1 and Batch 2)
- Rationale: one replacement applied to ~25 prose files plus a pinned renderer spec and a
  generated manifest. High volume, zero design judgment, and the plan gives an exact
  file/line table — the prompt/docs text batch the orchestrator reserved for codex.
- Tasks: 6 | Depends on: none
- **Deliberately stripped of every `task-specs` file.** The plan put
  `registry-generator.service.ts` and `libs\backend\task-specs\CLAUDE.md` in this group; both
  moved to Batch 4. Reason (R-2): Batch 1 is editing `@ptah-extension/task-specs` at the same
  time, so a Batch 3 typecheck of that project would fail for reasons Batch 3 did not cause.
  Moving `CLAUDE.md` to Batch 4 also fixes a second coupling — it documents the port and git
  service that Batch 4 creates.
- Files owned:
  - `…\libs\shared\src\lib\types\task-spec.contract.ts`
  - `…\libs\shared\src\lib\types\task-spec.contract.spec.ts`
  - `…\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\tool-description.builder.ts`
  - `…\.claude\agents\*.md` (15 files, listed in Task 3.2)
  - `…\.claude\skills\orchestration\SKILL.md`
  - `…\.claude\skills\orchestration\references\task-tracking.md`
  - `…\.claude\skills\tribunal\references\relay.md`
  - `…\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\orchestration\SKILL.md`
  - `…\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\orchestration\references\task-tracking.md`
  - `…\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\tribunal\references\relay.md`
  - `…\content-manifest.json` (REGENERATED by script, never hand-edited)
  - `…\CLAUDE.md` (repo root)

### Task 3.1: the two renderers in `task-spec.contract.ts` — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-id-suffix\libs\shared\src\lib\types\task-spec.contract.ts`
  and `…\task-spec.contract.spec.ts`
- Plan reference: implementation-plan.md:433-500 (component 8), table row 1-2
- Quality requirements: this is the SOURCE OF TRUTH. Write it first; every later task in this
  batch copies from it.
- Validation notes: `renderTaskSpecAgentBlock()` is resolved as the `TASK_SPEC_CONTRACT`
  partial by `libs\backend\agent-generation\src\lib\services\template-partial-resolver.ts:58,74`
  — which is why there is deliberately no `_shared\task-spec-contract.md` file to edit.
- Implementation details: `renderTaskSpecAgentBlock()` at `:502-530` — id shape at `:507`,
  allocation bullet at `:523-525`. `renderSpecsReadme()` — id shape at `:427`, the
  "## Allocating an id" section at `:473-477`. The new rule, in both: scan `origin/main` plus
  every worktree plus the local folder, take highest + 1, zero-pad, **append an underscore and
  four lowercase hex characters (`TASK_YYYY_NNN_xxxx`)**, and the exclusive fail-if-exists
  `mkdir` is still the lock. Then update the pinned expectations at
  `task-spec.contract.spec.ts:397-494`.

### Task 3.2: the 15 rendered agent files — COMPLETE

- Depends on: Task 3.1
- Files: `D:\projects\ptah-extension\.claude-worktrees\task-id-suffix\.claude\agents\` —
  `backend-developer.md`, `code-logic-reviewer.md`, `code-style-reviewer.md`,
  `devops-engineer.md`, `frontend-developer.md`, `modernization-detector.md`,
  `project-manager.md`, `researcher-expert.md`, `senior-tester.md`, `software-architect.md`,
  `team-leader.md`, `technical-content-writer.md`, `ui-ux-designer.md`, `video-director.md`,
  `visual-reviewer.md`
- Plan reference: implementation-plan.md:450-455, table row 3
- Quality requirements: the allocation bullet must be BYTE-IDENTICAL to Task 3.1's renderer
  output for that bullet.
- Validation notes: these files are NOT regenerated by anything. `harness-sync` treats
  `{ws}\.claude\agents` as a SOURCE and writes nothing there
  (`libs\backend\harness-sync\src\lib\targets\claude-target.ts:13,93`). Their `STATIC:` markers
  were stripped when they were rendered, so this is a hand edit — 15 times, identically.
- Implementation details: line `31` + lines `47-49` in each file; `video-director.md` is
  offset by one (`32` + `48-50`). Verify by grep, not by trusting the line numbers.

### Task 3.3: the orchestration and tribunal skills — COMPLETE

- Depends on: Task 3.1
- Files: `…\.claude\skills\orchestration\SKILL.md`,
  `…\.claude\skills\orchestration\references\task-tracking.md`,
  `…\.claude\skills\tribunal\references\relay.md`
- Plan reference: implementation-plan.md:456-458, table rows 4-6
- Validation notes: **a break the task brief did not name, verified present.**
  `SKILL.md:130` gates continuation on `/^TASK_\d{4}_\d{3}$/` inside the Mode Detection block.
  A suffixed id fails that anchor and routes to NEW_TASK — i.e. the orchestrator would mint a
  second task instead of resuming. Widen it to `/^TASK_\d{4}_\d{3,}(?:_[A-Za-z0-9]+)?$/`.
- Implementation details: `SKILL.md` — the regex at `:130` and the reserve rule restated at
  `:144` (step 1 of NEW_TASK: Initialization). `task-tracking.md` — the numbered allocation
  procedure at `:190-192` and its example at `:201-202`. `relay.md:40` — the one-line
  allocation step.

### Task 3.4: the shipped plugin copies — COMPLETE

- Depends on: Task 3.3
- Files: `…\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\orchestration\SKILL.md`,
  `…\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\orchestration\references\task-tracking.md`,
  `…\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\tribunal\references\relay.md`
- Plan reference: implementation-plan.md, table rows 7-9
- Validation notes: the plugin `SKILL.md` **already reads differently** from the `.claude` copy
  — it carries the same `/^TASK_\d{4}_\d{3}$/` gate at `:130` but its NEW_TASK steps are a
  5-item list where `.claude`'s is a 4-item list, and the allocation text sits at `:138`, not
  `:144`. Do not paste the `.claude` version over it; apply the same two SEMANTIC changes.
- Implementation details: widen the `:130` regex identically; restate the allocation rule at
  `:138`. Mirror `task-tracking.md:190-192,201-202` and `relay.md:40`.

### Task 3.5: MCP tool description + root CLAUDE.md — COMPLETE

- Depends on: Task 3.1
- Files: `…\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\tool-description.builder.ts`
  (line 45), `…\CLAUDE.md` (lines 173 and 177)
- Plan reference: implementation-plan.md, table rows 11, 13
- Implementation details: `tool-description.builder.ts:45` — `"Allocates the next TASK_YYYY_NNN id"`
  becomes the new format. Root `CLAUDE.md` — the carrier shape at `:173` and the "ID allocation"
  bullet at `:177`. `ptah_task_create` itself takes no id argument and needs no schema change
  (`protocol-dispatcher.ts:1670-1673` is a verbatim pass-through); only the description STRING
  changes.

### Task 3.6: regenerate the manifest and verify — COMPLETE

- Depends on: Task 3.4, Task 3.5
- Plan reference: implementation-plan.md:459-463, 495-499
- Validation notes (R-3): the plan names `contract.guard.spec.ts` as this component's
  verification seam. It is not one for the allocation text — read at `:226-300`, it checks
  per-task document FILENAMES and dead spec roots. Run it anyway (Batch 3 edits the plugin
  asset tree it scans), but the real check is the two greps below.
- Implementation details:
  1. `npm run manifest:generate` — required after ANY edit under
     `apps\ptah-extension-vscode\assets\plugins`, because
     `scripts\generate-content-manifest.js:25-27,321-326` hashes that tree into
     `content-manifest.json` and `npm run manifest:check` fails on a stale hash. Never
     hand-edit `content-manifest.json`.
  2. `npm run manifest:check` — must pass.
  3. `npm run validate-skill` — must pass.
  4. Grep: the retired phrase `zero-padded to three digits` returns NOTHING in this batch's
     owned files. (It will still appear in `libs\backend\task-specs` — that is Batch 4's,
     and the repo-wide grep belongs to the final gate, not to this batch.)
  5. Grep: the new allocation bullet appears in exactly 15 files under `.claude\agents\`.

### Batch 3 verification

- `npx nx run-many -t test -p @ptah-extension/shared` (contract renderer spec at `:397-494`)
- `npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/vscode-lm-tools`
  (header must read 2 projects)
- `npx nx run-many -t lint -p @ptah-extension/shared @ptah-extension/vscode-lm-tools`
- `npx nx test @ptah-extension/task-specs --testPathPattern=contract.guard` — the asset-tree
  guard. If this fails naming a file NOT in Batch 3's owned list, report it and stop; do not
  fix it — Batch 1 is editing that project concurrently.
- `npm run manifest:check` and `npm run validate-skill` both pass.
- No `libs\backend\task-specs` source file is modified (`git status --short`).

---

## Batch 4: The cross-checkout visibility seam — COMPLETE

- Commit: `28cd80567` — `feat(task-specs): allocate task ids against every checkout, not just this one`

- Recommended executor: `backend-developer` (sub-agent)
- Fallback executor: CLI lane — `ptah_agent_spawn cli: codex`, only with the plan's
  component 3, 4, 5 and 6 sections pasted in full
- Execution mode: sequential
- Rationale for a sub-agent rather than codex, per the orchestrator's request that this be
  justified — four failures here are silent, and each needs repository context a no-context
  CLI does not have:
  1. **The mirrored DI symbol.** `Symbol.for('SdkProcessSpawner')` must match
     `libs\backend\agent-sdk\src\lib\di\tokens.ts:51` character for character. A typo does not
     fail — it resolves `null`, git spawns inline, and the Electron main-thread `CreateProcessW`
     defect that `apps\ptah-electron\src\di\phase-4-handlers.ts:102-111` exists to prevent
     silently reopens. No test catches it unless the symbol string is pinned deliberately.
  2. **The degradation ratchet.** Three new degrading catches must EACH carry both a
     `// degradation-audit: reported — <code>` marker and a reporter call with a string-literal
     `code`, or `libs\backend\task-specs` exceeds its baseline of 12 and CI fails. The rule
     lives in `libs\backend\vscode-core\CLAUDE.md`, not in the plan.
  3. **R-1.** The plan's own constructor-site inventory is wrong; finding the 11th site in a
     different nx project required grepping the whole repo and knowing to distrust the plan.
     The next such gap needs the same judgment.
  4. **The "never throws" contract** across five independent git failure branches, where
     "returns nothing" and "throws" are indistinguishable to a passing test unless each branch
     is driven separately.
- Tasks: 7 | Depends on: Batch 1 (consumes the new `allocateTaskId` signature and
  `randomIdSuffix`). File-disjoint from Batches 2 and 3, so it may start as soon as Batch 1 is
  committed even if 2 or 3 are still running.
- Files owned:
  - `…\libs\backend\task-specs\src\lib\task-folder-visibility.port.ts` (CREATE)
  - `…\libs\backend\task-specs\src\lib\git-task-folder-visibility.service.ts` (CREATE)
  - `…\libs\backend\task-specs\src\lib\git-task-folder-visibility.service.spec.ts` (CREATE)
  - `…\libs\backend\task-specs\src\lib\task-writer.service.ts`
  - `…\libs\backend\task-specs\src\lib\task-writer.service.spec.ts`
  - `…\libs\backend\task-specs\src\lib\task-writer.create-race.spec.ts`
  - `…\libs\backend\task-specs\src\lib\task-writer.metadata.spec.ts`
  - `…\libs\backend\task-specs\src\lib\task-writer.conflict.integration.spec.ts`
  - `…\libs\backend\task-specs\src\lib\task-doctor.service.spec.ts`
  - `…\apps\ptah-cli\src\cli\commands\ptah-spec.spec.ts` **(R-1 — not in the plan)**
  - `…\libs\backend\task-specs\src\lib\di\tokens.ts`
  - `…\libs\backend\task-specs\src\lib\di\register.ts`
  - `…\libs\backend\task-specs\src\index.ts`
  - `…\libs\backend\task-specs\src\lib\registry-generator.service.ts` (moved here from the
    plan's group C)
  - `…\libs\backend\task-specs\CLAUDE.md` (moved here from the plan's group C)

### Task 4.1: `ITaskFolderVisibility` port + token + NoOp — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-id-suffix\libs\backend\task-specs\src\lib\task-folder-visibility.port.ts` (CREATE)
- Plan reference: implementation-plan.md:191-224 (component 3)
- Pattern to follow: `libs\backend\task-specs\src\lib\task-index.port.ts:14-27` — interface,
  `Symbol.for` token declared beside it, `@injectable()` NoOp. Copy the shape exactly.
- Implementation details: `listBeyondWorkspace(workspaceRoot: string): Promise<readonly string[]>`;
  `TASK_FOLDER_VISIBILITY_TOKEN = Symbol.for('TaskSpecsFolderVisibility')` (verified unused
  elsewhere); `NoOpTaskFolderVisibility` returns `[]`. Document the contract "never throws:
  an unreachable source contributes nothing" on the interface. `tsyringe` is the only import.

### Task 4.2: `GitTaskFolderVisibility` — the git-backed union reader — COMPLETE

- File: `…\libs\backend\task-specs\src\lib\git-task-folder-visibility.service.ts` (CREATE)
  and `…\git-task-folder-visibility.service.spec.ts` (CREATE)
- Depends on: Task 4.1
- Plan reference: implementation-plan.md:226-307 (component 4) — read it in full
- Pattern to follow: optional degradation-reporter injection at
  `libs\backend\persistence-sqlite\src\lib\backup.service.ts:180`; mirrored-symbol optional
  injection at `libs\backend\skill-synthesis\src\lib\di\tokens.ts:48-64`.
- Quality requirements: at most three git spawns + one `readDirectory` per worktree per
  uncached call; zero spawns on a cache hit within 60 s; never blocks the Electron main thread
  when the spawner is bound. No test may spawn a real git process.
- Validation notes (R-7, R-8): every guarded catch needs BOTH the marker comment and a reporter
  call. Pin the mirrored spawner symbol string literally in the spec.
- Implementation details:
  - `execGit(args, cwd, {timeoutMs, spawner})` from `@ptah-extension/vscode-core` (exported at
    `libs\backend\vscode-core\src\index.ts:101-105`); `parseWorktreeList` from
    `@ptah-extension/shared` (`libs\shared\src\lib\utils\index.ts:7`) — do NOT write a second
    porcelain parser; `IFileSystemProvider.readDirectory` + `FileType.Directory`, the pair
    `task-writer.service.ts:798-808` already uses; `IProcessSpawner` type from
    `@ptah-extension/platform-core`. All four are EXISTING edges of `task-specs`. Add no new
    lib dependency, and specifically no `agent-sdk` edge.
  - Steps: `git worktree list --porcelain` → paths → `readDirectory(<path>/.ptah/specs)` each;
    `git fetch --quiet origin main` (best effort); `git ls-tree --name-only -z origin/main .ptah/specs/`
    → basenames. Deduplicate. Cache per `workspaceRoot` for `VISIBILITY_CACHE_TTL_MS = 60_000`.
  - Two pure exported parsers in the SAME file (neither earns its own file under the lib's
    ~150-line guardrail): `specFolderNamesFromLsTree(stdout)` — split on `\0`, drop empties,
    take the segment after the last `/`, keep entries starting with `TASK_`; and
    `specDirsFromWorktreeList(stdout)` — `parseWorktreeList` → `.path` →
    `path.join(p, '.ptah', 'specs')`, deduplicated (git prints forward-slashed Windows paths;
    `path.join` normalises them).
  - Timeouts: `DEFAULT_GIT_TIMEOUT_MS` (10 s) for `worktree list` and `ls-tree`; a dedicated
    `FETCH_TIMEOUT_MS = 5_000` for the fetch — the only step touching the network and the only
    one that can hang on a credential prompt.
  - Failure behaviour, the load-bearing part — NO PATH THROWS. `worktree list` fails → no
    worktree contribution AND skip the remote steps (a non-repo cannot have `origin/main`).
    `fetch` fails/times out → CONTINUE to `ls-tree` against the stale ref. `ls-tree` fails → no
    remote contribution. A per-worktree `readDirectory` failure → that worktree only contributes
    nothing. Codes, as string literals: `task-visibility.worktree-list-failed`,
    `task-visibility.fetch-failed`, `task-visibility.ls-tree-failed`,
    `task-visibility.worktree-scan-failed`, all under `source: 'workspace'`
    (`DegradationSource` has no `tasks` member and must NOT be widened for three codes).
  - Test seam: take the exec as a constructor-injected function reference defaulting to the
    imported `execGit`. Drive all-succeed, no-git, fetch-fails-ls-tree-succeeds, ls-tree-fails,
    worktree-readdir-throws. Test both parsers directly, including the NUL-separated form and a
    worktree list carrying `bare` / `detached` blocks.

### Task 4.3: DI tokens, registration and the public barrel — COMPLETE

- Files: `…\libs\backend\task-specs\src\lib\di\tokens.ts`, `…\di\register.ts`, `…\src\index.ts`
- Depends on: Task 4.2
- Plan reference: implementation-plan.md:357-389 (component 6)
- Quality requirements: NO new registration in any `apps\**` file.
- Validation notes (R-8): the DI spec must pin `'SdkProcessSpawner'` as a string literal.
  Barrel export of `NoOpTaskFolderVisibility` must land before Task 4.5, which imports it from
  `apps\ptah-cli`.
- Implementation details: register `GitTaskFolderVisibility` as a singleton behind
  `TASK_FOLDER_VISIBILITY_TOKEN` inside `registerTaskSpecsServices`, same place and shape as
  the `TASK_INDEX_NOTIFIER_TOKEN` binding. Add to the barrel: `randomIdSuffix`,
  `TASK_ID_SUFFIX_RE`, `ITaskFolderVisibility`, `TASK_FOLDER_VISIBILITY_TOKEN`,
  `NoOpTaskFolderVisibility`, `GitTaskFolderVisibility`. Assert the token resolves to
  `GitTaskFolderVisibility` from a container carrying only `TOKENS.LOGGER` and
  `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER`.

### Task 4.4: `TaskWriterService.create` — union once, fresh suffix per attempt — COMPLETE

- File: `…\libs\backend\task-specs\src\lib\task-writer.service.ts`
- Depends on: Task 4.3
- Plan reference: implementation-plan.md:309-355 (component 5 — the seam half)
- Quality requirements: ONE visibility call per `create`, never per attempt.
- Validation notes: `MAX_CREATE_ATTEMPTS = 5` (`:117`) and the `ID_ALLOCATION_EXHAUSTED` path
  (`:291-302`) are UNCHANGED — the folder lock is still the correctness guarantee. Add no new
  `catch`: the port never throws, so this method adds no degradation site of its own.
- Implementation details: constructor at `:231-238` gains a fourth parameter
  `@inject(TASK_FOLDER_VISIBILITY_TOKEN) private readonly visibility: ITaskFolderVisibility`.
  Call `visibility.listBeyondWorkspace(root)` ONCE, BEFORE the loop at `:270`. Inside the loop,
  union that result with a fresh `listFolderNames(specsDir)` — the per-attempt LOCAL re-scan is
  what makes the retry converge; the external half cannot change during a five-attempt loop and
  must not be re-fetched. Keep the fresh `randomIdSuffix()` per attempt that Batch 1 added.

### Task 4.5: the 4th-argument fan-out, including the site the plan missed — COMPLETE

- Files: `…\task-writer.service.spec.ts`, `…\task-writer.create-race.spec.ts`,
  `…\task-writer.metadata.spec.ts`, `…\task-writer.conflict.integration.spec.ts`,
  `…\task-doctor.service.spec.ts`, and
  `D:\projects\ptah-extension\.claude-worktrees\task-id-suffix\apps\ptah-cli\src\cli\commands\ptah-spec.spec.ts`
- Depends on: Task 4.4
- Plan reference: implementation-plan.md:45, 351-355 — **and R-1 above, which corrects it**
- Validation notes (R-1): the plan says 9 sites / 6 files. Measured: **11 sites / 7 files.**
  Full inventory, all `new TaskWriterService(`:
  `apps\ptah-cli\...\ptah-spec.spec.ts:659`; `task-doctor.service.spec.ts:36`;
  `task-writer.conflict.integration.spec.ts:158,267,406`; `task-writer.create-race.spec.ts:63`;
  `task-writer.metadata.spec.ts:124,791,802`; `task-writer.service.spec.ts:29,342`.
  Re-grep before editing — do not trust this list either.
- Implementation details: pass `new NoOpTaskFolderVisibility()` as the 4th positional argument
  at every site that does not exercise allocation. In `task-writer.service.spec.ts` and
  `task-writer.create-race.spec.ts`, use a FAKE `ITaskFolderVisibility` for the four required
  cases: (a) local holds `TASK_2026_001`, the fake returns `TASK_2026_402_ab12` → the id is
  `TASK_2026_403_<hex>`; (b) the fake returns `[]` → behaviour identical to Batch 1's;
  (c) `listBeyondWorkspace` is called exactly ONCE across a 3-attempt EEXIST retry while
  `readDirectory` is called three times; (d) two attempts produce different suffixes.
  `apps\ptah-cli` imports `NoOpTaskFolderVisibility` from `@ptah-extension/task-specs`, which
  Task 4.3 exports.

### Task 4.6: verify the mirrored spawner symbol — COMPLETE

- Depends on: Task 4.3
- Validation notes (R-8): confirm `Symbol.for('SdkProcessSpawner')` matches
  `libs\backend\agent-sdk\src\lib\di\tokens.ts:51` character for character, and that the DI spec
  asserts the literal string. Confirm `TOKENS.DEGRADATION_REPORTER` resolves with
  `{isOptional: true}`.

### Task 4.7: the two remaining prose payloads in task-specs — COMPLETE

- Files: `…\libs\backend\task-specs\src\lib\registry-generator.service.ts` (lines 98, 101),
  `…\libs\backend\task-specs\CLAUDE.md` (lines 7, 18, 41)
- Depends on: Task 4.5
- Plan reference: implementation-plan.md, table rows 10 and 12 (moved here from group C)
- Validation notes (R-6): read `registry-generator.service.spec.ts` BEFORE editing the banner —
  if it pins the banner text, update the pinned expectation in this same task.
- Implementation details: `registry-generator.service.ts:98,101` — the emitted registry banner's
  allocation instructions, matching Batch 3's renderer wording. `libs\backend\task-specs\CLAUDE.md`
  — purpose line `:7`, helper list `:18`, the `id-allocator.ts` description `:41`, and ADD
  `task-folder-visibility.port.ts`, `git-task-folder-visibility.service.ts` and `id-suffix.ts`
  to Internal Structure, plus the new names to Public API.

### Batch 4 verification

- `npx nx run-many -t test -p @ptah-extension/task-specs ptah-cli` — header must read
  `Running target test for 2 projects`
- `npx nx run-many -t typecheck -p @ptah-extension/task-specs ptah-cli`
- `npx nx run-many -t lint -p @ptah-extension/task-specs ptah-cli`
- `npx nx run degradation-audit:lint` — `libs/backend/task-specs` must not exceed 12
  (`tools\degradation-audit\baseline.json:33`)
- Every new degrading `catch` carries BOTH a `// degradation-audit: reported — <code>` marker
  and a reporter call with a string-literal `code` (R-7)
- No `apps\**` file other than `apps\ptah-cli\src\cli\commands\ptah-spec.spec.ts` is modified
- Repo-wide grep: the retired phrase `zero-padded to three digits` returns nothing outside
  git history (this closes the check Batch 3 could only run partially)
- The visibility port never throws on any of its five failure branches; the union is computed
  once per `create`; the suffix is fresh per attempt

---

## Shared executor rules (every batch)

- Work ONLY in `D:\projects\ptah-extension\.claude-worktrees\task-id-suffix`. Never in the
  repository root `D:\projects\ptah-extension`.
- **Do NOT run `npx nx reset`.** It is process-wide and would kill a sibling lane's daemon and
  clear its cache mid-run (root `CLAUDE.md`; R-5). No batch edits a `project.json`, so no reset
  is warranted.
- **Never `nx test projA projB`** — Nx runs the first project only and turns the rest into Jest
  path filters, printing a green tick for zero tests. Always `npx nx run-many -t test -p …`, and
  read the `Running target for N projects` header to confirm N.
- Touch ONLY the files in your batch's owned list. If the work seems to require a file owned by
  another batch, STOP and report it — another lane may be editing it right now.
- **Do not commit.** The team-leader owns git.
- Do not edit this file. The team-leader owns every task state in it.
- Report each task's completion with its evidence, the absolute path of every file created or
  modified, and how you handled each risk listed against your batch.

---

## Completion

All 4 batches / 17 tasks are verified and committed on `fix/task-id-suffix`.

| Batch | Name                                       | Commit      |
| ----- | ------------------------------------------ | ----------- |
| 1     | Suffixed id shape, end to end              | `864b2f0c2` |
| 2     | Metrics extractor accepts the suffix       | `90efd32fe` |
| 3     | The stated rule — renderer, then its copies | `1ef1d40f1` |
| 4     | The cross-checkout visibility seam         | `28cd80567` |

### Batch 4 gates, re-run by the team-leader

- `npx nx run-many -t test -p @ptah-extension/task-specs` — 18 suites, 489 passed, 23 skipped.
- `npx nx run-many -t typecheck -p @ptah-extension/task-specs ptah-cli` — 2 projects, clean.
- `npx nx run-many -t lint -p @ptah-extension/task-specs ptah-cli` — 2 projects, **0 errors**
  (125 warnings, all pre-existing), including `@nx/enforce-module-boundaries` — mechanical
  proof that no `agent-sdk` edge was added.
- `npx nx run degradation-audit:lint` — `libs/backend/task-specs: 12 ok (baseline 12)`. R-7 closed.
- ptah-cli tests: the literal `run-many` command is blocked by `ptah-cli:copy-wasm`, an
  environmental defect of this worktree (see follow-up 1). Run as
  `PTAH_ALLOW_SKIP_UNBUILT=1 npx nx run-many -t test -p ptah-cli --exclude-task-dependencies
  --skip-nx-cache` → **66 suites passed, 981 tests passed**, exit 0.
- Repo-wide grep for `zero-padded to three digits`: only the four `.ptah/specs/**` documents
  that quote the retired phrase. Zero hits in source, `.claude/`, `.codex/` or any `CLAUDE.md`.
  The 14 tracked `.codex/agents/*.toml` harness mirrors carry the same 7-line bullet as
  Batch 3's `.claude/agents/*.md`, so a `harness reconcile` regenerates identical content.
  `frontend-developer.toml` never carried the phrase and needed no edit.

### Validation risks — resolution

| Risk | Resolution                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------- |
| R-1  | Confirmed 11 sites / 7 files by re-grep; the `apps/ptah-cli` site is in Batch 4's commit and `ptah-cli` typechecks.     |
| R-2  | Every wave-1 batch ended green; no lane observed a red sibling project.                                                |
| R-3  | Substituted greps ran: retired phrase gone, new bullet in 15 `.claude/agents/*.md` + 14 `.codex/agents/*.toml`.        |
| R-4  | Both `jest.spyOn(idAllocator, …)` sites updated in Batch 1.                                                            |
| R-5  | `npx nx reset` was never run, by any lane or by the team-leader.                                                       |
| R-6  | `registry-generator.service.spec.ts:110,111,115` pin `DERIVED, NOT AUTHORITATIVE`, `NEVER ALLOCATE…` and `fail-if-exists mkdir` — all three survive the new banner verbatim, so no expectation needed changing. |
| R-7  | All four guarded catches carry the marker + a literal-code reporter call; audit holds at 12.                           |
| R-8  | `SDK_PROCESS_SPAWNER_TOKEN.description` pinned as the literal `'SdkProcessSpawner'`, matching `agent-sdk/src/lib/di/tokens.ts:51`. |

### Follow-ups this task deliberately did not do

1. **`scripts/copy-wasm.js` is worktree-hostile.** It resolves
   `path.resolve(__dirname, '..') + /node_modules/web-tree-sitter/…`, which does not exist in a
   `git worktree` checkout sharing the main clone's `node_modules` (verified: this worktree has
   no `node_modules` of its own). `ptah-cli:copy-wasm` therefore fails → `build` fails →
   `test` fails for anyone running the literal verification command in a worktree. A
   `require.resolve('web-tree-sitter/package.json')` lookup would fix it. Owner: `devops-engineer`.
2. **`.codex/agents/*.toml` are tracked generated artifacts.** Their directory is gitignored yet
   the 15 files are tracked, each with a `# source: ptah` header naming `~/.ptah/user/agents/*`
   as the upstream. Every prose change to an agent body must therefore be made twice — which is
   exactly why this task's grep gate failed the first time. Whether they should be tracked at
   all, and whether `harness-sync` should own the round trip, is worth its own task.
3. Minor, noted but untouched: `task-writer.create-race.spec.ts:33` has an unused
   `MockFileSystemProvider` type import (pre-existing lint warning at `HEAD`), and
   `libs/frontend/editor` has a stale degradation baseline entry needing `--update-baseline`.
