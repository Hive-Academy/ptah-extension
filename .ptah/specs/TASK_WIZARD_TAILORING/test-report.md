# TASK_WIZARD_TAILORING — test report

Branch `fix/wizard-section-tailoring`, worktree `.claude-worktrees/wizard-tailoring-fix`, base `origin/main` at `09d5ae60d`.
Evidence: `%APPDATA%\Ptah\logs\Ptah Electron-2026-09-22.log` lines 1260–1385 (10 `generated text rejected` WARN lines), `.ptah/analysis/ptah-extension/generation-manifest.json` (`tailoredSections: 0` on all 15 agents), `03-quality-audit.md` (49 bytes).

## Before / after: the 10 rejected sections

Replayed with the real `GeneratedSectionValidator` against the real worktree, through a glob-backed `IFileSystemProvider` (fast-glob, excludes `node_modules`, `dist`, `.git`). Each section reconstructed from the exact token list in its log line, every token in a code span. Two index conditions: the real four phase files from `.ptah/analysis/ptah-extension/` as the analysis index (449 entries), and an empty index (disk only, worst case).

| # | Template / section | Before (log) | After, real index | After, empty index |
|---|---|---|---|---|
| 1 | software-architect / EXISTING_PATTERNS | rejected | accepted | accepted |
| 2 | backend-developer / FRAMEWORK_CONVENTIONS | rejected | accepted | accepted |
| 3 | backend-developer / ARCHITECTURE_PATTERNS | rejected | accepted | accepted |
| 4 | frontend-developer / FRAMEWORK_CONVENTIONS | rejected | accepted | accepted |
| 5 | frontend-developer / ARCHITECTURE_PATTERNS | rejected | accepted | accepted |
| 6 | devops-engineer / BUILD_AND_DEPLOY_SURFACE | rejected | rejected: `release/*` | rejected: `release/*` |
| 7 | senior-tester / TEST_INFRASTRUCTURE | rejected | accepted | rejected: `src/**/*.test.ts` |
| 8 | code-style-reviewer / REVIEW_FOCUS | rejected | accepted | accepted |
| 9 | code-logic-reviewer / REVIEW_FOCUS | rejected | accepted | accepted |
| 10 | visual-reviewer / REVIEW_FOCUS | rejected | accepted | accepted |
| | **Accepted** | **0 / 10** | **9 / 10** | **8 / 10** |

The two residual rejections are correct behaviour, not defects:
- `release/*` is a git branch pattern from `.github/workflows/sync-release-branch.yml`. There is no `release/` directory. It is accepted only when the analysis text surfaces it (spec case `accepts devops-engineer / BUILD_AND_DEPLOY_SURFACE` with index evidence; sibling case proves rejection with an empty index).
- `src/**/*.test.ts`: the repository has no `.test.ts` file. With the real index it is accepted through the fixed-prefix rule on `src`; with no index it is a glob nothing matches.

`kebab-case.ts` (case 8) is now excluded from citations through a closed set of casing-convention stems, not through a prose-context rule. An invented basename after "Naming convention:" is still rejected (spec case).

## Resolver render check

`backend-developer.template.md` rendered through the real `TemplatePartialResolver` with the `_shared` partials (blocks expanded: TOOLING_PRECEDENCE, TASK_SPEC_CONTRACT, CLARIFICATION_PROTOCOL, REPLACEMENT_POLICY, CLI_DELEGATION). The `LLM:FRAMEWORK_CONVENTIONS` fallback was extracted from the rendered output and a generated section with the same heading citing `register.ts`, `@ptah-extension/shared` and `error.message` was validated with an empty index against the real worktree: `{"accepted":true,"violations":[]}`.

Invented citations against the real worktree, all rejected: `libs/backend/does-not-exist/src/lib/made-up.service.ts`, `totally-invented-file.ts`, `libs/backend/platform-core/*.fake`, `*.py`.

## Scoped targets

| Command | Result |
|---|---|
| `nx run agent-generation:test --testPathPatterns=generated-section-validator --skip-nx-cache` | 92 passed |
| `nx run agent-generation:test --testPathPatterns=wizard/multi-phase --skip-nx-cache` | passed |
| `nx run agent-generation:lint` | 0 errors, 431 warnings (all pre-existing) |
| `nx run-many -t test,lint -p agent-generation workspace-intelligence` | see final section |

## Batches and reviews

| Batch | Commit | Lane | Cross-family review | Revise rounds |
|---|---|---|---|---|
| 1 quality-audit turn cap + incremental write + completed-with-warning | `7b8c08f61` | antigravity | codex (`code-logic-review.md`): REVISE → fixed | 1 |
| 2 validator citations | `1833712e3` | codex | antigravity (`review-lane-a.md`): REVISE → fixed | 1 |
| 3 stack detection + truncation + budgets | `e4e2a7bd6` | Glm (Ollama Cloud) | codex (`review-lane-c.md`): REVISE → fixed | 1 |

Batch 1 review findings and fixes: consumers read a phase file only when its manifest status is `completed` (`analysis-storage.service.ts:501`, `enhanced-prompts.service.ts:988`), so a capped phase that wrote a substantial file this run is now recorded `completed` with a warn log; the size guard uses `Buffer.byteLength`; the dead `MAX_AGENT_TURNS` export was removed; the preservation spec now enters the new branch.

Batch 2 review findings and fixes: a glob under an existing directory was accepted on the directory alone; a directory-less extension glob was accepted on extension plausibility alone; `kebab-case.ts` handling; `release/*` fixture dependence documented.

Batch 3 review findings and fixes: the sentence-level fallback still emitted a bare `3.` marker for a list-only section, and a wrapped item was cut before its continuation line; the shortened marker's cost was not reserved so a cut section could exceed its budget; `totalTokens` was clamped with `Math.min` and `qualityGuidance` was unbounded; the generation prompts still said "under 400 tokens" for architecture notes. Fixed with a Markdown block parser in `response-parser.ts` (whole items only, marker cost reserved, final text re-estimated), truthful recounts in `prompt-designer-agent.ts`, and prompt/schema wording derived from `deriveEffectiveBudgets` in `prompt-designer.types.ts`. Final budgets: 400 per section, 600 architecture notes, 400 quality guidance, 2200 total, inside the validator's 2300.

Decision recorded: when a section is a single list that does not fit, the leading whole items are kept and the marker is appended. A list is never left with a partial item or a dangling marker, but it may be shorter than the original.

## Final scoped verification

`npx nx run-many -t test,lint -p agent-generation workspace-intelligence --skip-nx-cache`, after batch 3:

| Project | Tests | Lint |
|---|---|---|
| agent-generation | 34 suites, 1116 passed | 0 errors, 431 warnings (pre-existing) |
| workspace-intelligence | 44 suites, 1121 passed | 0 errors, 10 warnings (pre-existing) |

## Follow-up (out of scope, noted per task)

Synthesized skills and the skill trajectory (`skill_registry`, `skill_candidates`, `skill_synthesis_queue` in `~/.ptah/state/ptah.sqlite`) are not read by agent generation. They reach agents only through harness sync of `.claude/skills`. Linking them into section generation or the enhanced prompt is a separate task.

The quality-audit prompt now asks the agent to write incrementally. Whether a live model complies was not verified here; no wizard run was made.
