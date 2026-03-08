# Requirements Document - TASK_2025_154

# Multi-Phase Analysis & Elevation Workflow

## Introduction

The Ptah setup wizard currently produces a single flat JSON analysis via one `InternalQueryService.execute()` call in `AgenticAnalysisService.analyzeWorkspace()`. This analysis is constrained by a rigid JSON Schema and produces a shallow output that loses nuance when serialized into `formatAnalysisData()` for downstream consumers.

### Problem Statement (with evidence)

1. **Single-call bottleneck**: `AgenticAnalysisService` makes ONE `internalQueryService.execute()` call with a monolithic system prompt covering discovery, architecture, health, testing, and quality all at once.

2. **Over-constrained agent**: The current system prescribes step counts (25 turns), tool-call-count heuristics for phase detection, and file sampling limits. This prevents the agent from using its intelligence to decide what matters for each specific project.

3. **Lossy text serialization**: `ContentGenerationService.formatAnalysisData()` reduces rich analysis to ~30 lines of flat text. Quality score, gaps, strengths, prescriptive guidance — all dropped before reaching the LLM generating agent templates.

4. **Generic agent templates**: LLM sections in agent templates receive this lossy text summary, producing generic rather than project-specific guidance.

5. **Sample JSON evidence**: The saved analysis at `react-spa-with-supabase-backend-2026-02-13-193423.json` shows: architecture patterns have 3-4 short evidence strings, quality issues have one-line descriptions, no file-level quality analysis, no before/after examples, no dependency flow analysis, no specific anti-pattern locations.

### Design Philosophy

**Define the OUTPUT CONTRACT, not the agent behavior.**

Each phase gets:

- A clear **objective** (what questions to answer)
- An **output schema** (what the deliverable must contain)
- Full **MCP tool access** (the agent explores freely)
- **No artificial constraints** on how it explores (no file count limits, no prescribed tool sequences)

The agent decides what's relevant based on what it discovers. A React+Supabase project needs different exploration than an Nx monorepo. We orchestrate the _what_, not the _how_.

Safety guardrails (maxTurns, timeout) exist as backstops, not design constraints. Set them generously (50+ turns, 10 min per phase).

### Business Value

- **Agent quality improvement**: Rich, multi-file analysis context produces specific, actionable agent guidance
- **Enhanced prompt depth**: Quality audit and elevation plan directly inform Claude's chat behavior
- **Differentiated premium feature**: Multi-phase "codebase elevation" becomes a compelling selling point
- **Reusable artifacts**: Markdown files in `.claude/analysis/` are readable by Claude Code agents and humans alike

---

## Requirements

### Requirement 1: Analysis Pipeline Orchestrator

**User Story:** As a premium user, I want analysis to execute as a structured multi-phase pipeline where each phase produces focused, deep output building on the previous.

#### Acceptance Criteria

1. WHEN the user initiates analysis THEN the system SHALL execute phases 1-4 sequentially, each as a separate `InternalQueryService.execute()` call
2. WHEN a phase completes THEN the system SHALL write its markdown output to `.claude/analysis/{project-slug}/` before starting the next phase
3. WHEN a phase fails THEN the system SHALL log the error, mark the phase as failed in the manifest, and attempt the next phase with available data
4. WHEN all phases complete THEN the system SHALL run Phase 5 (deterministic synthesis) and write `manifest.json`
5. WHEN cancelled mid-pipeline THEN completed phase outputs SHALL be preserved and remaining phases marked `skipped`
6. WHEN the pipeline starts THEN it SHALL create/overwrite the slug directory using existing `AnalysisStorageService.slugify()` logic

#### Technical Constraints

- New service: `MultiPhaseAnalysisService` in `libs/backend/agent-generation/src/lib/services/wizard/`
- Each phase gets its own AbortController
- Total pipeline timeout: configurable, default 1 hour
- Phase outputs are markdown files (human-readable, MCP-readable)
- Only `manifest.json` is JSON

### Requirement 2: Phase 1 - Project Profile

**Objective:** "Tell us everything factual about this project."

The agent has full MCP tool access. It decides what to explore, how deep to go, and what's relevant. The only constraint is the output contract.

#### Output Contract

The deliverable `01-project-profile.md` MUST contain:

- Tech stack with exact versions (from package.json, Cargo.toml, go.mod, etc.)
- Dependency overview (production + dev, notable packages)
- File structure overview (high-level directory tree)
- Entry points and configuration files
- Monorepo structure (if applicable) with per-package info
- Language distribution with file counts
- ZERO opinions, assessments, or recommendations — only verifiable facts

#### Agent Instructions (spirit, not prescription)

```
Produce a comprehensive factual profile of this codebase. Use any MCP tools you
need to explore the project thoroughly. Read package files for exact versions,
explore the file tree, identify entry points and configs. For monorepos, enumerate
all packages. Report only facts — no opinions or recommendations.
```

#### What we do NOT prescribe:

- Which tools to call first
- How many files to read
- How many turns to use
- What order to explore in

### Requirement 3: Phase 2 - Architecture Assessment

**Objective:** "Assess this project's architecture — what patterns exist, are they applied correctly, where do they break down?"

The agent reads Phase 1 output, then freely explores the codebase to evaluate architecture.

#### Output Contract

The deliverable `02-architecture-assessment.md` MUST contain:

- Detected patterns with specific file path evidence (not just folder names)
- Assessment of whether patterns are applied consistently
- Dependency flow analysis (are dependencies pointing in the right direction?)
- Coupling analysis between modules/packages
- Specific layer or boundary violations with the import/file that violates
- State management assessment
- Comparison: what patterns this project USES vs what patterns are RECOMMENDED for this tech stack

#### Agent Instructions (spirit, not prescription)

```
Read 01-project-profile.md to understand the project's tech stack and structure.
Then assess the architecture. Explore imports, folder structures, and dependency
relationships. Look for patterns (Layered, DDD, Component-Based, etc.) and evaluate
whether they're applied consistently. Find specific violations — cite the file and
import that breaks the pattern. Compare what exists against best practices for this
tech stack.
```

### Requirement 4: Phase 3 - Quality Audit

**Objective:** "Deep-dive into code quality — find the real issues, not surface-level lint warnings."

The agent reads Phases 1-2, then explores the codebase to audit quality. It decides which files matter based on the architecture assessment.

#### Output Contract

The deliverable `03-quality-audit.md` MUST contain:

- Overall quality score with justification
- File-level findings for files the agent deemed important (with reasoning for why those files were chosen)
- Anti-pattern inventory with specific locations (file + function/area)
- Type safety assessment (any usage, missing types, unsafe casts)
- Error handling evaluation (empty catches, swallowed errors, missing error boundaries)
- Security concerns with severity
- Test coverage analysis (what's tested, what's critically untested)
- Strengths — what the codebase does well (equally important)

#### Agent Instructions (spirit, not prescription)

```
Read 01-project-profile.md and 02-architecture-assessment.md to understand the project.
Then audit code quality. Choose which files to examine based on what you've learned —
entry points, core services, complex components, utilities. Read as many files as you
need to form a thorough opinion. Look for real issues: unsafe types, swallowed errors,
security gaps, missing tests for critical paths. Also identify strengths.
```

#### What we do NOT prescribe:

- "Sample 15-20 files" — the agent decides what and how many
- Per-dimension scoring formulas — the agent uses its judgment
- Which anti-patterns to look for — the agent knows

### Requirement 5: Phase 4 - Elevation Plan

**Objective:** "Create a prioritized, actionable improvement plan with concrete examples."

The agent reads all three previous phases, then synthesizes a practical roadmap.

#### Output Contract

The deliverable `04-elevation-plan.md` MUST contain:

- Prioritized recommendations ordered by impact/effort ratio
- Each recommendation MUST reference specific files/patterns from Phases 1-3
- Before/after code examples for key improvements
- Migration paths for architectural changes (ordered steps)
- Effort estimation per item: Quick Win (< 1hr), Small (1-4hr), Medium (1-2 days), Large (1+ week)
- Grouped by priority tier

#### Agent Instructions (spirit, not prescription)

```
Read all three previous analysis files. Create a prioritized elevation plan specific
to THIS codebase. Every recommendation must reference actual files and patterns found
in the analysis — no generic advice. Include before/after code examples. Order by
highest impact + lowest effort first.
```

### Requirement 6: Phase 5 - Agent Context Synthesis (Deterministic)

**No LLM call.** Pure programmatic file combination.

#### Acceptance Criteria

1. SHALL read all available phase output files from disk
2. SHALL combine into `05-agent-context.md` with role-tailored sections
3. SHALL contain labeled sections: "For All Agents", "For Backend Agents", "For Frontend Agents", "For QA Agents", "For Architecture Agents"
4. SHALL handle missing phases gracefully (note the gap, proceed with available data)
5. SHALL complete in < 1 second (no LLM calls)

### Requirement 7: Phase 6 - Agent Generation Integration

**User Story:** Content generation reads rich analysis files instead of flat text summaries.

#### Acceptance Criteria

1. WHEN `ContentGenerationService.generateContent()` is called AND multi-phase analysis exists THEN it SHALL read the role-specific section from `05-agent-context.md` instead of using `formatAnalysisData()`
2. WHEN the template is for `backend-developer` THEN the prompt SHALL include the "For Backend Agents" section
3. WHEN multi-phase analysis does NOT exist THEN fallback to current `formatAnalysisData()` behavior
4. WHEN context exceeds token budget THEN truncate lower-priority sections while preserving role-specific content

#### Technical Constraints

- Add `analysisDir?: string` to `AgentProjectContext`
- Read files using Node.js `fs/promises` (server-side, not MCP)
- MCP remains disabled in content generation SDK calls

### Requirement 8: Phase 7 - Enhanced Prompts Integration

**User Story:** Enhanced prompts incorporate quality audit and elevation plan for specific, actionable chat guidance.

#### Acceptance Criteria

1. WHEN multi-phase analysis exists THEN `EnhancedPromptsService` SHALL include quality audit findings and top elevation priorities in the prompt designer input
2. WHEN regenerated THEN it SHALL re-read latest analysis files (not cached)
3. WHEN analysis doesn't exist THEN fallback to current behavior unchanged

### Requirement 9: Manifest and Storage

#### Manifest Schema

```json
{
  "version": 2,
  "slug": "react-spa-with-supabase-backend",
  "analyzedAt": "2026-02-14T...",
  "model": "claude-sonnet-4-5-20250929",
  "totalDurationMs": 180000,
  "phases": {
    "project-profile": { "status": "completed", "file": "01-project-profile.md", "durationMs": 45000 },
    "architecture-assessment": { "status": "completed", "file": "02-architecture-assessment.md", "durationMs": 60000 },
    "quality-audit": { "status": "completed", "file": "03-quality-audit.md", "durationMs": 50000 },
    "elevation-plan": { "status": "completed", "file": "04-elevation-plan.md", "durationMs": 25000 },
    "agent-context": { "status": "completed", "file": "05-agent-context.md", "durationMs": 50 }
  }
}
```

#### Acceptance Criteria

1. `AnalysisStorageService` SHALL support both v1 (single JSON) and v2 (manifest directory)
2. New analyses overwrite existing slug directory (not timestamped copies)
3. List endpoint includes both formats sorted by date

### Requirement 10: Real-Time Progress Streaming

#### Acceptance Criteria

1. WHEN a phase starts THEN the frontend SHALL receive phase name, number, and total count
2. WHEN an agent uses tools THEN tool activity events stream via existing `SETUP_WIZARD_ANALYSIS_STREAM`
3. WHEN a phase completes THEN a completion event with duration fires
4. Reuse existing `AnalysisStreamPayload` and `SdkStreamProcessor` infrastructure
5. Extend `AnalysisPhase` type: `'project-profile' | 'architecture' | 'quality-audit' | 'elevation-plan' | 'synthesis'`

---

## Non-Functional Requirements

### Performance

- Each phase should complete within 10 minutes (generous — let the agent work)
- Total pipeline under 30 minutes for large projects
- Phase 5 (deterministic) under 1 second
- maxTurns per phase: 50 (safety backstop, not a design constraint)

### Security

- Analysis files written to user's `.claude/` directory only
- No secrets in phase outputs even if found in configs
- Premium-only (isPremium + mcpServerRunning required)

### Reliability

- Phase independence: failed phase doesn't block subsequent phases
- Graceful degradation to current single-call analysis if pipeline fails
- Cancellation preserves completed outputs

---

## Risk Assessment

| Risk                                                | Probability | Impact   | Mitigation                                                                                                                        |
| --------------------------------------------------- | ----------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Token overflow in Phase 4 (reads 3 previous phases) | High        | High     | Progressive truncation: trim Phase 1 first (least analytical). Phase outputs should be concise markdown, not verbose.             |
| Pipeline takes too long for users                   | Medium      | Medium   | Granular per-phase progress. Allow background execution. Results cached for reuse.                                                |
| Breaking existing JSON flow                         | Medium      | Critical | Full v1/v2 backward compatibility in AnalysisStorageService                                                                       |
| Agent produces inconsistent markdown                | Medium      | Low      | Output contract in system prompt. Accept reasonable variation — we're not parsing the markdown programmatically (except Phase 5). |
| Phase 2-4 agents fail MCP file reads                | Low         | Medium   | Fallback: embed previous phase content directly in prompt if MCP read fails                                                       |

---

## Implementation Batches

### Batch 1: Core Pipeline + Phases 1-4 (3-4 days)

- `MultiPhaseAnalysisService` orchestrator
- Phase 1-4 system prompts (objective + output contract only)
- Manifest creation
- Progress streaming

### Batch 2: Synthesis + Storage (1-2 days)

- Phase 5 deterministic synthesis
- AnalysisStorageService v2 support
- Legacy v1 compatibility

### Batch 3: Downstream Integration (2-3 days)

- ContentGenerationService reads analysis files (Phase 6)
- EnhancedPromptsService reads analysis files (Phase 7)
- Role-tailored context selection

### Batch 4: QA & Polish (1 day)

- End-to-end testing on real projects
- Token budget validation
- Fallback path testing

---

## Quality Gates

- [x] Requirements follow output-contract-first design (not agent-behavior prescription)
- [x] No artificial constraints on agent exploration
- [x] Acceptance criteria in WHEN/THEN/SHALL format
- [x] Risk assessment with mitigation strategies
- [x] Backward compatibility with v1 analysis
- [x] Integration points documented
- [x] Performance targets are generous (let the agent work)
