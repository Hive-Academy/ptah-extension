# Ptah Template System Architecture Design

## Overview

The Ptah Template System provides a reusable .claude template framework that integrates seamlessly with existing user workspaces through namespace isolation and smart conflict resolution.

## 1. Template Bundle Structure (Inside Extension)

```
src/templates/
├── claude-templates/
│   ├── agents/
│   │   ├── ptah-manager.md           # Ptah's project manager
│   │   ├── ptah-developer.md         # Full-stack developer
│   │   ├── ptah-architect.md         # Software architect
│   │   ├── ptah-tester.md           # Senior tester
│   │   ├── ptah-reviewer.md         # Code reviewer
│   │   └── ptah-researcher.md       # Research expert
│   ├── commands/
│   │   ├── ptah-orchestrate.md      # Enhanced orchestrate
│   │   ├── ptah-review-code.md      # Code review workflow
│   │   ├── ptah-analyze.md          # Project analysis
│   │   └── ptah-help.md             # Ptah help system
│   ├── docs/
│   │   └── ptah-framework.md        # Ptah-specific docs
│   └── templates/
│       ├── claude-base.md           # Base CLAUDE.md template
│       └── mcp-base.json           # Base MCP configuration
```

## 2. Service Architecture Integration

```typescript
// New services to add to existing ServiceRegistry
interface PtahTemplateServices {
  templateManager: TemplateManagerService;
  deploymentService: DeploymentService;
  conflictResolver: ConflictResolverService;
  mcpConfigManager: McpConfigManagerService;
}

// Integration with existing services
interface ExistingPtahServices {
  workspaceManager: WorkspaceManagerService; // For workspace detection
  serviceRegistry: ServiceRegistry; // DI container
  commandHandlers: CommandHandlerService; // For ptah.* commands
  logger: Logger; // Existing logging
}
```

## 3. Core Services Design

### A. TemplateManagerService

```typescript
class TemplateManagerService {
  private templatePath: string;
  private templateRegistry: Map<string, TemplateDefinition>;

  // Load templates from extension bundle
  async loadTemplates(): Promise<void>;

  // Get available templates
  getAvailableTemplates(): TemplateDefinition[];

  // Get specific template content
  async getTemplate(templateId: string): Promise<TemplateContent>;

  // Template validation
  validateTemplate(template: TemplateDefinition): ValidationResult;
}
```

### B. DeploymentService

```typescript
class DeploymentService {
  private conflictResolver: ConflictResolverService;
  private workspaceManager: WorkspaceManagerService;

  // Main deployment method
  async deployTemplates(workspacePath: string, templates: string[]): Promise<DeploymentResult>;

  // Check what would be deployed (dry run)
  async previewDeployment(workspacePath: string, templates: string[]): Promise<DeploymentPreview>;

  // Rollback deployment
  async rollbackDeployment(deploymentId: string): Promise<void>;
}
```

### C. ConflictResolverService

```typescript
class ConflictResolverService {
  // Check for existing .claude setup
  async detectExistingSetup(workspacePath: string): Promise<ExistingSetup>

  // Resolve conflicts during deployment
  async resolveConflicts(
    existing: ExistingSetup,
    incoming: TemplateContent[]
  ): Promise<ConflictResolution>

  // Smart CLAUDE.md merging
  async mergeClaude MD(
    existingPath: string,
    ptahContent: string
  ): Promise<MergeResult>
}
```

## 4. Deployment Workflow Design

```typescript
interface DeploymentWorkflow {
  phase1: 'workspace-analysis';    // Detect existing setup
  phase2: 'conflict-detection';    // Find potential conflicts
  phase3: 'user-confirmation';     // Show preview, get approval
  phase4: 'atomic-deployment';     // Deploy with rollback capability
  phase5: 'validation';            // Verify deployment success
}

// Example deployment flow
async deployPtahTemplates(workspacePath: string) {
  // Phase 1: Analysis
  const existingSetup = await this.conflictResolver.detectExistingSetup(workspacePath);

  // Phase 2: Conflict Detection
  const conflicts = await this.conflictResolver.resolveConflicts(
    existingSetup,
    await this.templateManager.getTemplate('ptah-full')
  );

  // Phase 3: User Confirmation
  const preview = await this.deploymentService.previewDeployment(workspacePath, ['ptah-full']);
  const approved = await this.showDeploymentPreview(preview);

  if (!approved) return { cancelled: true };

  // Phase 4: Atomic Deployment
  return await this.deploymentService.deployTemplates(workspacePath, ['ptah-full']);
}
```

## 5. Integration with Existing Ptah Architecture

### A. ServiceRegistry Integration

```typescript
// In PtahExtension.ts
async initializeTemplateSystem() {
  const templateManager = new TemplateManagerService(this.context.extensionPath);
  const deploymentService = new DeploymentService(
    this.serviceRegistry.get('conflictResolver'),
    this.serviceRegistry.get('workspaceManager')
  );

  // Register new services
  this.serviceRegistry.register('templateManager', templateManager);
  this.serviceRegistry.register('deploymentService', deploymentService);

  // Load templates
  await templateManager.loadTemplates();
}
```

### B. Command Integration

```typescript
// New commands to add to existing CommandHandlerService
const PTAH_TEMPLATE_COMMANDS = {
  'ptah.enableSuperpowers': this.enableSuperpowers.bind(this),
  'ptah.manageMcp': this.manageMcp.bind(this),
  'ptah.deployTemplates': this.deployTemplates.bind(this),
  'ptah.showTemplatePreview': this.showTemplatePreview.bind(this),
};
```

## 6. Angular Webview Integration

### A. Template Management Component

```typescript
@Component({
  selector: 'app-template-manager',
  template: `
    <div class="template-manager egyptian-card">
      <h3>📜 Ptah Superpowers</h3>

      @if (!templatesEnabled()) {
      <div class="enable-superpowers">
        <p>Enable Ptah superpowers for this workspace?</p>
        <app-egyptian-button (click)="enableSuperpowers()"> ✨ Enable Superpowers </app-egyptian-button>
      </div>
      } @else {
      <div class="superpowers-active">
        <p>🎉 Ptah superpowers are active!</p>
        <div class="available-commands">
          <span class="command-tag">/ptah-orchestrate</span>
          <span class="command-tag">/ptah-review-code</span>
          <span class="command-tag">/ptah-analyze</span>
        </div>
      </div>
      }
    </div>
  `,
})
export class TemplateManagerComponent {
  templatesEnabled = signal(false);

  async enableSuperpowers() {
    const result = await this.vscode.postMessage('ptah.enableSuperpowers', {});
    if (result.success) {
      this.templatesEnabled.set(true);
    }
  }
}
```

## 7. File Conflict Resolution Strategy

```typescript
interface ConflictResolutionStrategy {
  // For .claude/agents/
  agentConflicts: 'namespace-isolation'; // ptah-* prefix avoids conflicts

  // For .claude/commands/
  commandConflicts: 'namespace-isolation'; // ptah-* prefix avoids conflicts

  // For CLAUDE.md
  claudeMdConflicts: 'smart-append'; // Append Ptah section

  // For .mcp.json
  mcpJsonConflicts: 'merge-with-ui'; // Merge + provide UI management
}
```

## 8. Performance Considerations

```typescript
interface PerformanceOptimizations {
  templateLoading: 'lazy-load-on-demand'; // Only load when needed
  bundleSize: 'compress-templates'; // Gzip templates in bundle
  deployment: 'atomic-with-backup'; // Fast deployment with safety
  validation: 'async-with-progress'; // Non-blocking with feedback
}
```

## 9. Success Metrics & Validation

```typescript
interface DeploymentValidation {
  templatesInstalled: boolean; // All ptah-* files present
  noConflicts: boolean; // No existing files overwritten
  claudeMdIntegrated: boolean; // CLAUDE.md enhanced
  commandsAccessible: boolean; // /ptah-* commands work
  mcpConfigManaged: boolean; // .mcp.json accessible via UI
}
```

## Key Benefits of This Architecture

1. **Non-Destructive**: Namespace isolation prevents conflicts
2. **Modular**: Each service has single responsibility
3. **Extensible**: Easy to add new templates/commands
4. **Integrated**: Leverages existing Ptah services
5. **User-Friendly**: Clear preview and rollback capabilities

## Implementation Phases

### Phase 1: Core Infrastructure

- TemplateManagerService implementation
- Basic template loading from extension bundle
- ServiceRegistry integration

### Phase 2: Deployment System

- DeploymentService implementation
- ConflictResolverService for workspace analysis
- Atomic deployment with rollback

### Phase 3: UI Integration

- Angular component for template management
- VS Code command integration
- User confirmation workflows

### Phase 4: Advanced Features

- MCP configuration management UI
- Template update mechanism
- Advanced conflict resolution

## Questions for Validation

1. **Template Storage**: Should templates be embedded in extension bundle or fetched dynamically?
2. **Conflict Resolution**: How aggressive should auto-resolution be vs. user choice?
3. **Update Strategy**: How should template updates be handled in deployed workspaces?
4. **Rollback Granularity**: Individual files or complete deployment rollback?
5. **UI Integration**: Should template management be in sidebar, command palette, or both?

## Next Steps

1. Create template files (ptah-\* agents and commands)
2. Implement TemplateManagerService
3. Build basic deployment workflow
4. Create Angular UI components
5. Test with various workspace scenarios
