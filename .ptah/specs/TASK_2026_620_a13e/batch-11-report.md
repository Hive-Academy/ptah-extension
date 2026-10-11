# Batch 11 report: Synthetic skills fixtures

Executor: backend-developer sub-agent. Worktree
`D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench`. Nothing was committed.

Status: **PARTIAL**. Task 11.2 is done. Task 11.1 is **BLOCKED on Batch 4**: no session writer exists
yet.

## Task 11.2 Planted negative skill documents: done

Files:

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\fixtures\memory-skills\planted-negatives.v1\pn-01.md` … `pn-10.md` (10 documents)
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\fixtures\memory-skills\planted-negatives.v1\index.json`
  - `{schemaVersion, id: 'planted-negatives@v1', documents[{file, kind, derivedFrom, sha256}]}`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\fixtures\memory-skills\MANIFEST.json`
  - rebuilt with Batch 3's `buildManifest` + `writeManifest`; it now lists 11 files.

The 5 degenerate kinds from design §4.3, 2 documents each:

| Files | Kind | Derived from |
|---|---|---|
| pn-01, pn-02 | restated user request | synthetic text |
| pn-03, pn-04 | raw trajectory dump (same shape as the product's template fallback) | synthetic text |
| pn-05, pn-06 | empty steps | synthetic text |
| pn-07, pn-08 | correct skill with its trigger description deleted (frontmatter keeps only `name`) | `.claude/skills/tribunal/SKILL.md`, `.claude/skills/video-showcase/SKILL.md` @ `d995a1e1a` |
| pn-09, pn-10 | body copied from another skill, with a new name and description | `.claude/skills/nestjs-deployment/SKILL.md`, `.claude/skills/ddd-architecture/SKILL.md` @ `d995a1e1a` |

- **No user data.** Every document is either synthetic or taken from git-tracked authored skills.
  None comes from the candidate copy, the snapshot or any transcript.
- **File names do not give away the kind.** They are `pn-NN`; the kind is recorded only in
  `index.json`, so a judge or rater reads only the document.
- **Formatting change in pn-07.** Prettier re-padded the Markdown tables copied from `tribunal`. This
  changes whitespace only, and the hashes were recomputed after formatting.
- U1 raters may still veto any document at labelling time, as the batch allows.

## Task 11.1 Funnel session fixture generator: BLOCKED

- **Why it is blocked.** Batch 11 depends on Batch 4's session writer: the generator that emits
  SDK-shaped JSONL lines. Batch 4 is PENDING, and `ground-truth/seeded-session-generator.ts` does not
  exist in the worktree. Writing a second JSONL writer here would duplicate Batch 4's planned output
  (replace, don't accumulate), so 11.1 was not started.
- **What 11.1 needs when it resumes**, from reading the product source:
  - **Sessions must pass the skill pipeline's extractor.** `SkillSynthesisService.enqueueAnalyze` and
    `analyzeSession` call `TrajectoryExtractor.extract(sessionId, workspaceRoot,
    MIN_ROLE_TURNS_FLOOR, transcriptPath)`.
    - Sessions with fewer than 2 role turns emit feed event `{kind: 'ineligible', reason:
      'prefilterTooThin'}`.
    - Sessions that fail the work-evidence prefilter emit `{kind: 'ineligible', reason:
      'prefilterRejected'}` (`skill-synthesis.service.ts:563-581, 716-767`).
  - **Feed event vocabulary.** It is `SkillSynthesisEventKind` (`diagnostics.types.ts:3-16`).
  - **Trigger-side kinds.** These come from `triggers/skill-trigger.service.ts`: `subagent-stop`,
    `edit-then-test`, `idle-trigger`, `boot-scan`, `rate-limited` and `error`. The fixture script's
    operations should map onto these producers, so expected events are derived from the script and
    not from pipeline output.
  - **Size.** 30 sessions: 4 routines × 3, plus 10 non-routine, plus 8 degraded.

## Verification

- `npx nx run-many -t typecheck,lint -p mcp-bench --skip-nx-cache`: succeeded.
- `npx nx run mcp-bench:test --maxWorkers=2`: 199/200 tests. The one failure is 619's `corpus.spec.ts`;
  it passes when re-run alone (git-worktree contention with parallel lanes) and is not in this
  batch's files.
- `npx jest … src/memory-skills/ground-truth`: 49/49, including Batch 3's "committed memory-skills
  fixtures" check against the rebuilt manifest.
- `verifyManifest(tools/mcp-bench/fixtures/memory-skills)`: `{"ok":true,"mismatches":[]}`.
- `npx prettier --check --ignore-unknown tools/mcp-bench/fixtures/memory-skills`: clean.

## Risks

- **MANIFEST.json is shared.** Batch 4 (Task 4.2) also rebuilds `MANIFEST.json`. Whichever batch
  lands second must rebuild it with `buildManifest`, not hand-edit it.
- **The generation script is not committed.** The 10 documents were written once, by a temporary
  script, as the design asks ("written once by the labeller and frozen"). Their provenance is in
  `index.json`.
