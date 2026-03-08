# Implementation Plan - TASK_2025_111

## MCP-Powered Setup Wizard & Orchestration Skill Enhancements

---

## Codebase Investigation Summary

### Libraries Analyzed

| Library                               | Purpose                           | Key Patterns Discovered                                                             |
| ------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| `libs/backend/agent-generation`       | Wizard services, template storage | OrchestratorService (5-phase workflow), SetupWizardService, ITemplateStorageService |
| `libs/backend/vscode-lm-tools`        | MCP tools, Ptah API namespaces    | Namespace builder pattern, PtahAPI interface, 13 existing namespaces                |
| `libs/backend/workspace-intelligence` | Project analysis                  | WorkspaceAnalyzerService, ProjectDetectorService, ContextOrchestrationService       |
| `libs/frontend/setup-wizard`          | Wizard UI components              | 6-step wizard, SetupWizardStateService (signals), WizardRpcService                  |
| `.claude/skills/orchestration`        | Orchestration skill               | SKILL.md + 6 reference files, ~414 lines current                                    |

### Patterns Verified

**1. Namespace Builder Pattern** (Evidence: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/index.ts`)

- Each namespace has a dedicated builder function (e.g., `buildAINamespace`, `buildWorkspaceNamespace`)
- Builders accept dependency interfaces and return namespace objects
- Namespaces are combined in `ptah-api-builder.service.ts`

**2. RPC Handler Pattern** (Evidence: `apps/ptah-extension-vscode/src/services/rpc/handlers/`)

- Handlers grouped by domain (e.g., `chat-rpc.handlers.ts`, `setup-rpc.handlers.ts`)
- Use `@inject()` decorators from tsyringe
- Return `Result<T, Error>` for type-safe error handling

**3. Frontend State Management** (Evidence: `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts`)

- Signal-based state with `signal()` and `computed()`
- Step progression via `WizardStep` type
- `WizardRpcService` for extension communication

**4. Template Storage** (Evidence: `libs/backend/agent-generation/templates/`)

- Templates in `templates/agents/*.template.md` (11 agents verified)
- Templates in `templates/commands/*.template.md` (5 commands verified)
- Frontmatter-based metadata, variable interpolation

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         VS Code Extension Host                           │
├─────────────────────────────────────────────────────────────────────────┤
│  MCP Server Layer                                                        │
│  ├─ ptah.orchestration.* (NEW)                                           │
│  │   ├─ getState(taskId) → OrchestrationState                           │
│  │   ├─ setState(taskId, state) → void                                  │
│  │   └─ getNextAction(taskId) → NextAction                              │
│  └─ Existing namespaces (workspace, search, ai, etc.)                   │
├─────────────────────────────────────────────────────────────────────────┤
│  Agent Generation Library                                                │
│  ├─ SetupWizardService (ENHANCED)                                        │
│  │   ├─ Premium license verification                                     │
│  │   ├─ Deep project analysis via MCP                                    │
│  │   └─ Intelligent agent recommendation                                 │
│  ├─ SkillGeneratorService (NEW)                                          │
│  │   ├─ Generate .claude/skills/orchestration/**                         │
│  │   └─ Customize references with project context                        │
│  └─ Templates (13 agents + 5 commands + skill structure)                 │
├─────────────────────────────────────────────────────────────────────────┤
│  RPC Handlers                                                            │
│  ├─ SetupRpcHandlers (ENHANCED)                                          │
│  │   ├─ wizard:deep-analyze                                              │
│  │   ├─ wizard:recommend-agents                                          │
│  │   └─ wizard:generate-all                                              │
│  └─ OrchestrationRpcHandlers (NEW)                                       │
│      ├─ orchestration:get-state                                          │
│      ├─ orchestration:set-state                                          │
│      └─ orchestration:get-next-action                                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Webview (Angular SPA)                            │
├─────────────────────────────────────────────────────────────────────────┤
│  Setup Wizard UI                                                         │
│  ├─ Step 0: Premium Gate (NEW)                                           │
│  ├─ Step 1: Welcome                                                      │
│  ├─ Step 2: Deep Scan + MCP Analysis (ENHANCED)                          │
│  ├─ Step 3: Analysis Results + Recommendations (ENHANCED)                │
│  ├─ Step 4: Agent Selection with Scoring (ENHANCED)                      │
│  ├─ Step 5: Generation Progress (13 agents + skill)                      │
│  └─ Step 6: Completion with Quick Start                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  Services                                                                │
│  ├─ SetupWizardStateService (EXTENDED state)                             │
│  └─ WizardRpcService (NEW MCP-powered calls)                             │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Component Design

### 1. MCP Orchestration Namespace (Requirement 2.1)

**Purpose**: Provide state management tools for orchestration workflows.

**Pattern**: Namespace builder following existing conventions (Evidence: `system-namespace.builders.ts:128-751`)

**Types** (Add to `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts`):

```typescript
/**
 * Orchestration workflow state
 */
export interface OrchestrationState {
  taskId: string;
  phase: 'planning' | 'design' | 'implementation' | 'qa' | 'complete';
  currentAgent: string | null;
  lastCheckpoint: {
    type: 'requirements' | 'architecture' | 'batch-complete' | null;
    status: 'pending' | 'approved' | 'rejected';
    timestamp: string;
  };
  pendingActions: string[];
  strategy: string;
  metadata: Record<string, unknown>;
}

/**
 * Next action recommendation
 */
export interface OrchestrationNextAction {
  action: 'invoke-agent' | 'present-checkpoint' | 'complete';
  agent?: string;
  context?: Record<string, unknown>;
  requiredInputs?: string[];
  checkpointType?: string;
}

/**
 * Orchestration namespace for MCP
 */
export interface OrchestrationNamespace {
  getState: (taskId: string) => Promise<OrchestrationState | null>;
  setState: (taskId: string, state: Partial<OrchestrationState>) => Promise<void>;
  getNextAction: (taskId: string) => Promise<OrchestrationNextAction>;
}
```

**Implementation** (Create `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/orchestration-namespace.builder.ts`):

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import { OrchestrationNamespace, OrchestrationState, OrchestrationNextAction } from '../types';

export interface OrchestrationNamespaceDependencies {
  workspaceRoot: vscode.Uri;
}

export function buildOrchestrationNamespace(deps: OrchestrationNamespaceDependencies): OrchestrationNamespace {
  const { workspaceRoot } = deps;

  return {
    getState: async (taskId: string): Promise<OrchestrationState | null> => {
      // Read from task-tracking/TASK_XXX/.orchestration-state.json
      const statePath = vscode.Uri.joinPath(workspaceRoot, 'task-tracking', taskId, '.orchestration-state.json');

      try {
        const content = await vscode.workspace.fs.readFile(statePath);
        return JSON.parse(Buffer.from(content).toString('utf8'));
      } catch {
        return null;
      }
    },

    setState: async (taskId: string, state: Partial<OrchestrationState>): Promise<void> => {
      const statePath = vscode.Uri.joinPath(workspaceRoot, 'task-tracking', taskId, '.orchestration-state.json');

      let existing: OrchestrationState | null = null;
      try {
        const content = await vscode.workspace.fs.readFile(statePath);
        existing = JSON.parse(Buffer.from(content).toString('utf8'));
      } catch {
        // File doesn't exist, create new state
      }

      const newState: OrchestrationState = {
        taskId,
        phase: state.phase ?? existing?.phase ?? 'planning',
        currentAgent: state.currentAgent ?? existing?.currentAgent ?? null,
        lastCheckpoint: state.lastCheckpoint ?? existing?.lastCheckpoint ?? { type: null, status: 'pending', timestamp: '' },
        pendingActions: state.pendingActions ?? existing?.pendingActions ?? [],
        strategy: state.strategy ?? existing?.strategy ?? '',
        metadata: { ...existing?.metadata, ...state.metadata },
      };

      await vscode.workspace.fs.writeFile(statePath, Buffer.from(JSON.stringify(newState, null, 2)));
    },

    getNextAction: async (taskId: string): Promise<OrchestrationNextAction> => {
      // Implementation based on state and document analysis
      // See Requirement 2.3 for workspace intelligence integration
    },
  };
}
```

**Integration Point** (Modify `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`):

```typescript
// Add to PtahAPI interface
orchestration: OrchestrationNamespace;

// Add to buildAPI method
orchestration: buildOrchestrationNamespace({ workspaceRoot }),
```

**Files Affected**:

- `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts` (MODIFY)
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/orchestration-namespace.builder.ts` (CREATE)
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/index.ts` (MODIFY)
- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts` (MODIFY)

---

### 2. Premium License Gating (Requirement 1.1)

**Purpose**: Gate setup wizard access to premium license holders.

**Pattern**: Use existing LicenseService pattern (Evidence: TASK_2025_108 reference in task-description.md)

**Component Specification** (Modify `libs/frontend/setup-wizard/src/lib/components/wizard-view.component.ts`):

```typescript
// Add premium check before showing wizard
@Component({
  template: `
    @if (licenseState() === 'checking') {
    <div class="license-loading">Verifying license...</div>
    } @else if (licenseState() === 'invalid') {
    <ptah-premium-upsell [features]="premiumFeatures" />
    } @else {
    <!-- Existing wizard content -->
    }
  `,
})
export class WizardViewComponent {
  readonly licenseState = signal<'checking' | 'valid' | 'invalid'>('checking');

  readonly premiumFeatures = ['Deep project analysis via MCP', 'Intelligent agent recommendations', '13 customized agent templates', 'Orchestration skill generation'];

  constructor() {
    this.checkLicense();
  }

  private async checkLicense(): Promise<void> {
    const result = await this.rpc.callExtension('license:verify-premium');
    this.licenseState.set(result.success ? 'valid' : 'invalid');
  }
}
```

**Files Affected**:

- `libs/frontend/setup-wizard/src/lib/components/wizard-view.component.ts` (MODIFY)
- `libs/frontend/setup-wizard/src/lib/components/premium-upsell.component.ts` (CREATE)

---

### 3. Deep Project Analysis via MCP (Requirement 1.2)

**Purpose**: Analyze projects deeply using Ptah MCP capabilities.

**Pattern**: Extend existing `analyzeWorkspace` method in OrchestratorService (Evidence: `orchestrator.service.ts:377-466`)

**Service Specification** (Modify `libs/backend/agent-generation/src/lib/services/setup-wizard.service.ts`):

```typescript
export interface DeepProjectAnalysis {
  // Basic info (existing)
  projectType: ProjectType;
  frameworks: Framework[];
  monorepoType?: string;

  // Deep analysis (new via MCP)
  architecturePatterns: ArchitecturePattern[];
  keyFileLocations: KeyFileLocations;
  languageDistribution: LanguageStats[];
  existingIssues: DiagnosticSummary;
  codeConventions: CodeConventions;
  testCoverage: TestCoverageEstimate;
}

export interface ArchitecturePattern {
  name: string; // 'DDD', 'Layered', 'Microservices', 'Monolith'
  confidence: number; // 0-100
  evidence: string[]; // File patterns that indicate this
}

export interface KeyFileLocations {
  entryPoints: string[];
  configs: string[];
  testDirectories: string[];
  apiRoutes: string[];
  components: string[];
  services: string[];
}

@injectable()
export class SetupWizardService {
  async performDeepAnalysis(workspaceUri: vscode.Uri): Promise<Result<DeepProjectAnalysis, Error>> {
    // Step 1: Basic workspace analysis (existing)
    const basicResult = await this.workspaceAnalyzer.getProjectInfo();

    // Step 2: Architecture pattern detection via file structure
    const architecturePatterns = await this.detectArchitecturePatterns(workspaceUri);

    // Step 3: Find key configuration files
    const configFiles = await vscode.workspace.findFiles('**/*.config.{ts,js,json}', '**/node_modules/**', 50);

    // Step 4: Get workspace symbols for structure understanding
    const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', '');

    // Step 5: Get diagnostics for code health
    const diagnostics = vscode.languages.getDiagnostics();

    // Step 6: Aggregate into DeepProjectAnalysis
    return Result.ok({
      projectType: basicResult.type,
      frameworks: this.detectFrameworks(basicResult),
      architecturePatterns,
      keyFileLocations: this.extractKeyLocations(configFiles, symbols),
      languageDistribution: this.calculateLanguageDistribution(workspaceUri),
      existingIssues: this.summarizeDiagnostics(diagnostics),
      codeConventions: await this.detectCodeConventions(workspaceUri),
      testCoverage: await this.estimateTestCoverage(workspaceUri),
    });
  }

  private async detectArchitecturePatterns(workspaceUri: vscode.Uri): Promise<ArchitecturePattern[]> {
    const patterns: ArchitecturePattern[] = [];

    // Check for DDD patterns
    const domainFolders = await vscode.workspace.findFiles('**/domain/**/*.ts', '**/node_modules/**', 10);
    if (domainFolders.length > 0) {
      patterns.push({
        name: 'DDD',
        confidence: 75,
        evidence: domainFolders.map((f) => f.fsPath),
      });
    }

    // Check for layered architecture
    const layeredPatterns = ['controllers', 'services', 'repositories', 'entities'];
    const hasLayers = await Promise.all(
      layeredPatterns.map(async (layer) => {
        const files = await vscode.workspace.findFiles(`**/${layer}/**/*.ts`, '**/node_modules/**', 1);
        return files.length > 0;
      })
    );
    if (hasLayers.filter(Boolean).length >= 3) {
      patterns.push({
        name: 'Layered',
        confidence: 80,
        evidence: layeredPatterns.filter((_, i) => hasLayers[i]),
      });
    }

    return patterns;
  }
}
```

**Files Affected**:

- `libs/backend/agent-generation/src/lib/services/setup-wizard.service.ts` (MODIFY)
- `libs/backend/agent-generation/src/lib/types/analysis.types.ts` (CREATE)

---

### 4. Intelligent Agent Recommendation (Requirement 1.3)

**Purpose**: Score and recommend agents based on project analysis.

**Pattern**: Extend existing IAgentSelectionService (Evidence: `orchestrator.service.ts:477-533`)

**Service Specification** (Create `libs/backend/agent-generation/src/lib/services/agent-recommendation.service.ts`):

```typescript
export interface AgentRecommendation {
  agentId: string;
  relevanceScore: number; // 0-100
  matchedCriteria: string[];
  category: 'planning' | 'development' | 'qa' | 'specialist' | 'creative';
  recommended: boolean; // score > 75
}

@injectable()
export class AgentRecommendationService {
  /**
   * Calculate relevance scores for all 13 agents based on project analysis.
   */
  async calculateRecommendations(analysis: DeepProjectAnalysis): Promise<AgentRecommendation[]> {
    const recommendations: AgentRecommendation[] = [];

    // Planning agents (always relevant)
    recommendations.push(this.scoreAgent('project-manager', analysis, ['planning'], 85), this.scoreAgent('software-architect', analysis, ['planning'], 80), this.scoreAgent('team-leader', analysis, ['planning'], analysis.monorepoType ? 90 : 70));

    // Development agents (based on project type)
    const hasFrontend = this.hasFrontendFramework(analysis);
    const hasBackend = this.hasBackendFramework(analysis);

    recommendations.push(this.scoreAgent('frontend-developer', analysis, ['development'], hasFrontend ? 90 : 40), this.scoreAgent('backend-developer', analysis, ['development'], hasBackend ? 90 : 40), this.scoreAgent('devops-engineer', analysis, ['development'], this.hasDevOpsConfigs(analysis) ? 85 : 50));

    // QA agents (based on test coverage)
    const testCoverage = analysis.testCoverage.percentage;
    recommendations.push(this.scoreAgent('senior-tester', analysis, ['qa'], testCoverage < 50 ? 90 : 70), this.scoreAgent('code-style-reviewer', analysis, ['qa'], 75), this.scoreAgent('code-logic-reviewer', analysis, ['qa'], 75));

    // Specialist agents
    recommendations.push(this.scoreAgent('researcher-expert', analysis, ['specialist'], 65), this.scoreAgent('modernization-detector', analysis, ['specialist'], analysis.existingIssues.errorCount > 0 ? 80 : 60));

    // Creative agents (based on UI presence)
    recommendations.push(this.scoreAgent('ui-ux-designer', analysis, ['creative'], hasFrontend ? 75 : 40), this.scoreAgent('technical-content-writer', analysis, ['creative'], 60));

    return recommendations.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  private scoreAgent(agentId: string, analysis: DeepProjectAnalysis, categories: string[], baseScore: number): AgentRecommendation {
    const matchedCriteria: string[] = [];
    let adjustedScore = baseScore;

    // Adjust based on specific criteria
    if (agentId === 'frontend-developer') {
      if (analysis.frameworks.includes(Framework.Angular)) {
        matchedCriteria.push('Angular framework detected');
        adjustedScore += 5;
      }
      if (analysis.frameworks.includes(Framework.React)) {
        matchedCriteria.push('React framework detected');
        adjustedScore += 5;
      }
    }

    // ... additional scoring logic

    return {
      agentId,
      relevanceScore: Math.min(100, adjustedScore),
      matchedCriteria,
      category: categories[0] as any,
      recommended: adjustedScore >= 75,
    };
  }
}
```

**Files Affected**:

- `libs/backend/agent-generation/src/lib/services/agent-recommendation.service.ts` (CREATE)
- `libs/backend/agent-generation/src/lib/di/tokens.ts` (MODIFY)

---

### 5. Skill Template Generation (Requirement 1.5)

**Purpose**: Generate orchestration skill structure with project customization.

**Pattern**: Follow existing template storage pattern (Evidence: `templates/agents/*.template.md`)

**Templates to Create** (in `libs/backend/agent-generation/templates/skills/orchestration/`):

```
templates/skills/orchestration/
├── SKILL.template.md
└── references/
    ├── agent-catalog.template.md
    ├── strategies.template.md
    ├── team-leader-modes.template.md
    ├── task-tracking.template.md
    ├── checkpoints.template.md
    └── git-standards.template.md
```

**Service Specification** (Create `libs/backend/agent-generation/src/lib/services/skill-generator.service.ts`):

```typescript
export interface SkillGenerationOptions {
  workspaceUri: vscode.Uri;
  projectContext: AgentProjectContext;
  selectedAgents: string[];
  overwriteExisting: boolean;
}

export interface SkillGenerationResult {
  filesCreated: string[];
  filesSkipped: string[];
  customizations: Map<string, string[]>; // file -> customizations applied
}

@injectable()
export class SkillGeneratorService {
  constructor(
    @inject(AGENT_GENERATION_TOKENS.TEMPLATE_STORAGE_SERVICE)
    private readonly templateStorage: ITemplateStorageService,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger
  ) {}

  async generateOrchestrationSkill(options: SkillGenerationOptions): Promise<Result<SkillGenerationResult, Error>> {
    const { workspaceUri, projectContext, selectedAgents, overwriteExisting } = options;
    const result: SkillGenerationResult = {
      filesCreated: [],
      filesSkipped: [],
      customizations: new Map(),
    };

    // 1. Generate SKILL.md
    const skillResult = await this.generateSkillMd(workspaceUri, projectContext, overwriteExisting);
    if (skillResult.isOk()) {
      result.filesCreated.push('.claude/skills/orchestration/SKILL.md');
    }

    // 2. Generate reference files
    const references = ['agent-catalog', 'strategies', 'team-leader-modes', 'task-tracking', 'checkpoints', 'git-standards'];

    for (const ref of references) {
      const refResult = await this.generateReferenceFile(workspaceUri, ref, projectContext, selectedAgents, overwriteExisting);
      if (refResult.isOk()) {
        result.filesCreated.push(`.claude/skills/orchestration/references/${ref}.md`);
        result.customizations.set(ref, refResult.value!.customizations);
      }
    }

    return Result.ok(result);
  }

  private async generateSkillMd(workspaceUri: vscode.Uri, context: AgentProjectContext, overwrite: boolean): Promise<Result<{ customizations: string[] }, Error>> {
    const targetPath = vscode.Uri.joinPath(workspaceUri, '.claude/skills/orchestration/SKILL.md');

    // Check if file exists and overwrite is false
    if (!overwrite) {
      try {
        await vscode.workspace.fs.stat(targetPath);
        return Result.err(new Error('File exists and overwrite=false'));
      } catch {
        // File doesn't exist, proceed
      }
    }

    // Load template
    const templateResult = await this.templateStorage.loadSkillTemplate('orchestration/SKILL');
    if (templateResult.isErr()) {
      return Result.err(templateResult.error!);
    }

    // Apply project customizations
    const customizations: string[] = [];
    let content = templateResult.value!.content;

    // Customize project type references
    content = content.replace('{{PROJECT_TYPE}}', context.projectType.toString());
    customizations.push('Project type injected');

    // Customize monorepo settings
    if (context.monorepoType) {
      content = content.replace('{{MONOREPO_CONFIG}}', `This is a ${context.monorepoType} monorepo.`);
      customizations.push('Monorepo configuration added');
    }

    // Write file
    await vscode.workspace.fs.writeFile(targetPath, Buffer.from(content));

    return Result.ok({ customizations });
  }
}
```

**Files Affected**:

- `libs/backend/agent-generation/src/lib/services/skill-generator.service.ts` (CREATE)
- `libs/backend/agent-generation/templates/skills/orchestration/SKILL.template.md` (CREATE)
- `libs/backend/agent-generation/templates/skills/orchestration/references/*.template.md` (CREATE - 6 files)

---

### 6. Skill Validation Script (Requirement 2.4)

**Purpose**: Automated validation for orchestration skill integrity.

**Script Specification** (Create `scripts/validate-orchestration-skill.ts`):

```typescript
#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  stats: ValidationStats;
}

interface ValidationError {
  file: string;
  line?: number;
  type: 'syntax' | 'reference' | 'content' | 'consistency';
  message: string;
  suggestion?: string;
}

interface ValidationWarning {
  file: string;
  message: string;
}

interface ValidationStats {
  filesChecked: number;
  strategiesFound: number;
  agentsFound: number;
  referencesValidated: number;
}

const REQUIRED_STRATEGIES = ['FEATURE', 'BUGFIX', 'REFACTORING', 'DOCUMENTATION', 'RESEARCH', 'DEVOPS'];
const REQUIRED_AGENTS = ['project-manager', 'software-architect', 'team-leader', 'backend-developer', 'frontend-developer', 'devops-engineer', 'senior-tester', 'code-style-reviewer', 'code-logic-reviewer', 'researcher-expert', 'modernization-detector', 'ui-ux-designer', 'technical-content-writer'];
const REQUIRED_REFERENCES = ['agent-catalog.md', 'strategies.md', 'team-leader-modes.md', 'task-tracking.md', 'checkpoints.md', 'git-standards.md'];

async function validateOrchestrationSkill(skillPath: string): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const stats: ValidationStats = {
    filesChecked: 0,
    strategiesFound: 0,
    agentsFound: 0,
    referencesValidated: 0,
  };

  // 1. Syntax validation - all markdown files parseable
  const mdFiles = findMarkdownFiles(skillPath);
  for (const file of mdFiles) {
    stats.filesChecked++;
    const syntaxResult = validateMarkdownSyntax(file);
    if (!syntaxResult.valid) {
      errors.push({
        file,
        type: 'syntax',
        message: syntaxResult.error!,
      });
    }
  }

  // 2. Reference validation - all internal links point to existing files
  const skillMd = fs.readFileSync(path.join(skillPath, 'SKILL.md'), 'utf8');
  const referenceLinks = skillMd.match(/\[.*?\]\((references\/.*?\.md)\)/g) || [];
  for (const link of referenceLinks) {
    const refPath = link.match(/\((references\/.*?\.md)\)/)?.[1];
    if (refPath) {
      const fullPath = path.join(skillPath, refPath);
      if (!fs.existsSync(fullPath)) {
        errors.push({
          file: 'SKILL.md',
          type: 'reference',
          message: `Broken reference: ${refPath}`,
          suggestion: `Create ${refPath} or update the link`,
        });
      } else {
        stats.referencesValidated++;
      }
    }
  }

  // 3. Content validation - all 6 strategies documented
  for (const strategy of REQUIRED_STRATEGIES) {
    if (skillMd.includes(strategy)) {
      stats.strategiesFound++;
    } else {
      errors.push({
        file: 'SKILL.md',
        type: 'content',
        message: `Missing strategy: ${strategy}`,
        suggestion: `Add ${strategy} to Workflow Selection Matrix`,
      });
    }
  }

  // 4. Content validation - all 13 agents present in catalog
  const catalogPath = path.join(skillPath, 'references', 'agent-catalog.md');
  if (fs.existsSync(catalogPath)) {
    const catalog = fs.readFileSync(catalogPath, 'utf8');
    for (const agent of REQUIRED_AGENTS) {
      if (catalog.includes(agent)) {
        stats.agentsFound++;
      } else {
        errors.push({
          file: 'references/agent-catalog.md',
          type: 'content',
          message: `Missing agent: ${agent}`,
          suggestion: `Add ${agent} agent profile`,
        });
      }
    }
  }

  // 5. Consistency validation - invocation patterns match agent-catalog.md
  // Check that agents mentioned in strategies.md exist in agent-catalog.md
  const strategiesPath = path.join(skillPath, 'references', 'strategies.md');
  if (fs.existsSync(strategiesPath)) {
    const strategies = fs.readFileSync(strategiesPath, 'utf8');
    const mentionedAgents = strategies.match(/subagent_type:\s*'([^']+)'/g) || [];
    for (const mention of mentionedAgents) {
      const agentName = mention.match(/'([^']+)'/)?.[1];
      if (agentName && !REQUIRED_AGENTS.includes(agentName)) {
        warnings.push({
          file: 'references/strategies.md',
          message: `Agent "${agentName}" not in standard catalog`,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats,
  };
}

// Main execution
const skillPath = process.argv[2] || '.claude/skills/orchestration';
const result = await validateOrchestrationSkill(skillPath);

if (result.valid) {
  console.log('✅ Orchestration skill validation passed');
  console.log(`   Files checked: ${result.stats.filesChecked}`);
  console.log(`   Strategies found: ${result.stats.strategiesFound}/${REQUIRED_STRATEGIES.length}`);
  console.log(`   Agents found: ${result.stats.agentsFound}/${REQUIRED_AGENTS.length}`);
  process.exit(0);
} else {
  console.error('❌ Orchestration skill validation failed');
  for (const error of result.errors) {
    console.error(`   ${error.file}: [${error.type}] ${error.message}`);
    if (error.suggestion) {
      console.error(`     Suggestion: ${error.suggestion}`);
    }
  }
  process.exit(1);
}
```

**Pre-commit Hook** (Modify `.husky/pre-commit`):

```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Check if skill files changed
if git diff --cached --name-only | grep -q "^\.claude/skills/"; then
  echo "Validating orchestration skill..."
  npx ts-node scripts/validate-orchestration-skill.ts
  if [ $? -ne 0 ]; then
    echo "Skill validation failed. Please fix errors before committing."
    exit 1
  fi
fi
```

**Files Affected**:

- `scripts/validate-orchestration-skill.ts` (CREATE)
- `.husky/pre-commit` (MODIFY)
- `package.json` (MODIFY - add script)

---

### 7. SKILL.md Optimization (Requirement 2.5)

**Purpose**: Reduce SKILL.md from ~414 lines to <300 lines via progressive loading.

**Current Analysis**:

- SKILL.md current size: ~414 lines
- Content duplicated with references: ~150 lines
- Target size: <300 lines

**Optimization Strategy**:

1. **Keep in SKILL.md** (Essential quick-reference):

   - Frontmatter and description (~10 lines)
   - Quick Start section (~25 lines)
   - Strategy Quick Reference table (~15 lines)
   - Core Orchestration Loop summary (~60 lines)
   - Reference Index (~40 lines)
   - Key Design Principles (~20 lines)
   - **Total**: ~170 lines

2. **Move to references** (Detailed content):

   - Detailed strategy flows -> `strategies.md` (already there)
   - Detailed agent catalog -> `agent-catalog.md` (already there)
   - Team-leader modes detail -> `team-leader-modes.md` (already there)
   - Error handling templates -> `checkpoints.md`
   - Workflow completion details -> `task-tracking.md`

3. **Add explicit pointers**:

   ```markdown
   ## Workflow Selection Matrix

   [Strategy quick reference table here]

   See [strategies.md](references/strategies.md) for detailed flow diagrams and phase sequences.
   ```

**Files Affected**:

- `.claude/skills/orchestration/SKILL.md` (REWRITE)
- `.claude/skills/orchestration/references/checkpoints.md` (MODIFY - move content)
- `.claude/skills/orchestration/references/task-tracking.md` (MODIFY - move content)

---

### 8. Frontend Wizard Enhancements (Requirements 1.2-1.7)

**Purpose**: Enhanced wizard UI with MCP analysis, recommendations, and progress.

**State Service Extension** (Modify `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts`):

```typescript
export type WizardStep =
  | 'premium-check' // NEW
  | 'welcome'
  | 'scan'
  | 'analysis'
  | 'selection'
  | 'generation'
  | 'completion';

export interface ProjectAnalysisResult {
  // Basic (existing)
  projectType: string;
  fileCount: number;
  languages: string[];
  frameworks: string[];

  // Deep analysis (new)
  architecturePatterns: Array<{
    name: string;
    confidence: number;
    evidence: string[];
  }>;
  keyFileLocations: {
    entryPoints: string[];
    configs: string[];
    testDirectories: string[];
  };
  existingIssues: {
    errorCount: number;
    warningCount: number;
  };
  testCoverage: {
    percentage: number;
    hasTests: boolean;
  };
}

export interface AgentRecommendation {
  agentId: string;
  agentName: string; // Display name
  description: string;
  relevanceScore: number;
  matchedCriteria: string[];
  category: string;
  recommended: boolean;
}

@Injectable({ providedIn: 'root' })
export class SetupWizardStateService {
  // Existing state...

  // New state for deep analysis
  private readonly _deepAnalysis = signal<ProjectAnalysisResult | null>(null);
  private readonly _recommendations = signal<AgentRecommendation[]>([]);
  private readonly _skillGenerationProgress = signal<GenerationProgress[]>([]);

  readonly deepAnalysis = this._deepAnalysis.asReadonly();
  readonly recommendations = this._recommendations.asReadonly();
  readonly skillGenerationProgress = this._skillGenerationProgress.asReadonly();

  // Computed: recommended agents (score > 75)
  readonly recommendedAgents = computed(() => {
    return this._recommendations().filter((r) => r.recommended);
  });

  // Computed: total generation items (agents + commands + skill files)
  readonly totalGenerationItems = computed(() => {
    const selectedCount = Object.values(this._selectedAgents()).filter(Boolean).length;
    const commandCount = 5; // review-code, review-logic, review-security, orchestrate, orchestrate-help
    const skillFileCount = 7; // SKILL.md + 6 references
    return selectedCount + commandCount + skillFileCount;
  });

  setDeepAnalysis(analysis: ProjectAnalysisResult): void {
    this._deepAnalysis.set(analysis);
  }

  setRecommendations(recommendations: AgentRecommendation[]): void {
    this._recommendations.set(recommendations);

    // Auto-select recommended agents (score > 80)
    const autoSelected: Record<string, boolean> = {};
    for (const rec of recommendations) {
      autoSelected[rec.agentId] = rec.relevanceScore >= 80;
    }
    this._selectedAgents.set(autoSelected);
  }
}
```

**Enhanced Components**:

1. **AnalysisResultsComponent** - Show deep analysis with architecture patterns
2. **AgentSelectionComponent** - Show relevance scores and matched criteria
3. **GenerationProgressComponent** - Track agents + commands + skill files

**Files Affected**:

- `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts` (MODIFY)
- `libs/frontend/setup-wizard/src/lib/components/analysis-results.component.ts` (MODIFY)
- `libs/frontend/setup-wizard/src/lib/components/agent-selection.component.ts` (MODIFY)
- `libs/frontend/setup-wizard/src/lib/components/generation-progress.component.ts` (MODIFY)
- `libs/frontend/setup-wizard/src/lib/components/completion.component.ts` (MODIFY)

---

### 9. Adaptive Strategy Selection (Requirement 2.2)

**Purpose**: Confidence-based strategy selection using multiple factors.

**Implementation Location**: `.claude/skills/orchestration/SKILL.md` (documentation update) + new analysis logic

**Strategy Selection Algorithm**:

```typescript
interface StrategyScore {
  strategy: string;
  confidence: number; // 0-100
  factors: {
    keywords: number; // 30% weight
    affectedFiles: number; // 25% weight
    complexity: number; // 25% weight
    recentPatterns: number; // 20% weight
  };
}

function calculateStrategyConfidence(request: string, workspaceAnalysis: DeepProjectAnalysis, recentTasks: string[]): StrategyScore[] {
  const strategies = ['FEATURE', 'BUGFIX', 'REFACTORING', 'DOCUMENTATION', 'RESEARCH', 'DEVOPS', 'CREATIVE'];
  const scores: StrategyScore[] = [];

  for (const strategy of strategies) {
    const keywordScore = calculateKeywordMatch(request, strategy);
    const fileScore = calculateAffectedFilesScore(request, workspaceAnalysis, strategy);
    const complexityScore = calculateComplexityScore(workspaceAnalysis, strategy);
    const patternScore = calculateRecentPatternScore(recentTasks, strategy);

    const confidence = keywordScore * 0.3 + fileScore * 0.25 + complexityScore * 0.25 + patternScore * 0.2;

    scores.push({
      strategy,
      confidence,
      factors: {
        keywords: keywordScore,
        affectedFiles: fileScore,
        complexity: complexityScore,
        recentPatterns: patternScore,
      },
    });
  }

  return scores.sort((a, b) => b.confidence - a.confidence);
}
```

**SKILL.md Documentation Update**:

```markdown
### Adaptive Strategy Selection

When analyzing a task, evaluate multiple factors:

| Factor          | Weight | How to Assess                                                  |
| --------------- | ------ | -------------------------------------------------------------- |
| Keywords        | 30%    | Match request against strategy keyword table                   |
| Affected Files  | 25%    | Use `ptah.search.findFiles()` to identify likely affected code |
| Complexity      | 25%    | Analyze code structure via `ptah.workspace.analyze()`          |
| Recent Patterns | 20%    | Check last 5 tasks in registry.md for similar work             |

**Decision Rules**:

- If top strategy confidence >= 70%: Proceed with that strategy
- If top two strategies within 10 points: Present options to user
- If all strategies < 70%: Ask user for clarification with top 2 suggestions
```

**Files Affected**:

- `.claude/skills/orchestration/SKILL.md` (MODIFY - add adaptive selection section)
- `.claude/skills/orchestration/references/strategies.md` (MODIFY - add confidence guidance)

---

### 10. Agent Capability Matrix (Requirement 2.6)

**Purpose**: Visual matrix of agent capabilities for quick reference.

**Location**: `.claude/skills/orchestration/references/agent-catalog.md`

**Matrix Content**:

```markdown
## Agent Capability Matrix

| Agent                    | Write Code | Design | Review | Plan  | Research | Content |
| ------------------------ | :--------: | :----: | :----: | :---: | :------: | :-----: |
| project-manager          |     -      |   -    |   -    | **P** |    S     |    -    |
| software-architect       |     -      | **P**  |   S    | **P** |    S     |    -    |
| team-leader              |     -      |   -    |   S    | **P** |    -     |    -    |
| backend-developer        |   **P**    |   S    |   -    |   -   |    -     |    -    |
| frontend-developer       |   **P**    |   S    |   -    |   -   |    -     |    -    |
| devops-engineer          |   **P**    |   S    |   -    |   -   |    S     |    -    |
| senior-tester            |   **P**    |   -    | **P**  |   -   |    -     |    -    |
| code-style-reviewer      |     -      |   -    | **P**  |   -   |    -     |    -    |
| code-logic-reviewer      |     -      |   -    | **P**  |   -   |    -     |    -    |
| researcher-expert        |     -      |   -    |   -    |   -   |  **P**   |    S    |
| modernization-detector   |     -      |   -    |   S    |   -   |  **P**   |    -    |
| ui-ux-designer           |     -      | **P**  |   -    |   S   |    -     |    S    |
| technical-content-writer |     -      |   S    |   -    |   -   |    -     |  **P**  |

**Legend**: **P** = Primary capability, S = Secondary capability, - = Not applicable
```

**Files Affected**:

- `.claude/skills/orchestration/references/agent-catalog.md` (MODIFY)

---

## Implementation Phases

### Phase 1: Foundation (HIGH Priority) - 12-16 hours

**Dependencies**: None

| Task                                               | Files                                                     | Effort |
| -------------------------------------------------- | --------------------------------------------------------- | ------ |
| 1.1 Create orchestration namespace types           | `vscode-lm-tools/types.ts`                                | 2h     |
| 1.2 Implement orchestration namespace builder      | `namespace-builders/orchestration-namespace.builder.ts`   | 4h     |
| 1.3 Integrate orchestration namespace into PtahAPI | `ptah-api-builder.service.ts`                             | 2h     |
| 1.4 Create skill validation script                 | `scripts/validate-orchestration-skill.ts`                 | 4h     |
| 1.5 Add pre-commit hook for skill validation       | `.husky/pre-commit`                                       | 1h     |
| 1.6 Premium license gating (frontend)              | `wizard-view.component.ts`, `premium-upsell.component.ts` | 3h     |

**Verification**: `npm run validate-skill` passes, orchestration namespace available in MCP

### Phase 2: Deep Analysis (HIGH Priority) - 16-20 hours

**Dependencies**: Phase 1

| Task                                         | Files                                      | Effort |
| -------------------------------------------- | ------------------------------------------ | ------ |
| 2.1 Create analysis types                    | `agent-generation/types/analysis.types.ts` | 2h     |
| 2.2 Implement deep project analysis          | `setup-wizard.service.ts`                  | 6h     |
| 2.3 Implement architecture pattern detection | `setup-wizard.service.ts`                  | 4h     |
| 2.4 Implement agent recommendation service   | `agent-recommendation.service.ts`          | 4h     |
| 2.5 Create RPC handlers for deep analysis    | `setup-rpc.handlers.ts`                    | 2h     |
| 2.6 Update frontend analysis results         | `analysis-results.component.ts`            | 2h     |

**Verification**: Deep analysis returns architecture patterns, recommendations sorted by score

### Phase 3: Template Generation (Must Have) - 12-16 hours

**Dependencies**: Phase 2

| Task                                                                       | Files                               | Effort |
| -------------------------------------------------------------------------- | ----------------------------------- | ------ |
| 3.1 Create skill templates                                                 | `templates/skills/orchestration/**` | 4h     |
| 3.2 Implement skill generator service                                      | `skill-generator.service.ts`        | 4h     |
| 3.3 Add missing agent templates (ui-ux-designer, technical-content-writer) | `templates/agents/*.template.md`    | 2h     |
| 3.4 Update generation progress component                                   | `generation-progress.component.ts`  | 2h     |
| 3.5 Implement overwrite protection                                         | `skill-generator.service.ts`        | 2h     |
| 3.6 Update completion component with quick start                           | `completion.component.ts`           | 2h     |

**Verification**: All 13 agents + 5 commands + 7 skill files generate correctly

### Phase 4: Skill Optimization (HIGH Priority) - 8-12 hours

**Dependencies**: Phase 3

| Task                                     | Files                       | Effort |
| ---------------------------------------- | --------------------------- | ------ |
| 4.1 Audit SKILL.md for duplication       | Analysis task               | 1h     |
| 4.2 Refactor SKILL.md to <300 lines      | `SKILL.md`                  | 4h     |
| 4.3 Move detailed content to references  | `references/*.md`           | 2h     |
| 4.4 Add adaptive strategy selection docs | `SKILL.md`, `strategies.md` | 2h     |
| 4.5 Add agent capability matrix          | `agent-catalog.md`          | 1h     |
| 4.6 Validate optimization with script    | Validation                  | 1h     |

**Verification**: SKILL.md < 300 lines, validation script passes

### Phase 5: Quality (MEDIUM Priority) - 8-12 hours

**Dependencies**: Phase 4

| Task                                              | Files                             | Effort |
| ------------------------------------------------- | --------------------------------- | ------ |
| 5.1 Standardize agent profiles in catalog         | `agent-catalog.md`                | 3h     |
| 5.2 Add parallel execution notation to strategies | `strategies.md`                   | 2h     |
| 5.3 Document workspace intelligence integration   | `task-tracking.md`                | 2h     |
| 5.4 Add checkpoint customization docs             | `checkpoints.md`                  | 2h     |
| 5.5 Update validation script for new requirements | `validate-orchestration-skill.ts` | 2h     |

**Verification**: All agent profiles have standard sections, parallel notation in place

### Phase 6: Testing & Polish (MEDIUM Priority) - 8-12 hours

**Dependencies**: Phase 5

| Task                            | Files                                        | Effort |
| ------------------------------- | -------------------------------------------- | ------ |
| 6.1 Create test scenarios       | `task-tracking/test-scenarios/*.md`          | 4h     |
| 6.2 Add example workflow traces | `.claude/skills/orchestration/examples/*.md` | 4h     |
| 6.3 End-to-end wizard testing   | Manual testing                               | 2h     |
| 6.4 Documentation review        | All CLAUDE.md files                          | 2h     |

**Verification**: Test scenarios validate all 6 strategies, example traces complete

---

## Technical Decisions

### 1. State Persistence for Orchestration

**Decision**: Store orchestration state in `.orchestration-state.json` within task folder

**Rationale**:

- Task-scoped state (not global)
- Survives session restarts
- Git-ignorable if desired
- Evidence: Similar pattern used for `tasks.md` status tracking

### 2. Namespace Builder Pattern for MCP

**Decision**: Follow existing namespace builder pattern from `system-namespace.builders.ts`

**Rationale**:

- Consistent with codebase conventions (Evidence: 6 existing namespace builders)
- Clear dependency injection
- Testable in isolation
- Type-safe API surface

### 3. Template Variable System

**Decision**: Use `{{VARIABLE_NAME}}` syntax for template interpolation

**Rationale**:

- Matches existing template system (Evidence: `templates/agents/*.template.md`)
- Clear distinction from markdown syntax
- Easy to parse and replace

### 4. Progressive Reference Loading

**Decision**: Keep SKILL.md minimal with explicit pointers to references

**Rationale**:

- Reduces initial context load
- Matches Claude Code's skill loading pattern
- References loaded on-demand when needed
- Target: <300 lines for SKILL.md body

### 5. Validation as Pre-commit Hook

**Decision**: Run skill validation as pre-commit hook, not CI-only

**Rationale**:

- Catches errors before commit
- Faster feedback loop
- No broken skills in repository
- Evidence: Project already uses husky for pre-commit hooks

---

## Files to Create

| File Path                                                                                                   | Purpose                   |
| ----------------------------------------------------------------------------------------------------------- | ------------------------- |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/orchestration-namespace.builder.ts` | MCP orchestration tools   |
| `libs/backend/agent-generation/src/lib/services/agent-recommendation.service.ts`                            | Intelligent agent scoring |
| `libs/backend/agent-generation/src/lib/services/skill-generator.service.ts`                                 | Skill file generation     |
| `libs/backend/agent-generation/src/lib/types/analysis.types.ts`                                             | Deep analysis types       |
| `libs/backend/agent-generation/templates/skills/orchestration/SKILL.template.md`                            | Skill template            |
| `libs/backend/agent-generation/templates/skills/orchestration/references/*.template.md`                     | 6 reference templates     |
| `libs/frontend/setup-wizard/src/lib/components/premium-upsell.component.ts`                                 | Premium gate UI           |
| `scripts/validate-orchestration-skill.ts`                                                                   | Validation script         |
| `.claude/skills/orchestration/examples/feature-trace.md`                                                    | Example trace             |
| `.claude/skills/orchestration/examples/bugfix-trace.md`                                                     | Example trace             |
| `.claude/skills/orchestration/examples/creative-trace.md`                                                   | Example trace             |

## Files to Modify

| File Path                                                                         | Changes                               |
| --------------------------------------------------------------------------------- | ------------------------------------- |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts`                    | Add orchestration types               |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/index.ts` | Export orchestration builder          |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts` | Add orchestration namespace           |
| `libs/backend/agent-generation/src/lib/services/setup-wizard.service.ts`          | Add deep analysis methods             |
| `libs/backend/agent-generation/src/lib/di/tokens.ts`                              | Add new service tokens                |
| `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts`       | Extended state for deep analysis      |
| `libs/frontend/setup-wizard/src/lib/components/wizard-view.component.ts`          | Premium gating                        |
| `libs/frontend/setup-wizard/src/lib/components/analysis-results.component.ts`     | Deep analysis display                 |
| `libs/frontend/setup-wizard/src/lib/components/agent-selection.component.ts`      | Recommendation display                |
| `libs/frontend/setup-wizard/src/lib/components/generation-progress.component.ts`  | Full generation tracking              |
| `libs/frontend/setup-wizard/src/lib/components/completion.component.ts`           | Quick start guide                     |
| `.claude/skills/orchestration/SKILL.md`                                           | Optimization to <300 lines            |
| `.claude/skills/orchestration/references/agent-catalog.md`                        | Capability matrix, standardization    |
| `.claude/skills/orchestration/references/strategies.md`                           | Adaptive selection, parallel notation |
| `.claude/skills/orchestration/references/checkpoints.md`                          | Customization docs                    |
| `.claude/skills/orchestration/references/task-tracking.md`                        | Workspace intelligence integration    |
| `.husky/pre-commit`                                                               | Skill validation hook                 |
| `package.json`                                                                    | Add validation script                 |

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: **backend-developer** (primary) + **frontend-developer** (secondary)

**Rationale**:

- Phase 1-3: Backend work (MCP tools, services, templates) - backend-developer
- Phase 4: Skill documentation work - either developer
- Phase 5-6: Mixed work - both developers

### Complexity Assessment

**Complexity**: HIGH
**Estimated Effort**: 72-88 hours total

**Breakdown**:

- Backend: ~50 hours (MCP namespace, services, templates)
- Frontend: ~20 hours (wizard enhancements)
- Documentation: ~10 hours (skill optimization, traces)

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **All imports exist in codebase**:

   - `buildAINamespace` from `namespace-builders/system-namespace.builders.ts:128`
   - `PtahAPI` from `types.ts:21`
   - `Result` from `@ptah-extension/shared`
   - `TOKENS` from `@ptah-extension/vscode-core`

2. **All patterns verified from examples**:

   - Namespace builder pattern: `system-namespace.builders.ts`
   - RPC handler pattern: `setup-rpc.handlers.ts`
   - Template storage pattern: `template-storage.service.ts`

3. **Library documentation consulted**:

   - `libs/backend/vscode-lm-tools/CLAUDE.md`
   - `libs/backend/agent-generation/CLAUDE.md`
   - `libs/frontend/setup-wizard/CLAUDE.md`

4. **No hallucinated APIs**:
   - All VS Code APIs verified: `vscode.workspace.findFiles`, `vscode.languages.getDiagnostics`
   - All internal APIs verified from library exports

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined (from task-description.md)
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] No step-by-step implementation (that's team-leader's job)
