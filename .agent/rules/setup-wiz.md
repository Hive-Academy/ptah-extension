---
glob: 'libs/frontend/setup-wizard/**/*.ts'
---

# setup-wiz - Agent Setup Wizard

**Active**: Working in `libs/frontend/setup-wizard/**/*.ts`

## Purpose

The **setup-wizard library** provides a 6-step interactive wizard for intelligent agent rule generation. It scans the codebase, analyzes project structure, lets users select agents, and creates customized `.agent/rules/*.md` files.

## Responsibilities

✅ **Codebase Scanning**: File tree traversal  
✅ **Project Detection**: 13+ project types (React, Angular, Node.js)  
✅ **Agent Selection**: User selects agents to generate  
✅ **Rule Generation**: AI-powered agent customization  
✅ **Progress Tracking**: Real-time status visualization  
✅ **Error Handling**: Retry mechanisms

❌ **NOT**: Scanning logic (extension backend), Generic UI (→ ui), Chat (→ chat)

## Components

```
libs/frontend/setup-wizard/src/lib/
├── components/
│   ├── welcome.component.ts
│   ├── scan-progress.component.ts
│   ├── analysis-results.component.ts
│   ├── agent-selection.component.ts
│   ├── generation-progress.component.ts
│   └── completion.component.ts
└── services/
    ├── setup-wizard-state.service.ts
    └── wizard-rpc.service.ts
```

## 6-Step Wizard Flow

**Step 1: WELCOME** → User clicks "Start Setup"  
**Step 2: SCAN PROGRESS** → Extension scans codebase  
**Step 3: ANALYSIS RESULTS** → Display detected project type  
**Step 4: AGENT SELECTION** → User checks agents to generate  
**Step 5: GENERATION PROGRESS** → AI generates rules with progress  
**Step 6: COMPLETION** → Success with summary

## SetupWizardStateService

```typescript
export type WizardStep = 'welcome' | 'scanning' | 'analysis' | 'agent-selection' | 'generating' | 'completion';

@Injectable({ providedIn: 'root' })
export class SetupWizardStateService {
  // Private state
  private readonly _currentStep = signal<WizardStep>('welcome');
  private readonly _projectContext = signal<ProjectContext | null>(null);
  private readonly _selectedAgents = signal<AgentSelection>({});
  private readonly _generationProgress = signal<AgentProgress[]>([]);

  // Public readonly signals
  readonly currentStep = this._currentStep.asReadonly();
  readonly projectContext = this._projectContext.asReadonly();
  readonly selectedAgents = this._selectedAgents.asReadonly();
  readonly generationProgress = this._generationProgress.asReadonly();

  // Computed
  readonly canProceed = computed(() => {
    const step = this._currentStep();
    if (step === 'agent-selection') {
      return this.hasSelectedAgents();
    }
    return true;
  });

  readonly hasSelectedAgents = computed(() => {
    const selected = this._selectedAgents();
    return Object.values(selected).some((isSelected) => isSelected);
  });

  readonly generationComplete = computed(() => {
    const progress = this._generationProgress();
    return progress.every((a) => a.status === 'success' || a.status === 'error');
  });

  // State transitions
  nextStep(): void {
    const steps: WizardStep[] = ['welcome', 'scanning', 'analysis', 'agent-selection', 'generating', 'completion'];
    const idx = steps.indexOf(this._currentStep());
    if (idx < steps.length - 1) {
      this._currentStep.set(steps[idx + 1]);
    }
  }

  toggleAgent(agentName: string): void {
    this._selectedAgents.update((selected) => ({
      ...selected,
      [agentName]: !selected[agentName],
    }));
  }

  updateAgentProgress(agentName: string, progress: Partial<AgentProgress>): void {
    this._generationProgress.update((agents) => agents.map((agent) => (agent.agentName === agentName ? { ...agent, ...progress } : agent)));
  }
}
```

## WizardRpcService

```typescript
@Injectable({ providedIn: 'root' })
export class WizardRpcService {
  private readonly rpc = inject(ClaudeRpcService);

  async scanCodebase(): Promise<ScanProgress> {
    const result = await this.rpc.callExtension<void, ScanProgress>('wizard:scan-codebase', undefined, { timeout: 60000 });
    if (result.success) return result.data;
    throw new Error(result.error);
  }

  async analyzeProject(): Promise<ProjectContext> {
    const result = await this.rpc.callExtension<void, ProjectContext>('wizard:analyze-project', undefined, { timeout: 30000 });
    if (result.success) return result.data;
    throw new Error(result.error);
  }

  async generateAgentRules(agentNames: string[]): Promise<void> {
    const result = await this.rpc.callExtension<{ agents: string[] }, void>('wizard:generate-rules', { agents: agentNames }, { timeout: 120000 });
    if (!result.success) throw new Error(result.error);
  }

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

## Key Components

### ScanProgressComponent (Step 2)

```typescript
@Component({
  selector: 'ptah-scan-progress',
  template: `
    <div class="scan-progress">
      <h2>Scanning Codebase</h2>
      <div class="spinner"></div>
      <p>{{ statusMessage() }}</p>

      @if (errorState()) {
      <div class="error-alert">
        <p>{{ errorState()?.message }}</p>
        <button (click)="retryScan()">Retry</button>
      </div>
      }
    </div>
  `,
})
export class ScanProgressComponent implements OnInit {
  readonly statusMessage = signal('Initializing...');

  ngOnInit(): void {
    this.startScan();
  }

  private async startScan(): Promise<void> {
    try {
      this.statusMessage.set('Reading file tree...');
      await this.wizardRpc.scanCodebase();

      this.statusMessage.set('Analyzing structure...');
      const context = await this.wizardRpc.analyzeProject();

      this.wizardState.setProjectContext(context);
      this.wizardState.nextStep();
    } catch (error) {
      this.wizardState.setError({ message: 'Scan failed', details: error.message });
    }
  }
}
```

### AgentSelectionComponent (Step 4)

```typescript
@Component({
  selector: 'ptah-agent-selection',
  template: `
    <div class="agent-selection">
      <h2>Select Agents to Generate</h2>

      <p>Based on {{ projectType() }}:</p>

      <div class="agent-list">
        @for (agent of availableAgents(); track agent.name) {
        <label>
          <input type="checkbox" [checked]="isSelected(agent.name)" (change)="toggleAgent(agent.name)" />
          <div class="agent-info">
            <div class="agent-name">{{ agent.name }}</div>
            <div class="agent-description">{{ agent.description }}</div>
            @if (agent.recommended) {
            <span class="badge">Recommended</span>
            }
          </div>
        </label>
        }
      </div>

      <button (click)="proceed()" [disabled]="!hasSelectedAgents()">Generate Rules</button>
    </div>
  `,
})
export class AgentSelectionComponent {
  readonly projectType = computed(() => this.wizardState.projectContext()?.projectType || 'project');

  readonly availableAgents = computed(() => {
    const type = this.projectType();
    return [
      {
        name: 'frontend-developer',
        description: 'Builds UI components',
        recommended: type.includes('Angular') || type.includes('React'),
      },
      {
        name: 'backend-developer',
        description: 'Implements APIs',
        recommended: type.includes('Node.js'),
      },
      {
        name: 'software-architect',
        description: 'Designs architecture',
        recommended: true,
      },
      {
        name: 'senior-tester',
        description: 'Writes tests',
        recommended: true,
      },
    ];
  });

  toggleAgent(agentName: string): void {
    this.wizardState.toggleAgent(agentName);
  }

  proceed(): void {
    if (this.hasSelectedAgents()) {
      this.wizardState.nextStep();
      this.startGeneration();
    }
  }
}
```

### GenerationProgressComponent (Step 5)

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
        } @if (agent.status === 'success') {
        <div class="success-badge">✓ Complete</div>
        } @if (agent.status === 'error') {
        <div class="error-badge">✗ Failed</div>
        <button (click)="retryAgent(agent.agentName)">Retry</button>
        }
      </div>
      } @if (generationComplete()) {
      <button (click)="proceed()">Continue</button>
      }
    </div>
  `,
})
export class GenerationProgressComponent implements OnInit {
  ngOnInit(): void {
    this.wizardRpc.subscribeToProgress((progress) => {
      this.wizardState.updateAgentProgress(progress.agentName, progress);
    });
  }

  async retryAgent(agentName: string): Promise<void> {
    this.wizardState.updateAgentProgress(agentName, {
      status: 'pending',
      progress: 0,
    });
    await this.wizardRpc.generateAgentRules([agentName]);
  }
}
```

## Types

```typescript
export interface ProjectContext {
  projectType: string;
  fileCount: number;
  languages: string[];
  frameworks: string[];
}

export interface AgentSelection {
  [agentName: string]: boolean;
}

export interface AgentProgress {
  agentName: string;
  status: 'pending' | 'generating' | 'success' | 'error';
  progress: number;
  errorMessage?: string;
}
```

## Rules

1. **Linear Flow** - Wizard MUST enforce linear step progression
2. **Signal-Based** - All state MUST use Angular signals
3. **Real-Time Updates** - Progress updates reactively from extension
4. **Error Recovery** - Every step MUST have retry mechanism
5. **Type Safety** - All RPC calls MUST be type-safe
6. **Cleanup** - Unsubscribe from message streams on destroy
7. **DaisyUI Classes** - Use DaisyUI modal, card, progress, badge

## Commands

```bash
nx test setup-wizard
nx typecheck setup-wizard
nx build setup-wizard
```
