# Requirements Document - TASK_2025_111

## Introduction

**Title**: MCP-Powered Setup Wizard & Orchestration Skill Enhancements

**Business Context**: The Ptah VS Code extension currently has a basic setup wizard that generates agent files, but it lacks deep project analysis capabilities and intelligent, project-specific customization. Additionally, the newly created orchestration skill (TASK_2025_110) has identified several enhancements that would significantly improve workflow automation, validation, and developer experience.

**Value Proposition**: This task transforms the setup wizard into an intelligent, MCP-powered configuration generator that deeply analyzes projects and produces tailored Claude orchestration configurations. Combined with orchestration skill enhancements, this delivers a comprehensive workflow automation system that adapts to each project's unique characteristics.

**Scope**: Two major components:

1. **Setup Wizard Enhancement** - MCP integration for deep project analysis and intelligent generation
2. **Orchestration Skill Enhancements** - MCP tools, adaptive selection, workspace intelligence, validation, and optimization

---

## Part 1: Setup Wizard Enhancement

### Requirement 1.1: Premium License Gating

**User Story**: As a Ptah extension user, I want the setup wizard to be available only to premium license holders, so that advanced orchestration setup is a premium feature that justifies the subscription value.

#### Acceptance Criteria

1. WHEN a user attempts to access the setup wizard THEN the system SHALL verify premium license status via `LicenseService.verifyLicense()` before proceeding
2. WHEN the license check fails or returns non-premium status THEN the wizard SHALL display a premium upsell component with feature benefits and upgrade CTA
3. WHEN the user has a valid premium license THEN the wizard SHALL proceed to the welcome step without obstruction
4. WHEN license verification fails due to network error THEN the system SHALL show a retry option with clear error messaging
5. WHEN in development mode THEN the system SHALL allow bypass via dev license flag for testing purposes

---

### Requirement 1.2: Deep Project Analysis via MCP

**User Story**: As a developer setting up Claude orchestration, I want the wizard to deeply analyze my project using Ptah MCP capabilities, so that the generated configurations are tailored to my specific codebase structure, patterns, and technologies.

#### Acceptance Criteria

1. WHEN the user proceeds to the scan step THEN the wizard SHALL invoke `ptah.workspace.getProjectInfo()` to retrieve basic project structure
2. WHEN scanning is in progress THEN the wizard SHALL invoke `ptah.workspace.analyzeArchitecture()` to detect architectural patterns (DDD, layered, microservices, etc.)
3. WHEN analyzing files THEN the wizard SHALL invoke `ptah.search.findFiles()` with patterns for key configuration files (`**/*.config.*`, `**/package.json`, `**/tsconfig.json`)
4. WHEN analyzing code structure THEN the wizard SHALL invoke `ptah.symbols.getWorkspaceSymbols()` to understand class/interface/function definitions
5. WHEN checking code health THEN the wizard SHALL invoke `ptah.diagnostics.getProblems()` to identify existing issues
6. WHEN all MCP calls complete successfully THEN the wizard SHALL aggregate results into a comprehensive `ProjectAnalysis` object containing:
   - Project type (Angular, React, Node.js, Python, etc.)
   - Detected frameworks and their versions
   - Architecture patterns identified
   - Key file locations (entry points, configs, test directories)
   - Monorepo structure (if applicable)
   - Language distribution statistics
   - Existing issues count by severity
7. WHEN any MCP call fails THEN the system SHALL retry up to 3 times with exponential backoff, then display a user-friendly error with manual retry option

---

### Requirement 1.3: Intelligent Agent Recommendation

**User Story**: As a developer, I want the wizard to recommend which agents are most relevant to my project type and structure, so that I generate only the configurations I need without manual guesswork.

#### Acceptance Criteria

1. WHEN project analysis completes THEN the wizard SHALL calculate relevance scores for all 13 agents based on:
   - Project type matching (e.g., frontend-developer for Angular/React)
   - Detected patterns (e.g., devops-engineer for projects with CI/CD configs)
   - Monorepo presence (e.g., team-leader highly relevant for monorepos)
   - Existing test coverage (e.g., senior-tester if low test file ratio)
2. WHEN displaying agent selection THEN the wizard SHALL show agents sorted by relevance score with "Recommended" badges for scores above 75%
3. WHEN the user views agent details THEN the wizard SHALL show why each agent is recommended based on detected project characteristics
4. WHEN pre-selecting agents THEN the wizard SHALL auto-select agents with scores above 80% while allowing user override
5. WHEN no agents score above 50% for a category THEN the wizard SHALL display that category as "Optional" rather than hiding it

---

### Requirement 1.4: All 13 Agent Template Generation

**User Story**: As a developer, I want the wizard to generate all 13 agent template files with project-specific customizations, so that my Claude orchestration is fully configured without manual file creation.

#### Acceptance Criteria

1. WHEN generating agent files THEN the wizard SHALL create customized templates for all 13 agents:
   - project-manager (with project-specific requirements patterns)
   - software-architect (with detected architecture patterns)
   - team-leader (with batching strategy for project structure)
   - backend-developer (with detected backend framework patterns)
   - frontend-developer (with detected UI framework patterns)
   - devops-engineer (with CI/CD patterns for detected tooling)
   - senior-tester (with testing framework patterns)
   - code-style-reviewer (with ESLint/Prettier configs)
   - code-logic-reviewer (with domain-specific logic patterns)
   - researcher-expert (with project stack research context)
   - modernization-detector (with upgrade opportunity context)
   - ui-ux-designer (with design system patterns)
   - technical-content-writer (with documentation patterns)
2. WHEN generating each agent THEN the wizard SHALL embed project-specific context including:
   - Project type and detected frameworks
   - Key directory structure (libs/, apps/, src/)
   - Naming conventions discovered from codebase
   - File patterns for the agent's domain
3. WHEN using `ptah.ai.generateContent()` THEN the wizard SHALL pass the full project analysis context for intelligent customization
4. WHEN writing files THEN the wizard SHALL create `.claude/agents/{agent-name}.md` with proper frontmatter format

---

### Requirement 1.5: Command and Skill Generation

**User Story**: As a developer, I want the wizard to generate orchestration commands and the orchestration skill, so that I have a complete Claude Code automation setup without manual configuration.

#### Acceptance Criteria

1. WHEN generating commands THEN the wizard SHALL create `.claude/commands/orchestrate.md` that invokes the orchestration skill
2. WHEN generating commands THEN the wizard SHALL create review commands:
   - `.claude/commands/review-code.md`
   - `.claude/commands/review-logic.md`
   - `.claude/commands/review-security.md`
3. WHEN generating the orchestration skill THEN the wizard SHALL copy the complete skill structure from templates:
   - `.claude/skills/orchestration/SKILL.md`
   - `.claude/skills/orchestration/references/*.md` (6 reference files)
4. WHEN generating skill files THEN the wizard SHALL customize references with project-specific information:
   - Agent catalog with project context
   - Strategy recommendations based on project type
   - Task tracking paths matching project structure
5. WHEN files already exist THEN the wizard SHALL prompt user for overwrite confirmation with diff preview option

---

### Requirement 1.6: Generation Progress and Error Handling

**User Story**: As a developer running the wizard, I want to see real-time progress during generation with clear error handling, so that I understand what's happening and can recover from failures.

#### Acceptance Criteria

1. WHEN generation starts THEN the wizard SHALL display a progress list showing each file being generated
2. WHEN each file generation completes THEN the wizard SHALL update the progress item with success checkmark and file path
3. WHEN a generation fails THEN the wizard SHALL display error details with retry button for that specific file
4. WHEN retrying THEN the wizard SHALL retry only failed files without regenerating successful ones
5. WHEN all generations complete THEN the wizard SHALL show summary statistics:
   - Total files generated
   - Total time elapsed
   - Any warnings or skipped files
6. WHEN network timeout occurs during MCP calls THEN the system SHALL handle gracefully with user notification

---

### Requirement 1.7: Wizard Completion and Quick Start

**User Story**: As a developer who completed the wizard, I want a clear summary of what was generated and how to start using it, so that I can immediately begin using Claude orchestration.

#### Acceptance Criteria

1. WHEN wizard completes THEN the completion step SHALL display:
   - List of all generated files organized by category (agents, commands, skills)
   - Quick start guide with example commands (`/orchestrate implement user auth`)
   - Link to orchestration skill documentation
2. WHEN user clicks "Open Files" THEN the wizard SHALL open the `.claude/` directory in VS Code explorer
3. WHEN user clicks "Test Orchestration" THEN the wizard SHALL launch a new chat session with a sample orchestrate command
4. WHEN user clicks "Close" THEN the wizard SHALL return to the main chat view with a success toast notification

---

## Part 2: Orchestration Skill Enhancements

### Requirement 2.1: MCP Tool Integration for Workflow State (HIGH Priority)

**User Story**: As a Claude Code agent operating within an orchestration workflow, I want explicit MCP tools for workflow state management, so that workflow state persists correctly and continuation is reliable.

#### Acceptance Criteria

1. WHEN the orchestration skill needs to track state THEN it SHALL have access to `ptah.orchestration.getState(taskId)` MCP tool returning:
   - Current phase (planning, design, implementation, qa, complete)
   - Current agent
   - Last checkpoint status
   - Pending actions
2. WHEN the orchestration skill updates state THEN it SHALL use `ptah.orchestration.setState(taskId, state)` to persist:
   - Phase transitions
   - Agent completions
   - Checkpoint results
3. WHEN continuing a workflow THEN `ptah.orchestration.getNextAction(taskId)` SHALL return:
   - Next agent to invoke
   - Context to pass
   - Required inputs
4. WHEN state operations fail THEN the MCP tools SHALL return structured errors with recovery suggestions
5. WHEN implementing these tools THEN they SHALL be created in `libs/backend/vscode-lm-tools/src/lib/tools/orchestration-tools.ts`

---

### Requirement 2.2: Adaptive Strategy Selection (HIGH Priority)

**User Story**: As an orchestrator, I want strategy selection to use confidence-based analysis rather than simple keyword matching, so that complex tasks are routed to the most appropriate workflow.

#### Acceptance Criteria

1. WHEN analyzing a task for strategy selection THEN the system SHALL evaluate multiple factors:
   - Keywords in request (current behavior, weighted 30%)
   - Files likely affected via semantic analysis (weighted 25%)
   - Complexity score from code analysis (weighted 25%)
   - Recent task patterns from history (weighted 20%)
2. WHEN calculating strategy confidence THEN each strategy SHALL receive a confidence score 0-100
3. WHEN confidence score is below 70% for all strategies THEN the system SHALL ask user for clarification with top 2 strategy suggestions
4. WHEN multiple strategies have similar scores (within 10 points) THEN the system SHALL present options to user with rationale
5. WHEN updates are applied THEN they SHALL modify `.claude/skills/orchestration/SKILL.md` Workflow Selection Matrix section

---

### Requirement 2.3: Workspace Intelligence Integration (HIGH Priority)

**User Story**: As an orchestrator initiating a workflow, I want automatic integration with workspace-intelligence library during Phase 0, so that task context includes accurate affected library detection and complexity estimation.

#### Acceptance Criteria

1. WHEN initializing a new task (Phase 0) THEN the orchestrator SHALL invoke workspace-intelligence to:
   - Auto-detect affected libraries for feature requests
   - Recommend frontend vs backend developer based on file patterns
   - Estimate complexity from code analysis (lines of code, dependency depth)
2. WHEN creating context.md THEN the orchestrator SHALL include:
   - Affected libraries list with confidence scores
   - Suggested primary developer type
   - Complexity estimate (Simple/Medium/Complex) with justification
3. WHEN detected complexity differs from user expectation THEN the orchestrator SHALL notify user with analysis rationale
4. WHEN workspace-intelligence is unavailable THEN the system SHALL fall back to keyword-based analysis with degraded accuracy warning

---

### Requirement 2.4: Automated Skill Validation (HIGH Priority)

**User Story**: As a maintainer of the orchestration skill, I want automated validation that ensures skill integrity, so that errors are caught before they cause workflow failures.

#### Acceptance Criteria

1. WHEN the validation script runs THEN it SHALL check:
   - Syntax validation (all markdown files parseable)
   - Reference validation (all internal links point to existing files)
   - Content validation (all 6 strategies documented, all 13 agents present)
   - Consistency validation (invocation patterns match agent-catalog.md)
2. WHEN validation finds errors THEN it SHALL report:
   - File path with error
   - Error type and description
   - Suggested fix where possible
3. WHEN validation passes THEN it SHALL output success summary with statistics
4. WHEN implemented THEN validation script SHALL be at `scripts/validate-orchestration-skill.ts`
5. WHEN configured THEN `.husky/pre-commit` SHALL run validation for `.claude/skills/**` changes

---

### Requirement 2.5: Progressive Reference Loading Optimization (HIGH Priority)

**User Story**: As a user of the orchestration skill, I want the SKILL.md to be optimized for progressive loading, so that Claude Code loads only essential content initially and references as needed.

#### Acceptance Criteria

1. WHEN auditing SKILL.md THEN the optimizer SHALL identify content that duplicates reference files
2. WHEN optimizing THEN SKILL.md line count SHALL reduce from current ~398 lines to target <300 lines
3. WHEN content is removed from SKILL.md THEN it SHALL be replaced with explicit reference pointers: "See [reference-file.md] for details"
4. WHEN optimization completes THEN all essential quick-reference content SHALL remain in SKILL.md:
   - Quick Start section
   - Strategy Quick Reference table
   - Core Orchestration Loop summary
   - Reference Index
5. WHEN loading the skill THEN Claude Code SHALL load SKILL.md body only, with references loaded on-demand

---

### Requirement 2.6: Agent Capability Matrix (MEDIUM Priority)

**User Story**: As a user deciding which agent to invoke, I want a comparative matrix showing agent capabilities, so that I can quickly identify which agent handles what type of work.

#### Acceptance Criteria

1. WHEN viewing agent-catalog.md THEN it SHALL include a capability matrix showing:
   - Write Code capability (backend-developer, frontend-developer, devops-engineer)
   - Design capability (software-architect, ui-ux-designer)
   - Review capability (code-style-reviewer, code-logic-reviewer, senior-tester)
   - Plan capability (project-manager, team-leader)
   - Research capability (researcher-expert, modernization-detector)
   - Content capability (technical-content-writer)
2. WHEN matrix is displayed THEN each capability SHALL show primary (P) and secondary (S) indicators
3. WHEN agent selection is needed THEN users SHALL reference matrix for quick decision-making

---

### Requirement 2.7: Agent Profile Standardization (MEDIUM Priority)

**User Story**: As a user invoking agents, I want all agent profiles to follow a consistent structure, so that I know exactly what inputs are needed and outputs to expect.

#### Acceptance Criteria

1. WHEN updating agent profiles THEN each SHALL include standardized sections:
   - Role (one-line description)
   - Triggers (when to use this agent)
   - Inputs (required context/files)
   - Outputs (deliverables produced)
   - Dependencies (agents that must run before)
   - Parallel With (agents that can run concurrently)
   - Invocation Example (complete Task call)
2. WHEN standardizing THEN agent-catalog.md profiles SHALL match `.claude/agents/*.md` profiles
3. WHEN profile sections are missing THEN validation script SHALL flag as error (Requirement 2.4)

---

### Requirement 2.8: Skill Composition Support (MEDIUM Priority)

**User Story**: As a subagent encountering a blocking issue during implementation, I want to invoke a minimal orchestration workflow, so that I can resolve blockers without manual intervention.

#### Acceptance Criteria

1. WHEN a subagent discovers a blocking issue THEN it SHALL have option to invoke minimal orchestration:
   - Research-only workflow for technical unknowns
   - Quick-fix workflow for discovered bugs
2. WHEN subagent invokes orchestration THEN work SHALL happen in parent task folder (no nesting)
3. WHEN sub-orchestration completes THEN control SHALL return to original subagent with resolution context
4. WHEN documenting THEN SKILL.md SHALL include "Subagent Orchestration" section explaining patterns

---

### Requirement 2.9: Parallel Agent Execution Optimization (MEDIUM Priority)

**User Story**: As an orchestrator, I want to run independent agents in parallel, so that workflow execution time is reduced when agents don't depend on each other.

#### Acceptance Criteria

1. WHEN executing FEATURE strategy THEN researcher-expert and ui-ux-designer SHALL run in parallel when both are needed
2. WHEN executing QA phase THEN all selected QA agents SHALL run in parallel (senior-tester, code-style-reviewer, code-logic-reviewer)
3. WHEN any parallel agent fails THEN other parallel agents SHALL continue, with failure reported at sync point
4. WHEN documenting THEN strategies.md SHALL clearly mark which agents can run in parallel with `[parallel]` notation

---

### Requirement 2.10: Strategy Test Suite (MEDIUM Priority)

**User Story**: As a skill maintainer, I want automated tests for each strategy flow, so that regressions are caught before affecting users.

#### Acceptance Criteria

1. WHEN test suite runs THEN it SHALL validate each of the 6 strategies:
   - FEATURE, BUGFIX, REFACTORING, DOCUMENTATION, RESEARCH, DEVOPS
2. WHEN testing a strategy THEN it SHALL verify:
   - Correct phase sequence execution
   - Correct agents invoked per phase
   - Correct checkpoints presented
   - Correct state transitions
3. WHEN test fails THEN it SHALL report which assertion failed with expected vs actual
4. WHEN test scenarios are stored THEN they SHALL be in `task-tracking/test-scenarios/` directory

---

### Requirement 2.11: Checkpoint Customization (LOW Priority)

**User Story**: As a power user, I want to customize which checkpoints require manual approval, so that I can streamline workflows for trusted patterns.

#### Acceptance Criteria

1. WHEN user opts in to checkpoint customization THEN they SHALL be able to auto-approve:
   - PM requirements for simple tasks
   - Architect plans for routine work
2. WHEN checkpoint is auto-approved THEN system SHALL log the auto-approval for audit
3. WHEN auto-approve is enabled THEN user SHALL be able to disable per-workflow with `--manual-approve` flag
4. WHEN documenting THEN checkpoints.md SHALL include customization instructions

---

### Requirement 2.12: Workflow Telemetry (LOW Priority)

**User Story**: As a team lead, I want workflow execution metrics tracked, so that I can identify bottlenecks and improvement opportunities.

#### Acceptance Criteria

1. WHEN workflow executes THEN telemetry SHALL track:
   - Strategy used
   - Agent durations (start to completion)
   - Failure points (which agent, which phase)
   - Validation/rejection counts
2. WHEN telemetry is saved THEN it SHALL be in `task-tracking/TASK_[ID]/telemetry.json`
3. WHEN aggregating metrics THEN system SHALL produce summary statistics per strategy

---

### Requirement 2.13: Example Workflow Traces (LOW Priority)

**User Story**: As a new user learning orchestration, I want complete workflow trace examples, so that I understand how workflows execute from start to finish.

#### Acceptance Criteria

1. WHEN documentation is added THEN it SHALL include complete traces for:
   - FEATURE workflow (feature-trace.md)
   - BUGFIX workflow (bugfix-trace.md)
   - CREATIVE workflow (creative-trace.md)
2. WHEN traces are written THEN each SHALL show:
   - User command that initiated workflow
   - Each agent invocation with prompt
   - Each checkpoint and user response
   - Final output and summary
3. WHEN stored THEN traces SHALL be in `.claude/skills/orchestration/examples/`

---

### Requirement 2.14: Reference File Consolidation (LOW Priority)

**User Story**: As a skill maintainer, I want reference files consolidated where overlap exists, so that maintenance burden is reduced and consistency improved.

#### Acceptance Criteria

1. WHEN analyzing for consolidation THEN potential merges SHALL be evaluated:
   - `team-leader-modes.md` + `task-tracking.md` -> `development-workflow.md`
   - `checkpoints.md` + `git-standards.md` -> `validation-reference.md`
2. WHEN consolidation occurs THEN all internal references SHALL be updated
3. WHEN consolidation reduces total reference files THEN it SHALL NOT reduce information content
4. WHEN merged THEN new files SHALL have clear section organization

---

## Non-Functional Requirements

### Performance Requirements

1. **Wizard Scan Speed**: Project analysis SHALL complete within 30 seconds for workspaces up to 10,000 files
2. **Generation Speed**: All 13 agent files SHALL generate within 60 seconds using MCP
3. **MCP Response Time**: Individual MCP calls SHALL respond within 5 seconds, with 15-second timeout
4. **Memory Usage**: Wizard SHALL consume less than 100MB additional memory during scanning
5. **UI Responsiveness**: Progress updates SHALL render within 100ms of backend event

### Security Requirements

1. **License Verification**: Premium checks SHALL occur server-side, not bypass-able via client modification
2. **File Write Safety**: Generated files SHALL NOT overwrite without explicit user confirmation
3. **MCP Sandboxing**: All MCP code execution SHALL remain within VS Code sandbox constraints
4. **Credential Handling**: No API keys or secrets SHALL be embedded in generated files

### Reliability Requirements

1. **Retry Logic**: All network operations SHALL retry up to 3 times with exponential backoff
2. **Partial Failure Recovery**: If 1 agent generation fails, others SHALL still succeed
3. **State Persistence**: Wizard state SHALL survive VS Code window reload
4. **Graceful Degradation**: If MCP unavailable, wizard SHALL offer basic (non-intelligent) generation

### Maintainability Requirements

1. **Template Modularity**: Each agent template SHALL be independently updatable
2. **Skill Versioning**: Orchestration skill SHALL include version number for compatibility tracking
3. **Validation Automation**: All skill changes SHALL pass automated validation before commit

---

## Stakeholder Analysis

### Primary Stakeholders

| Stakeholder       | Impact Level | Involvement                    | Success Criteria                      |
| ----------------- | ------------ | ------------------------------ | ------------------------------------- |
| Premium Users     | High         | Primary users of wizard        | Successful setup in < 5 minutes       |
| Claude Code Users | High         | End users of generated configs | Workflows execute correctly           |
| Development Team  | High         | Implementation                 | Clean architecture, maintainable code |

### Secondary Stakeholders

| Stakeholder  | Impact Level | Involvement     | Success Criteria                        |
| ------------ | ------------ | --------------- | --------------------------------------- |
| Support Team | Medium       | Troubleshooting | Clear error messages, debuggable issues |
| QA Team      | Medium       | Testing         | Comprehensive test coverage             |
| Product Team | Medium       | Requirements    | Feature aligns with product vision      |

---

## Risk Assessment

### Technical Risks

| Risk                                   | Probability | Impact | Mitigation                              | Contingency                                        |
| -------------------------------------- | ----------- | ------ | --------------------------------------- | -------------------------------------------------- |
| MCP API changes                        | Medium      | High   | Abstract MCP calls behind service layer | Fall back to direct file operations                |
| Token limit exceeded in generation     | Medium      | Medium | Chunk large contexts, summarize         | Use template-only generation (no AI customization) |
| Workspace-intelligence library gaps    | Low         | Medium | Early integration testing               | Add missing APIs as needed                         |
| Performance degradation on large repos | Medium      | Medium | Lazy loading, streaming, sampling       | Limit analysis scope with user control             |

### Business Risks

| Risk                           | Probability | Impact | Mitigation                            | Contingency                           |
| ------------------------------ | ----------- | ------ | ------------------------------------- | ------------------------------------- |
| Low premium conversion         | Medium      | Medium | Clear value demonstration in wizard   | Offer limited free tier functionality |
| User confusion with complexity | Low         | Medium | Progressive disclosure, good defaults | Simplified mode with fewer options    |

### Integration Risks

| Risk                                     | Probability | Impact | Mitigation                     | Contingency                          |
| ---------------------------------------- | ----------- | ------ | ------------------------------ | ------------------------------------ |
| Orchestration skill changes break wizard | Medium      | High   | Versioned skill templates      | Pin wizard to specific skill version |
| Template generation quality issues       | Medium      | Medium | Comprehensive template testing | Manual template editing as fallback  |

---

## Dependencies

### Internal Dependencies

| Dependency                          | Type     | Status      | Impact if Unavailable       |
| ----------------------------------- | -------- | ----------- | --------------------------- |
| TASK_2025_110 (Orchestration Skill) | Required | Complete    | Cannot generate skill files |
| TASK_2025_108 (Premium Enforcement) | Required | In Progress | License gating patterns     |
| workspace-intelligence library      | Required | Available   | MCP analysis fails          |
| vscode-lm-tools library             | Required | Available   | MCP execution fails         |
| agent-generation library            | Required | Available   | Template storage fails      |

### External Dependencies

| Dependency                     | Type     | Status | Impact if Unavailable     |
| ------------------------------ | -------- | ------ | ------------------------- |
| VS Code Extension API          | Required | Stable | Extension non-functional  |
| Claude API (for AI generation) | Optional | Stable | Fallback to template-only |

---

## Success Criteria Summary

### Part 1: Setup Wizard (Must Have)

- [ ] Premium license gating enforced on backend and frontend
- [ ] Deep project analysis via 5+ MCP namespace calls
- [ ] Intelligent agent recommendation with relevance scoring
- [ ] All 13 agent templates generated with project context
- [ ] Orchestration commands and skill generated
- [ ] Real-time progress with error recovery
- [ ] Completion summary with quick start guide

### Part 2: Orchestration Enhancements (Prioritized)

**HIGH Priority (Must Have)**

- [ ] MCP orchestration tools (`ptah.orchestration.*`) implemented
- [ ] Adaptive strategy selection with confidence scoring
- [ ] Workspace intelligence integration in Phase 0
- [ ] Automated skill validation script
- [ ] SKILL.md optimized to <300 lines

**MEDIUM Priority (Should Have)**

- [ ] Agent capability matrix in agent-catalog.md
- [ ] Standardized agent profiles
- [ ] Skill composition support for subagents
- [ ] Parallel agent execution optimization
- [ ] Strategy test suite

**LOW Priority (Nice to Have)**

- [ ] Checkpoint customization
- [ ] Workflow telemetry
- [ ] Example workflow traces
- [ ] Reference file consolidation

---

## Implementation Priority Order

1. **Phase 1 - Foundation** (HIGH Priority)

   - Premium license gating
   - MCP orchestration tools
   - Skill validation script

2. **Phase 2 - Wizard Core** (HIGH Priority)

   - Deep project analysis via MCP
   - Agent recommendation system
   - Template generation infrastructure

3. **Phase 3 - Intelligence** (HIGH Priority)

   - Adaptive strategy selection
   - Workspace intelligence integration
   - SKILL.md optimization

4. **Phase 4 - Generation** (Must Have)

   - All 13 agent generation
   - Command/skill generation
   - Progress UI

5. **Phase 5 - Quality** (MEDIUM Priority)

   - Agent capability matrix
   - Agent profile standardization
   - Parallel execution

6. **Phase 6 - Testing** (MEDIUM Priority)

   - Strategy test suite
   - Skill composition

7. **Phase 7 - Polish** (LOW Priority)
   - Checkpoint customization
   - Telemetry
   - Example traces
   - Reference consolidation

---

## Estimated Effort

| Phase                  | Effort Estimate  | Dependencies  |
| ---------------------- | ---------------- | ------------- |
| Phase 1 - Foundation   | 12-16 hours      | TASK_2025_108 |
| Phase 2 - Wizard Core  | 16-20 hours      | Phase 1       |
| Phase 3 - Intelligence | 12-16 hours      | Phase 1       |
| Phase 4 - Generation   | 12-16 hours      | Phases 2, 3   |
| Phase 5 - Quality      | 8-12 hours       | Phase 4       |
| Phase 6 - Testing      | 8-12 hours       | Phase 5       |
| Phase 7 - Polish       | 8-12 hours       | Phase 6       |
| **Total**              | **76-104 hours** |               |

---

## Files to Modify/Create

### Backend (libs/backend/)

**agent-generation/**

- `services/setup-wizard.service.ts` - MCP integration
- `services/content-generation.service.ts` - AI customization
- `templates/agents/*.template.md` - Verify all 13 exist
- `templates/commands/*.template.md` - Orchestration commands
- `templates/skills/orchestration/**` - Skill templates

**vscode-lm-tools/**

- NEW: `src/lib/tools/orchestration-tools.ts` - MCP state tools
- `src/lib/code-execution/ptah-api-builder.service.ts` - Add orchestration namespace

**workspace-intelligence/**

- Integration enhancements for Phase 0 analysis

### Frontend (libs/frontend/)

**setup-wizard/**

- `components/wizard-view.component.ts` - Premium gating
- `components/scan-progress.component.ts` - MCP-powered scanning
- `components/analysis-results.component.ts` - Rich analysis display
- `components/agent-selection.component.ts` - Smart recommendations
- `components/generation-progress.component.ts` - Enhanced progress
- `components/completion.component.ts` - Quick start guide
- `services/setup-wizard-state.service.ts` - Extended state
- `services/wizard-rpc.service.ts` - New MCP RPC calls

### Orchestration Skill (.claude/skills/orchestration/)

- `SKILL.md` - Optimization, new sections
- `references/agent-catalog.md` - Capability matrix, standardization
- `references/strategies.md` - Parallel notation
- `references/checkpoints.md` - Customization docs
- `references/task-tracking.md` - Workspace intelligence integration
- NEW: `examples/feature-trace.md`
- NEW: `examples/bugfix-trace.md`
- NEW: `examples/creative-trace.md`

### Scripts

- NEW: `scripts/validate-orchestration-skill.ts`
- `.husky/pre-commit` - Add validation hook

### Integration (apps/ptah-extension-vscode/)

- `services/rpc/handlers/setup-rpc.handlers.ts` - New handlers
- `services/rpc/handlers/orchestration-rpc.handlers.ts` - State handlers
