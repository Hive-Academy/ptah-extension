# Development Tasks - TASK_2025_126

**Total Tasks**: 12 | **Batches**: 4 | **Status**: 0/4 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- ViewType union pattern: Verified in `app-state.service.ts:11-17`
- VALID_VIEWS array: Verified in `webview-html-generator.ts:81-88`
- App shell @switch pattern: Verified in `app-shell.component.html:11-24`
- License RPC `license:getStatus`: Verified in `license-rpc.handlers.ts:77-114`
- License commands: Verified in `main.ts:67-78`
- postMessage pattern: Verified in `vscode.service.ts:172-180`

### Risks Identified

| Risk | Severity | Mitigation |
|------|----------|------------|
| `LicenseGetStatusResponse` missing `reason` field | MEDIUM | Add `reason` field in Task 4.1 |
| VS Code command execution from webview needs RPC | MEDIUM | Add `command:execute` RPC method in Task 4.2 |
| Navigation bypass from welcome view | LOW | UI has no escape (no sidebar/tabs), defense-in-depth in Task 3.2 |

### Edge Cases to Handle

- [ ] User with expired license -> Show "Your subscription has expired" message
- [ ] User with trial ended -> Show "Your trial has ended" message
- [ ] New user (no_license) -> Show "Welcome to Ptah" message
- [ ] RPC timeout on license status check -> Show error with retry button
- [ ] Icon fails to load -> Button text remains functional

---

## Batch 1: Navigation System Foundation (IN PROGRESS)

**Developer**: frontend-developer + backend-developer
**Tasks**: 3 | **Dependencies**: None
**Estimated Time**: 30 minutes

### TASK-1.1: Add 'welcome' to ViewType union - IMPLEMENTED

**Assigned To**: frontend-developer
**Dependencies**: None
**Files**:
- [MODIFY] `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\app-state.service.ts`

**Description**: Add 'welcome' to the ViewType union type to enable signal-based navigation to the welcome view. The ViewType union (line 11-17) currently includes 'chat', 'command-builder', 'analytics', 'context-tree', 'settings', and 'setup-wizard'. Add 'welcome' as a new valid view type.

**Pattern Reference**: `app-state.service.ts:11-17`

**Implementation Details**:
```typescript
export type ViewType =
  | 'chat'
  | 'command-builder'
  | 'analytics'
  | 'context-tree'
  | 'settings'
  | 'setup-wizard'
  | 'welcome';  // NEW: Add welcome view
```

**Acceptance Criteria**:
- [ ] 'welcome' added to ViewType union type
- [ ] TypeScript compiles without errors
- [ ] Existing navigation functionality unaffected

**Verification**: Run `nx typecheck core` - should pass with no errors

---

### TASK-1.2: Add 'welcome' to VALID_VIEWS array - IMPLEMENTED

**Assigned To**: backend-developer
**Dependencies**: None
**Files**:
- [MODIFY] `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\webview-html-generator.ts`

**Description**: Add 'welcome' to the VALID_VIEWS array (line 81-88) to allow the backend to set `initialView: 'welcome'` when generating webview HTML. This enables the license blocking flow to initialize the webview with the welcome view.

**Pattern Reference**: `webview-html-generator.ts:81-88`

**Implementation Details**:
```typescript
const VALID_VIEWS = [
  'chat',
  'command-builder',
  'analytics',
  'context-tree',
  'settings',
  'setup-wizard',
  'welcome',  // NEW: Add welcome view
];
```

**Acceptance Criteria**:
- [ ] 'welcome' added to VALID_VIEWS array
- [ ] `generateAngularWebviewContent` accepts `initialView: 'welcome'` without throwing
- [ ] TypeScript compiles without errors

**Verification**: Run `nx build ptah-extension-vscode` - should pass

---

### TASK-1.3: Update window.initialView typing - IMPLEMENTED

**Assigned To**: frontend-developer
**Dependencies**: TASK-1.1
**Files**:
- [MODIFY] `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\app-state.service.ts`

**Description**: Verify the `initializeState()` method (line 92-96) correctly handles the 'welcome' view type from `window.initialView`. The current implementation casts `window.initialView` to `ViewType`, which should automatically work after TASK-1.1 is complete. Add logging for debugging.

**Pattern Reference**: `app-state.service.ts:92-96`

**Acceptance Criteria**:
- [ ] `initializeState()` correctly sets 'welcome' as currentView when `window.initialView === 'welcome'`
- [ ] Console log added for debugging: `[AppStateManager] Initializing with view: ${initialView}`

**Verification**: Manual test - set `window.initialView = 'welcome'` in DevTools and reload

---

**Batch 1 Verification**:
- [ ] TypeScript compiles: `nx typecheck core && nx build ptah-extension-vscode`
- [ ] 'welcome' recognized as valid ViewType
- [ ] 'welcome' recognized as valid initialView

---

## Batch 2: WelcomeComponent Creation (IMPLEMENTED)

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 1
**Estimated Time**: 1.5 hours

### TASK-2.1: Create WelcomeComponent TypeScript file - IMPLEMENTED

**Assigned To**: frontend-developer
**Dependencies**: TASK-1.1
**Files**:
- [CREATE] `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\welcome.component.ts`

**Description**: Create the WelcomeComponent as a standalone Angular component following the settings.component.ts pattern. The component should:
1. Inject ClaudeRpcService and VSCodeService
2. Use signal-based state management for license status and loading state
3. Implement ngOnInit to fetch license status via RPC
4. Implement action methods for license key entry, pricing, and trial

**Pattern References**:
- Component structure: `settings.component.ts:37-162`
- RPC call pattern: `settings.component.ts:140-161`
- DaisyUI styling: `wizard-view.component.ts:70-124`

**Implementation Details**:
```typescript
@Component({
  selector: 'ptah-welcome',
  standalone: true,
  imports: [NgOptimizedImage, LucideAngularModule],
  templateUrl: './welcome.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WelcomeComponent implements OnInit {
  // Inject services
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);

  // Icons
  readonly KeyIcon = Key;
  readonly ExternalLinkIcon = ExternalLink;
  readonly SparklesIcon = Sparkles;
  readonly ZapIcon = Zap;
  readonly GitBranchIcon = GitBranch;
  readonly BotIcon = Bot;

  // State signals
  readonly licenseReason = signal<string | null>(null);
  readonly isLoadingStatus = signal(true);
  readonly errorMessage = signal<string | null>(null);

  // Ptah icon URI
  readonly ptahIconUri: string;

  // Feature highlights
  readonly features = [...];

  constructor() {
    this.ptahIconUri = this.vscodeService.getPtahIconUri();
  }

  async ngOnInit(): Promise<void> {
    await this.fetchLicenseStatus();
  }

  // Methods: getHeadline(), getSubheadline(), enterLicenseKey(), viewPricing(), startTrial(), retryStatus()
}
```

**Acceptance Criteria**:
- [ ] Component created with standalone: true
- [ ] Signal-based state for licenseReason, isLoadingStatus, errorMessage
- [ ] ngOnInit calls fetchLicenseStatus()
- [ ] getHeadline() returns context-aware message based on reason
- [ ] getSubheadline() returns context-aware description
- [ ] enterLicenseKey() calls RPC to execute command
- [ ] viewPricing() calls RPC to execute command
- [ ] startTrial() calls viewPricing()
- [ ] retryStatus() retries fetchLicenseStatus()
- [ ] Features array with 4 items (AI-Powered, Multi-Agent, VS Code Native, Session Continuity)

**Verification**: Run `nx typecheck chat` - should pass

---

### TASK-2.2: Create WelcomeComponent Template - IMPLEMENTED

**Assigned To**: frontend-developer
**Dependencies**: TASK-2.1
**Files**:
- [CREATE] `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\welcome.component.html`

**Description**: Create the HTML template for WelcomeComponent using DaisyUI hero layout. The template should be a full-page standalone layout with:
1. Ptah logo at top
2. Context-aware headline and subheadline
3. Feature highlights in 2x2 grid
4. Action buttons (Start Trial, Enter License Key)
5. View Pricing link
6. Error state with retry button

**Pattern References**:
- Hero layout: `wizard-view.component.ts:70-124` (inline template pattern)
- DaisyUI classes: `settings.component.html`

**Implementation Details**:
```html
<div class="hero min-h-screen bg-base-100">
  <div class="hero-content text-center max-w-2xl">
    <div class="flex flex-col items-center gap-6">
      <!-- Ptah Logo -->
      <img [ngSrc]="ptahIconUri" alt="Ptah" class="w-20 h-20" width="80" height="80" priority />

      <!-- Context-aware Headline -->
      <h1 class="text-4xl font-bold text-base-content">{{ getHeadline() }}</h1>

      <!-- Subheadline -->
      <p class="text-lg text-base-content/70 max-w-lg">{{ getSubheadline() }}</p>

      <!-- Feature Highlights Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 w-full max-w-xl">
        @for (feature of features; track feature.title) {
          <div class="card bg-base-200 p-4">
            <div class="flex items-start gap-3">
              <lucide-angular [img]="feature.icon" class="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div class="text-left">
                <h3 class="font-semibold text-sm">{{ feature.title }}</h3>
                <p class="text-xs text-base-content/60">{{ feature.description }}</p>
              </div>
            </div>
          </div>
        }
      </div>

      <!-- Action Buttons -->
      <div class="flex flex-col sm:flex-row gap-3 mt-6 w-full max-w-sm">
        <button class="btn btn-secondary btn-lg flex-1 gap-2" (click)="startTrial()" aria-label="Start 14-day free trial">
          <lucide-angular [img]="SparklesIcon" class="w-5 h-5" />
          Start 14-Day Trial
        </button>
        <button class="btn btn-primary btn-lg flex-1 gap-2" (click)="enterLicenseKey()" aria-label="Enter license key">
          <lucide-angular [img]="KeyIcon" class="w-5 h-5" />
          Enter License Key
        </button>
      </div>

      <!-- View Pricing Link -->
      <button class="btn btn-ghost btn-sm gap-1 text-base-content/60" (click)="viewPricing()" aria-label="View pricing options">
        <lucide-angular [img]="ExternalLinkIcon" class="w-4 h-4" />
        View Pricing
      </button>

      <!-- Error State -->
      @if (errorMessage()) {
        <div class="alert alert-warning mt-4 max-w-sm">
          <span>{{ errorMessage() }}</span>
          <button class="btn btn-sm btn-ghost" (click)="retryStatus()">Retry</button>
        </div>
      }
    </div>
  </div>
</div>
```

**Acceptance Criteria**:
- [ ] Hero layout with centered content
- [ ] Ptah logo displayed with ngSrc and priority loading
- [ ] Headline uses getHeadline() for context-aware text
- [ ] Subheadline uses getSubheadline()
- [ ] 4 feature cards in responsive grid
- [ ] Start Trial button with secondary style and Sparkles icon
- [ ] Enter License Key button with primary style and Key icon
- [ ] View Pricing ghost button with ExternalLink icon
- [ ] Error state renders with retry button
- [ ] All buttons have aria-label attributes

**Verification**: Visual inspection in webview - all elements render correctly

---

### TASK-2.3: Export WelcomeComponent from chat library - IMPLEMENTED

**Assigned To**: frontend-developer
**Dependencies**: TASK-2.1, TASK-2.2
**Files**:
- [MODIFY] `D:\projects\ptah-extension\libs\frontend\chat\src\index.ts`

**Description**: Add WelcomeComponent to the public API exports of the chat library so it can be imported by app-shell.component.ts.

**Implementation Details**:
```typescript
// Add to existing exports in index.ts
export { WelcomeComponent } from './lib/components/templates/welcome.component';
```

**Acceptance Criteria**:
- [ ] WelcomeComponent exported from `@ptah-extension/chat`
- [ ] No circular dependency errors

**Verification**: Run `nx build chat` - should pass

---

**Batch 2 Verification**:
- [ ] All files created with real implementations (no stubs/TODOs)
- [ ] Build passes: `nx build chat`
- [ ] code-logic-reviewer approved

---

## Batch 3: App Shell Integration (IMPLEMENTED)

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 2
**Estimated Time**: 30 minutes

### TASK-3.1: Add @case ('welcome') to app-shell template - IMPLEMENTED

**Assigned To**: frontend-developer
**Dependencies**: TASK-2.3
**Files**:
- [MODIFY] `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.html`

**Description**: Add a new `@case ('welcome')` block to the app-shell template's @switch directive. The welcome view should render in full-width standalone mode (no sidebar, no tabs) matching the pattern used by 'setup-wizard' and 'settings' views.

**Pattern Reference**: `app-shell.component.html:11-24`

**Implementation Details**:
Add after the `@case ('settings')` block (line 20-24), before `@default`:
```html
<!-- Welcome: Full-width, standalone layout (no sidebar, no tabs) -->
@case ('welcome') {
<div class="h-full w-full">
  <ptah-welcome />
</div>
}
```

**Acceptance Criteria**:
- [ ] `@case ('welcome')` added to @switch block
- [ ] Renders `<ptah-welcome />` component
- [ ] Uses full-width container (`h-full w-full`)
- [ ] No sidebar or tabs visible (standalone layout)

**Verification**: Manual test - set currentView to 'welcome' and verify full-page render

---

### TASK-3.2: Import WelcomeComponent in app-shell - IMPLEMENTED

**Assigned To**: frontend-developer
**Dependencies**: TASK-3.1
**Files**:
- [MODIFY] `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts`

**Description**: Import and add WelcomeComponent to the imports array of AppShellComponent. This allows the template to use `<ptah-welcome />`.

**Pattern Reference**: `app-shell.component.ts:69-87`

**Implementation Details**:
```typescript
// Add import at top
import { WelcomeComponent } from './welcome.component';

// Add to imports array in @Component
imports: [
  ChatViewComponent,
  SettingsComponent,
  WizardViewComponent,
  WelcomeComponent,  // NEW
  TabBarComponent,
  // ... rest of imports
],
```

**Acceptance Criteria**:
- [ ] WelcomeComponent imported from relative path
- [ ] WelcomeComponent added to imports array
- [ ] No TypeScript errors

**Verification**: Run `nx build chat` - should pass

---

**Batch 3 Verification**:
- [ ] Welcome view renders in standalone mode
- [ ] No sidebar visible when on welcome view
- [ ] No tab bar visible when on welcome view
- [ ] Build passes: `nx build chat`

---

## Batch 4: Backend License Flow & RPC Enhancement (IMPLEMENTED)

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 1
**Estimated Time**: 1.5 hours

### TASK-4.1: Add 'reason' field to LicenseGetStatusResponse - IMPLEMENTED

**Assigned To**: backend-developer
**Dependencies**: None
**Files**:
- [MODIFY] `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`

**Description**: Add an optional `reason` field to `LicenseGetStatusResponse` to enable context-aware welcome messaging. The reason field should indicate why the license is invalid (expired, trial_ended, no_license).

**Pattern Reference**: `rpc.types.ts:574-595`

**Implementation Details**:
```typescript
export interface LicenseGetStatusResponse {
  /** Whether the license is valid */
  valid: boolean;
  /** License tier (basic, pro, trial_basic, trial_pro, or expired) */
  tier: LicenseTier;
  /** Whether the user has premium features enabled (Pro tier) */
  isPremium: boolean;
  /** Whether the user has Basic tier features (convenience flag) */
  isBasic: boolean;
  /** Days remaining before subscription expires (null if not applicable) */
  daysRemaining: number | null;
  /** Whether user is currently in trial period */
  trialActive: boolean;
  /** Days remaining in trial period (null if not in trial) */
  trialDaysRemaining: number | null;
  /** Plan details (if has valid license) */
  plan?: {
    name: string;
    description: string;
    features: string[];
  };
  /** Reason for invalid license (for context-aware welcome messaging) */
  reason?: 'expired' | 'trial_ended' | 'no_license';
}
```

**Acceptance Criteria**:
- [ ] `reason` field added as optional
- [ ] Type is `'expired' | 'trial_ended' | 'no_license'`
- [ ] TypeScript compiles without errors

**Verification**: Run `nx typecheck shared` - should pass

---

### TASK-4.2: Map reason field in license-rpc.handlers.ts - IMPLEMENTED

**Assigned To**: backend-developer
**Dependencies**: TASK-4.1
**Files**:
- [MODIFY] `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\license-rpc.handlers.ts`

**Description**: Update `mapLicenseStatusToResponse()` method to include the `reason` field from the internal LicenseStatus. This maps the backend license reason to the RPC response.

**Pattern Reference**: `license-rpc.handlers.ts:129-161`

**Implementation Details**:
```typescript
private mapLicenseStatusToResponse(
  status: LicenseStatus
): LicenseGetStatusResponse {
  // ... existing code ...

  return {
    valid: status.valid,
    tier: status.tier as LicenseTier,
    isPremium,
    isBasic,
    daysRemaining: status.daysRemaining ?? null,
    trialActive,
    trialDaysRemaining: status.trialDaysRemaining ?? null,
    plan: status.plan
      ? {
          name: status.plan.name,
          description: status.plan.description,
          features: status.plan.features,
        }
      : undefined,
    // NEW: Map reason field for context-aware welcome messaging
    reason: status.reason as 'expired' | 'trial_ended' | 'no_license' | undefined,
  };
}
```

**Acceptance Criteria**:
- [ ] `reason` field mapped from `status.reason`
- [ ] Handles undefined reason gracefully
- [ ] TypeScript compiles without errors

**Verification**: Run `nx build ptah-extension-vscode` - should pass

---

### TASK-4.3: Add command:execute RPC method - IMPLEMENTED

**Assigned To**: backend-developer
**Dependencies**: None
**Files**:
- [MODIFY] `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`
- [CREATE] `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\command-rpc.handlers.ts`
- [MODIFY] `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc/rpc-method-registration.service.ts`

**Description**: Create a new RPC method `command:execute` that allows the webview to trigger VS Code commands. This is needed for the WelcomeComponent to execute `ptah.enterLicenseKey` and `ptah.openPricing` commands.

**Implementation Details**:

1. Add types to `rpc.types.ts`:
```typescript
/** Parameters for command:execute RPC method */
export interface CommandExecuteParams {
  /** VS Code command ID to execute */
  command: string;
  /** Optional arguments for the command */
  args?: unknown[];
}

/** Response from command:execute RPC method */
export interface CommandExecuteResponse {
  /** Whether command executed successfully */
  success: boolean;
  /** Error message if failed */
  error?: string;
}
```

2. Create `command-rpc.handlers.ts`:
```typescript
@injectable()
export class CommandRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler
  ) {}

  register(): void {
    this.rpcHandler.registerMethod<CommandExecuteParams, CommandExecuteResponse>(
      'command:execute',
      async (params) => {
        try {
          // Security: Only allow ptah.* commands from webview
          if (!params.command.startsWith('ptah.')) {
            return { success: false, error: 'Only ptah.* commands allowed' };
          }

          await vscode.commands.executeCommand(params.command, ...(params.args || []));
          return { success: true };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      }
    );

    this.logger.debug('Command RPC handlers registered', { methods: ['command:execute'] });
  }
}
```

3. Register in `rpc-method-registration.service.ts`

**Acceptance Criteria**:
- [ ] RPC types defined for command:execute
- [ ] Handler only allows `ptah.*` commands (security)
- [ ] Handler registered via RpcMethodRegistrationService
- [ ] Command execution works from webview

**Verification**: Manual test - call RPC from DevTools console

---

### TASK-4.4: Modify handleLicenseBlocking to show webview - IMPLEMENTED

**Assigned To**: backend-developer
**Dependencies**: TASK-1.2
**Files**:
- [MODIFY] `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\main.ts`

**Description**: Modify `handleLicenseBlocking()` function (line 88-105) to show the webview with `initialView: 'welcome'` instead of the blocking modal. This is the core change that replaces the modal with the embedded welcome page.

**Pattern Reference**: `main.ts:88-105` (current implementation)

**Implementation Details**:
```typescript
async function handleLicenseBlocking(
  context: vscode.ExtensionContext,
  licenseService: LicenseService,
  status: LicenseStatus
): Promise<void> {
  // Register minimal commands for license management
  registerLicenseOnlyCommands(context, licenseService);

  // TASK_2025_126: Show webview with welcome view instead of modal
  const { WebviewHtmlGenerator } = require('./services/webview-html-generator');
  const htmlGenerator = new WebviewHtmlGenerator(context);

  // Create minimal webview provider for unlicensed users
  const provider: vscode.WebviewViewProvider = {
    resolveWebviewView(webviewView: vscode.WebviewView): void {
      webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'webview', 'browser'),
          vscode.Uri.joinPath(context.extensionUri, 'assets'),
          context.extensionUri,
        ],
      };

      // Generate HTML with welcome view
      const workspaceInfo = {
        name: vscode.workspace.workspaceFolders?.[0]?.name || 'Workspace',
        path: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
      };

      webviewView.webview.html = htmlGenerator.generateAngularWebviewContent(
        webviewView.webview,
        { workspaceInfo, initialView: 'welcome' }
      );

      // Setup minimal message listener for RPC calls (license status, command execution)
      webviewView.webview.onDidReceiveMessage(async (message) => {
        // Handle RPC calls - minimal handler for unlicensed state
        if (message.type === 'rpc:call' || message.type === 'rpc:request') {
          // Delegate to RpcHandler if available
          // For now, handle license:getStatus inline
          if (message.method === 'license:getStatus') {
            const response = {
              success: true,
              data: {
                valid: false,
                tier: status.tier || 'expired',
                isPremium: false,
                isBasic: false,
                daysRemaining: null,
                trialActive: false,
                trialDaysRemaining: null,
                reason: status.reason,
              },
              correlationId: message.correlationId,
            };
            webviewView.webview.postMessage({ type: 'rpc:response', ...response });
          } else if (message.method === 'command:execute') {
            // Execute ptah.* commands only
            try {
              if (message.params?.command?.startsWith('ptah.')) {
                await vscode.commands.executeCommand(message.params.command);
                webviewView.webview.postMessage({
                  type: 'rpc:response',
                  success: true,
                  data: { success: true },
                  correlationId: message.correlationId,
                });
              }
            } catch (error) {
              webviewView.webview.postMessage({
                type: 'rpc:response',
                success: false,
                error: error instanceof Error ? error.message : String(error),
                correlationId: message.correlationId,
              });
            }
          }
        }
      });
    },
  };

  // Register the webview provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('ptah.main', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  console.log('[Activate] Webview registered with welcome view for unlicensed user');
  // DO NOT call showLicenseRequiredUI() - webview handles onboarding
}
```

**Acceptance Criteria**:
- [ ] handleLicenseBlocking no longer calls showLicenseRequiredUI()
- [ ] Webview registered with initialView: 'welcome'
- [ ] Minimal RPC handler for license:getStatus and command:execute
- [ ] License commands still registered before webview
- [ ] No blocking modal shown

**Verification**: Start extension with no license - should see welcome page, not modal

---

**Batch 4 Verification**:
- [ ] Build passes: `nx build ptah-extension-vscode`
- [ ] License status RPC returns reason field
- [ ] command:execute RPC works for ptah.* commands
- [ ] Extension starts with welcome view for unlicensed users
- [ ] Modal is not shown

---

## Implementation Order

1. **Batch 1** (Navigation Foundation): TASK-1.1, TASK-1.2, TASK-1.3 - Can run in parallel
2. **Batch 2** (WelcomeComponent): TASK-2.1 -> TASK-2.2 -> TASK-2.3 - Sequential
3. **Batch 3** (App Shell): TASK-3.1 -> TASK-3.2 - Sequential, depends on Batch 2
4. **Batch 4** (Backend): TASK-4.1 -> TASK-4.2, TASK-4.3, TASK-4.4 - Can partially parallel

## Developer Assignment Summary

| Batch | Developer | Tasks | Est. Time |
|-------|-----------|-------|-----------|
| 1 | frontend + backend | 3 | 30 min |
| 2 | frontend-developer | 3 | 1.5 hours |
| 3 | frontend-developer | 2 | 30 min |
| 4 | backend-developer | 4 | 1.5 hours |

**Total Estimated Time**: 4 hours

## Quality Gates

- [ ] All TypeScript compiles: `npm run typecheck:all`
- [ ] All builds pass: `npm run build:all`
- [ ] No stubs, placeholders, or TODO comments
- [ ] code-logic-reviewer approved each batch
- [ ] Manual verification of welcome page flow
- [ ] Theme testing (dark, light, high-contrast)
