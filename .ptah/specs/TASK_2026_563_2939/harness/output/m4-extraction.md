# M4 extraction eval: old prompt against new — TASK_2026_563_2939 (Phase 1)

**Label (implementation-plan.md:926-932): this is a prompt-only, limited evaluation.** MCP tools
were off for both variants, so the new prompt's reuse-by-search lever (`ptah_memory_search`) was
not exercised. Turning search off can change the model's behaviour and recall in either
direction.

Raw data:

- `%TEMP%\mqs-563-eval\m4-calls.jsonl` holds one line per call, with the parsed drafts, usage and
  the last assistant text.
- `output/m4-extraction.json` holds the aggregates.
- `output/m4-drafts.json` holds every draft.
- `output/m4-windows.json` holds the window plan.
- `output/m4-sample.json` holds the sample.
- `output/m4-draft-classifications.md` holds the per-draft verdicts.

## Sample (seed `TASK_2026_563_2939:m4`)

**Pool.** The pool is `~/.claude/projects/D--projects-ptah-extension/*.jsonl` and was drawn at
2026-09-26T17:46:20Z:

| Step                   | Rule                                                                                                                                                                |       Files left |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------: |
| All JSONL files        | —                                                                                                                                                                   |              330 |
| Size                   | 200 KiB to 5 MiB (204,800 to 5,242,880 bytes)                                                                                                                       |              280 |
| Closed                 | not modified since 2026-09-25T17:46:20Z                                                                                                                             |              270 |
| Has memory on the copy | ≥ 1 memory with that `session_id` and `workspace_root` = `D:\projects\ptah-extension`, on the unmigrated copy `m4-unmigrated.sqlite` (the plan's filter, plan:1029) | **231 eligible** |

**Order.** The eligible files are ordered by `sha256(seed + ':' + filename)` ascending, with the
filename including `.jsonl`. The first 10 were taken:

|   # | Session                              | JSONL bytes | mtime (UTC)      | Memories on copy | Messages after last compact boundary | Transcript chars | Windows |
| --: | ------------------------------------ | ----------: | ---------------- | ---------------: | -----------------------------------: | ---------------: | ------: |
|   1 | 175019c3-ee52-4498-9f57-012d946bf325 |   5,157,766 | 2026-09-15 15:44 |              177 |                                   27 |           37,379 |       2 |
|   2 | d7a5f184-14fe-488b-8353-692017abe140 |   1,536,066 | 2026-08-27 18:34 |               12 |                                  246 |          185,102 |       6 |
|   3 | 665944b7-5b85-4760-bd48-e945ca0ace05 |   1,950,261 | 2026-09-06 17:03 |               92 |                                  339 |          259,093 |       8 |
|   4 | 9135b755-fc8c-4531-b6a0-7a7f531c811e |     714,469 | 2026-09-09 20:50 |               20 |                                  139 |           76,842 |       3 |
|   5 | b72b0c96-9854-4029-992d-4289a4560ea7 |     523,089 | 2026-09-06 18:03 |               51 |                                  115 |           83,104 |       3 |
|   6 | b289a3a6-7ba8-4bf2-bd3b-18699a1d9d13 |     795,363 | 2026-09-03 22:16 |                7 |                                  104 |           71,882 |       3 |
|   7 | 1359b2b0-8ab4-49a6-927e-03a1d91ec5d3 |     856,046 | 2026-09-03 04:38 |                1 |                                   65 |           64,339 |       3 |
|   8 | c99bca45-f298-4bc1-b32c-01d7ce79ceed |   1,521,583 | 2026-09-08 00:32 |               35 |                                  353 |          193,881 |       7 |
|   9 | d037db3e-9f04-42c4-8dfa-58eb6f9fb8b5 |     806,573 | 2026-09-18 19:45 |                3 |                                   33 |           27,883 |       1 |
|  10 | af174790-8ba9-482e-82fa-429a0cdf56df |   2,630,101 | 2026-08-29 19:48 |               38 |                                  260 |          206,161 |       7 |

The sample has **43 windows**, so the run made **86 extract calls**. No transcript needed the
chunked-budget clamp. `compressedChars` equals `transcriptChars` for every session.

## Method

- **Transcript path:**
  1. `SessionHistoryReaderService.readHistoryForCuration(id, 'D:\projects\ptah-extension')`, the
     real service built from the real `JsonlReaderService` and `HistoryEventFactory`. The file is
     read whole, as the PreCompact path reads it, and everything before the last `compact_boundary`
     is dropped.
  2. The join from `SdkTranscriptReaderAdapter.read`: `` `${ROLE}: ${content}` `` joined by `\n\n`.
  3. `.trim()`, as in `doCurate`.
  4. The real `planCuratorWindows` with the default budget of at most 8 windows.
- **LLM call:** `SdkInternalQueryCuratorLlm.extract(window.text)`, the real adapter. `runQuery`,
  last-message capture and `parseDrafts` run verbatim.
- **Model:** the adapter's default tier `haiku`. Every call resolved to `claude-haiku-4-5-20251001`
  (SDK `system/init`).
- **Settings:** `maxTurns` 6, as in production. `cwd` was `D:\projects\ptah-extension`.
- **Old prompt:** the stand-in asserted that the received `systemPromptAppend` equals the branch
  `EXTRACT_SYSTEM_PROMPT`, then substituted the `ebfc73321` text. `buildExtractUserPrompt` is
  byte-identical in both commits.
- **Tools:** MCP was off (`mcpServers: {}`, `strictMcpConfig: true`, `settingSources: []`). Only the
  read-only `Read`, `Grep` and `Glob` were available.
- **Tool use observed:** 1 old call used `Read` ×2, and 1 new call used `Grep` ×1.
- **Interleaving:** the variant order alternates by global window index. Even windows ran old then
  new, and odd windows ran new then old. A pool of 3 workers dispatched the windows.
- **Outcomes:** 86/86 calls returned `success` / `extracted`. There were 0 errors, 0 stalls and
  0 `no-output` results.
- **Run time:** 2026-09-26 17:47:02Z to 18:10:28Z.

## Results (aggregated over the 10 sessions)

| Metric                                                                                                           | Old prompt (`ebfc73321`) | New prompt (branch) |
| ---------------------------------------------------------------------------------------------------------------- | -----------------------: | ------------------: |
| Extract calls                                                                                                    |                       43 |                  43 |
| Total drafts                                                                                                     |                  **155** |    **128** (−17.4%) |
| Drafts with a null subject                                                                                       |                        1 |                   0 |
| Distinct case-folded subjects (`TRIM(LOWER)`)                                                                    |                      148 |                 127 |
| Single-use subjects (used by exactly 1 draft)                                                                    |                      145 |                 126 |
| Single-use share (of distinct subjects)                                                                          |                **98.0%** |           **99.2%** |
| Distinct subjects that already exist on the copy for `D:\projects\ptah-extension` (`TRIM(LOWER(subject))` match) |                       18 |               **6** |
| Subjects naming a task, PR or batch (regex `task[-_ ]?20dd`, `task[-_]d`, `pr-?ddd`, `batch-`)                   |                31 drafts |        **7** drafts |
| Kinds (fact / preference / event / entity)                                                                       |        122 / 20 / 11 / 2 |    100 / 19 / 4 / 5 |
| **Rubric: durable (D)**                                                                                          |              100 (64.5%) |     **105 (82.0%)** |
| **Rubric: mixed (M)**                                                                                            |               23 (14.8%) |            8 (6.3%) |
| **Rubric: sediment (S)**                                                                                         |               32 (20.6%) |      **15 (11.7%)** |
| Sediment class tags on S and M drafts (1 / 2 / 3; a draft can carry two)                                         |              36 / 28 / 2 |         14 / 12 / 1 |
| Mean call duration                                                                                               |                   46.0 s |              53.0 s |
| Output tokens                                                                                                    |                  129,188 |             160,881 |

The 18 old subjects already on the copy include `task-2026-254`, `task-2026-359`, `task-2026-367`,
`task-2026-381`, `task-2026-383`, `task-2026-439`, `pr-477-editor-launcher` and `seshat`. The 6 new
subjects already on the copy are `degradation-audit-tool`, `hyperframes-transparent-overlay-format`,
`hyperframes-version-pinning`, `platform-electron-coverage-thresholds`, `task-2026-359` and
`task-2026-381-scope-boundary`.

**Interpretation:**

- **A fall in "already on copy" is not reuse.** With MCP off, neither variant could look up an
  existing subject, and matching an existing key requires that lookup. The drop from 18 to 6 is
  mostly the loss of task-id and bare-product subjects (`task-2026-*`, `seshat`), which the new
  SUBJECTS rules forbid.
- **Subject reuse cannot be judged here.** Single-use share stays at about 98-99% in both variants
  inside this sample.

**Task and PR subjects still produced by the new prompt (7):**

- `task-2026-439-thoth-rework-six-phases`
- `task-2026-380-and-381-complementarity`
- `task-2026-380-file-conflicts`
- `task-2026-381-scope-boundary`
- `pr-477-editor-launcher-executable-only-detection`
- `task-2026-254-template-hardcoding`
- `task-2026-359`

Of these, 6 were classified sediment (class 2) and 1 mixed. The mixed one is the PR subject
(9135b755.w1.new.0), which carries a durable lesson.

**Per session, D / M / S:**

| Session  | Old        | New           |
| -------- | ---------- | ------------- |
| 175019c3 | 4 / 1 / 5  | 7 / 0 / 1     |
| d7a5f184 | 10 / 3 / 2 | 7 / 1 / 3     |
| 665944b7 | 13 / 7 / 7 | 21 / 2 / 6    |
| 9135b755 | 3 / 0 / 4  | 1 / 1 / 0     |
| b72b0c96 | 14 / 2 / 2 | 19 / 1 / 1    |
| b289a3a6 | 13 / 0 / 3 | 12 / 0 / 0    |
| 1359b2b0 | 4 / 1 / 2  | **0 / 0 / 0** |
| c99bca45 | 19 / 4 / 6 | 16 / 1 / 0    |
| d037db3e | 2 / 1 / 0  | 6 / 1 / 1     |
| af174790 | 18 / 4 / 1 | 16 / 1 / 3    |

## Durable-loss list: old durable or mixed drafts with no durable equivalent in the new run

Equivalence was judged by content, within the same session. A new draft counts as equivalent when
it carries the same durable fact, rule or root cause, even under a different subject. The old run
had 123 drafts with durable content (100 D + 23 M). **33 of them have no durable equivalent in the
new run:**

|   # | Old draft             | Subject                            | Durable content lost                                                                      | Note                                                                   |
| --: | --------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
|   1 | 175019c3.w1.old.6     | nx-command-syntax                  | use `nx run-many -p`, never `nx test a b c`; no `nx reset` on shared worktrees            |                                                                        |
|   2 | d7a5f184.w1.old.2     | registry-record-identity           | `isSessionActive` tests presence, not liveness; prefer `broadcaster.isStreaming`          | partial: the token pattern is kept (w5.new.0)                          |
|   3 | d7a5f184.w2.old.2     | session-id-canonicalization        | state armed under tabId is torn down under the UUID; `realSessionId ?? tabId`             |                                                                        |
|   4 | d7a5f184.w4.old.2     | agent-resumption                   | check disk and git state before resuming an interrupted subagent                          |                                                                        |
|   5 | d7a5f184.w5.old.1 (M) | agent-cap-raise-20                 | the four sync points must change together                                                 | the new run kept only a config restatement (S3)                        |
|   6 | d7a5f184.w5.old.2     | skills-sh-timeout-flake            | skills-sh specs time out at 5 s under full-suite load                                     |                                                                        |
|   7 | 665944b7.w4.old.2     | transcript-render-window-design    | IntersectionObserver render window, ALWAYS_MOUNTED_TAIL = 6, safe degradation             | also carried by w5.old.0 (M) and w7.old.2 (M)                          |
|   8 | 665944b7.w3.old.1 (M) | task-2026-381                      | AutoSizeVirtualScrollStrategy rejected because of oscillation; unmount instead of replace |                                                                        |
|   9 | 9135b755.w0.old.0     | editor-fallback-selection-pr477    | fallback chain remembered → vscode → targets[0]                                           |                                                                        |
|  10 | 9135b755.w2.old.0     | worktree-cleanup                   | remove the worktree and branch right after merge                                          | the subject already exists on the copy                                 |
|  11 | b72b0c96.w0.old.3     | video-editor-folder-structure      | job layout and kebab-case-by-content naming                                               | partial: the layout appears in w1.new.4                                |
|  12 | b72b0c96.w0.old.7     | hyperframes-separate-from-remotion | keep the HyperFrames and Remotion pipelines separate                                      |                                                                        |
|  13 | b72b0c96.w0.old.10    | no-explanatory-comments            | default to zero explanatory comments                                                      |                                                                        |
|  14 | b289a3a6.w0.old.3     | topic-creation-request-contract    | the POST topics request and response contract                                             |                                                                        |
|  15 | b289a3a6.w0.old.4     | category-visibility-and-cohorts    | visibility drives the cohort selectors                                                    |                                                                        |
|  16 | b289a3a6.w1.old.2     | admin-no-markdown-render           | admin never renders member markdown (NFR-S2)                                              |                                                                        |
|  17 | b289a3a6.w1.old.3     | detail-drawer-inert-accessibility  | `inert` vs `pointer-events-none`                                                          |                                                                        |
|  18 | b289a3a6.w1.old.5     | detail-drawer-document-order       | always-mounted drawers: DOM order drives `querySelector`                                  |                                                                        |
|  19 | 1359b2b0.w0.old.0     | mojibake-utf8-cp1252-corruption    | the double-encoding mechanism and its byte signature                                      | the new prompt returned **0 drafts for all 3 windows** of this session |
|  20 | 1359b2b0.w0.old.1     | bulk-repair-script-pattern         | code-point literals, dry-run, `git ls-files`, keep EOL                                    | same                                                                   |
|  21 | 1359b2b0.w0.old.2     | parallel-batch-file-exclusion      | exclude a parallel branch's files and the deliberate reference files                      | same                                                                   |
|  22 | 1359b2b0.w0.old.3     | bulk-repair-verification-workflow  | the six-step verification                                                                 | same                                                                   |
|  23 | 1359b2b0.w1.old.0 (M) | batch-b11-mojibake-repair          | the `sanitizeConsoleText` caveat: not every em-dash is corruption                         | same                                                                   |
|  24 | c99bca45.w0.old.1     | sonarcloud-public-api              | the public API works when the MCP tool returns empty                                      |                                                                        |
|  25 | c99bca45.w1.old.5     | parallel-agent-orchestration       | file-disjoint lanes; the orchestrator commits                                             | an equivalent exists in another session's new run (af174790.w2.new.3)  |
|  26 | c99bca45.w4.old.0 (M) | nx-parallel-test-windows-timeout   | local Windows is not authoritative; only CI Linux is                                      |                                                                        |
|  27 | c99bca45.w5.old.2     | merge-conflict                     | check provenance before resolving a modify/delete conflict                                |                                                                        |
|  28 | af174790.w0.old.1 (M) | task-2026-261-resolution           | `reconcile()` has production callers; the mirrorSkillSlug invariant                       |                                                                        |
|  29 | af174790.w3.old.1     | content-cache-partial-failure-fix  | persist `contentHash` only when every download succeeds                                   |                                                                        |
|  30 | af174790.w3.old.2     | replacement-policy-scope           | the replacement policy applies only to edit-capable roles                                 |                                                                        |
|  31 | af174790.w3.old.3 (M) | plugin-bundle-denylist             | every denylist entry states its reason                                                    |                                                                        |
|  32 | af174790.w5.old.2     | template-voice                     | preserve the template voice when applying findings                                        |                                                                        |
|  33 | af174790.w6.old.2     | template-guards-denylist           | a Ptah-term denylist guard as a second layer                                              |                                                                        |

**Gains in the other direction.** The new run also produced durable drafts that the old run did not
have for the same session. These were **not counted exhaustively**. Examples:

- `resolve-frame-rate-fidelity-critical`, `resolve-create-timeline-from-clips` and
  `editing-cut-criteria` (b72b0c96)
- `forum-soft-delete-visibility-filtering`, `publishing-separate-from-saving`,
  `visibilities-single-source-of-truth` and `reorder-api-sends-full-list` (b289a3a6)
- `ptah-state-database-sacred-paths` and `memory-retention-gates-cron-pattern` (175019c3)
- `ci-verification-capture-actual-exit-codes` and `merge-backup-untracked-files` (c99bca45)
- `guard-spec-extraction-pattern`, `concurrent-agent-staged-index-contamination` and
  `agent-template-llm-section-gating` (af174790)
- the 5 additional durable Seshat rules (d037db3e)

Net durable content (D + M) is 123 old against 113 new. The new prompt has **more pure-durable
drafts (105 against 100)** and **fewer mixed or sediment drafts (23 against 55)**.

## Cost and network

|                                                 |  Calls | Uncached input | Cache creation |  Cache read |      Output | SDK `total_cost_usd` |
| ----------------------------------------------- | -----: | -------------: | -------------: | ----------: | ----------: | -------------------: |
| Probe (new prompt, synthetic 3-line transcript) |      1 |             10 |         10,984 |       4,568 |         713 |               0.0270 |
| Old                                             |     43 |            446 |        648,864 |     439,549 |     129,188 |               2.4153 |
| New                                             |     43 |            438 |        641,304 |     436,662 |     160,881 |               2.5582 |
| **Total**                                       | **87** |        **894** |  **1,301,152** | **880,779** | **290,782** |           **≈ 5.00** |

- **Tokens.** Input-side tokens total **≈ 2.18 M**: uncached, plus cache creation, plus cache read.
  Most of that is the `claude_code` preset system prompt, which is cache-created or cache-read on
  every call. Output totals **≈ 0.29 M**. The plan estimated at most about 1.5 M input tokens for
  160 calls; this run used 87 calls, and the preset system prompt is why input exceeds that
  estimate.
- **Cost.** The `total_cost_usd` figures are what the SDK reports. They may be notional if the CLI
  login is a subscription.
- **Auth.** The run used the user's own `claude` CLI login. The empty `ANTHROPIC_*` variables in the
  harness environment were dropped for the child process.
- **Data touched.** No live-database access happened. The transcripts were only read.
