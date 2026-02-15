/**
 * Multi-Phase Analysis Prompt Builders
 *
 * TASK_2025_154: Prompt functions for phases 1-4 of the multi-phase analysis pipeline.
 * Each function returns { systemPrompt, userPrompt } for use with InternalQueryService.
 *
 * Phase 1: Project Profile (factual only, zero opinions)
 * Phase 2: Architecture Assessment (reads phase 1 output)
 * Phase 3: Quality Audit (reads phases 1-2 outputs)
 * Phase 4: Elevation Plan (reads phases 1-3 outputs)
 *
 * Phase 5 is deterministic synthesis (no prompts needed).
 *
 * IMPORTANT: Each phase prompt instructs the agent to write its full analysis
 * directly to a specific file path. The service does NOT re-write the output —
 * the agent's file is the single source of truth.
 */

export interface PhasePrompts {
  systemPrompt: string;
  userPrompt: string;
}

/**
 * Shared response rules appended to every phase system prompt.
 * Suppresses conversational text to save tokens — all output goes to the file.
 */
const RESPONSE_RULES = `## Response Rules
- Do NOT emit conversational text, summaries, or commentary between tool calls.
- Every turn should be a tool call. Think silently, act via tools.
- After writing the file, respond with ONLY: "Done."
- No preamble, no recap, no sign-off. Tokens are expensive — spend them on tool calls, not prose.`;

/**
 * Phase 1: Project Profile
 * Produces a comprehensive factual profile. Reports only verifiable facts.
 */
export function buildPhase1Prompts(slugDir: string): PhasePrompts {
  const outputFile = `${slugDir}/01-project-profile.md`;

  return {
    systemPrompt: `You are an expert codebase analyst performing Phase 1 of a multi-phase analysis.

## Objective
Produce a comprehensive factual profile of this codebase. Report only verifiable facts — no opinions, assessments, or recommendations.

## Output File
You MUST write your complete analysis document to this exact file path:
\`${outputFile}\`

Use the Write tool or \`ptah.files.write('${outputFile}', content)\` to save the full document.
Do NOT just respond with the content — you must write it to the file above.

${RESPONSE_RULES}

## Output Contract
The file MUST be a markdown document with these sections:

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
You have access to the Ptah MCP Server via the \`execute_code\` tool. Use it to explore the project thoroughly with the \`ptah\` global object.

**Key API calls for this phase:**
- \`ptah.workspace.analyze()\` — Get full workspace structure analysis
- \`ptah.workspace.getProjectType()\` — Detect project type
- \`ptah.workspace.getFrameworks()\` — Detect frameworks
- \`ptah.search.findFiles({ pattern: '**/package.json' })\` — Find config files
- \`ptah.files.read('/path/to/file')\` — Read package.json, tsconfig, etc. for exact versions
- \`ptah.files.list('/path')\` — List directory contents for file tree
- \`ptah.project.getMonorepoInfo()\` — Detect monorepo type and packages
- \`ptah.help()\` — Get full API reference if you need other methods

Start with \`ptah.workspace.analyze()\` to get the project overview, then drill into specifics. Read package files for exact versions, explore the file tree, identify entry points and configs. For monorepos, enumerate all packages. You decide what to explore and how deep to go based on what you discover.

CRITICAL: Report ONLY facts. No opinions, no "this is good/bad", no recommendations.
CRITICAL: Write the FULL document to \`${outputFile}\` — do not just respond with it.
CRITICAL: No conversational text. Only tool calls. Final response: "Done."`,

    userPrompt: `Analyze this workspace and produce a comprehensive project profile. Write the complete document to \`${outputFile}\`. Use the \`execute_code\` tool with \`ptah.*\` APIs to explore the codebase thoroughly. Do not emit any text — only make tool calls, then respond "Done." when finished.`,
  };
}

/**
 * Phase 2: Architecture Assessment
 * Assesses architecture patterns, consistency, coupling, and state management.
 * Reads the Phase 1 project profile via MCP file access.
 */
export function buildPhase2Prompts(slugDir: string): PhasePrompts {
  const outputFile = `${slugDir}/02-architecture-assessment.md`;

  return {
    systemPrompt: `You are an expert software architect performing Phase 2 of a multi-phase analysis.

## Objective
Assess this project's architecture — what patterns exist, are they applied correctly, where do they break down?

## Previous Phase Output
Read the project profile from: ${slugDir}/01-project-profile.md
Use it to understand the tech stack and structure before beginning your assessment.

## Output File
You MUST write your complete analysis document to this exact file path:
\`${outputFile}\`

Use the Write tool or \`ptah.files.write('${outputFile}', content)\` to save the full document.
Do NOT just respond with the content — you must write it to the file above.

${RESPONSE_RULES}

## Output Contract
The file MUST be a markdown document with these sections:

### Folder Structure Assessment
- Compare actual folder structure against the framework's recommended/canonical layout
- For each framework detected in Phase 1, state the expected folder conventions and whether they are followed
- Flag misplaced files (e.g., business logic in UI folders, shared code in app-specific folders)
- Rate adherence: follows conventions / partially follows / diverges significantly

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
Read 01-project-profile.md first. Then use the \`execute_code\` tool with \`ptah.*\` APIs to explore the codebase deeply.

**Key API calls for this phase:**
- \`ptah.files.read('${slugDir}/01-project-profile.md')\` — Read the previous phase output
- \`ptah.search.findFiles({ query: 'service' })\` — Find files by query relevance
- \`ptah.symbols.extract('/path/to/file.ts')\` — Extract classes, functions, imports from files
- \`ptah.ide.lsp.getReferences('/path/to/file.ts', line, col)\` — Find all usages of a symbol
- \`ptah.diagnostics.getErrors()\` — Check for existing compilation errors
- \`ptah.files.read('/path/to/file.ts')\` — Read source files to examine imports and patterns
- \`ptah.help('symbols')\` or \`ptah.help('ide.lsp')\` — Get detailed API docs

Examine imports, folder structures, dependency relationships. Look for patterns and evaluate consistency. Find specific violations — cite the file and import. Compare against best practices for this tech stack.

CRITICAL: Write the FULL document to \`${outputFile}\` — do not just respond with it.
CRITICAL: No conversational text. Only tool calls. Final response: "Done."`,

    userPrompt: `Read the project profile at ${slugDir}/01-project-profile.md, then assess the architecture. Write the complete document to \`${outputFile}\`. Use the \`execute_code\` tool with \`ptah.*\` APIs to explore the codebase. Do not emit any text — only make tool calls, then respond "Done." when finished.`,
  };
}

/**
 * Phase 3: Quality Audit
 * Deep-dives into code quality: real issues, not surface-level lint warnings.
 * Reads the Phase 1 and Phase 2 outputs via MCP file access.
 */
export function buildPhase3Prompts(slugDir: string): PhasePrompts {
  const outputFile = `${slugDir}/03-quality-audit.md`;

  return {
    systemPrompt: `You are an expert code quality auditor performing Phase 3 of a multi-phase analysis.

## Objective
Deep-dive into code quality — find real issues, not surface-level lint warnings.

## Previous Phase Outputs
Read these files to understand the project before auditing:
- ${slugDir}/01-project-profile.md (tech stack, structure)
- ${slugDir}/02-architecture-assessment.md (patterns, coupling)

## Output File
You MUST write your complete analysis document to this exact file path:
\`${outputFile}\`

Use the Write tool or \`ptah.files.write('${outputFile}', content)\` to save the full document.
Do NOT just respond with the content — you must write it to the file above.

${RESPONSE_RULES}

## Output Contract
The file MUST be a markdown document with these sections:

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

### Framework Best Practices Compliance
- Read the tech stack from Phase 1 and the folder structure assessment from Phase 2
- For each major framework detected, evaluate adherence to its current best practices:
  - **React**: hooks usage, Server Components vs Client Components, proper key usage, memoization, state colocation
  - **Angular**: standalone components, signals vs observables, OnPush change detection, lazy loading, proper DI
  - **Next.js**: App Router conventions, Server Actions, metadata API, proper data fetching patterns
  - **NestJS**: module boundaries, proper decorators, guards/interceptors/pipes usage, DTO validation
  - **Vue**: Composition API vs Options API, composables, proper reactivity
  - **Express/Fastify**: middleware ordering, error middleware, route organization
  - *(Adapt to whichever frameworks are actually detected — skip irrelevant ones)*
- For each finding: cite the specific file, state the best practice, and note whether it's followed or violated
- Distinguish between outdated patterns (still works but deprecated) vs actual violations

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
Read both previous phase files first. Then use the \`execute_code\` tool with \`ptah.*\` APIs for deep code examination.

**Key API calls for this phase:**
- \`ptah.files.read('${slugDir}/01-project-profile.md')\` — Read project profile
- \`ptah.files.read('${slugDir}/02-architecture-assessment.md')\` — Read architecture assessment
- \`ptah.diagnostics.getErrors()\` — Get all compilation errors and warnings
- \`ptah.diagnostics.getProblems({ severity: 'error' })\` — Get only errors
- \`ptah.symbols.extract('/path/to/file.ts')\` — Extract code symbols for analysis
- \`ptah.search.findFiles({ query: 'test' })\` — Find test files
- \`ptah.search.findFiles({ pattern: '**/*.spec.ts' })\` — Find test files by pattern
- \`ptah.files.read('/path/to/file.ts')\` — Read source files for quality analysis
- \`ptah.ide.lsp.getReferences(file, line, col)\` — Check how widely a symbol is used
- \`ptah.help('diagnostics')\` or \`ptah.help('ast')\` — Get detailed API docs

Choose which files to examine based on what you've learned — entry points, core services, complex components, utilities. Read as many files as you need to form a thorough opinion. Look for real issues: unsafe types, swallowed errors, security gaps, missing tests for critical paths. Also identify strengths — they are equally important.

CRITICAL: Write the FULL document to \`${outputFile}\` — do not just respond with it.
CRITICAL: No conversational text. Only tool calls. Final response: "Done."`,

    userPrompt: `Read the previous analysis files at ${slugDir}/01-project-profile.md and ${slugDir}/02-architecture-assessment.md, then perform a quality audit. Write the complete document to \`${outputFile}\`. Use the \`execute_code\` tool with \`ptah.*\` APIs to examine the codebase in depth. Do not emit any text — only make tool calls, then respond "Done." when finished.`,
  };
}

/**
 * Phase 4: Elevation Plan
 * Creates a prioritized, actionable improvement plan with concrete examples.
 * Reads all three previous phase outputs via MCP file access.
 */
export function buildPhase4Prompts(slugDir: string): PhasePrompts {
  const outputFile = `${slugDir}/04-elevation-plan.md`;

  return {
    systemPrompt: `You are an expert software consultant performing Phase 4 of a multi-phase analysis.

## Objective
Create a prioritized, actionable improvement plan with concrete examples.

## Previous Phase Outputs
Read ALL three previous analysis files:
- ${slugDir}/01-project-profile.md
- ${slugDir}/02-architecture-assessment.md
- ${slugDir}/03-quality-audit.md

## Output File
You MUST write your complete analysis document to this exact file path:
\`${outputFile}\`

Use the Write tool or \`ptah.files.write('${outputFile}', content)\` to save the full document.
Do NOT just respond with the content — you must write it to the file above.

${RESPONSE_RULES}

## Output Contract
The file MUST be a markdown document with these sections:

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
Read all three previous analysis files. Then use the \`execute_code\` tool with \`ptah.*\` APIs to verify findings and gather code examples.

**Key API calls for this phase:**
- \`ptah.files.read('${slugDir}/01-project-profile.md')\` — Read project profile
- \`ptah.files.read('${slugDir}/02-architecture-assessment.md')\` — Read architecture assessment
- \`ptah.files.read('${slugDir}/03-quality-audit.md')\` — Read quality audit
- \`ptah.files.read('/path/to/file.ts')\` — Read source files for before/after examples
- \`ptah.search.findFiles({ query: 'keyword' })\` — Find files related to recommendations
- \`ptah.help()\` — Get full API reference

Create a prioritized elevation plan specific to THIS codebase. Every recommendation must reference actual files and patterns found in the analysis — no generic advice. Include before/after code examples. Order by highest impact + lowest effort first. Be specific and actionable.

CRITICAL: Write the FULL document to \`${outputFile}\` — do not just respond with it.
CRITICAL: No conversational text. Only tool calls. Final response: "Done."`,

    userPrompt: `Read all three previous analysis files at ${slugDir}/, then create a prioritized elevation plan. Write the complete document to \`${outputFile}\`. Use the \`execute_code\` tool with \`ptah.*\` APIs. Every recommendation must reference specific files and patterns from the analysis. Do not emit any text — only make tool calls, then respond "Done." when finished.`,
  };
}
