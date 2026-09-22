# Setup wizard run of 2026-09-22 — did project knowledge reach the agents?

Source of truth: `%APPDATA%\Ptah\logs\Ptah Electron-2026-09-22.log` (the desktop app, which is
what ran the wizard), `.ptah/analysis/ptah-extension/*` and `.ptah/harness/state.json`.

## Timeline (UTC)

| Time | Step | Result |
|---|---|---|
| 06:00:46 | Multi-phase analysis started (model `default`, maxTurns 50 per phase) | run `01M33V7NKWDZXMVEGA4F8V32NZ` |
| 06:02:52 | Phase 1 project-profile | completed, `01-project-profile.md` 16.9 KB |
| 06:09:34 | Phase 2 architecture-assessment | completed, `02-architecture-assessment.md` 33.7 KB |
| 06:15:19 | Phase 3 quality-audit | **failed**: `SDK result error_max_turns: Reached maximum number of turns (50)`; file holds one sentence |
| 06:19:41 | Phase 4 elevation-plan | completed, `04-elevation-plan.md` 42.1 KB; run lifecycle `failed` |
| 06:29:34 – 06:36:32 | Agent generation, 15 agents | all 15 written; **tailoredSections = 0 for every agent, 10 LLM sections rejected** |
| 06:38:22 – 06:39:11 | Enhanced prompt (project guidance) | written, 6,136 chars, 3 phases used, `hasQualityData: false` |

## Finding 1 — every project-specific agent section was rejected (the real defect)

The 8 templates that carry `<!-- LLM:* -->` sections asked the model for 10 sections in total
(FRAMEWORK_CONVENTIONS ×2, ARCHITECTURE_PATTERNS ×2, REVIEW_FOCUS ×3, EXISTING_PATTERNS,
BUILD_AND_DEPLOY_SURFACE, TEST_INFRASTRUCTURE). The model returned text for all 10.
`GeneratedSectionValidator` rejected all 10, so every agent shipped the generic authored fallback.
The generation manifest confirms: `tailoredSections: 0` on all 15 agents.

Every rejection has the same reason: `cites path(s) that neither the analysis surfaced nor the
workspace contains`. The cited tokens fall into four groups, none of which is a fabricated path:

1. **Bare file names of real files**: `register.ts`, `tokens.ts`, `chat-rpc.handlers.ts`,
   `publish-cli.yml`, `test-setup.ts`, `session-data.token.ts`. `existsOnDisk` resolves the
   citation relative to the workspace root (`generated-section-validator.ts:350-356`), so a
   basename never matches even when the file exists.
2. **Globs and directory shorthands**: `*.spec.ts`, `src/**/*.spec.ts`, `release/*`, `src/lib/`,
   `src/index.ts` (relative to a lib, not the root).
3. **Package and rule specifiers**: `@ptah-extension/shared`, `@nx/enforce-module-boundaries`,
   `@ptah-extension/shared/testing`. `PATH_CHARS` (`:133`) admits `@`, so a package name is read
   as a path.
4. **Identifiers and prose inside code spans**: `ChangeDetectionStrategy.OnPush`, `process.env`,
   `error.message`, `.message`, `page.evaluate`, `e.g`, `text-base-content/60`. Any code span
   with a dot or slash is treated as a citation (`extractPathCandidates`, `:427`).

Net effect: the validator's citation rule cannot be satisfied by a model that writes normal
repository guidance, so the LLM tailoring path is dead in practice. The file writes succeed, so
nothing in the UI says so; only the manifest counters and the WARN lines do.

Smallest fix, in `generated-section-validator.ts`:
- Treat a code span as a citation only when it has a `/` or a file extension AND is not a
  package specifier (`@scope/name`) or a dotted identifier (no extension from a known set).
- Resolve a bare basename against the analysis path index and the workspace file index by
  basename, not root-relative.
- Accept a glob when its fixed prefix resolves, which `isKnownPath` already does for the index
  but `existsOnDisk` does not.
Pin each group above with a spec case taken verbatim from the log lines.

## Finding 2 — the quality audit phase never finishes

Phase 3 hit the 50-turn cap after 5.75 minutes. Its output file is 49 bytes. The enhanced prompt
therefore ran with `hasQualityData: false` and no "Quality Guidance" section, and every agent's
REVIEW_FOCUS section had no audit evidence to cite. The phase prompt is the largest of the four
(system prompt 5,190 chars) and asks the model to survey the whole repository; on a 96-project
monorepo 50 turns is not enough. Options: raise `maxTurns` for this phase, scope the audit to the
projects the profile phase flagged, or let the phase write incrementally so a turn-cap still
leaves a usable file.

## Finding 3 — stack detection feeds the prompt designer wrong facts

`EnhancedPromptsService` ran with `hasPreComputedInput: false` and built its own analysis:
`projectType: "react"`, `framework: "angular"`, `isMonorepo: false`, `buildTools: []`,
`testingFrameworks: []` (log 06:38:23, `enhanced-prompt.json`).
- `react` comes from `framework-detector.service.ts:150` because React is in the dependency
  list (Ink TUI, Remotion), and the Node branch wins before `angular.json` is checked
  (`project-detector.service.ts:92-96,122`). `ptah_workspace_analyze` reports the same.
- `isMonorepo` checks only `projectInfo.dependencies` for `nx` (`enhanced-prompts.service.ts:402-405`);
  `nx` is a devDependency here, so an Nx workspace is reported as not a monorepo.
The three phase files carried the correct facts, which is why the generated guidance text is
still accurate; but the designer's framing and the "Detected stack" the UI shows are wrong.

## Finding 4 — the enhanced prompt is truncated mid-sentence

`enhanced-prompt.md` ends three sections with `....` (Framework Guidelines after the NestJS
bullets, Coding Standards after SOLID, Architecture Notes at "Three isolations to respect / 2.").
`truncateToTokenBudget` (`response-parser.ts:241-260`) cuts each section to a 2,000-token
budget and appends `...`. The Architecture Notes cut lands inside a numbered list, so the
guidance every session and every spawned lane reads (`getProjectGuidanceContent`) is missing
two of the "three isolations". Either raise the budget for this section or cut at the last
heading or list boundary instead of the last sentence.

## Finding 5 — how skills and the skill trajectory reach the agents today

- **Plugin skills** (`pluginPathCount: 4`) are listed in the system prompt of every analysis
  phase, of the enhanced-prompt designer and of the agent section generator
  (`discoverPluginSkills` → "Available Plugin Skills"). They influence the text only; no
  skill is injected into an agent file.
- **Synthesized skills / skill trajectory** (`skill_registry` 48 rows, `skill_candidates`
  2,454, `skill_synthesis_queue` 1,814 in `~/.ptah/state/ptah.sqlite`) are not read by
  agent-generation at all: no reference to the skill registry, skill synthesis or trajectories
  exists in `libs/backend/agent-generation/src`. They reach agents only through harness sync
  of `.claude/skills`, which OpenCode, Claude Code and the synced rivals load on their own.
- Nothing in the wizard uses the outcome of a skill run to change an agent or the enhanced
  prompt. That link does not exist yet.

## What the user saw, explained

- `.claude/agents/*` contain only the authored template text because all tailoring was
  rejected (Finding 1), rendered from the main-branch template cache (see
  `agent-generation-investigation.md`).
- The project knowledge that did survive lives in `.ptah/analysis/ptah-extension/enhanced-prompt.md`
  and is prepended to chat sessions and spawned lanes, truncated (Finding 4).
