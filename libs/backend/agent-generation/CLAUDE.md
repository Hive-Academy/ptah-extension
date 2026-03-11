# libs/backend/agent-generation - Intelligent Agent Generation System

[Back to Main](../../../CLAUDE.md)

## Purpose

The **agent-generation library** provides intelligent, project-adaptive agent generation infrastructure for Ptah Extension. It offers utilities for content processing, orchestration patterns, template management, and LLM-powered agent prompt generation. This library enables dynamic creation of Claude agent markdown files tailored to workspace context.

## Boundaries

**Belongs here**:

- Agent generation orchestration and workflow patterns
- Template storage, loading, and management
- Content generation via LLM providers
- Output validation and schema enforcement
- Agent file writing and lifecycle management
- Agent selection and recommendation
- Setup status tracking and verification
- Content processing utilities (markdown, frontmatter, interpolation)

**Does NOT belong**:

- LLM provider implementations (belongs in `llm-abstraction`)
- VS Code API wrappers (belongs in `vscode-core`)
- Workspace analysis (belongs in `workspace-intelligence`)
- Business logic for specific agents (belongs in generated `.claude/agents/*.md` files)

## Architecture

```
┌──────────────────────────────────────────────────────┐
│       Agent Generation Orchestration Layer            │
├──────────────────────────────────────────────────────┤
│  Generation Services                                  │
│  ├─ ContentGenerationService   - LLM content gen     │
│  ├─ OutputValidationService    - Schema validation   │
│  ├─ AgentFileWriterService     - File I/O            │
│  ├─ AgentSelectionService      - Agent selection     │
│  ├─ SetupStatusService         - Setup tracking      │
│  └─ VsCodeLmService            - VS Code LM API      │
├──────────────────────────────────────────────────────┤
│  Setup Wizard (Facade + Child Services)              │
│  └─ SetupWizardService (Facade)                      │
│     ├─ WizardWebviewLifecycleService - Panel mgmt    │
│     ├─ WizardSessionManagerService   - Session CRUD  │
│     ├─ WizardStepMachineService      - Step machine  │
│     ├─ DeepProjectAnalysisService    - Architecture  │
│     ├─ CodeHealthAnalysisService     - Code health   │
│     └─ WizardContextMapperService    - Context map   │
├──────────────────────────────────────────────────────┤
│  Template Management                                  │
│  └─ TemplateStorageService                           │
│     ├─ Template loading from assets                  │
│     ├─ Frontmatter parsing (YAML)                    │
│     └─ Template caching                              │
├──────────────────────────────────────────────────────┤
│  Content Processing Utilities                        │
│  └─ ContentProcessor                                 │
│     ├─ Markdown formatting                           │
│     ├─ Frontmatter extraction                        │
│     └─ Variable interpolation                        │
├──────────────────────────────────────────────────────┤
│  Orchestration Patterns                              │
│  └─ Patterns                                         │
│     ├─ Sequential execution                          │
│     ├─ Parallel execution                            │
│     └─ Conditional branching                         │
├──────────────────────────────────────────────────────┤
│  Type System                                         │
│  ├─ Template types                                   │
│  ├─ Generation types                                 │
│  ├─ Validation types                                 │
│  └─ Orchestration types                              │
├──────────────────────────────────────────────────────┤
│  Error Handling                                      │
│  └─ AgentGenerationError (base class)               │
│     ├─ TemplateNotFoundError                        │
│     ├─ ValidationError                               │
│     └─ GenerationFailedError                         │
└──────────────────────────────────────────────────────┘
```

## Key Files

### Services

- `services/template-storage.service.ts` - Template loading and caching
- `services/content-generation.service.ts` - LLM-powered content generation
- `services/output-validation.service.ts` - Zod schema validation
- `services/file-writer.service.ts` - Agent file writing (.claude/agents/)
- `services/agent-selection.service.ts` - Agent selection and recommendation
- `services/vscode-lm.service.ts` - VS Code Language Model API integration
- `services/setup-status.service.ts` - Setup state tracking and verification
- `services/setup-wizard.service.ts` - Setup wizard facade (orchestrates child services)

### Wizard Child Services (TASK_2025_115)

The setup wizard functionality has been decomposed following SRP into focused child services:

- `services/wizard/webview-lifecycle.service.ts` - Webview panel creation, RPC responses, progress emission
- `services/wizard/session-manager.service.ts` - Session CRUD and workspace state persistence (24hr expiry)
- `services/wizard/step-machine.service.ts` - Step state machine (welcome->scan->review->select->generate->complete)
- `services/wizard/deep-analysis.service.ts` - Architecture pattern detection, key file locations, language stats
- `services/wizard/code-health.service.ts` - Diagnostics summary, code conventions, test coverage estimation
- `services/wizard/context-mapper.service.ts` - Frontend-to-backend context transformation
- `services/wizard/index.ts` - Barrel exports for all wizard child services

### Utilities

- `utils/content-processor.ts` - Markdown and frontmatter processing

### Patterns

- `patterns/index.ts` - Orchestration pattern definitions

### Type System

- `types/template.types.ts` - Template type definitions
- `types/generation.types.ts` - Generation request/response types
- `types/validation.types.ts` - Validation schema types
- `types/orchestration.types.ts` - Orchestration workflow types

### Errors

- `errors/agent-generation.error.ts` - Hierarchy of error classes

### Dependency Injection

- `di/tokens.ts` - DI tokens for agent-generation services
- `interfaces/index.ts` - Service interface definitions

## Dependencies

**Internal**:

- `@ptah-extension/shared` - Type definitions (Result, CorrelationId)
- `@ptah-extension/vscode-core` - Logger, FileSystemManager, TOKENS
- `@ptah-extension/llm-abstraction` - LLM provider abstraction
- `@ptah-extension/workspace-intelligence` - Workspace analysis

**External**:

- `tsyringe` (^4.10.0) - Dependency injection
- `vscode` (^1.96.0) - VS Code Extension API
- `eventemitter3` (^5.0.1) - Event emitters
- `rxjs` (^7.8.1) - Reactive programming
- `gray-matter` (^4.0.3) - YAML frontmatter parsing
- `zod` (^3.23.8) - Schema validation

## Import Path

```typescript
import { TemplateStorageService, ContentGenerationService, OutputValidationService, AgentFileWriterService, AgentSelectionService, VsCodeLmService, SetupStatusService, ContentProcessor } from '@ptah-extension/agent-generation';

// Type imports
import type { AgentTemplate, GenerationRequest, GenerationResult, SetupStatus } from '@ptah-extension/agent-generation';

// Error imports
import { AgentGenerationError, TemplateNotFoundError, ValidationError, GenerationFailedError } from '@ptah-extension/agent-generation';
```

## Commands

```bash
# Build library (includes template assets)
nx build agent-generation

# Run tests
nx test agent-generation

# Type-check
nx run agent-generation:typecheck

# Lint
nx lint agent-generation
```

## Usage Examples

### Template Storage Service

```typescript
import { TemplateStorageService } from '@ptah-extension/agent-generation';

const templateStorage = container.resolve(TemplateStorageService);

// Load template by name
const template = await templateStorage.loadTemplate('backend-developer');
// Returns: { name: 'backend-developer', content: '...', frontmatter: {...} }

// List all available templates
const templates = await templateStorage.listTemplates();
// Returns: ['backend-developer', 'frontend-developer', 'architect', ...]

// Get template metadata
const metadata = await templateStorage.getTemplateMetadata('backend-developer');
// Returns: { name: 'backend-developer', description: '...', version: '1.0.0' }
```

### Content Generation Service

```typescript
import { ContentGenerationService } from '@ptah-extension/agent-generation';

const contentGen = container.resolve(ContentGenerationService);

// Generate agent content using LLM
const result = await contentGen.generateContent({
  correlationId: 'corr-123',
  template: 'backend-developer',
  context: {
    projectType: 'Node.js',
    frameworks: ['NestJS', 'TypeORM'],
    codeStyle: 'functional',
    testingFramework: 'Jest',
  },
  model: 'claude-3-5-sonnet-20241022',
});

// Returns:
// {
//   content: '# Backend Developer Agent\n\n...',
//   metadata: { model: 'claude-3-5-sonnet-20241022', tokens: 1500 },
//   validationErrors: []
// }
```

### Output Validation Service

```typescript
import { OutputValidationService } from '@ptah-extension/agent-generation';

const validator = container.resolve(OutputValidationService);

// Validate generated content against schema
const validationResult = await validator.validate({
  content: generatedAgentContent,
  schema: agentContentSchema, // Zod schema
});

if (!validationResult.isValid) {
  console.error('Validation errors:', validationResult.errors);
  // [{ field: 'frontmatter.name', message: 'Required field missing' }]
}
```

### Agent File Writer Service

```typescript
import { AgentFileWriterService } from '@ptah-extension/agent-generation';

const fileWriter = container.resolve(AgentFileWriterService);

// Write agent file to .claude/agents/
await fileWriter.writeAgentFile({
  correlationId: 'corr-456',
  agentName: 'backend-developer',
  content: generatedContent,
  overwrite: false, // Prevent overwriting existing files
});

// File written to: .claude/agents/backend-developer.md

// List existing agent files
const existingAgents = await fileWriter.listAgentFiles();
// Returns: ['backend-developer.md', 'frontend-developer.md', ...]

// Delete agent file
await fileWriter.deleteAgentFile({
  correlationId: 'corr-789',
  agentName: 'backend-developer',
});
```

### Agent Selection Service

```typescript
import { AgentSelectionService } from '@ptah-extension/agent-generation';

const agentSelection = container.resolve(AgentSelectionService);

// Get agent recommendations based on workspace
const recommendations = await agentSelection.getRecommendations({
  correlationId: 'corr-111',
  projectType: 'Node.js',
  frameworks: ['NestJS', 'Angular'],
  complexity: 'high',
});

// Returns:
// [
//   { agentName: 'backend-developer', score: 0.95, reason: 'NestJS expertise' },
//   { agentName: 'frontend-developer', score: 0.90, reason: 'Angular expertise' },
//   { agentName: 'architect', score: 0.85, reason: 'High complexity project' }
// ]

// Select agent by name
const agent = await agentSelection.selectAgent({
  correlationId: 'corr-222',
  agentName: 'backend-developer',
});
```

### Setup Status Service

```typescript
import { SetupStatusService } from '@ptah-extension/agent-generation';

const setupStatus = container.resolve(SetupStatusService);

// Get current setup status
const status = setupStatus.getStatus();
// Returns:
// {
//   isInitialized: true,
//   hasAgents: true,
//   agentCount: 5,
//   lastGeneratedAt: 1234567890,
//   errors: []
// }

// Update setup status
setupStatus.updateStatus({
  isInitialized: true,
  hasAgents: true,
  agentCount: 5,
});

// Watch for status changes
setupStatus.onStatusChange((newStatus) => {
  console.log('Setup status changed:', newStatus);
});
```

### VS Code LM Service

```typescript
import { VsCodeLmService } from '@ptah-extension/agent-generation';

const vsCodeLm = container.resolve(VsCodeLmService);

// Generate content using VS Code Language Model API
const result = await vsCodeLm.generateContent({
  correlationId: 'corr-333',
  prompt: 'Generate a backend developer agent for NestJS',
  model: 'claude-3-5-sonnet-20241022',
  temperature: 0.7,
  maxTokens: 2000,
});

// Returns:
// {
//   content: '# Backend Developer Agent\n\n...',
//   model: 'claude-3-5-sonnet-20241022',
//   tokens: 1500
// }
```

### Content Processor Utilities

```typescript
import { ContentProcessor } from '@ptah-extension/agent-generation';

// Parse frontmatter from markdown
const { frontmatter, content } = ContentProcessor.parseFrontmatter(`---
name: backend-developer
description: Backend development agent
---

# Backend Developer Agent
`);

// Returns:
// frontmatter: { name: 'backend-developer', description: '...' }
// content: '# Backend Developer Agent'

// Interpolate variables in template
const interpolated = ContentProcessor.interpolate('Hello {{name}}, your project is {{projectType}}', { name: 'John', projectType: 'Node.js' });
// Returns: 'Hello John, your project is Node.js'

// Format markdown
const formatted = ContentProcessor.formatMarkdown(rawMarkdown);
```

## Guidelines

### Template Management

1. **Templates stored in `templates/` directory**:

   ```
   libs/backend/agent-generation/templates/
   ├── backend-developer.template.md
   ├── frontend-developer.template.md
   ├── architect.template.md
   └── ...
   ```

2. **Template format (Markdown + YAML frontmatter)**:

   ```markdown
   ---
   name: backend-developer
   description: Backend development specialist
   version: 1.0.0
   category: development
   ---

   # Backend Developer Agent

   ## Purpose

   {{purpose}}

   ## Expertise

   {{expertise}}
   ```

3. **Template variables**:
   - Use `{{variableName}}` for interpolation
   - Variables provided in `GenerationRequest.context`
   - ContentProcessor handles interpolation

### Content Generation

1. **Use LLM provider for adaptive generation**:

   ```typescript
   // LLM analyzes workspace and generates tailored content
   const result = await contentGen.generateContent({
     template: 'backend-developer',
     context: {
       projectType: 'Node.js',
       frameworks: ['NestJS'],
       // LLM adapts content based on context
     },
   });
   ```

2. **Validate output before writing**:

   ```typescript
   const validationResult = await validator.validate({
     content: result.content,
     schema: agentContentSchema,
   });

   if (!validationResult.isValid) {
     throw new ValidationError(validationResult.errors);
   }

   await fileWriter.writeAgentFile({
     agentName: 'backend-developer',
     content: result.content,
   });
   ```

3. **Handle generation errors gracefully**:
   ```typescript
   try {
     const result = await contentGen.generateContent(request);
   } catch (error) {
     if (error instanceof GenerationFailedError) {
       // Retry with different model or fallback to template
     } else {
       throw error;
     }
   }
   ```

### File Writing

1. **Always use AgentFileWriterService**:

   ```typescript
   // ✅ CORRECT - Use service
   await fileWriter.writeAgentFile({
     agentName: 'backend-developer',
     content: generatedContent,
   });

   // ❌ WRONG - Direct file system access
   fs.writeFileSync('.claude/agents/backend-developer.md', content);
   ```

2. **Handle existing files**:

   ```typescript
   await fileWriter.writeAgentFile({
     agentName: 'backend-developer',
     content: generatedContent,
     overwrite: false, // Throw error if file exists
   });

   // Or check before writing:
   const existingAgents = await fileWriter.listAgentFiles();
   if (existingAgents.includes('backend-developer.md')) {
     // Prompt user for confirmation
   }
   ```

3. **Use correlation IDs for tracking**:
   ```typescript
   await fileWriter.writeAgentFile({
     correlationId: correlationId,
     agentName: 'backend-developer',
     content: generatedContent,
   });
   // Logs include correlationId for tracing
   ```

### Error Handling

1. **Use typed error classes**:

   ```typescript
   import { AgentGenerationError, TemplateNotFoundError, ValidationError } from '@ptah-extension/agent-generation';

   try {
     const template = await templateStorage.loadTemplate('non-existent');
   } catch (error) {
     if (error instanceof TemplateNotFoundError) {
       console.error('Template not found:', error.templateName);
     } else if (error instanceof AgentGenerationError) {
       console.error('Generation error:', error.message);
     }
   }
   ```

2. **Propagate context in errors**:
   ```typescript
   throw new GenerationFailedError('LLM generation failed', {
     correlationId,
     template: 'backend-developer',
     model: 'claude-3-5-sonnet-20241022',
     cause: originalError,
   });
   ```

### Testing

1. **Mock LLM provider for tests**:

   ```typescript
   const mockLlmProvider = {
     generateContent: jest.fn().mockResolvedValue({
       content: '# Mock Agent Content',
       tokens: 100,
     }),
   };

   const contentGen = new ContentGenerationService(mockLlmProvider, logger);
   ```

2. **Test template loading**:

   ```typescript
   it('should load template from assets', async () => {
     const template = await templateStorage.loadTemplate('backend-developer');

     expect(template.name).toBe('backend-developer');
     expect(template.content).toContain('# Backend Developer Agent');
     expect(template.frontmatter).toHaveProperty('name');
   });
   ```

3. **Test validation**:

   ```typescript
   it('should validate generated content', async () => {
     const result = await validator.validate({
       content: invalidContent,
       schema: agentContentSchema,
     });

     expect(result.isValid).toBe(false);
     expect(result.errors).toHaveLength(2);
   });
   ```

## Orchestration Patterns

### Sequential Execution

```typescript
import { SequentialPattern } from '@ptah-extension/agent-generation';

// Execute steps in sequence
const result = await SequentialPattern.execute([
  async () => {
    const template = await templateStorage.loadTemplate('backend-developer');
    return { template };
  },
  async ({ template }) => {
    const content = await contentGen.generateContent({ template });
    return { template, content };
  },
  async ({ content }) => {
    await fileWriter.writeAgentFile({ content });
    return { success: true };
  },
]);
```

### Parallel Execution

```typescript
import { ParallelPattern } from '@ptah-extension/agent-generation';

// Execute tasks in parallel
const results = await ParallelPattern.execute([() => templateStorage.loadTemplate('backend-developer'), () => templateStorage.loadTemplate('frontend-developer'), () => templateStorage.loadTemplate('architect')]);
```

### Conditional Branching

```typescript
import { ConditionalPattern } from '@ptah-extension/agent-generation';

// Execute based on condition
const result = await ConditionalPattern.execute({
  condition: () => setupStatus.getStatus().hasAgents,
  ifTrue: () => agentSelection.getRecommendations(),
  ifFalse: () => templateStorage.listTemplates(),
});
```

## Integration with Other Libraries

**Uses `@ptah-extension/llm-abstraction`**:

- LLM provider abstraction for content generation
- Model selection (Anthropic, OpenAI, VS Code LM)
- Streaming support for long content

**Uses `@ptah-extension/workspace-intelligence`**:

- Project type detection for agent recommendations
- Framework detection for context building
- Workspace analysis for adaptive generation

**Uses `@ptah-extension/vscode-core`**:

- Logger for structured logging
- FileSystemManager for file I/O
- ErrorHandler for error boundaries

**Consumed by `apps/ptah-extension-vscode`**:

- Agent generation commands
- Setup wizard integration
- Agent selection UI

## Performance Considerations

- **Template caching**: Templates loaded once and cached
- **LLM streaming**: Use streaming for long content generation
- **Parallel validation**: Validate multiple agents in parallel
- **Incremental file writes**: Write files incrementally to avoid blocking

## Future Enhancements

- Multi-language template support (internationalization)
- Agent version management (upgrade/downgrade)
- Agent marketplace integration
- Custom template creation UI
- Agent performance analytics
- A/B testing for agent prompts

## Testing

```bash
# Run tests
nx test agent-generation

# Run tests with coverage
nx test agent-generation --coverage

# Run specific test
nx test agent-generation --testFile=content-generation.service.spec.ts
```

## File Paths Reference

- **Services**: `src/lib/services/`
- **Wizard Services**: `src/lib/services/wizard/` (child services for setup wizard)
- **Utilities**: `src/lib/utils/`
- **Patterns**: `src/lib/patterns/`
- **Types**: `src/lib/types/`
- **Errors**: `src/lib/errors/`
- **Interfaces**: `src/lib/interfaces/`
- **DI**: `src/lib/di/`
- **Templates**: `templates/` (bundled as assets)
- **Entry Point**: `src/index.ts`
