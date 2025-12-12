# libs/frontend/setup-wizard - Agent Setup Wizard

[Back to Main](../../../CLAUDE.md)

## Purpose

The **setup-wizard library** provides a 6-step interactive wizard for intelligent agent rule generation. It scans the codebase, analyzes project structure, lets users select agents to generate, and creates customized `.agent/rules/*.md` files based on project context.

## Key Responsibilities

- **Codebase Scanning**: File tree traversal and analysis
- **Project Detection**: Intelligent detection of 13+ project types (React, Angular, Node.js, etc.)
- **Agent Selection**: User selects which agents to generate (frontend, backend, etc.)
- **Rule Generation**: AI-powered generation of agent-specific rules
- **Progress Tracking**: Real-time progress visualization with step-by-step status
- **Error Handling**: Retry mechanisms for failed scans/generations

## Architecture

```
libs/frontend/setup-wizard/src/lib/
├── components/                           # Wizard Step Components
│   ├── welcome.component.ts              # Step 1: Welcome screen
│   ├── scan-progress.component.ts        # Step 2: Codebase scanning
│   ├── analysis-results.component.ts     # Step 3: Show detected project type
│   ├── agent-selection.component.ts      # Step 4: Select agents to generate
│   ├── generation-progress.component.ts  # Step 5: Generate rules with progress
│   ├── completion.component.ts           # Step 6: Success confirmation
│   └── confirmation-modal.component.ts   # Utility: Confirmation dialog
│
└── services/
    ├── setup-wizard-state.service.ts     # Wizard state management
    └── wizard-rpc.service.ts             # Extension RPC calls
```

## Critical Design Decisions

### 1. 6-Step Wizard Flow

**Linear wizard with clear progression.**

```
Step 1: WELCOME
  → User clicks "Start Setup"

Step 2: SCAN PROGRESS
  → Extension scans codebase (file tree, package.json, etc.)
  → Real-time progress updates

Step 3: ANALYSIS RESULTS
  → Display detected project type (e.g., "Angular Nx Monorepo")
  → Show project stats (file count, libraries, etc.)
  → User confirms or re-scans

Step 4: AGENT SELECTION
  → Show available agents (frontend-developer, backend-developer, etc.)
  → User checks which agents to generate
  → Warn if no agents selected

Step 5: GENERATION PROGRESS
  → Extension generates agent rules with AI
  → Real-time per-agent progress
  → Retry button if generation fails

Step 6: COMPLETION
  → Success message with summary
  → Button to close wizard
  → Button to open generated files
```

### 2. SetupWizardStateService: Centralized State

**Signal-based state management for wizard flow.**

```typescript
export type WizardStep = 'welcome' | 'scanning' | 'analysis' | 'agent-selection' | 'generating' | 'completion';

export interface ProjectContext {
  projectType: string; // "Angular Nx Monorepo", "React App", etc.
  fileCount: number;
  languages: string[];
  frameworks: string[];
  libraries: string[];
}

export interface AgentSelection {
  [agentName: string]: boolean; // { "frontend-developer": true, "backend-developer": false }
}

export interface AgentProgress {
  agentName: string;
  status: 'pending' | 'generating' | 'success' | 'error';
  progress: number; // 0-100
  errorMessage?: string;
}

@Injectable({ providedIn: 'root' })
export class SetupWizardStateService {
  // Private state
  private readonly _currentStep = signal<WizardStep>('welcome');
  private readonly _projectContext = signal<ProjectContext | null>(null);
  private readonly _selectedAgents = signal<AgentSelection>({});
  private readonly _generationProgress = signal<AgentProgress[]>([]);
  private readonly _isLoading = signal(false);
  private readonly _errorState = signal<ErrorState | null>(null);

  // Public readonly signals
  readonly currentStep = this._currentStep.asReadonly();
  readonly projectContext = this._projectContext.asReadonly();
  readonly selectedAgents = this._selectedAgents.asReadonly();
  readonly generationProgress = this._generationProgress.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly errorState = this._errorState.asReadonly();

  // Computed signals
  readonly canProceed = computed(() => {
    const step = this._currentStep();
    const isLoading = this._isLoading();

    if (isLoading) return false;

    switch (step) {
      case 'welcome':
        return true;
      case 'analysis':
        return this._projectContext() !== null;
      case 'agent-selection':
        return this.hasSelectedAgents();
      case 'completion':
        return true;
      default:
        return false;
    }
  });

  readonly hasSelectedAgents = computed(() => {
    const selected = this._selectedAgents();
    return Object.values(selected).some((isSelected) => isSelected);
  });

  readonly generationComplete = computed(() => {
    const progress = this._generationProgress();
    return progress.every((agent) => agent.status === 'success' || agent.status === 'error');
  });

  // State transitions
  nextStep(): void {
    const current = this._currentStep();
    const stepOrder: WizardStep[] = ['welcome', 'scanning', 'analysis', 'agent-selection', 'generating', 'completion'];

    const currentIndex = stepOrder.indexOf(current);
    if (currentIndex < stepOrder.length - 1) {
      this._currentStep.set(stepOrder[currentIndex + 1]);
    }
  }

  previousStep(): void {
    const current = this._currentStep();
    const stepOrder: WizardStep[] = ['welcome', 'scanning', 'analysis', 'agent-selection', 'generating', 'completion'];

    const currentIndex = stepOrder.indexOf(current);
    if (currentIndex > 0) {
      this._currentStep.set(stepOrder[currentIndex - 1]);
    }
  }

  // Agent selection
  toggleAgent(agentName: string): void {
    this._selectedAgents.update((selected) => ({
      ...selected,
      [agentName]: !selected[agentName],
    }));
  }

  // Project context
  setProjectContext(context: ProjectContext): void {
    this._projectContext.set(context);
  }

  // Generation progress
  updateAgentProgress(agentName: string, progress: Partial<AgentProgress>): void {
    this._generationProgress.update((agents) => agents.map((agent) => (agent.agentName === agentName ? { ...agent, ...progress } : agent)));
  }

  // Error handling
  setError(error: ErrorState): void {
    this._errorState.set(error);
  }

  clearError(): void {
    this._errorState.set(null);
  }

  // Reset wizard
  reset(): void {
    this._currentStep.set('welcome');
    this._projectContext.set(null);
    this._selectedAgents.set({});
    this._generationProgress.set([]);
    this._errorState.set(null);
  }
}
```

### 3. WizardRpcService: Extension Communication

**Type-safe RPC calls for wizard operations.**

```typescript
@Injectable({ providedIn: 'root' })
export class WizardRpcService {
  private readonly rpc = inject(ClaudeRpcService);

  // Scan codebase
  async scanCodebase(): Promise<ScanProgress> {
    const result = await this.rpc.callExtension<void, ScanProgress>(
      'wizard:scan-codebase',
      undefined,
      { timeout: 60000 } // 1 minute timeout
    );

    if (result.success) {
      return result.data;
    } else {
      throw new Error(result.error);
    }
  }

  // Analyze project
  async analyzeProject(): Promise<ProjectContext> {
    const result = await this.rpc.callExtension<void, ProjectContext>('wizard:analyze-project', undefined, { timeout: 30000 });

    if (result.success) {
      return result.data;
    } else {
      throw new Error(result.error);
    }
  }

  // Generate agent rules
  async generateAgentRules(agentNames: string[]): Promise<void> {
    const result = await this.rpc.callExtension<{ agents: string[] }, void>(
      'wizard:generate-rules',
      { agents: agentNames },
      { timeout: 120000 } // 2 minute timeout for AI generation
    );

    if (!result.success) {
      throw new Error(result.error);
    }
  }

  // Subscribe to generation progress updates
  subscribeToProgress(callback: (progress: AgentProgress) => void): Subscription {
    return this.vscode.messages$
      .pipe(
        filter((msg) => msg.type === 'wizard:generation-progress'),
        map((msg) => msg.payload as AgentProgress)
      )
      .subscribe(callback);
  }
}
```

### 4. Real-Time Progress Updates

**Extension sends progress messages, wizard updates UI reactively.**

```typescript
@Component({
  selector: 'ptah-generation-progress',
  template: `
    <div class="generation-progress">
      <h2>Generating Agent Rules</h2>

      @for (agent of agentProgress(); track agent.agentName) {
      <div class="agent-progress-item">
        <div class="agent-name">{{ agent.agentName }}</div>

        @if (agent.status === 'generating') {
        <div class="progress-bar">
          <div class="progress-fill" [style.width.%]="agent.progress"></div>
        </div>
        <div class="progress-text">{{ agent.progress }}%</div>
        } @if (agent.status === 'success') {
        <div class="success-badge">✓ Complete</div>
        } @if (agent.status === 'error') {
        <div class="error-badge">✗ Failed</div>
        <div class="error-message">{{ agent.errorMessage }}</div>
        <button (click)="retryAgent(agent.agentName)">Retry</button>
        }
      </div>
      } @if (generationComplete()) {
      <button (click)="proceed()">Continue</button>
      }
    </div>
  `,
})
export class GenerationProgressComponent implements OnInit, OnDestroy {
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly wizardRpc = inject(WizardRpcService);
  private readonly destroyRef = inject(DestroyRef);

  readonly agentProgress = this.wizardState.generationProgress;
  readonly generationComplete = this.wizardState.generationComplete;

  ngOnInit(): void {
    // Subscribe to progress updates from extension
    this.wizardRpc
      .subscribeToProgress((progress) => {
        this.wizardState.updateAgentProgress(progress.agentName, progress);
      })
      .pipe(takeUntilDestroyed(this.destroyRef));
  }

  async retryAgent(agentName: string): Promise<void> {
    // Reset agent progress
    this.wizardState.updateAgentProgress(agentName, {
      status: 'pending',
      progress: 0,
      errorMessage: undefined,
    });

    // Retry generation
    try {
      await this.wizardRpc.generateAgentRules([agentName]);
    } catch (error) {
      this.wizardState.updateAgentProgress(agentName, {
        status: 'error',
        errorMessage: error.message,
      });
    }
  }

  proceed(): void {
    this.wizardState.nextStep();
  }
}
```

### 5. Agent Selection with Recommendations

**Smart agent recommendations based on project type.**

```typescript
@Component({
  selector: 'ptah-agent-selection',
  template: `
    <div class="agent-selection">
      <h2>Select Agents to Generate</h2>

      <p>Based on your {{ projectType() }}, we recommend:</p>

      <div class="agent-list">
        @for (agent of availableAgents; track agent.name) {
        <label class="agent-checkbox">
          <input type="checkbox" [checked]="isSelected(agent.name)" (change)="toggleAgent(agent.name)" />
          <div class="agent-info">
            <div class="agent-name">{{ agent.name }}</div>
            <div class="agent-description">{{ agent.description }}</div>
            @if (agent.recommended) {
            <span class="badge badge-primary">Recommended</span>
            }
          </div>
        </label>
        }
      </div>

      @if (!hasSelectedAgents()) {
      <div class="warning">Please select at least one agent.</div>
      }

      <div class="button-group">
        <button (click)="back()">Back</button>
        <button (click)="proceed()" [disabled]="!hasSelectedAgents()">Generate Rules</button>
      </div>
    </div>
  `,
})
export class AgentSelectionComponent {
  private readonly wizardState = inject(SetupWizardStateService);

  readonly projectType = computed(() => {
    return this.wizardState.projectContext()?.projectType || 'project';
  });

  readonly selectedAgents = this.wizardState.selectedAgents;
  readonly hasSelectedAgents = this.wizardState.hasSelectedAgents;

  // Available agents with recommendations
  readonly availableAgents = computed(() => {
    const projectType = this.projectType();

    return [
      {
        name: 'frontend-developer',
        description: 'Builds UI components, handles styling, client-side logic',
        recommended: projectType.includes('Angular') || projectType.includes('React'),
      },
      {
        name: 'backend-developer',
        description: 'Implements APIs, database logic, server-side code',
        recommended: projectType.includes('Node.js') || projectType.includes('Express'),
      },
      {
        name: 'software-architect',
        description: 'Designs system architecture, makes technical decisions',
        recommended: true, // Always recommended
      },
      {
        name: 'senior-tester',
        description: 'Writes tests, ensures quality, validates functionality',
        recommended: true, // Always recommended
      },
      {
        name: 'code-style-reviewer',
        description: 'Reviews code style, enforces patterns, checks consistency',
        recommended: false,
      },
      {
        name: 'code-logic-reviewer',
        description: 'Reviews business logic, checks completeness, validates requirements',
        recommended: false,
      },
    ];
  });

  isSelected(agentName: string): boolean {
    return this.selectedAgents()[agentName] === true;
  }

  toggleAgent(agentName: string): void {
    this.wizardState.toggleAgent(agentName);
  }

  back(): void {
    this.wizardState.previousStep();
  }

  proceed(): void {
    if (this.hasSelectedAgents()) {
      this.wizardState.nextStep();
      this.startGeneration();
    }
  }

  private async startGeneration(): Promise<void> {
    const selectedAgentNames = Object.entries(this.selectedAgents())
      .filter(([_, isSelected]) => isSelected)
      .map(([name]) => name);

    try {
      await this.wizardRpc.generateAgentRules(selectedAgentNames);
    } catch (error) {
      this.wizardState.setError({
        message: 'Failed to generate agent rules',
        details: error.message,
      });
    }
  }
}
```

---

## Key Components API Reference

### WelcomeComponent (Step 1)

**Purpose**: Wizard introduction and "Start Setup" button.

```typescript
@Component({
  selector: 'ptah-welcome',
  standalone: true,
  template: `
    <div class="welcome-screen">
      <h1>Welcome to Ptah Extension Setup</h1>
      <p>This wizard will help you generate customized agent rules based on your project.</p>

      <div class="features-list">
        <div class="feature">
          <span class="icon">🔍</span>
          <span>Scan your codebase</span>
        </div>
        <div class="feature">
          <span class="icon">🤖</span>
          <span>Generate agent-specific rules</span>
        </div>
        <div class="feature">
          <span class="icon">⚡</span>
          <span>Get started in minutes</span>
        </div>
      </div>

      <button (click)="start()" class="btn btn-primary btn-lg">Start Setup</button>
    </div>
  `,
})
export class WelcomeComponent {
  private readonly wizardState = inject(SetupWizardStateService);

  start(): void {
    this.wizardState.nextStep();
  }
}
```

### ScanProgressComponent (Step 2)

**Purpose**: Real-time codebase scanning progress.

```typescript
@Component({
  selector: 'ptah-scan-progress',
  standalone: true,
  template: `
    <div class="scan-progress">
      <h2>Scanning Codebase</h2>

      <div class="progress-container">
        <div class="spinner"></div>
        <p>{{ statusMessage() }}</p>
      </div>

      @if (errorState()) {
      <div class="error-alert">
        <p>{{ errorState()?.message }}</p>
        <button (click)="retryScan()">Retry Scan</button>
      </div>
      }
    </div>
  `,
})
export class ScanProgressComponent implements OnInit {
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly wizardRpc = inject(WizardRpcService);

  readonly statusMessage = signal('Initializing scan...');
  readonly errorState = this.wizardState.errorState;

  ngOnInit(): void {
    this.startScan();
  }

  private async startScan(): Promise<void> {
    try {
      this.statusMessage.set('Reading file tree...');
      const scanResult = await this.wizardRpc.scanCodebase();

      this.statusMessage.set('Analyzing project structure...');
      const projectContext = await this.wizardRpc.analyzeProject();

      this.wizardState.setProjectContext(projectContext);
      this.wizardState.nextStep(); // Go to analysis results
    } catch (error) {
      this.wizardState.setError({
        message: 'Failed to scan codebase',
        details: error.message,
      });
    }
  }

  retryScan(): void {
    this.wizardState.clearError();
    this.startScan();
  }
}
```

### AnalysisResultsComponent (Step 3)

**Purpose**: Display detected project type and stats.

```typescript
@Component({
  selector: 'ptah-analysis-results',
  standalone: true,
  template: `
    <div class="analysis-results">
      <h2>Project Analysis Complete</h2>

      @if (projectContext()) {
      <div class="project-card">
        <h3>{{ projectContext()?.projectType }}</h3>

        <div class="stats-grid">
          <div class="stat">
            <div class="stat-label">Files</div>
            <div class="stat-value">{{ projectContext()?.fileCount }}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Languages</div>
            <div class="stat-value">{{ projectContext()?.languages.join(', ') }}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Frameworks</div>
            <div class="stat-value">{{ projectContext()?.frameworks.join(', ') }}</div>
          </div>
        </div>
      </div>
      }

      <div class="button-group">
        <button (click)="rescan()">Re-scan</button>
        <button (click)="proceed()" class="btn-primary">Continue</button>
      </div>
    </div>
  `,
})
export class AnalysisResultsComponent {
  private readonly wizardState = inject(SetupWizardStateService);

  readonly projectContext = this.wizardState.projectContext;

  rescan(): void {
    this.wizardState.previousStep(); // Go back to scanning
  }

  proceed(): void {
    this.wizardState.nextStep();
  }
}
```

### CompletionComponent (Step 6)

**Purpose**: Success confirmation with summary.

```typescript
@Component({
  selector: 'ptah-completion',
  standalone: true,
  template: `
    <div class="completion-screen">
      <div class="success-icon">✓</div>
      <h2>Setup Complete!</h2>

      <p>Agent rules have been generated successfully.</p>

      <div class="summary">
        <h3>Generated Rules:</h3>
        <ul>
          @for (agent of generatedAgents(); track agent) {
          <li>{{ agent }}.md</li>
          }
        </ul>
      </div>

      <div class="button-group">
        <button (click)="openRules()">Open Generated Files</button>
        <button (click)="close()" class="btn-primary">Close</button>
      </div>
    </div>
  `,
})
export class CompletionComponent {
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly vscode = inject(VSCodeService);

  readonly generatedAgents = computed(() => {
    return this.wizardState
      .generationProgress()
      .filter((agent) => agent.status === 'success')
      .map((agent) => agent.agentName);
  });

  openRules(): void {
    this.vscode.postMessage({
      type: 'command',
      payload: { command: 'open-generated-rules' },
    });
  }

  close(): void {
    this.vscode.postMessage({
      type: 'command',
      payload: { command: 'close-wizard' },
    });
  }
}
```

---

## Boundaries

**Belongs Here**:

- Wizard UI components (6 steps + modal)
- Wizard state management (SetupWizardStateService)
- Extension RPC for wizard operations (WizardRpcService)
- Agent selection logic
- Progress tracking and error handling

**Does NOT Belong**:

- Codebase scanning logic (belongs in extension backend)
- AI rule generation logic (belongs in extension backend)
- Generic UI components (belongs in `@ptah-extension/ui`)
- Chat functionality (belongs in `@ptah-extension/chat`)

---

## Dependencies

**Internal Libraries**:

- `@ptah-extension/shared` - Type contracts (WizardStep, ProjectContext)
- `@ptah-extension/core` - ClaudeRpcService, VSCodeService

**External Dependencies**:

- `@angular/core` (^20.1.2) - Component framework, signals
- `@angular/common` (^20.1.2) - NgFor, NgIf

---

## Import Path

```typescript
// Components
import { WelcomeComponent } from '@ptah-extension/setup-wizard';
import { ScanProgressComponent } from '@ptah-extension/setup-wizard';
import { AgentSelectionComponent } from '@ptah-extension/setup-wizard';
import { GenerationProgressComponent } from '@ptah-extension/setup-wizard';

// Services
import { SetupWizardStateService } from '@ptah-extension/setup-wizard';
import { WizardRpcService } from '@ptah-extension/setup-wizard';

// Types
import type { WizardStep, ProjectContext, AgentProgress } from '@ptah-extension/setup-wizard';
```

---

## Commands

```bash
# Test
nx test setup-wizard

# Typecheck
nx typecheck setup-wizard

# Lint
nx lint setup-wizard

# Build to ESM
nx build setup-wizard
```

---

## Guidelines

1. **Linear Flow**: Wizard MUST enforce linear step progression (no skipping)
2. **Signal-Based State**: All wizard state MUST use Angular signals
3. **Real-Time Updates**: Progress MUST update reactively from extension messages
4. **Error Recovery**: Every step MUST have retry mechanism on failure
5. **Accessibility**: Proper ARIA labels and keyboard navigation
6. **DaisyUI Classes**: Use DaisyUI modal, card, progress, and badge classes
7. **Mobile Responsive**: Wizard MUST work on all screen sizes
8. **Type Safety**: All RPC calls MUST be type-safe with shared contracts
9. **Cleanup**: Unsubscribe from message streams on component destroy
10. **User Feedback**: Always show loading states and error messages

---

## File Paths Reference

- **Components**: `src/lib/components/`
  - `welcome.component.ts` - Step 1
  - `scan-progress.component.ts` - Step 2
  - `analysis-results.component.ts` - Step 3
  - `agent-selection.component.ts` - Step 4
  - `generation-progress.component.ts` - Step 5
  - `completion.component.ts` - Step 6
  - `confirmation-modal.component.ts` - Utility modal
- **Services**: `src/lib/services/`
  - `setup-wizard-state.service.ts` - Wizard state
  - `wizard-rpc.service.ts` - Extension RPC
- **Entry Point**: `src/index.ts`
