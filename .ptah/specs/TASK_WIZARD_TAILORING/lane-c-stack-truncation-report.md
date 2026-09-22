# Lane C — Stack Detection & Prompt Truncation Report

Task: `TASK_WIZARD_TAILORING` (lane C). Worktree: `fix/wizard-section-tailoring`.

## 1. Changes

### Fix 1a — Monorepo detection sees devDependencies and matches exact/scoped names

`libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts:402-416`

- Added a local predicate `isMonorepoTool`: true only when the package name equals `nx`, `lerna`, or `turbo`, or starts with `@nx/`, `@nrwl/`, or `@turbo/`.
- `isMonorepo` now tests `[...projectInfo.dependencies, ...projectInfo.devDependencies]` (line 413-416) instead of only `dependencies`.
- Effect: `nx` as a devDependency (this repository's layout) reports a monorepo; `onnx`, `next`, `nx-cloud` no longer match (the old `includes('nx')` matched `onnx`).

### Fix 1b — angular.json wins over the Node dependency branch

`libs/backend/workspace-intelligence/src/project-analysis/project-detector.service.ts:79-101`

- Moved the `angular.json` check (line 100-102) to the top of `detectProjectType`, before the `NODE_TS_PROFILE` branch, so the file-based framework signal beats dependency-based detection (React in devDependencies no longer wins).
- Removed the now-dead `angular.json` check that previously sat after the Ruby check.
- Updated the method doc comment's priority list (lines 79-86) to the new order, and documented that `nx.json` alone does not decide a type — it signals that a workspace-level config names the framework, so it has no branch (lines 89-91).
- `detectNodeProjectType` is kept unchanged as the fallback for repositories with no config file.

### Fix 2a — Truncation lands on structural boundaries and marks shortened sections

`libs/backend/agent-generation/src/lib/services/prompt-designer/response-parser.ts:236-369`

- New module constants/helpers: `SECTION_SHORTENED_MARKER` (line 236), `isListItemLine` / `isHeadingLine` (lines 240-248), `isAcceptableCut` (line 256), `truncateAtStructuralBoundary` (line 282).
- `truncateToTokenBudget` (line 324) now:
  1. Computes the proportional char budget as before.
  2. Walks back from the last fitting line to the nearest acceptable boundary: after a blank line (paragraph boundary), right before a heading line, or after the last item of a list. A cut inside a list, or right after a heading line (which would leave the heading dangling), is rejected, so the walk continues past the whole list block — a list is always kept whole or dropped whole.
  3. Gives up and falls back to the previous sentence/line cut when no boundary exists above 50% of the target chars (`truncateAtStructuralBoundary` returns `null`).
  4. Appends `_(section shortened to fit the prompt budget)_` instead of a bare `...` on every truncated path, structural or fallback.
- `validateOutput` (2000/2300 total budgets) is unchanged.

### Fix 2b — architectureNotes gets a higher, consistent budget

- `libs/backend/agent-generation/src/lib/services/prompt-designer/prompt-designer-agent.ts:190-228` — `enforceTokenBudgets` derives `maxArchitectureNotes = maxArchitectureNotesTokens ?? round(maxSectionTokens * 1.5)` (lines 193-196) and enforces it for `architectureNotes` only (lines 221-227). Other sections keep `maxSectionTokens`.
- `libs/backend/agent-generation/src/lib/services/prompt-designer/prompt-designer-agent.ts:331` — the JSON schema description for `architectureNotes` now says "under 600 tokens", matching the enforcement budget.
- `libs/backend/agent-generation/src/lib/services/prompt-designer/prompt-designer.types.ts:208-218, 234-235` — added optional `maxArchitectureNotesTokens` config field (defaults to 1.5x `maxSectionTokens` when unset) and raised `maxTotalTokens` default from 1600 to 1800.

## 2. Budget numbers chosen

| Budget | Value | Why |
|---|---|---|
| `maxSectionTokens` | 400 (unchanged) | Existing default. |
| architectureNotes budget | 600 = 1.5 x 400 | Task's suggested ratio; gives the three-isolation list room to survive truncation. Optional `maxArchitectureNotesTokens` overrides it; otherwise derived from `maxSectionTokens` so a configured `maxSectionTokens` stays coherent. |
| `maxTotalTokens` | 1600 → 1800 | Sum of section budgets: 3 x 400 + 600 = 1800. The previous 1600 was the sum under the old equal budgets; keeping it would have made the `Math.min` clamp in `enforceTokenBudgets` undercount a validly-sized output. |
| `validateOutput` total | 2000 (no qualityGuidance) / 2300 (with) — unchanged | A maximally-sized valid output is 1800 tokens; 1800 + ~300 quality guidance = 2100 ≤ 2300. A validly-sized output is never flagged, so no raise was needed. |

## 3. Files changed

- MODIFIED `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts`
- MODIFIED `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.spec.ts` (3 new tests: nx in devDependencies only; scoped `@nx/devkit`; no false positive from `onnx`/`next`)
- MODIFIED `libs/backend/workspace-intelligence/src/project-analysis/project-detector.service.ts`
- MODIFIED `libs/backend/workspace-intelligence/src/project-analysis/project-detector.service.spec.ts` (2 new tests: angular.json wins over react+@angular/core in devDependencies; react in devDependencies still wins without angular.json)
- MODIFIED `libs/backend/agent-generation/src/lib/services/prompt-designer/response-parser.ts`
- CREATED `libs/backend/agent-generation/src/lib/services/prompt-designer/response-parser.spec.ts` (8 new tests: under-budget untouched, paragraph boundary, heading boundary, numbered/bulleted list never half-emitted, whole list kept, fallback marker)
- MODIFIED `libs/backend/agent-generation/src/lib/services/prompt-designer/prompt-designer-agent.ts`
- MODIFIED `libs/backend/agent-generation/src/lib/services/prompt-designer/prompt-designer-agent.spec.ts` (3 new tests: 1.5x budget, truncation above own budget, explicit override)
- MODIFIED `libs/backend/agent-generation/src/lib/services/prompt-designer/prompt-designer.types.ts`

## 4. Verification

`npx nx run-many -t test -p agent-generation workspace-intelligence --output-style=static`:

```
Test Suites: 1 failed, 33 passed, 34 total
Tests:       2 failed, 1075 passed, 1077 total        (agent-generation, first run)
Test Suites: 44 passed, 44 total
Tests:       1121 passed, 1121 total                 (workspace-intelligence)
```

The agent-generation failures are NOT in this lane's files:

- First run: 2 failures in `user-layer-activation-sequence.spec.ts` — passes in isolation (`5 passed`) and was not reproduced on rerun (flake under parallel load).
- Rerun: 1 failure in `services/wizard/multi-phase-prompts.spec.ts` ("instructs incremental writes with heading skeleton first and section appending") — an untracked spec created by another lane working in this shared worktree (their modified `multi-phase-prompts.ts` / `multi-phase-analysis.service.ts`). I did not touch anything under `services/wizard/` or `generated-section-validator*`, and the wizard sources import nothing from my changed files (verified by grep for `prompt-designer|response-parser|truncateToTokenBudget|maxSectionTokens` under `services/wizard/` — no matches).

All of this lane's specs pass:

```
npx jest src/lib/services/prompt-designer src/lib/services/enhanced-prompts
Test Suites: 3 passed, 3 total
Tests:       91 passed, 91 total
```

`npx nx run-many -t lint -p agent-generation workspace-intelligence --output-style=static`:

```
✖ 10 problems (0 errors, 10 warnings)
NX   Successfully ran target lint for 2 projects
```

All 10 warnings are pre-existing in files this lane did not touch (`error-accumulation.ts`, `generation-pipeline.ts`, `patterns.spec.ts`, `agent-customization.service.spec.ts`, `file-system.service.ts`). Lint exits green (0 errors).

Also ran `npx nx run-many -t build -p agent-generation workspace-intelligence` (not required, extra type safety):

```
NX   Successfully ran target build for 2 projects and 8 tasks they depend on
```

## 5. Could not do / out-of-scope observations

- The full `agent-generation` test target does not pass in this worktree because another lane's in-flight spec (`services/wizard/multi-phase-prompts.spec.ts`) fails. That file is explicitly out of my ownership ("Do NOT touch anything under `services/wizard/`"). The orchestrator should re-run the target after the wizard lane lands its fix.
- `generation-prompts.ts:52` still tells the LLM "Each section must stay under 400 tokens. Total output should be under 1600 tokens." That file is not in my allowed file list, so I did not update it. The enforcement budget (600) still gives architectureNotes truncation headroom, but aligning the LLM-facing text would need a separate change.
- `catch (error: unknown)` used nowhere new (no new catch blocks were needed); no `as any`, no `@ts-ignore` added.

# Revision 1 — review-lane-c.md (REVISE 4/10) addressed

Ownership extended to `generation-prompts.ts`. All four review findings fixed; the two detection findings needed no change.

## Item 1 — list integrity in truncateToTokenBudget (review 1 + 2)

Fix: `response-parser.ts:244-406` rewritten around a real block parser.

- `estimateTokens` exported (`response-parser.ts:244`), the same ceil(chars/4) estimator the module uses.
- `analyzeStructure` (`response-parser.ts:283`) parses blocks: a heading with its body (to the next blank line), a paragraph (to a blank line / heading / list start), or one complete top-level list item. An item starts with `-`, `*`, `+`, `\d+.` or `\d+)` plus a space (`LIST_MARKER_PATTERN`, line 261); it owns every following line indented deeper than its marker (wrapped text, nested children) and every blank line that a deeper-indented line follows (loose list). Cuts between the returned offsets can never split an item or separate a nested item from its parent. CRLF content is parsed CR-stripped but offsets are computed from raw lines, so cuts stay byte-exact.
- `truncateToTokenBudget` (`response-parser.ts:380`): when the content contains any list, the sentence heuristic never runs and there is no 50% floor — it keeps the leading whole blocks/items that fit the reserved target, drops the rest, and returns the marker alone only when nothing fits. The no-list path keeps the 50% floor and sentence fallback.

### Exact outputs for the review's traced cases (locked by tests)

`M` below = `\n\n_(section shortened to fit the prompt budget)_`; marker alone = `_(section shortened to fit the prompt budget)_`.

| Case | Input (max/current tokens) | Output after fix |
|---|---|---|
| a | 6-item numbered list (30/60) | `1. abcdefghij\n2. abcdefghij` + M — items 1–2 complete, no bare `3.` |
| b | heading + paragraph + 3 items (42/60) | `## Rules\n\nParagraph with enough context.` + M |
| c | nested list (35/60) | marker alone — first parent (40 chars) exceeds the reserved 29-char target; children are never separated from a parent |
| d | wrapped item (20/60) | marker alone — item 1 with its continuation is 57 chars, above the reserved 12 |
| e | CRLF content (10/10) | byte-identical, CRLF preserved |
| f | sentences (30/60) | `First sentence. Second sentence.` + M (sentence fallback, no list) |
| f2 | intro + 4 items (40/60) | `Intro\n\n1. abcdefghij` + M — no bare `3.` |

(c) and (d) now return the marker alone. Under the decided marker arithmetic (below) no whole item fits the reserved target, and the review's own finding 1 accepts "Returning only the marker is structurally compliant"; these are the "empty content plus marker is the last resort" cases. Exact strings are asserted in `response-parser.spec.ts`.

Additional exact-output tests: `+` marker list, `1)` marker list, loose list (`1. first item\n\n2. second item` kept through the internal blank line), nested-parent-kept (case c input, 45/60 → parent + both children), wrapped-item-kept (case d input, 40/42 → marker line + continuation line).

## Item 2 — marker cost reserved (review 4)

- `response-parser.ts:392-399`: `effectiveTargetChars = floor(maxTokens/currentTokens × content.length) − estimateTokens(SECTION_SHORTENED_MARKER)` (12 tokens) before any boundary is chosen. Budget below the marker cost → marker alone (`:387`).
- After a boundary is chosen, the complete result (content + marker) is verified with `estimateTokens` and walks back one boundary while over budget (`:404-417`); the sentence fallback has the same verify-and-shrink loop (`:433-442`).
- Arithmetic note: the marker's 12 tokens are subtracted from the proportional CHAR target, not from maxTokens. Token-space subtraction (maxTokens − 12 → recompute) yields only item 1 for case (a), which contradicts the mandated "items 1–2 complete plus the marker". Char-space subtraction (41 − 12 = 29 → 27 chars) reproduces it exactly. The honest verify-and-walk-back loop covers any under-reservation this heuristic can cause.
- Test: `truncateToTokenBudget('A'.repeat(1604), 400, 401)` now returns `'A'.repeat(1552)` + marker, and `estimateTokens(result) === 400` (was 1648 chars / 412 tokens). Also covered: maxTokens 10 (< marker cost) → marker alone; content budget below the marker → marker alone.

## Item 3 — truthful totals and a bounded qualityGuidance (review 3, blocking)

- `Math.min` clamp DELETED. `prompt-designer-agent.ts:263-279` recounts every section from the FINAL text with `estimateTokens` and sets `totalTokens` to the true sum; the old clamp (fabricated 1800) is gone.
- qualityGuidance is now bounded (`prompt-designer-agent.ts:249-258`): truncated to `maxQualityGuidanceTokens` like the other sections.
- Budget rule lives in one place, `deriveEffectiveBudgets` (`prompt-designer.types.ts:208`): `maxQualityGuidance = (3 × maxSection + maxArchitectureNotes + maxSection ≤ 2300) ? maxSection : 300`. Default: 3×400 + 600 + 400 = **2200 ≤ 2300**, so quality gets the same **400** as the other sections. The 300 fallback is the validator headroom (2300 − 2000) and applies only when a configured `maxSectionTokens` would break the 2300 validator total. `VALIDATOR_TOTAL_TOKENS_WITH_QUALITY = 2300` (`prompt-designer.types.ts:140`) is shared with `validateOutput` (`response-parser.ts:530`).
- Final budget numbers: sections 400, architectureNotes 600 (1.5×, optional override), qualityGuidance 400, stated total 1800, validator total 2000 (four sections) / 2300 (five).
- Existing-test audit: NO existing test asserted the clamped `totalTokens` — all `enforceTokenBudgets`/`configure` tests assert section text or call arguments, and only the untouched `generateFallbackGuidance` path asserts `totalTokens > 0`. Nothing had to be changed for the truthful totals. The two `buildGenerationUserPrompt` call assertions gained a third budgets argument (signature change, `prompt-designer-agent.spec.ts:117,130`).
- Real-parser integration test (`response-parser.spec.ts`, "integration with PromptDesignerAgent"): sections at 400/400/400/600/600 claimed tokens, qualityGuidance over budget → real truncation to `Q×1552 + marker`; recounted breakdown 400/400/400/600/400, `totalTokens === 2200`, and `validateOutput(result)` returns `{valid: true, issues: []}` — the review's 2400-token false-pass reproduction now produces honest, valid numbers.

## Item 4 — prompt wording follows config (review 5)

All budget literals derive from `deriveEffectiveBudgets(this.config)`:

- `buildSystemPrompt(budgets)` (`generation-prompts.ts:63`) appends a Token Budget section with the effective numbers; `PROMPT_DESIGNER_SYSTEM_PROMPT` (barrel export, kept) is now `buildSystemPrompt(DEFAULT_PROMPT_BUDGETS)` (`generation-prompts.ts:78`) — "under 400 / up to 600 / under 1800", no stale 1600.
- `buildGenerationUserPrompt(input, qualityContext?, budgets?)` (`generation-prompts.ts:194`): "Keep each section under ${maxSectionTokens} tokens" and "Keep this section under ${maxQualityGuidanceTokens} tokens" derive from the passed budgets.
- `buildJsonSchema` (`prompt-designer-agent.ts:351`): all five descriptions are template literals over the effective budgets (the stale "under 500" frameworkGuidelines is fixed too).
- Zod schema descriptions (`prompt-designer.types.ts:241`) derive from `DEFAULT_PROMPT_BUDGETS`; the stale line-164 "under 400" for architectureNotes now says "under 600", quality says "under 400". The config block moved above the schema so the descriptions can reference it at module load.
- Configured values flow through everywhere: test at `prompt-designer-agent.spec.ts` configures `maxSectionTokens: 200` and asserts schema descriptions "under 200"/"under 300" and `buildSystemPrompt` called with `{maxSectionTokens: 200, maxArchitectureNotesTokens: 300}`.

## Verification

`npx nx run-many -t test,lint -p agent-generation workspace-intelligence --skip-nx-cache --output-style=static` — exit 0, all targets green:

```
agent-generation:        Test Suites: 34 passed, 34 total
                         Tests:       1116 passed, 1116 total
workspace-intelligence:  Test Suites: 44 passed, 44 total
                         Tests:       1121 passed, 1121 total

NX   Successfully ran targets test, lint for 2 projects
Run duration: 54.3s   Cache: Skipped (--skip-nx-cache)
```

No wizard/multi-phase flake occurred in this run. Lint exits green (the 10 pre-existing warnings in files this lane never touched are unchanged). agent-generation grew from 1096 to 1116 tests (prompt-designer suites: 58 of them, all passing).

No commits were made; no state-changing git command was run.