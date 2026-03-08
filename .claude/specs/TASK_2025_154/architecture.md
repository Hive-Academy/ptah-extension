# Architecture Document - TASK_2025_154: Multi-Phase Analysis & Elevation Workflow

## Codebase Investigation Summary

### Libraries Analyzed

- **agent-generation** (`libs/backend/agent-generation/`) - Contains current `AgenticAnalysisService`, `AnalysisStorageService`, `ContentGenerationService`, DI tokens, and registration
- **agent-sdk** (`libs/backend/agent-sdk/`) - Contains `InternalQueryService`, `SdkStreamProcessor`, SDK types, DI tokens
- **shared** (`libs/shared/`) - Contains `AnalysisPhase`, `AnalysisStreamPayload`, `SavedAnalysisFile`, `ProjectAnalysisResult`, RPC types

### Patterns Identified

- **InternalQueryService.execute()** pattern: config object with `cwd`, `model`, `prompt`, `systemPromptAppend`, `isPremium`, `mcpServerRunning`, `mcpPort`, `maxTurns`, `abortController`, optional `outputFormat` (source: `libs/backend/agent-sdk/src/lib/internal-query/internal-query.types.ts:28-67`)
- **SdkStreamProcessor** pattern: construct with config, call `process(stream)`, get `{ structuredOutput, resultMeta }` (source: `libs/backend/agent-sdk/src/lib/stream-processing/sdk-stream-processor.ts:38-303`)
- **DI registration**: Symbol.for tokens, singleton lifecycle, factory for special cases (source: `libs/backend/agent-generation/src/lib/di/register.ts`)
- **AnalysisStorageService**: v1 format using timestamped JSON files in `.claude/analysis/` (source: `libs/backend/agent-generation/src/lib/services/analysis-storage.service.ts`)
- **WebviewManager.broadcastMessage()** for progress streaming (source: `libs/backend/agent-generation/src/lib/services/wizard/agentic-analysis.service.ts:460-495`)
- **Result.ok/err pattern** for error handling (source: `@ptah-extension/shared`)

### Key Integration Points Verified

- `InternalQueryConfig` interface: `libs/backend/agent-sdk/src/lib/internal-query/internal-query.types.ts:28`
- `InternalQueryHandle` interface: `libs/backend/agent-sdk/src/lib/internal-query/internal-query.types.ts:79`
- `SdkStreamProcessor` class: `libs/backend/agent-sdk/src/lib/stream-processing/sdk-stream-processor.ts:38`
- `StreamEvent` interface: `libs/backend/agent-sdk/src/lib/stream-processing/sdk-stream-processor.types.ts:21`
- `AnalysisPhase` type: `libs/shared/src/lib/types/setup-wizard.types.ts:758`
- `AnalysisStreamPayload` type: `libs/shared/src/lib/types/setup-wizard.types.ts:789`
- `MESSAGE_TYPES.SETUP_WIZARD_ANALYSIS_STREAM`: used by `AgenticAnalysisService` for stream broadcast
- `MESSAGE_TYPES.SETUP_WIZARD_SCAN_PROGRESS`: used by `AgenticAnalysisService` for progress broadcast
- `AGENT_GENERATION_TOKENS`: `libs/backend/agent-generation/src/lib/di/tokens.ts:201`
- `SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE`: used by both `AgenticAnalysisService` and `ContentGenerationService`
- `AgentProjectContext.fullAnalysis`: `libs/backend/agent-generation/src/lib/types/core.types.ts:342-346`
- `ContentGenerationService.formatAnalysisData()`: `libs/backend/agent-generation/src/lib/services/content-generation.service.ts:475-567`

---

## 1. Service Architecture

### 1.1 MultiPhaseAnalysisService

**Location**: `libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.ts`

**Pattern**: Follows `AgenticAnalysisService` pattern (same library, same DI dependencies), but orchestrates 4 sequential `InternalQueryService.execute()` calls instead of 1, followed by a deterministic Phase 5.

**Evidence**: `AgenticAnalysisService` at `libs/backend/agent-generation/src/lib/services/wizard/agentic-analysis.service.ts:136-261` shows the established pattern for injecting `InternalQueryService`, `WebviewManager`, `Logger`, `ConfigManager`, and calling `internalQueryService.execute()`.

```typescript
import { injectable, inject } from 'tsyringe';
import * as vscode from 'vscode';
import { Logger, ConfigManager, TOKENS, type WebviewManager } from '@ptah-extension/vscode-core';
import { Result, MESSAGE_TYPES } from '@ptah-extension/shared';
import type { AnalysisStreamPayload } from '@ptah-extension/shared';
import { SDK_TOKENS, SdkStreamProcessor } from '@ptah-extension/agent-sdk';
import type { InternalQueryService, SDKMessage, StreamEventEmitter, StreamEvent } from '@ptah-extension/agent-sdk';
import type { AnalysisStorageService } from '../analysis-storage.service';
import { AGENT_GENERATION_TOKENS } from '../../di/tokens';

// Phase definitions
const PHASE_CONFIGS = [
  { id: 'project-profile', file: '01-project-profile.md', label: 'Discovering project profile...' },
  { id: 'architecture-assessment', file: '02-architecture-assessment.md', label: 'Assessing architecture...' },
  { id: 'quality-audit', file: '03-quality-audit.md', label: 'Auditing code quality...' },
  { id: 'elevation-plan', file: '04-elevation-plan.md', label: 'Creating elevation plan...' },
  { id: 'agent-context', file: '05-agent-context.md', label: 'Synthesizing agent context...' },
] as const;

type MultiPhaseId = (typeof PHASE_CONFIGS)[number]['id'];

interface PhaseResult {
  status: 'completed' | 'failed' | 'skipped';
  file: string;
  durationMs: number;
  error?: string;
}

interface MultiPhaseManifest {
  version: 2;
  slug: string;
  analyzedAt: string;
  model: string;
  totalDurationMs: number;
  phases: Record<MultiPhaseId, PhaseResult>;
}

interface MultiPhaseAnalysisOptions {
  timeout?: number; // Total pipeline timeout, default 3600000 (1hr)
  model?: string;
  isPremium?: boolean;
  mcpServerRunning?: boolean;
  mcpPort?: number;
}

@injectable()
export class MultiPhaseAnalysisService {
  private activeAbortController: AbortController | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private readonly config: ConfigManager,
    @inject(TOKENS.WEBVIEW_MANAGER) private readonly webviewManager: WebviewManager,
    @inject(SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE)
    private readonly internalQueryService: InternalQueryService,
    @inject(AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE)
    private readonly storageService: AnalysisStorageService
  ) {}

  // ...
}
```

### 1.2 Orchestration Flow

The `analyzeWorkspace()` method follows this flow:

```
1. Validate premium + MCP
2. Create/overwrite slug directory: .claude/analysis/{slug}/
3. For each phase 1-4 (sequential):
   a. Create per-phase AbortController (linked to master)
   b. Build system prompt (objective + output contract)
   c. Call internalQueryService.execute() with:
      - mcpServerRunning: true (phases 1-4 use MCP tools)
      - maxTurns: 50 (generous backstop)
      - outputFormat: undefined (markdown output, not JSON)
      - systemPromptAppend: phase-specific prompt
      - prompt: phase-specific user prompt (for phases 2-4, references previous files)
   d. Process stream via SdkStreamProcessor for progress events
   e. Extract final text from result message
   f. Write markdown to .claude/analysis/{slug}/{phase-file}
   g. Record phase result (status, duration, error)
   h. On failure: log error, mark failed, continue to next phase
4. Run Phase 5 (deterministic synthesis) - no LLM call
5. Write manifest.json
6. Return Result<MultiPhaseManifest>
```

**Key design decisions**:

1. **No `outputFormat` (no JSON schema)**: Phases 1-4 produce markdown, not structured JSON. The agent writes its response as free-form markdown following the output contract in the system prompt. We extract the text from the result message, not `structured_output`.

2. **Previous phase content delivery**: Phases 2-4 reference previous outputs. The system prompt instructs the agent to read the files via MCP (`ptah.files.readFile`). This avoids embedding potentially large phase outputs in the prompt context. If the MCP read fails, the agent still has the file path to try alternative reads via `Read` tool.

3. **Per-phase AbortController**: Each phase gets its own AbortController. If the user cancels, the master controller aborts, which signals the current phase's controller. Completed outputs are preserved.

### 1.3 Stream Processing for Multi-Phase

The existing `SdkStreamProcessor` is reused as-is. For each phase, a new processor instance is created:

```typescript
private async processPhaseStream(
  stream: AsyncIterable<SDKMessage>,
  phaseId: MultiPhaseId,
  phaseIndex: number,
  totalPhases: number,
  abortController: AbortController,
  perPhaseTimeoutMs: number,
): Promise<{ text: string | null; resultMeta?: StreamProcessorResult['resultMeta'] }> {
  const emitter: StreamEventEmitter = {
    emit: (event: StreamEvent) => {
      // Broadcast with phase context
      this.broadcastStreamMessage({
        ...event,
        // Extend AnalysisStreamPayload - see Section 5 for type changes
      });
      // Also broadcast progress
      this.broadcastPhaseProgress(phaseId, phaseIndex, totalPhases, event);
    },
  };

  const processor = new SdkStreamProcessor({
    emitter,
    timeout: { ms: perPhaseTimeoutMs, abortController },
    logger: this.logger,
    serviceTag: `[MultiPhase:${phaseId}]`,
  });

  const result = await processor.process(stream);

  // For markdown output (no outputFormat), the text is in result message
  // SdkStreamProcessor returns structuredOutput for JSON, but for markdown
  // we need to capture the assistant's text output
  // The text accumulation happens via stream events (text deltas)
  // We capture it in a buffer during processing
  return { text: this.capturedText, resultMeta: result.resultMeta };
}
```

**Text capture strategy**: Since we don't use `outputFormat`, the agent's response is free-form text. The `SdkStreamProcessor` emits `text` events. We accumulate these into a buffer during processing. When the result message arrives, the full text is available. We also check `result.result` from the SDK result message as a fallback (the SDK returns the final response text in the result message's `result` field).

### 1.4 Phase Failure and Cancellation

```typescript
// Phase failure - continue to next phase
for (const [index, phaseConfig] of PHASE_CONFIGS.slice(0, 4).entries()) {
  try {
    const phaseResult = await this.executePhase(index, phaseConfig, slugDir, options);
    manifest.phases[phaseConfig.id] = phaseResult;
  } catch (error) {
    // Check if user cancelled
    if (masterAbortController.signal.aborted) {
      // Mark remaining phases as skipped
      for (const remaining of PHASE_CONFIGS.slice(index)) {
        manifest.phases[remaining.id] = {
          status: 'skipped',
          file: remaining.file,
          durationMs: 0,
        };
      }
      break;
    }

    // Phase failed - log and continue
    this.logger.error(`Phase ${phaseConfig.id} failed`, { error });
    manifest.phases[phaseConfig.id] = {
      status: 'failed',
      file: phaseConfig.file,
      durationMs: Date.now() - phaseStart,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
```

### 1.5 Phase 5: Deterministic Synthesis

Phase 5 is pure TypeScript, no LLM call. It reads all available phase output files and combines them:

```typescript
private async synthesizeAgentContext(slugDir: string, manifest: MultiPhaseManifest): Promise<void> {
  const startTime = Date.now();
  const sections: string[] = [];

  // Header
  sections.push(`# Agent Context Synthesis\n`);
  sections.push(`*Generated: ${new Date().toISOString()}*\n`);

  // Read completed phase files
  const phaseFiles = [
    { id: 'project-profile', file: '01-project-profile.md', label: 'Project Profile' },
    { id: 'architecture-assessment', file: '02-architecture-assessment.md', label: 'Architecture Assessment' },
    { id: 'quality-audit', file: '03-quality-audit.md', label: 'Quality Audit' },
    { id: 'elevation-plan', file: '04-elevation-plan.md', label: 'Elevation Plan' },
  ];

  // "For All Agents" section - Project Profile + Architecture summary
  sections.push(`## For All Agents\n`);
  for (const pf of phaseFiles.slice(0, 2)) { // profile + architecture
    if (manifest.phases[pf.id as MultiPhaseId]?.status === 'completed') {
      const content = await readFile(join(slugDir, pf.file), 'utf-8');
      sections.push(`### ${pf.label}\n\n${content}\n`);
    } else {
      sections.push(`### ${pf.label}\n\n*Phase ${pf.id} was not completed.*\n`);
    }
  }

  // "For Backend Agents" - Quality issues related to backend
  sections.push(`## For Backend Agents\n`);
  sections.push(`*Refer to full quality audit and elevation plan for backend-specific findings.*\n`);

  // "For Frontend Agents" - Quality issues related to frontend
  sections.push(`## For Frontend Agents\n`);
  sections.push(`*Refer to full quality audit and elevation plan for frontend-specific findings.*\n`);

  // "For QA Agents" - Test coverage analysis, quality issues
  sections.push(`## For QA Agents\n`);
  if (manifest.phases['quality-audit']?.status === 'completed') {
    const auditContent = await readFile(join(slugDir, '03-quality-audit.md'), 'utf-8');
    sections.push(`### Quality Audit\n\n${auditContent}\n`);
  }

  // "For Architecture Agents" - Architecture assessment + elevation plan
  sections.push(`## For Architecture Agents\n`);
  for (const pf of [phaseFiles[1], phaseFiles[3]]) { // architecture + elevation
    if (manifest.phases[pf.id as MultiPhaseId]?.status === 'completed') {
      const content = await readFile(join(slugDir, pf.file), 'utf-8');
      sections.push(`### ${pf.label}\n\n${content}\n`);
    }
  }

  const combined = sections.join('\n');
  await writeFile(join(slugDir, '05-agent-context.md'), combined, 'utf-8');

  manifest.phases['agent-context'] = {
    status: 'completed',
    file: '05-agent-context.md',
    durationMs: Date.now() - startTime,
  };
}
```

**Note on role-tailored sections**: Phase 5 is intentionally simple for v1. The role sections include the full phase content (not parsed/extracted subsections). The LLM phases (1-4) produce the deep analysis; Phase 5 just organizes it. Future iterations can make Phase 5 smarter about extracting backend vs frontend specific content using regex/heuristic parsing, but that is out of scope.

---

## 2. Analysis Storage v2

### 2.1 Directory Structure

```
.claude/analysis/
  react-spa-with-supabase-backend/          # v2 slug directory
    manifest.json
    01-project-profile.md
    02-architecture-assessment.md
    03-quality-audit.md
    04-elevation-plan.md
    05-agent-context.md
  react-spa-with-supabase-backend-2026-02-13-193423.json  # v1 file (legacy)
```

### 2.2 Manifest Schema

```typescript
interface MultiPhaseManifest {
  version: 2;
  slug: string;
  analyzedAt: string; // ISO 8601
  model: string; // e.g., 'claude-sonnet-4-5-20250929'
  totalDurationMs: number;
  phases: {
    'project-profile': PhaseResult;
    'architecture-assessment': PhaseResult;
    'quality-audit': PhaseResult;
    'elevation-plan': PhaseResult;
    'agent-context': PhaseResult;
  };
}

interface PhaseResult {
  status: 'completed' | 'failed' | 'skipped';
  file: string; // filename within slug directory
  durationMs: number;
  error?: string; // present when status === 'failed'
}
```

### 2.3 AnalysisStorageService v2 Updates

**File**: `libs/backend/agent-generation/src/lib/services/analysis-storage.service.ts`

The existing service handles v1 (single JSON files). We extend it to also handle v2 (manifest directories):

```typescript
// New methods added to AnalysisStorageService

/**
 * Get the analysis subdirectory for a project slug.
 */
getSlugDir(workspacePath: string, slug: string): string {
  return join(this.getAnalysisDir(workspacePath), slug);
}

/**
 * Create or overwrite a slug directory for multi-phase analysis.
 * Returns the absolute path to the slug directory.
 */
async createSlugDir(workspacePath: string, projectDescription: string): Promise<{ slugDir: string; slug: string }> {
  const slug = this.slugify(projectDescription);
  const slugDir = this.getSlugDir(workspacePath, slug);

  // Remove existing directory if present (overwrite strategy)
  await rm(slugDir, { recursive: true, force: true });
  await mkdir(slugDir, { recursive: true });

  return { slugDir, slug };
}

/**
 * Write a phase output file to a slug directory.
 */
async writePhaseFile(slugDir: string, filename: string, content: string): Promise<void> {
  await writeFile(join(slugDir, filename), content, 'utf-8');
}

/**
 * Write manifest.json to a slug directory.
 */
async writeManifest(slugDir: string, manifest: MultiPhaseManifest): Promise<void> {
  await writeFile(join(slugDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
}

/**
 * Load manifest from a slug directory.
 */
async loadManifest(slugDir: string): Promise<MultiPhaseManifest | null> {
  try {
    const content = await readFile(join(slugDir, 'manifest.json'), 'utf-8');
    const data = JSON.parse(content) as MultiPhaseManifest;
    if (data.version !== 2) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Read a phase output file from a slug directory.
 */
async readPhaseFile(slugDir: string, filename: string): Promise<string | null> {
  try {
    return await readFile(join(slugDir, filename), 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Find the most recent multi-phase analysis for a workspace.
 * Checks for slug directories containing manifest.json with version: 2.
 */
async findLatestMultiPhaseAnalysis(workspacePath: string): Promise<{
  slugDir: string;
  manifest: MultiPhaseManifest;
} | null> {
  const analysisDir = this.getAnalysisDir(workspacePath);
  let entries: string[];
  try {
    entries = await readdir(analysisDir);
  } catch {
    return null;
  }

  let latest: { slugDir: string; manifest: MultiPhaseManifest } | null = null;

  for (const entry of entries) {
    const entryPath = join(analysisDir, entry);
    try {
      const stat = await fsStat(entryPath);
      if (!stat.isDirectory()) continue;

      const manifest = await this.loadManifest(entryPath);
      if (!manifest) continue;

      if (!latest || new Date(manifest.analyzedAt) > new Date(latest.manifest.analyzedAt)) {
        latest = { slugDir: entryPath, manifest };
      }
    } catch {
      continue;
    }
  }

  return latest;
}

/**
 * Extended list method: returns both v1 and v2 analyses.
 * The existing list() method returns v1 metadata. This adds v2 to the mix.
 */
async listAll(workspacePath: string): Promise<SavedAnalysisMetadata[]> {
  const v1Items = await this.list(workspacePath);  // existing method

  // Also scan for v2 directories
  const analysisDir = this.getAnalysisDir(workspacePath);
  let entries: string[];
  try {
    entries = await readdir(analysisDir);
  } catch {
    return v1Items;
  }

  const v2Items: SavedAnalysisMetadata[] = [];
  for (const entry of entries) {
    const entryPath = join(analysisDir, entry);
    try {
      const stat = await fsStat(entryPath);
      if (!stat.isDirectory()) continue;

      const manifest = await this.loadManifest(entryPath);
      if (!manifest) continue;

      v2Items.push({
        filename: entry,  // directory name acts as identifier
        savedAt: manifest.analyzedAt,
        projectType: manifest.slug,
        fileCount: 0,  // Not tracked in v2 manifest
        analysisMethod: 'agentic',
        agentCount: 0,  // Recommendations not stored in v2
        qualityScore: undefined,
      });
    } catch {
      continue;
    }
  }

  // Combine and sort by date
  return [...v1Items, ...v2Items].sort(
    (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
  );
}
```

**The existing `slugify()` method** is already present on `AnalysisStorageService` (source: line 37-43). It will be reused for slug directory naming. Currently private - needs to be made public or called via a new public method like `createSlugDir()`.

---

## 3. Phase System Prompts

### 3.1 Prompt Design Pattern

Each phase prompt consists of:

1. **Objective** - What questions to answer
2. **Output Contract** - Required sections in the markdown output
3. **Agent Instructions** - Spirit, not prescription

The system prompt goes into `systemPromptAppend` of `InternalQueryConfig`. The user prompt goes into `prompt`.

### 3.2 Phase 1: Project Profile

```typescript
function buildPhase1Prompts(): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: `You are an expert codebase analyst performing Phase 1 of a multi-phase analysis.

## Objective
Produce a comprehensive factual profile of this codebase. Report only verifiable facts — no opinions, assessments, or recommendations.

## Output Contract
Your response MUST be a markdown document with these sections:

### Tech Stack
- Language(s) with exact versions (from package.json, Cargo.toml, go.mod, pyproject.toml, etc.)
- Frameworks with versions
- Runtime environment

### Dependencies
- Production dependencies (notable packages, not exhaustive list)
- Dev dependencies (build tools, testing, linting)
- Dependency count summary

### File Structure
- High-level directory tree (depth 2-3)
- Total file count by type

### Entry Points & Configuration
- Application entry points (main files, index files)
- Key configuration files (tsconfig, webpack, vite, eslint, etc.)
- Environment configuration files

### Monorepo Structure (if applicable)
- Monorepo tool (Nx, Lerna, Turborepo, pnpm workspaces, etc.)
- Package/app listing with brief purpose
- Shared libraries

### Language Distribution
- Languages with file counts and approximate percentages

## Instructions
Use any MCP tools you need to explore the project thoroughly. Read package files for exact versions, explore the file tree, identify entry points and configs. For monorepos, enumerate all packages. You decide what to explore and how deep to go based on what you discover.

CRITICAL: Report ONLY facts. No opinions, no "this is good/bad", no recommendations.`,

    userPrompt: `Analyze this workspace and produce a comprehensive project profile as specified. Use the available tools to explore the codebase thoroughly.`,
  };
}
```

### 3.3 Phase 2: Architecture Assessment

```typescript
function buildPhase2Prompts(slugDir: string): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: `You are an expert software architect performing Phase 2 of a multi-phase analysis.

## Objective
Assess this project's architecture — what patterns exist, are they applied correctly, where do they break down?

## Previous Phase Output
Read the project profile from: ${slugDir}/01-project-profile.md
Use it to understand the tech stack and structure before beginning your assessment.

## Output Contract
Your response MUST be a markdown document with these sections:

### Detected Patterns
- Name each pattern (Layered, DDD, MVC, Component-Based, Hexagonal, etc.)
- Cite specific file paths as evidence (not just folder names)
- Confidence assessment per pattern

### Pattern Consistency
- Where patterns are applied correctly (with evidence)
- Where patterns break down (with specific file/import that violates)

### Dependency Flow
- Are dependencies pointing in the right direction?
- Import analysis showing any violations
- Layer boundary assessment

### Coupling Analysis
- Module/package coupling assessment
- Tight coupling hotspots with evidence
- Loose coupling examples

### State Management
- How state is managed (global store, signals, observables, etc.)
- Consistency of state management approach

### Pattern Comparison
- What patterns this project USES
- What patterns are RECOMMENDED for this tech stack
- Gap analysis

## Instructions
Read 01-project-profile.md first. Then freely explore the codebase — examine imports, folder structures, dependency relationships. Look for patterns and evaluate consistency. Find specific violations — cite the file and import. Compare against best practices for this tech stack.`,

    userPrompt: `Read the project profile at ${slugDir}/01-project-profile.md, then assess the architecture as specified. Use the available tools to explore the codebase.`,
  };
}
```

### 3.4 Phase 3: Quality Audit

```typescript
function buildPhase3Prompts(slugDir: string): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: `You are an expert code quality auditor performing Phase 3 of a multi-phase analysis.

## Objective
Deep-dive into code quality — find real issues, not surface-level lint warnings.

## Previous Phase Outputs
Read these files to understand the project before auditing:
- ${slugDir}/01-project-profile.md (tech stack, structure)
- ${slugDir}/02-architecture-assessment.md (patterns, coupling)

## Output Contract
Your response MUST be a markdown document with these sections:

### Overall Quality Score
- Score (0-100) with justification
- Key factors that influenced the score

### File-Level Findings
- For each important file you examined:
  - Why you chose this file (reasoning)
  - Issues found with severity (critical/high/medium/low)
  - Code quality observations

### Anti-Pattern Inventory
- Each anti-pattern with:
  - Name/description
  - Specific location (file path + function/area)
  - Severity
  - Suggested fix

### Type Safety Assessment
- \`any\` usage analysis
- Missing types
- Unsafe casts (\`as\`, non-null assertions)
- Generic usage quality

### Error Handling Evaluation
- Empty catch blocks (with locations)
- Swallowed errors
- Missing error boundaries
- Unhandled promise rejections

### Security Concerns
- Each concern with severity (critical/high/medium/low)
- Location and description
- Mitigation recommendation

### Test Coverage Analysis
- What is tested
- What is critically untested
- Test quality assessment

### Strengths
- What the codebase does well
- Best practices followed
- Notable quality achievements

## Instructions
Read both previous phase files first. Then choose which files to examine based on what you've learned — entry points, core services, complex components, utilities. Read as many files as you need to form a thorough opinion. Look for real issues: unsafe types, swallowed errors, security gaps, missing tests for critical paths. Also identify strengths — they are equally important.`,

    userPrompt: `Read the previous analysis files at ${slugDir}/01-project-profile.md and ${slugDir}/02-architecture-assessment.md, then perform a quality audit as specified. Use the available tools to examine the codebase in depth.`,
  };
}
```

### 3.5 Phase 4: Elevation Plan

```typescript
function buildPhase4Prompts(slugDir: string): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: `You are an expert software consultant performing Phase 4 of a multi-phase analysis.

## Objective
Create a prioritized, actionable improvement plan with concrete examples.

## Previous Phase Outputs
Read ALL three previous analysis files:
- ${slugDir}/01-project-profile.md
- ${slugDir}/02-architecture-assessment.md
- ${slugDir}/03-quality-audit.md

## Output Contract
Your response MUST be a markdown document with these sections:

### Priority Tier 1: Quick Wins (< 1 hour each)
For each item:
- What to change and why
- Which file(s) to modify (reference from phases 1-3)
- Before/after code example
- Expected impact

### Priority Tier 2: Small Improvements (1-4 hours each)
Same format as Tier 1

### Priority Tier 3: Medium Efforts (1-2 days each)
Same format as Tier 1, plus:
- Migration steps (ordered)

### Priority Tier 4: Large Initiatives (1+ week each)
Same format as Tier 3, plus:
- Dependencies and prerequisites
- Risk assessment

### Summary Matrix
| # | Item | Tier | Effort | Impact | Files |
|---|------|------|--------|--------|-------|

## Instructions
Read all three previous analysis files. Create a prioritized elevation plan specific to THIS codebase. Every recommendation must reference actual files and patterns found in the analysis — no generic advice. Include before/after code examples. Order by highest impact + lowest effort first. Be specific and actionable.`,

    userPrompt: `Read all three previous analysis files at ${slugDir}/, then create a prioritized elevation plan as specified. Every recommendation must reference specific files and patterns from the analysis.`,
  };
}
```

### 3.6 How Phases 2-4 Access Previous Phase Outputs

**Strategy: MCP file read via `ptah.files.readFile()`**

Since `mcpServerRunning: true` for phases 1-4, the agent has access to MCP tools including `ptah.files.readFile()`. The system prompt provides the absolute file path to previous phase outputs. The agent reads these files using MCP tools before starting its own analysis.

**Fallback**: If the MCP file read fails (unlikely since we just wrote the file), the agent also has `Read` tool from the `claude_code` preset. The path is in the prompt, so it can try alternative access methods.

**Why not embed in prompt**: Phase outputs could be 5,000-20,000 tokens each. Embedding phases 1-3 in Phase 4's prompt would consume 15,000-60,000 tokens of context just for previous outputs. Having the agent read files via MCP keeps the system prompt compact and lets the agent manage its own context window.

---

## 4. Integration Points

### 4.1 ContentGenerationService Integration

**File**: `libs/backend/agent-generation/src/lib/services/content-generation.service.ts`

**Current behavior** (source: line 475-567): `formatAnalysisData()` converts `AgentProjectContext` into ~30 lines of flat text.

**New behavior**: When multi-phase analysis exists, read role-specific section from `05-agent-context.md` instead.

**Changes to `AgentProjectContext`** (source: `libs/backend/agent-generation/src/lib/types/core.types.ts:295-347`):

```typescript
// Add to AgentProjectContext interface
export interface AgentProjectContext {
  // ... existing fields ...

  /**
   * Path to the multi-phase analysis directory.
   * When present, ContentGenerationService reads rich analysis files
   * instead of using formatAnalysisData().
   */
  analysisDir?: string;
}
```

**Changes to `buildAllSectionsPrompt()`** method (source: line 342-378):

```typescript
private buildAllSectionsPrompt(
  sections: DynamicSection[],
  context: AgentProjectContext,
  templateName: string,
): string {
  // NEW: Use multi-phase analysis if available
  let analysisData: string;
  if (context.analysisDir) {
    analysisData = this.readRoleSpecificContext(context.analysisDir, templateName);
  } else {
    analysisData = this.formatAnalysisData(context); // existing fallback
  }

  // ... rest unchanged, uses analysisData ...
}

/**
 * Read role-specific context from 05-agent-context.md.
 * Falls back to formatAnalysisData() if file is missing.
 */
private readRoleSpecificContext(analysisDir: string, templateName: string): string {
  try {
    const contextFile = join(analysisDir, '05-agent-context.md');
    const content = readFileSync(contextFile, 'utf-8');

    // Determine role section based on template name
    const roleSection = this.getRoleSectionForTemplate(templateName);

    // Extract "For All Agents" section (always included)
    const allAgentsContent = this.extractSection(content, 'For All Agents');

    // Extract role-specific section
    const roleContent = roleSection
      ? this.extractSection(content, roleSection)
      : '';

    // Combine
    const combined = [allAgentsContent, roleContent].filter(Boolean).join('\n\n');

    // Token budget check - if too large, truncate lower-priority sections
    if (combined.length > 50_000) {
      // Truncate: keep role-specific, trim "For All Agents" project profile
      return this.truncateForTokenBudget(allAgentsContent, roleContent);
    }

    return combined || this.formatAnalysisData({ .../* context fallback */ } as AgentProjectContext);
  } catch {
    // File not available - fall back to existing behavior
    return '(Multi-phase analysis not available)';
  }
}

private getRoleSectionForTemplate(templateName: string): string | null {
  if (templateName.includes('backend')) return 'For Backend Agents';
  if (templateName.includes('frontend')) return 'For Frontend Agents';
  if (templateName.includes('tester') || templateName.includes('qa')) return 'For QA Agents';
  if (templateName.includes('architect')) return 'For Architecture Agents';
  return null; // Use "For All Agents" only
}

private extractSection(content: string, sectionName: string): string {
  const regex = new RegExp(`## ${sectionName}\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = content.match(regex);
  return match ? match[1].trim() : '';
}
```

**Note**: Uses `readFileSync` because this is server-side Node.js code running in the extension host, not in the browser. The file is local and small. The existing `ContentGenerationService` already uses synchronous operations in its flow.

### 4.2 EnhancedPromptsService Integration

**File**: `libs/backend/agent-sdk/src/lib/prompt-harness/enhanced-prompts/enhanced-prompts.service.ts`

**Current behavior** (source: line 251-416): `runWizard()` uses `PromptDesignerAgent` with workspace analysis to generate enhanced prompts.

**New behavior**: When multi-phase analysis exists, incorporate quality audit findings and elevation plan priorities into the `PromptDesignerInput`.

**Changes to `runWizard()`**: After workspace analysis (Step 1-3), check for multi-phase analysis:

```typescript
// In runWizard(), after building input (Step 3):

// Step 3.5: Enrich with multi-phase analysis if available
if (this.analysisStorageService) {
  const multiPhase = await this.analysisStorageService.findLatestMultiPhaseAnalysis(workspacePath);
  if (multiPhase) {
    const qualityAudit = await this.analysisStorageService.readPhaseFile(multiPhase.slugDir, '03-quality-audit.md');
    const elevationPlan = await this.analysisStorageService.readPhaseFile(multiPhase.slugDir, '04-elevation-plan.md');

    if (qualityAudit || elevationPlan) {
      // Append to input's context for richer prompt generation
      input.additionalContext = [qualityAudit ? `## Quality Audit Findings\n${qualityAudit.substring(0, 10000)}` : '', elevationPlan ? `## Top Elevation Priorities\n${elevationPlan.substring(0, 5000)}` : ''].filter(Boolean).join('\n\n');
    }
  }
}
```

**Changes to `PromptDesignerInput`** (in `libs/backend/agent-sdk/src/lib/prompt-harness/prompt-designer/prompt-designer.types.ts`):

```typescript
export interface PromptDesignerInput {
  // ... existing fields ...

  /** Additional analysis context from multi-phase analysis (quality audit, elevation plan) */
  additionalContext?: string;
}
```

The `PromptDesignerAgent.buildPrompts()` method will naturally include `additionalContext` in the user prompt it generates, giving the LLM richer context for producing more specific enhanced prompts.

**Dependency**: `EnhancedPromptsService` needs access to `AnalysisStorageService`. This is done via optional DI injection:

```typescript
constructor(
  // ... existing injections ...
  @inject(AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE) @optional()
  private readonly analysisStorageService: AnalysisStorageService | null,
) {}
```

### 4.3 WizardGenerationRpcHandlers Integration

**File**: `apps/ptah-extension-vscode/src/services/rpc/handlers/wizard-generation-rpc.handlers.ts`

The RPC handler for `wizard:submit-selection` currently triggers the generation orchestrator. After multi-phase analysis is implemented, the flow becomes:

1. User clicks "Analyze" in wizard -> triggers multi-phase analysis via new RPC method
2. Multi-phase analysis completes -> results stored in `.claude/analysis/{slug}/`
3. User proceeds to agent selection
4. User clicks "Generate" -> orchestrator reads analysis from disk, passes `analysisDir` in context

**New RPC method needed**: `wizard:start-multi-phase-analysis`

```typescript
// In a new or existing RPC handler file
async handleStartMultiPhaseAnalysis(params: {
  workspacePath: string;
  model?: string;
}): Promise<{ success: boolean; error?: string }> {
  const workspaceUri = vscode.Uri.file(params.workspacePath);
  const multiPhaseService = container.resolve<MultiPhaseAnalysisService>(
    AGENT_GENERATION_TOKENS.MULTI_PHASE_ANALYSIS_SERVICE
  );

  const licenseService = container.resolve<LicenseService>(TOKENS.LICENSE_SERVICE);
  const mcpServer = container.resolve<CodeExecutionMCP>(/* token */);

  const result = await multiPhaseService.analyzeWorkspace(workspaceUri, {
    model: params.model,
    isPremium: licenseService.isPremium(),
    mcpServerRunning: mcpServer.isRunning(),
    mcpPort: mcpServer.getPort(),
  });

  if (result.isErr()) {
    return { success: false, error: result.error.message };
  }

  return { success: true };
}
```

---

## 5. Stream & Progress Architecture

### 5.1 Extending AnalysisPhase Type

**File**: `libs/shared/src/lib/types/setup-wizard.types.ts`

**Current** (source: line 758):

```typescript
export type AnalysisPhase = 'discovery' | 'architecture' | 'health' | 'quality';
```

**New**:

```typescript
export type AnalysisPhase =
  | 'discovery'
  | 'architecture'
  | 'health'
  | 'quality' // v1 phases (kept for backward compat)
  | 'project-profile'
  | 'architecture-assessment'
  | 'quality-audit'
  | 'elevation-plan'
  | 'synthesis'; // v2 multi-phase
```

### 5.2 Extending ScanProgressPayload

**File**: `libs/shared/src/lib/types/setup-wizard.types.ts`

Add multi-phase progress fields to `ScanProgressPayload` (source: line 768-783):

```typescript
export interface ScanProgressPayload {
  // ... existing fields ...

  /** Multi-phase analysis: current phase number (1-based) */
  currentPhaseNumber?: number;
  /** Multi-phase analysis: total phase count */
  totalPhaseCount?: number;
  /** Multi-phase analysis: phase completion status */
  phaseStatuses?: Array<{ id: string; status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' }>;
}
```

### 5.3 How Progress Flows to Frontend

The `MultiPhaseAnalysisService` broadcasts progress using the same message types as `AgenticAnalysisService`:

1. **Phase start**: `MESSAGE_TYPES.SETUP_WIZARD_SCAN_PROGRESS` with `currentPhase`, `currentPhaseNumber`, `totalPhaseCount`
2. **Tool activity during phase**: `MESSAGE_TYPES.SETUP_WIZARD_ANALYSIS_STREAM` with `AnalysisStreamPayload` (existing type)
3. **Phase complete**: `MESSAGE_TYPES.SETUP_WIZARD_SCAN_PROGRESS` with updated `phaseStatuses`

The frontend `SetupWizardStateService` already listens for these messages (source: `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts`). It will need minor updates to display multi-phase progress.

```typescript
// MultiPhaseAnalysisService progress broadcasting
private broadcastPhaseProgress(
  phaseId: string,
  phaseIndex: number,
  totalPhases: number,
  event?: StreamEvent,
): void {
  this.webviewManager.broadcastMessage(
    MESSAGE_TYPES.SETUP_WIZARD_SCAN_PROGRESS,
    {
      filesScanned: 0,
      totalFiles: 0,
      detections: [],
      currentPhase: phaseId as AnalysisPhase,
      currentPhaseNumber: phaseIndex + 1,
      totalPhaseCount: totalPhases,
      phaseLabel: PHASE_CONFIGS[phaseIndex]?.label,
      agentReasoning: event?.content,
      completedPhases: this.getCompletedPhaseIds(),
    }
  );
}
```

---

## 6. File-Level Change Map

### 6.1 Files to CREATE

| File                                                                                    | Purpose                                                                |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.ts` | Main orchestrator: 4 LLM phases + 1 deterministic synthesis            |
| `libs/backend/agent-generation/src/lib/services/wizard/multi-phase-prompts.ts`          | Phase 1-4 system prompt builders (extracted for testability)           |
| `libs/backend/agent-generation/src/lib/types/multi-phase.types.ts`                      | `MultiPhaseManifest`, `PhaseResult`, `MultiPhaseAnalysisOptions` types |

### 6.2 Files to MODIFY

| File                                                                                             | Changes                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`libs/shared/src/lib/types/setup-wizard.types.ts`**                                            | Extend `AnalysisPhase` with v2 values; add `currentPhaseNumber`, `totalPhaseCount`, `phaseStatuses` to `ScanProgressPayload`; add `SavedAnalysisMetadataV2` interface                 |
| **`libs/backend/agent-generation/src/lib/services/analysis-storage.service.ts`**                 | Add v2 methods: `createSlugDir()`, `writePhaseFile()`, `writeManifest()`, `loadManifest()`, `readPhaseFile()`, `findLatestMultiPhaseAnalysis()`, `listAll()`; make `slugify()` public |
| **`libs/backend/agent-generation/src/lib/di/tokens.ts`**                                         | Add `MULTI_PHASE_ANALYSIS_SERVICE` token                                                                                                                                              |
| **`libs/backend/agent-generation/src/lib/di/register.ts`**                                       | Register `MultiPhaseAnalysisService`; import new service                                                                                                                              |
| **`libs/backend/agent-generation/src/lib/services/wizard/index.ts`**                             | Export `MultiPhaseAnalysisService`                                                                                                                                                    |
| **`libs/backend/agent-generation/src/index.ts`**                                                 | Export new types and service                                                                                                                                                          |
| **`libs/backend/agent-generation/src/lib/types/core.types.ts`**                                  | Add `analysisDir?: string` to `AgentProjectContext`                                                                                                                                   |
| **`libs/backend/agent-generation/src/lib/services/content-generation.service.ts`**               | Add `readRoleSpecificContext()`, `getRoleSectionForTemplate()`, `extractSection()` methods; modify `buildAllSectionsPrompt()` to use analysis dir when available                      |
| **`libs/backend/agent-sdk/src/lib/prompt-harness/enhanced-prompts/enhanced-prompts.service.ts`** | Add optional `AnalysisStorageService` injection; read quality audit + elevation plan in `runWizard()`                                                                                 |
| **`libs/backend/agent-sdk/src/lib/prompt-harness/enhanced-prompts/enhanced-prompts.types.ts`**   | Add `additionalContext?: string` to `PromptDesignerInput` (if defined here) or in `prompt-designer.types.ts`                                                                          |
| **`libs/shared/src/lib/types/rpc.types.ts`**                                                     | Add `WizardStartMultiPhaseParams` and `WizardStartMultiPhaseResult` RPC types                                                                                                         |
| **`apps/ptah-extension-vscode/src/services/rpc/handlers/wizard-generation-rpc.handlers.ts`**     | Add `wizard:start-multi-phase-analysis` RPC handler                                                                                                                                   |
| **`apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts`**             | Register new RPC method                                                                                                                                                               |
| **`apps/ptah-extension-vscode/src/di/container.ts`**                                             | Ensure `MultiPhaseAnalysisService` is resolved                                                                                                                                        |
| **`libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts`**                  | Add multi-phase progress tracking signals; handle v2 phase progress messages                                                                                                          |

### 6.3 Dependency Graph (Implementation Order)

```
Layer 1 (Foundation - no dependencies):
  ├── libs/shared/.../setup-wizard.types.ts  (extend AnalysisPhase, ScanProgressPayload)
  ├── libs/backend/agent-generation/.../types/multi-phase.types.ts  (new types)
  └── libs/backend/agent-generation/.../types/core.types.ts  (add analysisDir)

Layer 2 (Storage - depends on Layer 1):
  └── libs/backend/agent-generation/.../analysis-storage.service.ts  (v2 methods)

Layer 3 (Prompts - no dependencies on storage):
  └── libs/backend/agent-generation/.../wizard/multi-phase-prompts.ts  (prompt builders)

Layer 4 (Core Service - depends on Layers 1-3):
  ├── libs/backend/agent-generation/.../wizard/multi-phase-analysis.service.ts
  ├── libs/backend/agent-generation/.../di/tokens.ts  (new token)
  ├── libs/backend/agent-generation/.../di/register.ts  (registration)
  └── libs/backend/agent-generation/.../services/wizard/index.ts  (barrel export)

Layer 5 (Downstream Integration - depends on Layer 4):
  ├── libs/backend/agent-generation/.../content-generation.service.ts
  ├── libs/backend/agent-sdk/.../enhanced-prompts.service.ts
  └── libs/backend/agent-sdk/.../enhanced-prompts.types.ts

Layer 6 (RPC & Frontend - depends on Layer 5):
  ├── libs/shared/.../rpc.types.ts
  ├── apps/ptah-extension-vscode/.../wizard-generation-rpc.handlers.ts
  ├── apps/ptah-extension-vscode/.../rpc-method-registration.service.ts
  ├── apps/ptah-extension-vscode/.../di/container.ts
  └── libs/frontend/setup-wizard/.../setup-wizard-state.service.ts
```

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**: This is primarily backend service architecture work:

- New TypeScript service with DI, async orchestration, file I/O
- InternalQueryService integration (agent-sdk)
- Stream processing with SdkStreamProcessor
- No Angular components or UI work (frontend changes are minimal signal additions)

### Complexity Assessment

**Complexity**: HIGH
**Estimated Effort**: 4-6 days

**Breakdown**:

- Batch 1 (Core Pipeline): 2-3 days - MultiPhaseAnalysisService, prompts, storage v2, manifest
- Batch 2 (Downstream Integration): 1-2 days - ContentGenerationService, EnhancedPromptsService
- Batch 3 (RPC & Frontend): 0.5-1 day - RPC handlers, frontend progress signals
- Batch 4 (Testing & Polish): 0.5 day - Integration testing, fallback path verification

### Critical Verification Points

1. **All imports exist in codebase**:

   - `InternalQueryService` from `@ptah-extension/agent-sdk` (verified: `libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.ts`)
   - `SdkStreamProcessor` from `@ptah-extension/agent-sdk` (verified: `libs/backend/agent-sdk/src/lib/stream-processing/sdk-stream-processor.ts`)
   - `SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE` (verified: `libs/backend/agent-sdk/src/lib/di/tokens.ts`)
   - `AGENT_GENERATION_TOKENS` (verified: `libs/backend/agent-generation/src/lib/di/tokens.ts`)
   - `MESSAGE_TYPES.SETUP_WIZARD_ANALYSIS_STREAM` (verified: used in `agentic-analysis.service.ts:484`)
   - `MESSAGE_TYPES.SETUP_WIZARD_SCAN_PROGRESS` (verified: used in `agentic-analysis.service.ts:472`)

2. **All patterns verified from examples**:

   - InternalQueryService.execute() pattern: `agentic-analysis.service.ts:193-208`
   - SdkStreamProcessor usage: `agentic-analysis.service.ts:349-357`
   - WebviewManager.broadcastMessage(): `agentic-analysis.service.ts:470-478`
   - AbortController pattern: `agentic-analysis.service.ts:189-260`
   - Result.ok/err pattern: `agentic-analysis.service.ts:236-250`

3. **No hallucinated APIs**: All decorators, services, and interfaces cited with file:line evidence.

### Files Affected Summary

**CREATE** (3 files):

- `libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.ts`
- `libs/backend/agent-generation/src/lib/services/wizard/multi-phase-prompts.ts`
- `libs/backend/agent-generation/src/lib/types/multi-phase.types.ts`

**MODIFY** (14 files):

- `libs/shared/src/lib/types/setup-wizard.types.ts`
- `libs/backend/agent-generation/src/lib/services/analysis-storage.service.ts`
- `libs/backend/agent-generation/src/lib/di/tokens.ts`
- `libs/backend/agent-generation/src/lib/di/register.ts`
- `libs/backend/agent-generation/src/lib/services/wizard/index.ts`
- `libs/backend/agent-generation/src/index.ts`
- `libs/backend/agent-generation/src/lib/types/core.types.ts`
- `libs/backend/agent-generation/src/lib/services/content-generation.service.ts`
- `libs/backend/agent-sdk/src/lib/prompt-harness/enhanced-prompts/enhanced-prompts.service.ts`
- `libs/backend/agent-sdk/src/lib/prompt-harness/enhanced-prompts/enhanced-prompts.types.ts`
- `libs/shared/src/lib/types/rpc.types.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/wizard-generation-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts`
- `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts`
