# Research Report - TASK_2025_058

# Intelligent Project-Adaptive Agent Generation System

**Classification**: STRATEGIC_ANALYSIS
**Confidence Level**: 90% (based on codebase analysis + VS Code LM API research)
**Created**: 2025-12-08
**Researcher**: researcher-expert

---

## 1. Executive Summary

### System Overview

The Intelligent Project-Adaptive Agent Generation System transforms Ptah from shipping hardcoded generic agents to dynamically generating project-specific agents tailored to each user's codebase. This meta-agent system leverages existing workspace-intelligence capabilities, VS Code LM API, and template-generation infrastructure to create a personalized `.claude/` folder during onboarding.

**Core Value Proposition**: Backend API developers get backend-focused agents. Angular developers get Angular-specific guidance. Nx monorepo teams get workspace-aware agents. All without manual configuration.

### Key Design Decisions

1. **Template Syntax**: Hybrid approach with `{{VAR}}` for variables, `<!-- STATIC -->` for protected sections, and `<!-- LLM:TOPIC -->` markers for AI-customized zones
2. **Agent Selection**: Relevance scoring algorithm (0-100) based on ProjectType, tech stack detection, and file pattern analysis
3. **LLM Quality Control**: Three-tier validation (schema, safety, factual accuracy) with automatic fallback to generic content
4. **Setup Wizard**: 6-step flow (2-4 minutes typical completion) with user preview/approval before generation
5. **Versioning**: Semantic versioning (MAJOR.MINOR.PATCH) with diff-based migration and user consent workflow

### Recommended Next Step

**BUILD PROOF OF CONCEPT (POC)** - 2-3 week scope to validate:

- Template format with 2 agents (backend-developer, orchestrate command)
- Basic LLM integration with quality validation
- Minimal setup wizard (3-step version)
- Agent selection algorithm with 3 test projects

**Rationale**: This system has moderate technical risk (LLM quality consistency, template format rigidity). A POC validates the approach before committing to 10-14 weeks of full implementation. The POC creates tangible artifacts for stakeholder evaluation and user testing.

**Success Criteria for POC**:

- Generated agents pass blind quality test vs hand-written agents (3/5 reviewers can't distinguish)
- Setup completes in <3 minutes for typical project
- Agent selection achieves >85% relevance accuracy

---

## 2. Template Format Specification

### Variable Syntax Design

**Chosen Approach**: Hybrid HTML comment + Handlebars style for compatibility with markdown rendering and clear visual separation.

```markdown
---
name: { { AGENT_NAME } }
description: { { AGENT_DESCRIPTION } }
generated: true
sourceTemplate: { { TEMPLATE_ID } }
sourceTemplateVersion: { { TEMPLATE_VERSION } }
generatedAt: { { TIMESTAMP } }
projectType: { { PROJECT_TYPE } }
---

# {{AGENT_TITLE}}

<!-- STATIC:START -->

You are a {{AGENT_ROLE}} who builds {{AGENT_FOCUS}}.

## CORE PRINCIPLES FOUNDATION

[Hardcoded best practices that never change]

<!-- STATIC:END -->

<!-- LLM:TECH_STACK_SPECIFICS -->

## Tech Stack Best Practices

{{FRAMEWORK_NAME}} specific guidance:

- [AI-generated based on detected framework]
- [Custom patterns from codebase analysis]
<!-- /LLM:TECH_STACK_SPECIFICS -->

<!-- VAR:PROJECT_STRUCTURE -->

## Your Project Structure

Detected architecture: {{ARCHITECTURE_PATTERN}}
Main directories: {{PRIMARY_SOURCE_DIRS}}

<!-- /VAR:PROJECT_STRUCTURE -->
```

### Section Types

| Section Type      | Syntax                                     | Modification Rules                               | Example                                         |
| ----------------- | ------------------------------------------ | ------------------------------------------------ | ----------------------------------------------- |
| **STATIC**        | `<!-- STATIC:ID -->...<!-- /STATIC:ID -->` | Never modified, protected from LLM               | Git conventions, SOLID principles               |
| **VARIABLE**      | `{{VAR_NAME}}`                             | Simple string substitution                       | `{{PROJECT_NAME}}`, `{{MAIN_BRANCH}}`           |
| **LLM-GENERATED** | `<!-- LLM:TOPIC -->...<!-- /LLM:TOPIC -->` | AI-customized content zone                       | Framework best practices, architecture patterns |
| **CONDITIONAL**   | `{{#if CONDITION}}...{{/if}}`              | Include/exclude based on project characteristics | `{{#if HAS_FRONTEND}}`, `{{#if IS_MONOREPO}}`   |

### YAML Frontmatter Schema

```yaml
# Required Fields
name: string # Agent identifier (kebab-case)
description: string # Brief description
generated: boolean # Always true for generated agents
sourceTemplate: string # Template ID (e.g., "backend-developer-v2")
sourceTemplateVersion: string # Semantic version (e.g., "2.1.0")
generatedAt: string # ISO 8601 timestamp
projectType: ProjectType # Enum value from workspace-intelligence

# Optional Fields
techStack: string[] # Detected technologies (e.g., ["Angular", "NestJS"])
architecture: string # Pattern detected (e.g., "Nx Monorepo", "Microservices")
applicabilityScore: number # Relevance score (0-100)
customizations: string[] # List of LLM-customized sections
variables: Record<string, any> # Variable values used in generation
```

### Template Examples

#### Example 1: backend-developer.template.md (Full Structure)

```markdown
---
# Template metadata (not in final output)
templateId: backend-developer-v2
templateVersion: 2.1.0
applicabilityRules:
  projectTypes: [Node, Python, Java, Go, DotNet, PHP, Ruby]
  requiredPatterns: ['**/controllers/**', '**/services/**', '**/models/**']
  excludePatterns: ['**/components/**', '**/views/**']
  minimumRelevanceScore: 60
dependencies: []
---

---

name: backend-developer
description: Backend Developer focused on {{PROJECT_TYPE}} with {{FRAMEWORK_NAME}}
generated: true
sourceTemplate: backend-developer-v2
sourceTemplateVersion: 2.1.0
generatedAt: {{TIMESTAMP}}
projectType: {{PROJECT_TYPE}}
techStack: {{TECH_STACK}}

---

# Backend Developer Agent - {{PROJECT_TYPE}} Edition

You are a Backend Developer who builds scalable, maintainable server-side systems for **{{PROJECT_NAME}}**.

<!-- STATIC:FILE_PATH_WARNING -->

## **IMPORTANT**: There's a file modification bug in Claude Code. The workaround is: always use complete absolute Windows paths with drive letters and backslashes for ALL file operations.

<!-- /STATIC:FILE_PATH_WARNING -->

<!-- STATIC:CORE_PRINCIPLES -->

## CORE PRINCIPLES FOUNDATION

**These principles apply to EVERY implementation. Non-negotiable.**

### SOLID Principles

[Full SOLID section - never changes]

<!-- /STATIC:CORE_PRINCIPLES -->

<!-- LLM:FRAMEWORK_SPECIFICS -->

## {{FRAMEWORK_NAME}} Best Practices

**Detected Framework**: {{FRAMEWORK_NAME}} {{FRAMEWORK_VERSION}}

### Framework-Specific Patterns

[AI-generated based on framework detection]

- Dependency injection patterns specific to {{FRAMEWORK_NAME}}
- Error handling conventions used in this codebase
- Testing approach based on detected test framework

### Project Architecture

Your codebase follows: {{ARCHITECTURE_PATTERN}}
[AI analyzes structure and generates architecture guidance]

<!-- /LLM:FRAMEWORK_SPECIFICS -->

<!-- VAR:PROJECT_CONTEXT -->

## Your Project Context

- **Project Type**: {{PROJECT_TYPE}}
- **Main Language**: {{PRIMARY_LANGUAGE}}
- **Source Directory**: {{SOURCE_DIR}}
- **Test Directory**: {{TEST_DIR}}
  {{#if IS_MONOREPO}}
- **Monorepo Tool**: {{MONOREPO_TYPE}}
- **Package Count**: {{PACKAGE_COUNT}}
{{/if}}
<!-- /VAR:PROJECT_CONTEXT -->

<!-- LLM:CONVENTIONS -->

## Detected Code Conventions

Based on analysis of your codebase:
[AI generates from actual code patterns]

- Naming conventions
- File organization patterns
- Import/module structure
- Error handling patterns
<!-- /LLM:CONVENTIONS -->

<!-- STATIC:ENFORCEMENT_RULES -->

## ENFORCEMENT RULES

[Hardcoded quality gates that never change]

<!-- /STATIC:ENFORCEMENT_RULES -->
```

#### Example 2: orchestrate.template.md (Abbreviated)

```markdown
---
templateId: orchestrate-command-v1
templateVersion: 1.0.0
applicabilityRules:
  projectTypes: [ALL]
  minimumRelevanceScore: 100 # Always included
---

---

name: orchestrate
description: Multi-phase development workflow for {{PROJECT_TYPE}} projects

---

# Orchestrate Development Workflow

<!-- STATIC:CORE_ORCHESTRATION -->

Multi-phase development workflow with dynamic strategies and user validation checkpoints.
[Core orchestration logic never changes]

<!-- /STATIC:CORE_ORCHESTRATION -->

<!-- VAR:PROJECT_PATHS -->

## Project Configuration

- **Task Tracking**: {{TASK_TRACKING_DIR}}
- **Branch Prefix**: {{BRANCH_PREFIX}}
  {{#if IS_MONOREPO}}
- **Workspace Root**: {{WORKSPACE_ROOT}}
{{/if}}
<!-- /VAR:PROJECT_PATHS -->

<!-- LLM:PROJECT_STRATEGIES -->

## Project-Specific Strategies

Based on your {{PROJECT_TYPE}} project:
[AI generates strategies tailored to project type]

<!-- /LLM:PROJECT_STRATEGIES -->
```

#### Other Required Templates (Reference List)

- `frontend-developer.template.md` - Conditional on HAS_FRONTEND
- `team-leader.template.md` - Always included
- `software-architect.template.md` - Always included
- `project-manager.template.md` - Always included
- `senior-tester.template.md` - Always included
- `code-style-reviewer.template.md` - Always included
- `code-logic-reviewer.template.md` - Always included
- `researcher-expert.template.md` - Always included
- `ui-ux-designer.template.md` - Conditional on HAS_FRONTEND
- `modernization-detector.template.md` - Always included

---

## 3. LLM Prompt Engineering

### Prompt Library (5 Key Prompts)

#### Prompt 1: Agent Customization (Core Prompt)

```typescript
const AGENT_CUSTOMIZATION_PROMPT = `You are an expert software development coach specializing in {{FRAMEWORK_NAME}}.

CONTEXT:
- Project Type: {{PROJECT_TYPE}}
- Framework: {{FRAMEWORK_NAME}} {{FRAMEWORK_VERSION}}
- Architecture: {{ARCHITECTURE_PATTERN}}
- Tech Stack: {{TECH_STACK_LIST}}

FILE SAMPLES:
{{FILE_SAMPLES}}

TASK:
Generate best practice guidance for the "{{SECTION_TOPIC}}" section of a development agent. This guidance will be used by an AI assistant helping developers work on THIS SPECIFIC PROJECT.

REQUIREMENTS:
1. Use concrete examples from the file samples provided
2. Reference actual patterns detected in this codebase
3. Be specific to {{FRAMEWORK_NAME}} - avoid generic advice
4. Keep recommendations under 500 words
5. Use bullet points for readability
6. Focus on patterns that already exist in this project

OUTPUT FORMAT:
Return ONLY the markdown content for this section. Do not include section headers or delimiters.

EXAMPLE OUTPUT:
- Use dependency injection via {{FRAMEWORK_NAME}}'s DI container, as seen in services/user.service.ts
- Follow the repository pattern established in data/ directory
- Error handling should use Result<T, E> pattern (detected in utils/result.ts)
`;
```

**Validation Rules**:

- Output length: 100-1000 words
- Must reference at least 1 actual file from project
- No code injection patterns (validated via regex)
- No external URLs or credentials
- Schema: Markdown with bullet points only

**Fallback Strategy**:

- If LLM fails: Use generic template content for that section
- If validation fails: Retry once with simplified prompt
- If retry fails: Use empty string (section becomes optional)

#### Prompt 2: Tech Stack Injection

```typescript
const TECH_STACK_PROMPT = `You are a technical documentation expert.

DETECTED TECHNOLOGIES:
{{TECH_STACK_JSON}}

TASK:
Generate a concise "Tech Stack Overview" section for a development agent. This helps the AI assistant understand the project's technology choices.

REQUIREMENTS:
1. Group by category (Frontend, Backend, Database, DevOps, Testing)
2. Include version numbers when available
3. Highlight unusual or advanced technologies
4. Keep under 200 words
5. Use a table format

OUTPUT FORMAT (markdown table):
| Category | Technologies | Notes |
|----------|--------------|-------|
| Backend | Node.js 20.x, NestJS 10.x | Uses DI pattern |
| Frontend | Angular 20+, Signals | Zoneless change detection |
`;
```

#### Prompt 3: Architecture Pattern Detection

```typescript
const ARCHITECTURE_PROMPT = `You are a software architect analyzing project structure.

PROJECT STRUCTURE:
{{DIRECTORY_TREE}}

MONOREPO INFO:
{{MONOREPO_DETAILS}}

TASK:
Identify the architecture pattern used in this project and generate guidance for maintaining consistency.

REQUIREMENTS:
1. Identify pattern: Layered, Hexagonal, Microservices, Monorepo, etc.
2. Explain how it's implemented in THIS project
3. Provide 3-5 rules for maintaining the pattern
4. Reference actual directory names from the structure
5. Keep under 300 words

OUTPUT FORMAT:
Architecture: [Pattern Name]

Implementation:
- [How it's structured in this project]

Maintenance Rules:
1. [Specific rule with directory references]
2. [...]
`;
```

#### Prompt 4: Code Convention Analysis

```typescript
const CONVENTION_PROMPT = `You are a code quality expert analyzing coding conventions.

CODE SAMPLES ({{LANGUAGE}}):
{{CODE_SAMPLES}}

TASK:
Extract coding conventions and style patterns from these samples.

REQUIREMENTS:
1. Naming conventions (camelCase, PascalCase, kebab-case usage)
2. File organization patterns
3. Import/export structure
4. Error handling patterns
5. Async patterns (promises vs async/await)
6. Keep under 250 words

OUTPUT FORMAT (bullet points):
Naming:
- Classes: PascalCase (e.g., UserService)
- Functions: camelCase (e.g., getUserById)
- Files: kebab-case (e.g., user-service.ts)

[Continue pattern...]
`;
```

#### Prompt 5: Quality Validation (Post-Generation)

```typescript
const VALIDATION_PROMPT = `You are a quality assurance expert reviewing AI-generated content.

GENERATED CONTENT:
{{GENERATED_SECTION}}

ORIGINAL PROJECT CONTEXT:
- Project Type: {{PROJECT_TYPE}}
- Framework: {{FRAMEWORK_NAME}}

VALIDATION CHECKLIST:
1. Does content reference actual files/patterns from the project?
2. Is guidance specific to {{FRAMEWORK_NAME}} (not generic)?
3. Are recommendations realistic and implementable?
4. Is the tone professional and helpful?
5. Are there any factual errors or hallucinations?

OUTPUT FORMAT (JSON):
{
  "isValid": boolean,
  "score": 0-100,
  "issues": ["issue1", "issue2"],
  "recommendations": ["fix1", "fix2"]
}
`;
```

### Validation Framework (Outline)

**Three-Tier Validation**:

1. **Tier 1: Schema Validation** (Immediate)

   - Markdown structure (headers, lists, code blocks)
   - Length constraints (min/max words)
   - Required elements present (e.g., bullet points)
   - No forbidden patterns (URLs, credentials, code injection)

2. **Tier 2: Safety Checks** (Fast)

   - No malicious code suggestions
   - No credential leaks (API keys, tokens, passwords)
   - No external resource references (CDNs, APIs)
   - Content moderation (profanity, bias)

3. **Tier 3: Factual Accuracy** (Slower)
   - File references exist in workspace
   - Framework versions match detected versions
   - Patterns mentioned exist in codebase
   - No contradictions with workspace analysis

### Fallback Strategies (Bullet Points)

- **LLM API Unavailable**: Use generic template sections, notify user of limited customization
- **Rate Limit Hit**: Queue remaining sections, process asynchronously, notify user
- **Quality Validation Fails**: Retry with simplified prompt (once), then fallback to generic
- **Partial Success**: Use successful sections, mark failed sections as "[Customize Later]"
- **Catastrophic Failure**: Abort generation, offer pre-built agent set, log for debugging

---

## 4. Agent Selection Logic

### Project Type → Agent Mapping

| Project Type       | Always Include                                                                                                                                                                                           | Conditional                                 | Never Include                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------- |
| **Node (Backend)** | backend-developer, team-leader, project-manager, software-architect, senior-tester, code-style-reviewer, code-logic-reviewer, researcher-expert, modernization-detector, orchestrate                     | -                                           | frontend-developer, ui-ux-designer                  |
| **Angular**        | frontend-developer, backend-developer, team-leader, project-manager, software-architect, senior-tester, code-style-reviewer, code-logic-reviewer, researcher-expert, modernization-detector, orchestrate | ui-ux-designer (if design system detected)  | -                                                   |
| **React**          | frontend-developer, backend-developer, team-leader, project-manager, software-architect, senior-tester, code-style-reviewer, code-logic-reviewer, researcher-expert, modernization-detector, orchestrate | ui-ux-designer (if design system detected)  | -                                                   |
| **Python**         | backend-developer, team-leader, project-manager, software-architect, senior-tester, code-style-reviewer, code-logic-reviewer, researcher-expert, modernization-detector, orchestrate                     | frontend-developer (if templates/ detected) | ui-ux-designer (unless Django/Flask with templates) |
| **Java/Go/.NET**   | backend-developer, team-leader, project-manager, software-architect, senior-tester, code-style-reviewer, code-logic-reviewer, researcher-expert, modernization-detector, orchestrate                     | -                                           | frontend-developer, ui-ux-designer                  |

### Relevance Scoring Algorithm (Pseudocode)

```typescript
interface AgentRelevanceScore {
  agentId: string;
  score: number; // 0-100
  reasons: string[];
  autoInclude: boolean;
}

function scoreAgentRelevance(agent: AgentTemplate, projectContext: ProjectContext): AgentRelevanceScore {
  let score = 0;
  const reasons: string[] = [];

  // Base score: Project type match (0-40 points)
  if (agent.applicabilityRules.projectTypes.includes(projectContext.type)) {
    score += 40;
    reasons.push(`Matches project type: ${projectContext.type}`);
  }

  // Tech stack match (0-30 points)
  const techStackMatches = agent.applicabilityRules.techStack.filter((tech) => projectContext.techStack.includes(tech));
  score += Math.min(30, techStackMatches.length * 10);
  if (techStackMatches.length > 0) {
    reasons.push(`Tech stack match: ${techStackMatches.join(', ')}`);
  }

  // File pattern match (0-20 points)
  const requiredPatterns = agent.applicabilityRules.requiredPatterns;
  const matchedPatterns = requiredPatterns.filter((pattern) => projectContext.fileIndex.some((file) => picomatch(pattern, file)));
  score += Math.min(20, (matchedPatterns.length / requiredPatterns.length) * 20);
  if (matchedPatterns.length > 0) {
    reasons.push(`File patterns found: ${matchedPatterns.length}/${requiredPatterns.length}`);
  }

  // Architecture match (0-10 points)
  if (agent.applicabilityRules.architecture === projectContext.architecture) {
    score += 10;
    reasons.push(`Architecture match: ${projectContext.architecture}`);
  }

  // Deductions for exclusion patterns (-50 points)
  const excludePatterns = agent.applicabilityRules.excludePatterns;
  const excludeMatches = excludePatterns.filter((pattern) => projectContext.fileIndex.some((file) => picomatch(pattern, file)));
  if (excludeMatches.length > 0) {
    score -= 50;
    reasons.push(`Exclusion patterns found: ${excludeMatches.join(', ')}`);
  }

  // Auto-include override
  const autoInclude = agent.applicabilityRules.alwaysInclude === true;
  if (autoInclude) {
    score = 100;
    reasons.push('Always included (core agent)');
  }

  return { agentId: agent.id, score: Math.max(0, score), reasons, autoInclude };
}

// Selection threshold
const INCLUSION_THRESHOLD = 50; // Agents with score >= 50 are included
```

### Example Test Cases

#### Test Case 1: Angular Nx Monorepo

```typescript
const projectContext = {
  type: ProjectType.Angular,
  techStack: ['Angular 20', 'NestJS', 'Nx', 'Jest', 'Cypress'],
  architecture: 'Nx Monorepo',
  fileIndex: ['apps/web/src/app/app.component.ts', 'apps/api/src/main.ts', 'libs/shared/ui/src/button.component.ts', 'nx.json', 'package.json'],
};

// Expected Results:
// frontend-developer: 100 (Angular + UI files)
// backend-developer: 90 (NestJS detected)
// team-leader: 100 (always include)
// ui-ux-designer: 70 (UI lib detected)
```

#### Test Case 2: Backend-Only Node.js API

```typescript
const projectContext = {
  type: ProjectType.Node,
  techStack: ['Express', 'PostgreSQL', 'Redis', 'Jest'],
  architecture: 'Layered Architecture',
  fileIndex: ['src/controllers/user.controller.js', 'src/services/user.service.js', 'src/repositories/user.repository.js', 'package.json'],
};

// Expected Results:
// frontend-developer: 0 (no UI files) - EXCLUDED
// backend-developer: 100 (perfect match)
// ui-ux-designer: 0 (no design files) - EXCLUDED
```

#### Test Case 3: Unknown/General Project

```typescript
const projectContext = {
  type: ProjectType.General,
  techStack: [],
  architecture: 'Unknown',
  fileIndex: ['README.md', 'main.py', 'requirements.txt'],
};

// Expected Results:
// All agents score 40-50 (minimal match)
// Fallback to core agent set (backend-developer, team-leader, orchestrate)
```

---

## 5. Setup Wizard UX

### 6-Step Flow (Textual Description)

**Step 1: Welcome Screen** (15 seconds)

- Headline: "Let's Personalize Your Ptah Experience"
- Explanation: "Ptah will analyze your project and generate AI agents tailored to your tech stack and architecture."
- Estimated time: "This usually takes 2-4 minutes"
- Action: "Start Setup" button

**Step 2: Workspace Scan** (30-90 seconds)

- Progress bar with file count: "Scanning files... 523/1247 analyzed"
- Live updates: "Detected Angular 20... Detected Nx Monorepo... Analyzing architecture..."
- Cancellation option: "Cancel Setup" (warning: can resume later)

**Step 3: Analysis Results** (Review, 30 seconds)

- Display detected characteristics:
  - Project Type: Angular
  - Tech Stack: Angular 20, NestJS, Nx, Jest, Cypress
  - Architecture: Nx Monorepo (12 packages)
- Confirmation: "Does this look correct?" [Yes] [No, let me adjust]

**Step 4: Agent Selection** (Review + Customize, 45 seconds)

- Table of agents with checkboxes (checked = will be generated):
  | Agent | Relevance | Reason |
  |-------|-----------|--------|
  | ✅ Frontend Developer | 100% | Angular detected |
  | ✅ Backend Developer | 90% | NestJS API found |
  | ⬜ UI/UX Designer | 70% | Shared UI library found |
  | ✅ Team Leader | 100% | Core orchestration |
- User can check/uncheck boxes
- Total: 8 agents selected
- Action: "Generate Agents" button

**Step 5: Customization Progress** (60-120 seconds)

- Per-agent progress:
  - ✅ Backend Developer (12s) - Customized with NestJS patterns
  - ⏳ Frontend Developer (in progress...)
  - ⏳ Team Leader (pending...)
- Live customization preview: "Learning your dependency injection patterns..."
- Cannot cancel once started (agents saved incrementally)

**Step 6: Completion** (Review + Next Steps)

- Success message: "Your Personalized Agents Are Ready!"
- Summary:
  - 8 agents generated
  - 3 commands customized
  - 1 workflow created
- Preview: Show `.claude/` folder structure
- Actions:
  - [Start Chatting] - Opens chat with agents available
  - [View Agents] - Opens `.claude/agents/` folder
  - [Regenerate Later] - Explains how to re-run setup
- Tip: "Try `/orchestrate` to start your first task with agent assistance"

### Key User Interactions (Bullet Points)

- **Cancellation (Steps 1-2)**: Safe exit with option to resume, no partial files written
- **Adjustment (Step 3)**: Manual project type selection, tech stack override
- **Agent Deselection (Step 4)**: Uncheck agents that aren't relevant
- **Progress Transparency (Step 5)**: Real-time updates, estimated time remaining
- **Preview Before Approval (Step 4)**: Users see exactly what will be generated

### Error UX (Brief Description)

**LLM API Failure**:

- Message: "Personalization is temporarily unavailable. We'll use standard agents for now."
- Action: [Continue with Standard Agents] [Retry Setup]
- Fallback: Generate agents without LLM customization (variable substitution only)

**Workspace Too Large**:

- Message: "Your workspace is very large (10,000+ files). Setup might take 5-10 minutes."
- Action: [Continue Anyway] [Skip Large Directories]
- Option: Exclude directories (node_modules, dist, .git already excluded)

**Partial Generation Failure**:

- Message: "We successfully generated 6 of 8 agents. 2 failed due to [reason]."
- Action: [Continue with 6 Agents] [Retry Failed Agents]
- Fallback: Use generic templates for failed agents

---

## 6. Versioning & Migration

### Versioning Scheme (Specification)

**Semantic Versioning for Templates**: `MAJOR.MINOR.PATCH`

- **MAJOR**: Breaking changes to template structure (requires regeneration)

  - Example: Changing section syntax from `{{LLM:X}}` to `[[AI:X]]`
  - User action required: Full regeneration with review

- **MINOR**: New sections added, enhanced LLM prompts (backward compatible)

  - Example: Adding new "Performance Best Practices" section
  - User action: Optional regeneration to get new sections

- **PATCH**: Typo fixes, prompt refinements (backward compatible)
  - Example: Improving LLM prompt quality, fixing typos
  - User action: Silent update (no regeneration needed)

**Version Tracking in Generated Agents**:

```yaml
---
sourceTemplate: backend-developer-v2
sourceTemplateVersion: 2.1.0
generatedAt: 2025-12-08T10:30:00Z
---
```

**Compatibility Matrix**:
| Template Version | SDK Version | Action Required |
|------------------|-------------|-----------------|
| 1.x.x → 2.0.0 | Any | Regenerate (breaking) |
| 2.0.0 → 2.1.0 | Any | Optional (new features) |
| 2.1.0 → 2.1.1 | Any | None (patch) |

### Migration Workflow (Flowchart as Text)

```
[Extension Startup]
  ↓
[Check .claude/agents/*.md for generated: true]
  ↓
[Read sourceTemplateVersion from each agent]
  ↓
[Compare with current template versions]
  ↓
┌─────────────────────────────┐
│ Are versions outdated?       │
└─────────────────────────────┘
  │                           │
  NO                         YES
  ↓                           ↓
[No action]              [Calculate update impact]
                              ↓
                         ┌────────────────────┐
                         │ Breaking changes?   │
                         └────────────────────┘
                           │               │
                          NO              YES
                           ↓               ↓
                    [Show notification] [Show warning]
                    "Updates available" "Breaking changes"
                           ↓               ↓
                    [User clicks]    [User clicks]
                           ↓               ↓
                    ┌─────────────────────────┐
                    │ Show diff preview modal │
                    │ - Old vs New sections   │
                    │ - Changelog summary     │
                    │ - User customizations   │
                    │   (highlighted)         │
                    └─────────────────────────┘
                           ↓
                    ┌─────────────────────────┐
                    │ User decision:          │
                    │ [Regenerate All]        │
                    │ [Regenerate Selected]   │
                    │ [Not Now]               │
                    │ [Never for This Agent]  │
                    └─────────────────────────┘
                           ↓
                    [Backup existing .claude/]
                           ↓
                    [Regenerate selected agents]
                           ↓
                    [Preserve user customizations]
                           ↓
                    [Write new agents]
                           ↓
                    [Update sourceTemplateVersion]
                           ↓
                    [Show success message]
```

### User Consent Approach

**Consent Levels**:

1. **Explicit Consent**: Required for MAJOR version updates (breaking changes)
2. **Opt-in Consent**: Default for MINOR updates (show notification, user clicks)
3. **Automatic**: PATCH updates (silent, no user action)

**User Control**:

- Settings: `ptah.agents.autoUpdate` (true/false)
- Settings: `ptah.agents.updateChannel` (stable/beta)
- Command: "Regenerate Agents" (manual trigger)
- Command: "Check for Agent Updates" (check without applying)

**Customization Preservation**:

- Detect user-modified agents: Compare against template + generated variables
- Highlight customizations in diff preview
- Offer merge strategies:
  - **Keep Mine**: Preserve user customizations, skip template updates
  - **Keep Theirs**: Accept all template changes, lose customizations
  - **Smart Merge**: Update STATIC sections, preserve customizations in LLM sections

---

## 7. Error Handling

### 5 Failure Modes (Table Format)

| Failure Mode                     | Detection                                                       | Mitigation                                                   | Fallback                                                                                              |
| -------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| **LLM API Unavailable**          | API request timeout (>30s) or 503 response                      | Retry 3x with exponential backoff (5s, 10s, 20s)             | Generate agents with variable substitution only (skip LLM customization), notify user                 |
| **Workspace Analysis Failure**   | ProjectDetector throws error or returns ProjectType.General     | Partial analysis: use successful detections, log failures    | Prompt user for manual project type selection, use minimal agent set (5 core agents)                  |
| **Template Rendering Error**     | Template syntax error (missing variable, malformed conditional) | Validate templates at build time, log error with template ID | Skip broken template, continue with remaining agents, show error summary                              |
| **File Write Permission Denied** | fs.writeFile throws EACCES error                                | Detect early with permission check before generation         | Prompt for alternative location (user home directory), offer manual copy/paste, save to temp location |
| **Partial LLM Success**          | Some sections generate successfully, others fail validation     | Process sections independently, mark failures                | Use generic content for failed sections, mark with `<!-- [Customize Later] -->`, log for retry        |

### Recovery Strategy (Brief)

**Circuit Breaker Pattern**:

- After 3 consecutive LLM failures, stop LLM requests for 5 minutes
- Switch to variable-substitution-only mode
- Notify user: "Customization temporarily disabled, using standard agents"
- Auto-resume after cooldown period

**Progressive Degradation**:

1. **Full Functionality**: LLM customization + variable substitution
2. **Degraded**: Variable substitution only (no LLM)
3. **Minimal**: Pre-built generic agents (no generation)

**Error Logging**:

- All failures logged with context: project type, template ID, LLM response
- Errors sent to telemetry (opt-in) for future improvements
- Local error log: `.ptah/generation-errors.log`

---

## 8. Architecture Design

### Component Diagram (ASCII Art)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Ptah Extension                            │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │         SetupWizardWebview (Frontend - Angular)          │   │
│  │  - WelcomeComponent                                      │   │
│  │  - ScanProgressComponent                                 │   │
│  │  │  - AnalysisResultsComponent                           │   │
│  │  - AgentSelectionComponent                               │   │
│  │  - GenerationProgressComponent                           │   │
│  │  - CompletionComponent                                   │   │
│  └────────────────────┬────────────────────────────────────┘   │
│                       │ RPC Messages                            │
│                       ↓                                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │       SetupOrchestratorService (Coordinator)             │   │
│  │  - orchestrateSetup()                                    │   │
│  │  - handleUserSelection()                                 │   │
│  │  - monitorProgress()                                     │   │
│  └──┬───┬───┬───┬───┬───┬──────────────────────────────────┘   │
│     │   │   │   │   │   │                                       │
│     ↓   ↓   ↓   ↓   ↓   ↓                                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Backend Services (DI Container)                           │  │
│  │                                                            │  │
│  │  ┌─────────────────────┐  ┌────────────────────────┐     │  │
│  │  │ WorkspaceAnalyzer   │  │ AgentSelector          │     │  │
│  │  │ (from workspace-    │  │ - scoreRelevance()     │     │  │
│  │  │  intelligence)      │  │ - selectAgents()       │     │  │
│  │  │ - detectProject()   │  │ - applyFilters()       │     │  │
│  │  │ - getTechStack()    │  └────────────────────────┘     │  │
│  │  └─────────────────────┘                                  │  │
│  │                                                            │  │
│  │  ┌─────────────────────┐  ┌────────────────────────┐     │  │
│  │  │ TemplateStorage     │  │ LLMCustomization       │     │  │
│  │  │ - loadTemplate()    │  │ - customizeSection()   │     │  │
│  │  │ - getVersion()      │  │ - validateOutput()     │     │  │
│  │  │ - listTemplates()   │  │ - batchProcess()       │     │  │
│  │  └─────────────────────┘  └────────────────────────┘     │  │
│  │                                  │                         │  │
│  │                                  ↓                         │  │
│  │  ┌─────────────────────┐  ┌────────────────────────┐     │  │
│  │  │ TemplateRenderer    │  │ FileWriter             │     │  │
│  │  │ (from template-     │  │ - writeAgent()         │     │  │
│  │  │  generation)        │  │ - backupExisting()     │     │  │
│  │  │ - renderTemplate()  │  │ - atomicWrite()        │     │  │
│  │  │ - substituteVars()  │  └────────────────────────┘     │  │
│  │  └─────────────────────┘                                  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ External Dependencies                                     │  │
│  │                                                            │  │
│  │  ┌──────────────────┐  ┌──────────────────────────┐      │  │
│  │  │ VS Code LM API   │  │ Template Assets          │      │  │
│  │  │ - lm.sendRequest │  │ - extension/templates/   │      │  │
│  │  │ - chat models    │  │   agents/*.template.md   │      │  │
│  │  └──────────────────┘  └──────────────────────────┘      │  │
│  └──────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

### Key Service Contracts (TypeScript Interfaces)

```typescript
// 1. SetupOrchestratorService - Main coordinator
interface ISetupOrchestratorService {
  /**
   * Orchestrates the entire setup workflow
   * @returns Result with generation summary or error
   */
  orchestrateSetup(options: SetupOptions): Promise<Result<GenerationSummary>>;

  /**
   * Resumes a previously cancelled setup
   */
  resumeSetup(sessionId: string): Promise<Result<GenerationSummary>>;
}

interface SetupOptions {
  workspaceUri: vscode.Uri;
  userSelections?: AgentSelection[]; // Pre-selected agents
  skipWizard?: boolean; // Headless mode
  progressCallback?: (progress: SetupProgress) => void;
}

interface GenerationSummary {
  successCount: number;
  failureCount: number;
  agents: GeneratedAgent[];
  errors: GenerationError[];
  duration: number; // milliseconds
}

// 2. AgentSelectionService - Relevance scoring
interface IAgentSelectionService {
  /**
   * Scores all available agent templates against project context
   * @returns Map of agent ID to relevance score
   */
  scoreAgents(projectContext: ProjectContext): Promise<Map<string, AgentRelevanceScore>>;

  /**
   * Selects agents above threshold, respecting user overrides
   */
  selectAgents(scores: Map<string, AgentRelevanceScore>, threshold: number, userOverrides?: AgentSelection[]): AgentTemplate[];
}

// 3. LLMCustomizationService - AI-powered customization
interface ILLMCustomizationService {
  /**
   * Customizes a template section using LLM
   * @returns Customized content or error
   */
  customizeSection(sectionTopic: string, projectContext: ProjectContext, fileSamples: string[]): Promise<Result<string>>;

  /**
   * Validates LLM output for quality and safety
   */
  validateOutput(content: string, validationRules: ValidationRules): Result<ValidationResult>;

  /**
   * Processes multiple sections in parallel
   */
  batchCustomize(sections: SectionRequest[], concurrency: number): Promise<Map<string, Result<string>>>;
}

// 4. TemplateStorageService - Template management
interface ITemplateStorageService {
  /**
   * Loads a template by ID
   */
  loadTemplate(templateId: string): Promise<Result<AgentTemplate>>;

  /**
   * Lists all available templates with metadata
   */
  listTemplates(filter?: TemplateFilter): Promise<AgentTemplate[]>;

  /**
   * Gets current version of a template
   */
  getVersion(templateId: string): Promise<Result<SemanticVersion>>;

  /**
   * Checks for template updates
   */
  checkUpdates(installedVersions: Map<string, SemanticVersion>): Promise<UpdateInfo[]>;
}
```

### Data Models (Core Interfaces Only)

```typescript
// 1. AgentTemplate - Template definition
interface AgentTemplate {
  id: string; // "backend-developer-v2"
  name: string; // "Backend Developer"
  description: string;
  version: SemanticVersion; // { major: 2, minor: 1, patch: 0 }
  content: string; // Template markdown with placeholders
  applicabilityRules: ApplicabilityRules;
  variables: VariableDefinition[];
  llmSections: LLMSectionDefinition[];
  dependencies: string[]; // Other template IDs
}

interface ApplicabilityRules {
  projectTypes: ProjectType[]; // [Node, Python, ...]
  techStack?: string[]; // ["NestJS", "Express"]
  architecture?: string; // "Nx Monorepo"
  requiredPatterns: string[]; // ["**/controllers/**"]
  excludePatterns: string[]; // ["**/components/**"]
  minimumRelevanceScore: number; // 60
  alwaysInclude?: boolean; // Core agents
}

// 2. ProjectContext - Workspace analysis results
interface ProjectContext {
  type: ProjectType;
  techStack: string[]; // ["Angular 20", "NestJS 10"]
  frameworks: FrameworkInfo[];
  architecture: string; // "Nx Monorepo"
  isMonorepo: boolean;
  monorepoType?: MonorepoType;
  fileIndex: string[]; // All file paths
  primaryLanguage: string;
  sourceDir: string;
  testDir?: string;
  packageCount?: number; // For monorepos
}

// 3. GeneratedAgent - Output of generation
interface GeneratedAgent {
  id: string; // Generated file name
  sourceTemplate: string;
  sourceTemplateVersion: SemanticVersion;
  content: string; // Final markdown
  variables: Record<string, any>; // Variables used
  customizations: CustomizationInfo[];
  generatedAt: Date;
  filePath: string; // Absolute path to .claude/agents/X.md
}

interface CustomizationInfo {
  section: string; // "TECH_STACK_SPECIFICS"
  method: 'llm' | 'variable' | 'static';
  duration: number; // Milliseconds
  success: boolean;
  error?: string;
}

// 4. ValidationResult - LLM output validation
interface ValidationResult {
  isValid: boolean;
  score: number; // 0-100 quality score
  issues: ValidationIssue[];
  warnings: string[];
}

interface ValidationIssue {
  type: 'schema' | 'safety' | 'factual';
  severity: 'error' | 'warning';
  message: string;
  suggestion?: string;
}
```

---

## 9. Risk Mitigation

### Top 5 Risks with Mitigation (Table Format)

| Risk                                        | Probability  | Impact   | Score | Mitigation Strategy                                                                                                                                                                                                                                                                                                       | Contingency Plan                                                                                                                                                      |
| ------------------------------------------- | ------------ | -------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LLM Quality Inconsistency**               | High (70%)   | Critical | 9/10  | - Extensive prompt engineering with 5 validated prompts<br>- Three-tier validation (schema, safety, factual)<br>- Blind quality testing (3/5 reviewers can't distinguish from hand-written)<br>- Fallback to generic content if validation fails<br>- User preview before applying                                        | Ship with pre-built agents + manual customization wizard if LLM approach fails. Defer LLM customization to Phase 2, ship Phase 1 with variable substitution only.     |
| **Template Format Rigidity**                | Medium (50%) | High     | 7/10  | - Prototype 3 syntax alternatives (HTML comments, Handlebars, custom)<br>- Test conversion of 5+ existing agents to templates<br>- Get feedback from template authors early<br>- Design extensible format (support nested sections, future syntax evolution)                                                              | Iteratively refine format across versions. Support multiple template format versions simultaneously. Provide migration tools for format updates.                      |
| **Workspace Analysis Blind Spots**          | Medium (40%) | High     | 6/10  | - Enhance workspace-intelligence with additional detectors (architecture patterns, conventions)<br>- Manual override UI for agent selection<br>- User review step before generation (Step 4)<br>- Learn from misclassifications via telemetry feedback loop<br>- Conservative selection (prefer inclusion over exclusion) | Manual selection UI as primary path. Reduce reliance on auto-detection. Offer "Custom Setup" mode where user configures all aspects.                                  |
| **User Resistance to AI-Generated Content** | Medium (40%) | High     | 6/10  | - Transparency (show what changed, why, in diff UI)<br>- User control (preview, approve, customize)<br>- Quality benchmarking (blind comparison tests with hand-written)<br>- Gradual rollout (opt-in beta, collect feedback)<br>- Clear labeling (`generated: true` in frontmatter)                                      | Keep existing hand-written agents as fallback. Make generation optional (opt-in feature). Offer both modes: "Quick Setup" (generated) and "Manual Setup" (pre-built). |
| **Performance at Scale**                    | Low (30%)    | Medium   | 4/10  | - Stream workspace analysis (async generators, don't load all files)<br>- Parallel LLM requests (5 concurrent)<br>- Timeout protections (30s per LLM request)<br>- Partial success mode (continue with successful agents)<br>- Performance testing with large monorepos (10k+ files)                                      | Manual mode for very large projects (>10k files). Offer cloud-based generation service (future). Allow selective generation (choose specific agents only).            |

---

## 10. Implementation Roadmap

### Recommended Next Step: BUILD PROOF OF CONCEPT (POC)

**Rationale**:
This system has **moderate-to-high technical risk** due to:

1. **LLM Quality Uncertainty**: No guarantee AI-generated content meets quality bar
2. **Template Format Unknown**: Need to validate syntax works for all agent types
3. **User Experience Unknown**: Will users trust and adopt generated agents?

A POC validates core assumptions before committing 10-14 weeks to full implementation. It creates:

- **Technical Proof**: Template format works, LLM quality acceptable
- **User Feedback**: Real users test and provide input
- **Risk Reduction**: Identifies blockers early
- **Stakeholder Confidence**: Tangible demo for decision-making

**POC Scope** (2-3 weeks):

**Week 1: Template Foundation**

- Convert 2 agents to templates: `backend-developer.template.md`, `orchestrate.template.md`
- Implement template syntax: `{{VAR}}`, `<!-- STATIC -->`, `<!-- LLM:TOPIC -->`
- Build TemplateStorageService (load, parse YAML frontmatter)
- Build TemplateRenderer (variable substitution only, no LLM yet)
- **Deliverable**: Templates render with variables, STATIC sections protected

**Week 2: LLM Integration + Agent Selection**

- Implement LLMCustomizationService (VS Code LM API integration)
- Create 2 prompts: Agent Customization, Tech Stack Injection
- Implement three-tier validation (schema, safety checks)
- Build AgentSelectionService (scoring algorithm)
- Test on 3 projects: Angular Nx, Node.js API, Python app
- **Deliverable**: 2 agents generate with LLM customization, selection works

**Week 3: Minimal Setup Wizard + Testing**

- Build 3-step wizard: Scan → Select → Generate
- Implement SetupOrchestratorService
- Add progress tracking
- User testing with 5 developers (blind quality test)
- Measure: generation time, quality score, user satisfaction
- **Deliverable**: End-to-end POC, user feedback report

**POC Success Criteria**:

- ✅ Generated agents pass blind quality test (3/5 reviewers can't distinguish from hand-written)
- ✅ Setup completes in <3 minutes for typical project
- ✅ Agent selection achieves >85% relevance accuracy (manual review)
- ✅ User satisfaction >4/5 (feedback survey)
- ✅ Zero critical bugs (crashes, data loss)

**POC Decision Gate**:

- **If POC succeeds**: Proceed to Phase 1 (full template library conversion)
- **If POC partially succeeds**: Iterate on specific issues, extend POC by 1 week
- **If POC fails**: Pivot to alternative approach (manual customization wizard, pre-built agent packs)

### Alternative: Start Phase 1 Implementation

**NOT RECOMMENDED** due to high uncertainty. Phase 1 (Template Foundation, 2-3 weeks) commits to full implementation without validating core assumptions. Risk of 4-6 weeks wasted if LLM quality or template format fails.

**Only choose Phase 1 if**:

- Stakeholders have very high confidence in approach
- User research shows strong demand for generated agents
- LLM quality validated through separate experiments

### Phase 1 Scope (If POC Succeeds)

**Duration**: 2-3 weeks
**Goal**: Production-ready template infrastructure

**Tasks**:

1. Convert all 11 agents to templates
2. Build template versioning system (semantic versioning)
3. Implement template storage with bundled assets
4. Create template metadata schema (ApplicabilityRules)
5. Write template authoring documentation
6. Build template validation CI pipeline
7. **Deliverable**: Full template library with versioning

### Success Criteria for POC/Phase 1

**Technical**:

- ✅ All agents convert to template format without loss of functionality
- ✅ Template rendering performance: <1s per agent (variable substitution)
- ✅ Template validation catches 100% of syntax errors at build time
- ✅ Generated agents load correctly in Claude SDK

**Quality**:

- ✅ Generated agent quality score >80/100 (via automated scoring)
- ✅ User satisfaction >4.5/5 (post-setup survey)
- ✅ Zero critical bugs in production

**Usability**:

- ✅ Setup wizard completion rate >90%
- ✅ User can complete setup without documentation
- ✅ Error messages are clear and actionable

---

## Research Artifacts

### Primary Sources

1. [VS Code Language Model API Documentation](https://code.visualstudio.com/api/extension-guides/ai/language-model) - Official API guide (2025)
2. [VS Code Language Model Tutorial](https://code.visualstudio.com/api/extension-guides/ai/language-model-tutorial) - Prompt engineering examples
3. Codebase Analysis:
   - `libs/backend/workspace-intelligence/` - Project detection (13 types), framework detection, monorepo detection (6 types)
   - `libs/backend/template-generation/` - Template rendering infrastructure (variable substitution, file management)
   - `.claude/agents/` - 11 existing agents for template conversion
   - `.claude/commands/orchestrate.md` - Command template example
4. [GitHub Copilot Extensions: LLM Integration](https://pascoal.net/2024/11/30/gh-copilot-extension-vscode-llm-integration/) - VS Code LLM best practices

### Secondary Sources

- OpenAI Prompt Engineering Guidelines (referenced by VS Code docs)
- Handlebars, Jinja2, Liquid template syntax (for syntax design comparison)
- Semantic Versioning Specification (semver.org)

### Raw Data

- **ProjectType Enum**: 13 types (Node, React, Vue, Angular, NextJS, Python, Java, Rust, Go, DotNet, PHP, Ruby, General)
- **MonorepoType Enum**: 6 types (Nx, Lerna, Rush, Turborepo, PnpmWorkspaces, YarnWorkspaces)
- **Agent Count**: 11 existing agents to convert
- **Workspace Intelligence Capabilities**: 40+ detection heuristics (package.json, tsconfig.json, nx.json, etc.)

---

## Knowledge Gaps Remaining

1. **LLM Prompt Effectiveness**: Need empirical testing to determine optimal prompt length, structure, and validation thresholds
2. **User Trust Factors**: Unknown which transparency mechanisms (diff UI, changelog, preview) most impact user adoption
3. **Template Maintenance Burden**: Unclear how much effort is required to keep 11+ templates updated as frameworks evolve
4. **Performance at Scale**: Need real-world testing with 10k+ file monorepos to measure actual generation time
5. **Cross-Language Support**: Workspace-intelligence has strong Node.js/TypeScript detection, but Python/Java/Go detection less mature

---

## Recommended Next Steps

### Immediate Actions (This Week)

1. **POC Kickoff Meeting** - Review this research report with team, confirm POC scope
2. **User Research** - Conduct 5 interviews with Ptah users to validate assumptions about generated agents
3. **Template Prototype** - Convert 1 agent (backend-developer) to template format, test syntax
4. **LLM Experiment** - Run 10 test prompts through VS Code LM API, measure quality and latency

### POC Execution (Weeks 2-4)

1. Implement minimal viable template system
2. Integrate VS Code LM API with validation
3. Build 3-step setup wizard
4. Test with 3 diverse projects
5. Conduct blind quality testing (5 developers)
6. **Decision Gate**: Proceed, iterate, or pivot

### Phase 1 (If POC Succeeds)

1. Full template library conversion
2. Complete setup wizard (6 steps)
3. Template versioning system
4. Production deployment

---

## Output Artifacts

**Generated Files**:

- ✅ `task-tracking/TASK_2025_058/research-report.md` (this document)

**Next Agent**: software-architect

**Architect Focus Areas**:

1. **Component Architecture**: Design SetupOrchestratorService, AgentSelectionService, LLMCustomizationService with DI integration
2. **Service Interaction Flows**: Diagram SetupWizard → Orchestrator → WorkspaceAnalyzer → AgentSelector → LLMCustomization → TemplateRenderer → FileWriter
3. **Data Models**: Define AgentTemplate, ProjectContext, GeneratedAgent, ValidationResult with type-safe interfaces
4. **Integration Points**: VS Code LM API wrapper, workspace-intelligence library usage, template-generation library enhancement
5. **Testing Strategy**: Unit tests (service isolation), integration tests (end-to-end generation), LLM mocking approach

---

## Appendix: Alternative Syntax Evaluations

### Syntax Option 1: HTML Comments (CHOSEN)

**Pros**:

- Markdown-compatible (renders correctly in preview)
- Clear visual separation
- Easy to parse with regex
- Supports nested sections

**Cons**:

- Verbose for simple variables
- Could conflict with actual HTML comments

**Example**:

```markdown
<!-- STATIC:PRINCIPLES -->

## Core Principles

<!-- /STATIC:PRINCIPLES -->

<!-- LLM:TECH_STACK -->

{{GENERATED_CONTENT}}

<!-- /LLM:TECH_STACK -->
```

### Syntax Option 2: Handlebars-Style (CHOSEN FOR VARIABLES)

**Pros**:

- Familiar to developers (widely used)
- Supports conditionals (`{{#if}}`)
- Compact for variables

**Cons**:

- Less clear for sections
- Requires parser library

**Example**:

```markdown
{{VARIABLE_NAME}}
{{#if CONDITION}}
Content
{{/if}}
```

### Syntax Option 3: Custom Delimiters

**Pros**:

- No conflicts with markdown
- Full control over syntax

**Cons**:

- Unfamiliar to developers
- More implementation work

**Example**:

```markdown
[[STATIC:ID]]
Content
[[/STATIC:ID]]

[[LLM:TOPIC]]
{{GENERATED}}
[[/LLM:TOPIC]]
```

**Decision**: Use hybrid approach (HTML comments for sections, Handlebars for variables) for maximum clarity and compatibility.

---

**END OF RESEARCH REPORT**
