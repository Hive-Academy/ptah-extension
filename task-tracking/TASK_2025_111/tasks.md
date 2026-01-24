# Development Tasks - TASK_2025_111

**Title**: MCP-Powered Setup Wizard & Orchestration Skill Enhancements
**Total Tasks**: 32 | **Batches**: 7 | **Status**: 7/7 complete (ALL BATCHES COMPLETE)

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- [x] Namespace builder pattern exists (7 existing builders in namespace-builders/)
- [x] RPC handler pattern exists (setup-rpc.handlers.ts)
- [x] Template storage pattern exists (11 agent templates)
- [x] SKILL.md is 413 lines (target <300)
- [x] PtahAPI has 14 namespaces (orchestration will be 15th)
- [x] Setup wizard uses signal-based state

### Risks Identified

| Risk                                                | Severity | Mitigation                                                                                    |
| --------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| Only 11 of 13 agent templates exist                 | MEDIUM   | Task 4.3 creates missing devops-engineer.template.md and technical-content-writer.template.md |
| Frontend WizardStep missing 'premium-check'         | LOW      | Task 2.1 adds this step                                                                       |
| Deep analysis types need frontend/backend alignment | LOW      | Task 2.2 defines shared types                                                                 |

### Edge Cases to Handle

- [ ] Premium license check fails due to network -> Task 2.1 handles with retry
- [ ] MCP namespace unavailable -> Task 1.3 handles gracefully
- [ ] Template file missing during generation -> Task 4.2 validates before generation

---

## Batch 1: MCP Orchestration Foundation - COMPLETE

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: None
**Estimated Hours**: 12-16
**Commit**: 37727d8

### Task 1.1: Create orchestration namespace types - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\types.ts
**Spec Reference**: implementation-plan.md:107-145
**Pattern to Follow**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\types.ts:62-86 (WorkspaceNamespace pattern)

**Quality Requirements**:

- Define OrchestrationState interface with phase, currentAgent, lastCheckpoint, pendingActions, strategy, metadata
- Define OrchestrationNextAction interface with action, agent, context, requiredInputs, checkpointType
- Define OrchestrationNamespace interface with getState, setState, getNextAction methods
- All types must be exported and documented with JSDoc

**Implementation Details**:

- Imports: vscode (already imported)
- Add types after existing namespace interfaces (around line 1390)
- Follow existing interface documentation patterns

---

### Task 1.2: Implement orchestration namespace builder - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\orchestration-namespace.builder.ts (CREATE)
**Spec Reference**: implementation-plan.md:147-219
**Pattern to Follow**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\core-namespace.builders.ts

**Quality Requirements**:

- Create OrchestrationNamespaceDependencies interface with workspaceRoot
- Implement buildOrchestrationNamespace function
- getState reads from task-tracking/TASK_XXX/.orchestration-state.json
- setState merges partial state and writes to file
- getNextAction analyzes state and documents to recommend next step
- Error handling for file operations

**Implementation Details**:

- Imports: vscode, OrchestrationNamespace/State/NextAction from '../types'
- Use vscode.Uri.joinPath for path construction
- Use vscode.workspace.fs for file operations
- Export function and dependency interface

---

### Task 1.3: Export orchestration namespace builder - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\index.ts
**Spec Reference**: implementation-plan.md:233-234
**Pattern to Follow**: Same file, lines 7-11 (existing export pattern)

**Quality Requirements**:

- Export buildOrchestrationNamespace function
- Export OrchestrationNamespaceDependencies type
- Maintain alphabetical ordering with other exports

**Implementation Details**:

- Add export block similar to buildAstNamespace export

---

### Task 1.4: Integrate orchestration namespace into PtahAPI - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts
**Spec Reference**: implementation-plan.md:221-229
**Pattern to Follow**: Same file, lines 180-209 (existing namespace integration)

**Quality Requirements**:

- Add orchestration import to namespace-builders import
- Add orchestrationDeps object with workspaceRoot
- Add orchestration namespace to return object
- Update constructor logger message to "15 namespaces"

**Implementation Details**:

- Imports: Add buildOrchestrationNamespace to existing import
- Need to inject workspace root URI - use TOKENS.WORKSPACE_ROOT or get from vscode.workspace.workspaceFolders
- Add orchestration: buildOrchestrationNamespace(orchestrationDeps) to return object

**Validation Notes**:

- May need to add TOKENS.WORKSPACE_ROOT to vscode-core if not exists
- Verify workspace folder availability before building namespace

---

### Task 1.5: Update PtahAPI interface with orchestration - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\types.ts
**Spec Reference**: implementation-plan.md:221-229
**Pattern to Follow**: Same file, lines 21-52 (PtahAPI interface)

**Quality Requirements**:

- Add orchestration: OrchestrationNamespace to PtahAPI interface
- Update comment to reflect 15 namespaces
- Maintain proper ordering (after llm, before help)

**Implementation Details**:

- Add orchestration property at line ~44 (after llm: LLMNamespace)

---

**Batch 1 Verification**:

- All files exist at specified paths
- Build passes: `npx nx build vscode-lm-tools`
- TypeScript compiles without errors
- Orchestration namespace appears in PtahAPI type

---

## Batch 2: Deep Analysis Types & Premium Gate - COMPLETE

**Developer**: backend-developer + frontend-developer (parallel)
**Tasks**: 5 | **Dependencies**: Batch 1
**Estimated Hours**: 10-14
**Commit**: 8a7081b

### Task 2.1: Add premium license gating to wizard (frontend) - COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\wizard-view.component.ts
**Spec Reference**: implementation-plan.md:239-280
**Pattern to Follow**: Same file (existing component structure)

**Quality Requirements**:

- Add licenseState signal: 'checking' | 'valid' | 'invalid'
- Add checkLicense method that calls license:verify-premium RPC
- Add conditional template for license checking, invalid (upsell), valid (wizard)
- Handle network errors with retry option

**Implementation Details**:

- Imports: Add signal from @angular/core
- Inject ClaudeRpcService for license check
- Create premiumFeatures array for upsell component

**Implementation Notes**:

- Used existing `license:getStatus` RPC method (checks `isPremium` flag) instead of new `license:verify-premium`
- Added LicenseState type: 'checking' | 'valid' | 'invalid'
- Added licenseError signal for network error handling with retry
- Template uses @if/@else if/@else control flow with three states

---

### Task 2.2: Create premium upsell component (frontend) - COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\premium-upsell.component.ts (CREATE)
**Spec Reference**: implementation-plan.md:280-284
**Pattern to Follow**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\welcome.component.ts

**Quality Requirements**:

- Standalone Angular component
- Input for features array
- Display feature benefits with icons
- "Upgrade to Premium" CTA button
- OnPush change detection

**Implementation Details**:

- Imports: Component, input, ChangeDetectionStrategy from @angular/core
- Use DaisyUI card and badge classes
- Emit upgrade event or navigate to premium page

**Implementation Notes**:

- Uses input() function for features and errorMessage inputs
- Uses output() function for retry event
- Upgrade button opens https://ptah.dev/pricing via VSCodeService message
- DaisyUI hero, card, badge, btn components used
- SVG icons for premium badge, checkmarks, and lightning bolt
- Exported from index.ts

---

### Task 2.3: Create deep analysis types (backend) - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\types\analysis.types.ts (CREATE)
**Spec Reference**: implementation-plan.md:296-328
**Pattern to Follow**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\types\core.types.ts

**Quality Requirements**:

- Define DeepProjectAnalysis interface with all required fields
- Define ArchitecturePattern interface
- Define KeyFileLocations interface
- Define LanguageStats, DiagnosticSummary, CodeConventions, TestCoverageEstimate interfaces
- Export all types

**Implementation Details**:

- Follow existing type patterns in the library
- Use string literal unions for known values
- Include confidence scores (0-100) where applicable

**Implementation Notes**:

- Created comprehensive DeepProjectAnalysis interface with all fields
- Created ArchitecturePattern with name, confidence, evidence, description
- Created ArchitecturePatternName as extensible string literal union
- Created KeyFileLocations with entryPoints, configs, testDirectories, apiRoutes, components, services, models, repositories, utilities
- Created LanguageStats with language, percentage, fileCount, linesOfCode
- Created DiagnosticSummary with errorCount, warningCount, infoCount, errorsByType, warningsByType, topErrors
- Created extended CodeConventions with namingConventions, maxLineLength, usePrettier, useEslint, additionalTools
- Created NamingConventions interface for files, classes, functions, variables, constants, interfaces, types
- Created TestCoverageEstimate with comprehensive test detection fields
- Created AgentRecommendation interface for recommendation scoring
- Created AgentCategory type for agent grouping
- Updated index.ts to export all new types (renamed core CodeConventions as CoreCodeConventions to avoid conflict)

---

### Task 2.4: Extend SetupWizardStateService (frontend) - COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts
**Spec Reference**: implementation-plan.md:907-1003
**Pattern to Follow**: Same file (existing signal patterns)

**Quality Requirements**:

- Add 'premium-check' to WizardStep type
- Add deepAnalysis signal for ProjectAnalysisResult
- Add recommendations signal for AgentRecommendation[]
- Add skillGenerationProgress signal for GenerationProgress[]
- Add recommendedAgents computed signal (score > 75)
- Add totalGenerationItems computed signal
- Add setDeepAnalysis and setRecommendations methods

**Implementation Details**:

- Imports: Add computed from @angular/core if not present
- Follow existing signal pattern with private/public readonly
- Auto-select agents with score >= 80 in setRecommendations

**Implementation Notes**:

- Added 'premium-check' to WizardStep type (7 steps total)
- Added deepAnalysisSignal with public readonly deepAnalysis
- Added recommendationsSignal with public readonly recommendations
- Added skillGenerationProgressSignal with public readonly skillGenerationProgress
- Added selectedAgentsMapSignal with public readonly selectedAgentsMap
- Added recommendedAgents computed (score >= 75)
- Added totalGenerationItems computed (agents + 5 commands + 7 skill files)
- Added generationCompletionPercentage computed
- Added isGenerationComplete computed
- Added failedGenerationItems computed
- Updated canProceed, percentComplete, stepIndex to include premium-check
- Added setDeepAnalysis method
- Added setRecommendations method with auto-select (score >= 80)
- Added toggleAgentRecommendationSelection, setAgentSelections, selectAllRecommended, deselectAllAgents
- Added setSkillGenerationProgress, updateSkillGenerationItem, retryGenerationItem
- Updated reset() to clear all new signals

---

### Task 2.5: Create frontend analysis types (shared) - COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts
**Spec Reference**: implementation-plan.md:926-959
**Pattern to Follow**: Same file, existing interfaces

**Quality Requirements**:

- Extend ProjectContext interface or create ProjectAnalysisResult
- Define frontend AgentRecommendation interface matching backend
- Ensure types align with backend DeepProjectAnalysis

**Implementation Details**:

- Can define interfaces directly in state service file
- Or create separate types file if cleaner

**Implementation Notes**:

- Created ArchitecturePatternResult interface (mirrors backend ArchitecturePattern)
- Created KeyFileLocationsResult interface (simplified version for frontend)
- Created DiagnosticSummaryResult interface (errorCount, warningCount, infoCount)
- Created TestCoverageEstimateResult interface (percentage, hasTests, frameworks, test types)
- Created ProjectAnalysisResult interface with all deep analysis fields
- Created AgentCategory type matching backend
- Created AgentRecommendation interface matching backend AgentRecommendation
- Created SkillGenerationProgressItem interface for progress tracking
- All types defined in state service file following existing pattern
- Types align with backend DeepProjectAnalysis structure

---

**Batch 2 Verification**:

- Build passes: `npx nx build setup-wizard` and `npx nx build agent-generation`
- Premium gate renders in wizard component
- Deep analysis types compile without errors
- State service has new signals

---

## Batch 3: Deep Analysis & Recommendation Services - COMPLETE

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 2
**Estimated Hours**: 16-20
**Commit**: 60ad4d6

### Task 3.1: Implement deep project analysis in SetupWizardService - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\setup-wizard.service.ts
**Spec Reference**: implementation-plan.md:326-401
**Pattern to Follow**: Same file (existing method patterns)

**Quality Requirements**:

- Add performDeepAnalysis method returning Result<DeepProjectAnalysis, Error>
- Use vscode.workspace.findFiles for config discovery
- Use vscode.commands.executeCommand for symbol provider
- Use vscode.languages.getDiagnostics for code health
- Implement detectArchitecturePatterns private method
- Aggregate results into DeepProjectAnalysis

**Implementation Details**:

- Imports: DeepProjectAnalysis from types/analysis.types
- Inject workspace analyzer service for basic analysis
- Use glob patterns: **/\*.config.{ts,js,json}, **/package.json
- Detect DDD, Layered, Microservices patterns via folder structure

**Implementation Notes**:

- Added performDeepAnalysis method with 10-step comprehensive analysis
- Added detectArchitecturePatterns private method detecting DDD, Layered, Microservices, Hexagonal, Clean-Architecture, Component-Based patterns
- Added extractKeyLocations for entry points, configs, tests, routes, components, services, models, repos, utils
- Added calculateLanguageDistribution for TypeScript, JavaScript, TSX, JSX, Vue, Python, HTML, CSS, JSON
- Added summarizeDiagnostics aggregating errors/warnings from VS Code diagnostics
- Added detectCodeConventions reading .prettierrc, .eslintrc configs
- Added estimateTestCoverage detecting Jest, Vitest, Mocha, Cypress, Playwright

---

### Task 3.2: Create agent recommendation service - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\agent-recommendation.service.ts (CREATE)
**Spec Reference**: implementation-plan.md:410-516
**Pattern to Follow**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\agent-selection.service.ts

**Quality Requirements**:

- Define AgentRecommendation interface
- Implement calculateRecommendations method
- Score all 13 agents based on project analysis
- Categorize agents: planning, development, qa, specialist, creative
- Scoring logic for each agent type
- Return sorted recommendations (highest score first)

**Implementation Details**:

- Imports: injectable, inject from tsyringe
- Inject Logger from vscode-core
- Use DeepProjectAnalysis for scoring decisions
- Base scores + adjustments based on detected patterns
- recommended = score >= 75

**Implementation Notes**:

- Created AgentMetadata interface for agent catalog
- Defined AGENT_CATALOG with all 13 agents with base scores, categories, descriptions, icons
- Implemented calculateRecommendations returning sorted AgentRecommendation[]
- Implemented category-specific scoring methods:
  - scorePlanningAgent: team-leader boost for monorepos, architect boost for complex patterns
  - scoreDevelopmentAgent: frontend/backend framework detection, devops config detection
  - scoreQaAgent: test coverage adjustments, diagnostic counts
  - scoreSpecialistAgent: multi-framework/language projects, technical debt indicators
  - scoreCreativeAgent: UI components, stylesheets, API documentation needs
- Exported from index.ts

---

### Task 3.3: Add DI token for recommendation service - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\di\tokens.ts
**Spec Reference**: implementation-plan.md:519-521
**Pattern to Follow**: Same file (existing token patterns)

**Quality Requirements**:

- Add AGENT_RECOMMENDATION_SERVICE token
- Follow existing naming convention

**Implementation Details**:

- Add to AGENT_GENERATION_TOKENS object

**Implementation Notes**:

- Added AGENT_RECOMMENDATION_SERVICE Symbol.for token
- Added to AGENT_GENERATION_TOKENS registry under Agent Selection section

---

### Task 3.4: Create RPC handler for deep analysis - COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\setup-rpc.handlers.ts
**Spec Reference**: implementation-plan.md:2162-2166
**Pattern to Follow**: Same file (existing handler patterns)

**Quality Requirements**:

- Add wizard:deep-analyze RPC handler
- Call SetupWizardService.performDeepAnalysis
- Return DeepProjectAnalysis result
- Handle errors with proper RPC error response

**Implementation Details**:

- Inject SetupWizardService
- Use Result type for error handling
- Map to RPC response format

**Implementation Notes**:

- Added registerDeepAnalyze private method
- Registered wizard:deep-analyze RPC method
- Dynamically imports agent-generation for lazy loading
- Resolves SetupWizardService from container
- Returns DeepProjectAnalysis result or throws with error message
- Logs analysis completion with projectType and patternCount

---

### Task 3.5: Create RPC handler for agent recommendations - COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\setup-rpc.handlers.ts
**Spec Reference**: implementation-plan.md:2162-2166
**Pattern to Follow**: Same file

**Quality Requirements**:

- Add wizard:recommend-agents RPC handler
- Accept DeepProjectAnalysis as input
- Call AgentRecommendationService.calculateRecommendations
- Return AgentRecommendation[] result

**Implementation Details**:

- Inject AgentRecommendationService
- Validate input analysis object

**Implementation Notes**:

- Added registerRecommendAgents private method
- Registered wizard:recommend-agents RPC method
- Validates input analysis (required, has projectType field)
- Tries container resolution first, falls back to direct instantiation
- Returns AgentRecommendation[] sorted by score
- Logs recommendation counts (total and recommended)

---

**Batch 3 Verification**:

- Build passes: `npx nx build agent-generation` and `npx nx build ptah-extension-vscode`
- RPC handlers respond correctly (manual test)
- Deep analysis returns architecture patterns
- Recommendations sorted by score

---

## Batch 4: Skill & Template Generation - COMPLETE

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 3
**Estimated Hours**: 12-16
**Commit**: cc2dbfa

### Task 4.1: Create skill generator service - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\skill-generator.service.ts (CREATE)
**Spec Reference**: implementation-plan.md:524-656
**Pattern to Follow**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\content-generation.service.ts

**Quality Requirements**:

- Define SkillGenerationOptions interface
- Define SkillGenerationResult interface
- Implement generateOrchestrationSkill method
- Generate SKILL.md with project customizations
- Generate 6 reference files with customizations
- Handle overwrite protection
- Track customizations applied per file

**Implementation Details**:

- Imports: injectable, inject from tsyringe, vscode
- Inject ITemplateStorageService, Logger
- Use vscode.workspace.fs for file operations
- Template variable replacement: {{PROJECT_TYPE}}, {{MONOREPO_CONFIG}}, etc.

**Implementation Notes**:

- Created SkillGeneratorService with injectable decorator
- Defined SkillGenerationOptions interface with workspaceUri, projectContext, selectedAgents, overwriteExisting
- Defined SkillGenerationResult interface with filesCreated, filesSkipped, customizations Map
- Implemented generateOrchestrationSkill method with full workflow: directory creation, template loading, variable substitution, file writing
- Implemented skillExists method to check for existing SKILL.md
- Implemented getGeneratedFilePaths method returning all 7 file paths
- Template variable substitution for: PROJECT_TYPE, PROJECT_PATH, PROJECT_NAME, MONOREPO_CONFIG, AGENTS_LIST, BRANCH_PREFIX, FRAMEWORKS, LANGUAGES, BUILD_TOOLS, PACKAGE_MANAGER
- Overwrite protection: checks if file exists and skips if overwriteExisting=false
- Error handling with Result type pattern

---

### Task 4.2: Create skill templates directory and SKILL.template.md - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\templates\skills\orchestration\SKILL.template.md (CREATE)
**Spec Reference**: implementation-plan.md:530-538
**Pattern to Follow**: D:\projects\ptah-extension\libs\backend\agent-generation\templates\agents\backend-developer.template.md

**Quality Requirements**:

- Create directory structure: templates/skills/orchestration/
- Create SKILL.template.md with frontmatter
- Include template variables for customization
- Target <300 lines (based on optimized version)
- Include all essential sections from current SKILL.md

**Implementation Details**:

- Frontmatter: name, description, version
- Variables: {{PROJECT_TYPE}}, {{MONOREPO_CONFIG}}, {{AGENTS_LIST}}
- Include: Quick Start, Strategy Matrix, Role, Reference Index

**Implementation Notes**:

- Created directory structure: templates/skills/orchestration/ and templates/skills/orchestration/references/
- SKILL.template.md created with YAML frontmatter (name, description, version, projectType, generatedAt)
- Template variables: {{PROJECT_NAME}}, {{PROJECT_TYPE}}, {{PROJECT_PATH}}, {{MONOREPO_CONFIG}}, {{AGENTS_LIST}}, {{TIMESTAMP}}
- Includes: Quick Start, Strategy Quick Reference, Project Context, Role section, Workflow Selection Matrix, Core Orchestration Loop, Team-Leader Integration, Reference Index, Key Design Principles
- Total ~200 lines (under 300 target)
- Based on current SKILL.md but condensed for template use

---

### Task 4.3: Create missing agent templates - COMPLETE

**Files**:

- D:\projects\ptah-extension\libs\backend\agent-generation\templates\agents\devops-engineer.template.md (CREATE)
- D:\projects\ptah-extension\libs\backend\agent-generation\templates\agents\technical-content-writer.template.md (CREATE)
  **Spec Reference**: implementation-plan.md:3176-3178
  **Pattern to Follow**: D:\projects\ptah-extension\libs\backend\agent-generation\templates\agents\backend-developer.template.md

**Quality Requirements**:

- Create devops-engineer.template.md with CI/CD, Docker, K8s, Terraform expertise
- Create technical-content-writer.template.md with documentation, blog, video script expertise
- Include frontmatter: name, description, version, category
- Include template variables for project customization

**Implementation Details**:

- Follow existing template structure
- Include: Purpose, Expertise, Workflow, Guidelines sections
- Variables: {{PROJECT_TYPE}}, {{CI_TOOL}}, {{CLOUD_PROVIDER}}

**Implementation Notes**:

- devops-engineer.template.md created with:
  - YAML frontmatter (templateId, templateVersion, applicabilityRules)
  - Core Identity with CI/CD, Docker, Kubernetes, Terraform, cloud platforms, monitoring expertise
  - Anti-backward compatibility mandate
  - Mandatory initialization protocol
  - CI/CD implementation patterns (GitHub Actions, Docker, Docker Compose, Kubernetes, Terraform)
  - NPM/Docker publishing automation patterns
  - Security best practices
  - Implementation quality standards
  - Return format template
- technical-content-writer.template.md created with:
  - YAML frontmatter matching pattern
  - Core Identity for landing pages, blogs, docs, video scripts
  - Evidence-based content creation principle
  - Design system integration requirements
  - Mandatory initialization protocol
  - Content type sections: Landing Pages, Blog Posts, Documentation, Video Scripts
  - Codebase investigation patterns
  - Output specifications for each content type
  - Return format template

---

### Task 4.4: Create skill reference templates - COMPLETE

**Files**:

- D:\projects\ptah-extension\libs\backend\agent-generation\templates\skills\orchestration\references\agent-catalog.template.md (CREATE)
- D:\projects\ptah-extension\libs\backend\agent-generation\templates\skills\orchestration\references\strategies.template.md (CREATE)
- D:\projects\ptah-extension\libs\backend\agent-generation\templates\skills\orchestration\references\team-leader-modes.template.md (CREATE)
- D:\projects\ptah-extension\libs\backend\agent-generation\templates\skills\orchestration\references\task-tracking.template.md (CREATE)
- D:\projects\ptah-extension\libs\backend\agent-generation\templates\skills\orchestration\references\checkpoints.template.md (CREATE)
- D:\projects\ptah-extension\libs\backend\agent-generation\templates\skills\orchestration\references\git-standards.template.md (CREATE)
  **Spec Reference**: implementation-plan.md:530-538
  **Pattern to Follow**: D:\projects\ptah-extension\.claude\skills\orchestration\references\*.md

**Quality Requirements**:

- Create 6 reference template files
- Include frontmatter and template variables
- Base content on existing reference files
- Add customization placeholders

**Implementation Details**:

- Copy structure from existing references
- Add {{PROJECT_PATH}}, {{BRANCH_PREFIX}}, etc. variables

**Implementation Notes**:

- All 6 reference template files created in templates/skills/orchestration/references/
- agent-catalog.template.md: Agent selection matrix, planning/development/QA/specialist/creative agents with invocation patterns, {{PROJECT_NAME}} and {{AGENTS_LIST}} variables
- strategies.template.md: All 6 strategies (FEATURE, BUGFIX, REFACTORING, DOCUMENTATION, RESEARCH, DEVOPS) plus creative workflows
- team-leader-modes.template.md: MODE 1/2/3 integration patterns, invocation templates with {{PROJECT_PATH}}, response detection logic
- task-tracking.template.md: Task ID format, folder structure, registry management, continuation mode, {{PROJECT_PATH}} variables
- checkpoints.template.md: All 5 checkpoints (0, 1, 1.5, 2, 3), templates, response handling, error handling patterns
- git-standards.template.md: Commit format, allowed types/scopes, pre-commit hooks, hook failure protocol, {{BRANCH_PREFIX}} and {{PACKAGE_MANAGER}} variables

---

### Task 4.5: Add skill generator DI token and interface - COMPLETE

**Files**:

- D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\di\tokens.ts
- D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\interfaces\skill-generator.interface.ts (CREATE)
  **Spec Reference**: implementation-plan.md:519-521
  **Pattern to Follow**: Same files (existing patterns)

**Quality Requirements**:

- Add SKILL_GENERATOR_SERVICE token
- Create ISkillGeneratorService interface
- Export from index.ts

**Implementation Details**:

- Interface mirrors SkillGeneratorService public methods

**Implementation Notes**:

- Added SKILL_GENERATOR_SERVICE Symbol.for token to tokens.ts
- Added token to AGENT_GENERATION_TOKENS registry under "Skill Generation" section
- Created skill-generator.interface.ts with:
  - SkillGenerationOptions interface (workspaceUri, projectContext, selectedAgents, overwriteExisting)
  - SkillGenerationResult interface (filesCreated, filesSkipped, customizations Map)
  - ISkillGeneratorService interface with generateOrchestrationSkill, skillExists, getGeneratedFilePaths methods
  - Full JSDoc documentation with examples
- Exported ISkillGeneratorService, SkillGenerationOptions, SkillGenerationResult from interfaces/index.ts

---

**Batch 4 Verification**:

- All template files exist
- Build passes: `npx nx build agent-generation`
- Skill generator service can load templates
- Variable interpolation works

---

## Batch 5: Frontend Wizard Enhancements - COMPLETE

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: Batch 3, Batch 4
**Estimated Hours**: 10-14
**Commit**: 5e7ac61

### Task 5.1: Enhance analysis results component - COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-results.component.ts
**Spec Reference**: implementation-plan.md:1007-1010
**Pattern to Follow**: Same file (existing component)

**Quality Requirements**:

- Display architecture patterns with confidence scores
- Show key file locations grouped by type
- Display language distribution chart/list
- Show existing issues count (errors, warnings)
- Display test coverage estimate

**Implementation Details**:

- Use deepAnalysis signal from state service
- Add architecture patterns section with progress bars
- Add collapsible file locations sections
- Use DaisyUI badge/progress components

**Implementation Notes**:

- Added deepAnalysis computed signal with fallback to projectContext
- Created Project Overview card with project type, file count, frameworks, monorepo info
- Created Architecture Patterns card with progress bars showing confidence scores
- Created Key File Locations card with collapsible sections for entry points, configs, test directories, components, services, API routes
- Created Code Health card with Language Distribution progress bars and Diagnostics summary (errors, warnings, info badges)
- Added Test Coverage section with radial progress, test framework badge, and test type indicators (Unit, Integration, E2E)
- Helper methods: getConfidenceBadgeClass, getConfidenceProgressClass for color-coded confidence indicators
- Full accessibility with aria-labels on progress bars

---

### Task 5.2: Enhance agent selection component with scores - COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\agent-selection.component.ts
**Spec Reference**: implementation-plan.md:1007-1010
**Pattern to Follow**: Same file (existing component)

**Quality Requirements**:

- Display relevance score for each agent
- Show matched criteria as tooltips/badges
- Visual indicator for "Recommended" (score > 75)
- Auto-select recommended agents (score >= 80)
- Sort agents by score descending

**Implementation Details**:

- Use recommendations signal from state service
- Add score progress bar or percentage display
- Add "Recommended" badge using DaisyUI
- Add criteria tooltip on hover

**Implementation Notes**:

- Agents sorted by relevance score descending via sortedRecommendations computed
- Agents grouped by category (Planning, Development, QA, Specialist, Creative)
- Each agent card displays score badge with color coding (success >= 80, warning >= 60, error < 60)
- Progress bar under each agent showing relevance visually
- "Recommended" badge with checkmark icon for agents with score >= 75
- Matched criteria displayed as outline badges with tooltips for overflow
- Category icons and labels with agent counts
- Select All Recommended and Deselect All buttons
- Ring highlight on selected agent cards
- Full keyboard navigation with tabindex and aria attributes
- Back button to return to analysis step

---

### Task 5.3: Enhance generation progress component - COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\generation-progress.component.ts
**Spec Reference**: implementation-plan.md:1007-1010
**Pattern to Follow**: Same file (existing component)

**Quality Requirements**:

- Track agents, commands, and skill files separately
- Show individual progress for each item
- Display total progress (agents + commands + skill)
- Handle partial failures with retry per item
- Show estimated time remaining

**Implementation Details**:

- Use skillGenerationProgress signal
- Group by category: Agents, Commands, Skill Files
- Use totalGenerationItems computed for progress calculation
- Add retry button per failed item

**Implementation Notes**:

- Overall progress card with percentage and item count
- Items grouped into 3 sections: Agent Files, Command Files, Orchestration Skill Files
- Each section shows completed/total count
- Per-item cards with status indicators (pending badge, loading spinner, success checkmark, error icon)
- Individual progress bars for in-progress items
- Error messages displayed for failed items
- Retry button on each failed item that calls retryGenerationItem
- Added retryGenerationItem method to WizardRpcService
- Empty state with loading spinner when no items yet
- Completion alert (success or warning with failed count)
- Continue button to proceed to completion step

---

### Task 5.4: Enhance completion component with quick start - COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\completion.component.ts
**Spec Reference**: implementation-plan.md:1007-1010
**Pattern to Follow**: Same file (existing component)

**Quality Requirements**:

- Display generated files organized by category
- Show quick start guide with example commands
- Include /orchestrate example usage
- Add "Open Files" button to reveal .claude folder
- Add "Test Orchestration" button to launch chat with sample command

**Implementation Details**:

- Add quick start code block with usage examples
- Add VSCodeService for postMessage commands
- Use DaisyUI card and code components

**Implementation Notes**:

- Success header with checkmark icon and congratulations message
- Stats card showing Agents Generated, Commands Created, Skill Files counts
- Generated Files card with 3-column grid organizing files by category (Agents, Commands, Skill Files)
- Quick Start Guide card with 4 numbered steps:
  1. Start a Development Workflow - shows /orchestrate command in mockup-code
  2. Available Workflow Strategies - badges for FEATURE, BUGFIX, REFACTORING, DOCUMENTATION, RESEARCH, DEVOPS
  3. Example Commands - 3 mockup-code examples with strategy comments
  4. Continuing Existing Tasks - shows TASK_XXX continuation pattern
- Pro Tips alert with @agent-name usage, SKILL.md location, task-tracking folder info
- Three action buttons:
  - Open .claude Folder (primary) - reveals folder in VS Code
  - Test /orchestrate (secondary) - opens chat with sample orchestrate command
  - Start New Chat (ghost) - opens empty chat
- onTestOrchestration sends prefillMessage with sample orchestrate command

---

**Batch 5 Verification**:

- Build passes: `npx nx build setup-wizard`
- All components render without errors
- Progress tracking shows correct counts
- Quick start guide displays properly

---

## Batch 6: Skill Optimization & Documentation - COMPLETE

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 4
**Estimated Hours**: 8-12
**Commit**: 83150d5

### Task 6.1: Optimize SKILL.md to <300 lines - COMPLETE

**File**: D:\projects\ptah-extension\.claude\skills\orchestration\SKILL.md
**Spec Reference**: implementation-plan.md:864-904
**Pattern to Follow**: Current file (reduce, don't remove essential content)

**Quality Requirements**:

- Reduce from 413 lines to <300 lines
- Keep: Quick Start, Strategy Matrix, Role, Reference Index
- Move to references: Detailed strategy flows, detailed agent catalog
- Add explicit "See [reference.md] for details" pointers
- Maintain all essential quick-reference content

**Implementation Details**:

- Audit for content duplicating references (~150 lines)
- Replace detailed sections with reference links
- Consolidate redundant sections
- Target: ~170-200 lines body content

---

### Task 6.2: Add agent capability matrix to agent-catalog.md - COMPLETE

**File**: D:\projects\ptah-extension\.claude\skills\orchestration\references\agent-catalog.md
**Spec Reference**: implementation-plan.md:1102-1135
**Pattern to Follow**: Same file (add new section)

**Quality Requirements**:

- Create capability matrix table
- Categories: Write Code, Design, Review, Plan, Research, Content
- Mark Primary (P) and Secondary (S) capabilities
- Include all 13 agents
- Add legend explanation

**Implementation Details**:

- Use markdown table format
- Place at beginning of file after intro

---

### Task 6.3: Add adaptive strategy selection to SKILL.md - COMPLETE

**File**: D:\projects\ptah-extension\.claude\skills\orchestration\SKILL.md
**Spec Reference**: implementation-plan.md:1019-1095
**Pattern to Follow**: Same file (Workflow Selection Matrix section)

**Quality Requirements**:

- Add confidence-based selection guidance
- Document 4 factors: Keywords (30%), Affected Files (25%), Complexity (25%), Recent Patterns (20%)
- Add decision rules for confidence thresholds
- Reference strategies.md for detailed flows

**Implementation Details**:

- Add table with factor/weight/assessment columns
- Add decision rules: >=70% proceed, within 10 points present options, <70% ask user

---

### Task 6.4: Standardize agent profiles in agent-catalog.md - COMPLETE

**File**: D:\projects\ptah-extension\.claude\skills\orchestration\references\agent-catalog.md
**Spec Reference**: implementation-plan.md:2286-2296
**Pattern to Follow**: Same file (existing agent profiles)

**Quality Requirements**:

- Standardize all 13 agent profiles with consistent sections
- Required sections: Role, Triggers, Inputs, Outputs, Dependencies, Parallel With, Invocation Example
- Ensure profiles match .claude/agents/\*.md files

**Implementation Details**:

- Audit each profile for missing sections
- Add missing sections with appropriate content
- Ensure invocation examples use correct Task format

---

**Batch 6 Verification**:

- SKILL.md < 300 lines
- Agent capability matrix renders correctly
- All agent profiles have standard sections
- Validation script passes (from Batch 7)

---

## Batch 7: Validation & Quality - COMPLETE

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 6
**Estimated Hours**: 6-10
**Commit**: 13c4a92

### Task 7.1: Create skill validation script - COMPLETE

**File**: D:\projects\ptah-extension\scripts\validate-orchestration-skill.ts (CREATE)
**Spec Reference**: implementation-plan.md:665-838
**Pattern to Follow**: Existing scripts in scripts/ folder

**Quality Requirements**:

- Validate markdown syntax (all files parseable)
- Validate internal references (all links point to existing files)
- Validate content: all 6 strategies, all 13 agents documented
- Validate consistency: invocation patterns match agent-catalog
- Report errors with file, line, type, message, suggestion
- Exit with success/failure code

**Implementation Details**:

- Use fs for file operations
- Parse markdown for link references
- Check for required strategies array
- Check for required agents array
- Output colored console messages

---

### Task 7.2: Add validation script to package.json - COMPLETE

**File**: D:\projects\ptah-extension\package.json
**Spec Reference**: implementation-plan.md:856-861
**Pattern to Follow**: Existing scripts in package.json

**Quality Requirements**:

- Add "validate-skill" script
- Script runs: npx ts-node scripts/validate-orchestration-skill.ts

**Implementation Details**:

- Add to scripts section

---

### Task 7.3: Add pre-commit hook for skill validation - COMPLETE

**File**: D:\projects\ptah-extension\.husky\pre-commit
**Spec Reference**: implementation-plan.md:842-856
**Pattern to Follow**: Existing pre-commit hooks

**Quality Requirements**:

- Check if .claude/skills/\*\* files changed
- If changed, run validation script
- Block commit if validation fails

**Implementation Details**:

- Use git diff --cached --name-only
- Grep for .claude/skills/ pattern
- Run npm run validate-skill

---

### Task 7.4: Create example workflow traces - COMPLETE

**Files**:

- D:\projects\ptah-extension\.claude\skills\orchestration\examples\feature-trace.md (CREATE)
- D:\projects\ptah-extension\.claude\skills\orchestration\examples\bugfix-trace.md (CREATE)
- D:\projects\ptah-extension\.claude\skills\orchestration\examples\creative-trace.md (CREATE)
  **Spec Reference**: implementation-plan.md:2212-2218
  **Pattern to Follow**: None (new content)

**Quality Requirements**:

- Show complete workflow from start to finish
- Include: User command, agent invocations with prompts, checkpoints, final output
- Feature trace: Full PM->Architect->Dev->QA flow
- Bugfix trace: Research->TeamLeader->QA flow
- Creative trace: Designer->ContentWriter->Frontend flow

**Implementation Details**:

- Create examples/ directory
- Write realistic traces based on actual orchestration patterns

---

**Batch 7 Verification**:

- npm run validate-skill passes
- Pre-commit hook triggers on skill file changes
- Example traces are complete and realistic
- All 32 tasks complete

---

## Summary

| Batch     | Name                                    | Developer          | Tasks  | Hours      | Status   |
| --------- | --------------------------------------- | ------------------ | ------ | ---------- | -------- |
| 1         | MCP Orchestration Foundation            | backend-developer  | 5      | 12-16      | COMPLETE |
| 2         | Deep Analysis Types & Premium Gate      | backend + frontend | 5      | 10-14      | COMPLETE |
| 3         | Deep Analysis & Recommendation Services | backend-developer  | 5      | 16-20      | COMPLETE |
| 4         | Skill & Template Generation             | backend-developer  | 5      | 12-16      | COMPLETE |
| 5         | Frontend Wizard Enhancements            | frontend-developer | 4      | 10-14      | COMPLETE |
| 6         | Skill Optimization & Documentation      | either             | 4      | 8-12       | COMPLETE |
| 7         | Validation & Quality                    | backend-developer  | 4      | 6-10       | COMPLETE |
| **Total** |                                         |                    | **32** | **74-102** |          |

---

## Next Steps

1. ~~Orchestrator invokes backend-developer for Batch 1~~ COMPLETE (37727d8)
2. ~~Batch 2 (parallel backend + frontend)~~ COMPLETE (8a7081b)
   - Frontend: Tasks 2.1, 2.2 (premium gate)
   - Backend: Tasks 2.3, 2.4, 2.5 (deep analysis types)
3. ~~Batch 3 assigned to backend-developer~~ COMPLETE (60ad4d6)
   - Tasks 3.1-3.5: Deep analysis service, recommendation service, RPC handlers
4. ~~Batch 4 assigned to backend-developer~~ COMPLETE (cc2dbfa)
   - Tasks 4.1-4.5: Skill generator service, templates, reference files
5. ~~Batch 5 assigned to frontend-developer~~ COMPLETE (5e7ac61)
   - Tasks 5.1-5.4: Frontend wizard component enhancements
6. ~~Batch 6 assigned to backend-developer~~ COMPLETE (83150d5)
   - Tasks 6.1-6.4: Skill optimization and documentation updates
7. Batch 7 assigned to backend-developer - COMPLETE (13c4a92)
   - Tasks 7.1-7.4: Validation script, package.json, pre-commit hook, example traces
8. **ALL BATCHES COMPLETE** - Ready for QA phase
