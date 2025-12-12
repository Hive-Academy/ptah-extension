# libs/backend/template-generation - Template Processing & Generation

[Back to Main](../../../CLAUDE.md)

## Purpose

The **template-generation library** provides intelligent template processing and generation capabilities for Ptah Extension. It handles template loading, variable interpolation, Zod schema validation, and LLM-powered content generation. This library enables dynamic, context-aware generation of agent prompts, command definitions, and documentation.

## Boundaries

**Belongs here**:

- Template file loading and parsing
- Variable interpolation and substitution
- Schema validation using Zod
- LLM-powered template expansion
- Template caching and optimization
- Template metadata management

**Does NOT belong**:

- LLM provider implementations (belongs in `llm-abstraction`)
- Agent-specific business logic (belongs in `agent-generation`)
- File system operations (belongs in `vscode-core`)
- Workspace analysis (belongs in `workspace-intelligence`)

## Architecture

```
┌──────────────────────────────────────────────────────┐
│         Template Generation & Processing Layer        │
├──────────────────────────────────────────────────────┤
│  TemplateGeneratorService (Main entry point)         │
│  └─ Orchestrates template lifecycle                  │
├──────────────────────────────────────────────────────┤
│  Template Processing Pipeline                        │
│  ├─ Load template from file/string                   │
│  ├─ Parse frontmatter (YAML)                         │
│  ├─ Interpolate variables                            │
│  ├─ Validate against schema                          │
│  └─ Generate with LLM (optional)                     │
├──────────────────────────────────────────────────────┤
│  Schema Validation (Zod)                             │
│  ├─ Template schema definitions                      │
│  ├─ Frontmatter validation                           │
│  └─ Output validation                                │
├──────────────────────────────────────────────────────┤
│  LLM Integration                                     │
│  └─ Content expansion via llm-abstraction            │
└──────────────────────────────────────────────────────┘
```

## Key Files

### Main Service

- `services/template-generator.service.ts` - Core template generation orchestration

### Interfaces

- `interfaces/template-generator.interface.ts` - ITemplateGenerator interface
- `interfaces/template-context.interface.ts` - Template context definitions
- `interfaces/template-schema.interface.ts` - Schema definitions

### Error Handling

- `errors/template-generation.error.ts` - Template-specific error classes

### Dependency Injection

- `di/registration.ts` - DI registration function

## Dependencies

**Internal**:

- `@ptah-extension/shared` - Type definitions (Result, CorrelationId)
- `@ptah-extension/vscode-core` - Logger, FileSystemManager
- `@ptah-extension/llm-abstraction` - LLM provider abstraction

**External**:

- `tsyringe` (^4.10.0) - Dependency injection
- `@langchain/core` (^0.3.29) - Langchain abstractions
- `zod` (^3.23.8) - Schema validation and type inference
- `gray-matter` (^4.0.3) - YAML frontmatter parsing (implied, check actual deps)
- `vscode` (^1.96.0) - VS Code Extension API

## Import Path

```typescript
import { TemplateGeneratorService, registerTemplateGeneration } from '@ptah-extension/template-generation';

// Interface imports
import type { ITemplateGenerator, TemplateContext, TemplateGenerationRequest, TemplateGenerationResult, TemplateSchema } from '@ptah-extension/template-generation';

// Error imports
import { TemplateGenerationError, TemplateNotFoundError, TemplateValidationError, TemplateInterpolationError } from '@ptah-extension/template-generation';
```

## Commands

```bash
# Build library
nx build template-generation

# Run tests
nx test template-generation

# Type-check
nx run template-generation:typecheck

# Lint
nx lint template-generation
```

## Usage Examples

### Template Generator Service

```typescript
import { TemplateGeneratorService } from '@ptah-extension/template-generation';

const templateGenerator = container.resolve(TemplateGeneratorService);

// Generate content from template file
const result = await templateGenerator.generateFromFile({
  correlationId: 'corr-123',
  templatePath: '/templates/agent.template.md',
  context: {
    agentName: 'backend-developer',
    projectType: 'Node.js',
    frameworks: ['NestJS', 'TypeORM'],
    expertise: ['REST APIs', 'Database design', 'Authentication'],
  },
  schema: agentSchema, // Zod schema for validation
});

console.log(result.content);
// "# Backend Developer Agent\n\nExpertise: REST APIs, Database design..."

// Generate from template string
const result2 = await templateGenerator.generateFromString({
  correlationId: 'corr-456',
  template: `# {{agentName}} Agent

## Expertise
{{#each expertise}}
- {{this}}
{{/each}}
  `,
  context: {
    agentName: 'Frontend Developer',
    expertise: ['React', 'TypeScript', 'CSS'],
  },
});
```

### Template with Frontmatter

```markdown
---
name: backend-developer
version: 1.0.0
category: development
requiredContext:
  - projectType
  - frameworks
---

# {{agentName}} Agent

You are a {{projectType}} backend developer specializing in:
{{#each frameworks}}

- {{this}}
  {{/each}}

## Expertise

{{#each expertise}}

- {{this}}
  {{/each}}
```

### Schema Validation

```typescript
import { z } from 'zod';

// Define template schema
const agentSchema = z.object({
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  category: z.enum(['development', 'testing', 'architecture', 'documentation']),
  content: z.string().min(100),
  requiredContext: z.array(z.string()).optional(),
});

// Validate template output
const result = await templateGenerator.generateFromFile({
  templatePath: '/templates/agent.template.md',
  context: contextData,
  schema: agentSchema,
});

if (!result.isValid) {
  console.error('Validation errors:', result.errors);
  // [{ path: 'name', message: 'Required field missing' }]
}
```

### LLM-Powered Template Expansion

```typescript
// Generate content with LLM expansion
const result = await templateGenerator.generateWithLLM({
  correlationId: 'corr-789',
  templatePath: '/templates/agent.template.md',
  context: {
    agentName: 'backend-developer',
    projectType: 'Node.js',
  },
  llmConfig: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    prompt: 'Expand the template with detailed examples and best practices',
    temperature: 0.7,
  },
});

// Result includes LLM-expanded content
console.log(result.content);
// "# Backend Developer Agent\n\n## Expertise\n\n..."
// (with LLM-generated examples and detailed sections)
```

### Template Caching

```typescript
// Enable caching for frequently used templates
const generator = new TemplateGeneratorService({
  logger,
  cacheEnabled: true,
  cacheTTL: 300000, // 5 minutes
});

// First call: loads from disk
const result1 = await generator.generateFromFile({
  templatePath: '/templates/agent.template.md',
  context: context1,
});

// Second call: uses cached template (faster)
const result2 = await generator.generateFromFile({
  templatePath: '/templates/agent.template.md',
  context: context2,
});
```

### Template Metadata

```typescript
// Get template metadata without generating
const metadata = await templateGenerator.getTemplateMetadata({
  templatePath: '/templates/agent.template.md',
});

console.log(metadata);
// {
//   name: 'backend-developer',
//   version: '1.0.0',
//   category: 'development',
//   requiredContext: ['projectType', 'frameworks'],
//   fileSize: 1024,
//   lastModified: 1234567890
// }
```

### Batch Template Generation

```typescript
// Generate multiple templates in parallel
const results = await Promise.all([
  templateGenerator.generateFromFile({
    templatePath: '/templates/backend-developer.template.md',
    context: backendContext,
  }),
  templateGenerator.generateFromFile({
    templatePath: '/templates/frontend-developer.template.md',
    context: frontendContext,
  }),
  templateGenerator.generateFromFile({
    templatePath: '/templates/architect.template.md',
    context: architectContext,
  }),
]);

// Process results
results.forEach((result, index) => {
  if (result.isValid) {
    console.log(`Template ${index + 1} generated successfully`);
  } else {
    console.error(`Template ${index + 1} failed:`, result.errors);
  }
});
```

### Conditional Template Blocks

```markdown
---
name: agent-template
---

# {{agentName}} Agent

{{#if includeExpertise}}

## Expertise

{{#each expertise}}

- {{this}}
  {{/each}}
  {{/if}}

{{#if includeExamples}}

## Examples

{{#each examples}}

### {{this.title}}

{{this.description}}
{{/each}}
{{/if}}

{{#unless isMinimal}}

## Additional Information

{{additionalInfo}}
{{/unless}}
```

## Guidelines

### Template Structure

1. **Use YAML frontmatter for metadata**:

   ```markdown
   ---
   name: template-name
   version: 1.0.0
   category: development
   requiredContext:
     - projectType
     - frameworks
   ---

   # Template Content
   ```

2. **Follow Handlebars syntax for interpolation**:

   ```markdown
   # {{title}}

   {{#each items}}

   - {{this}}
     {{/each}}

   {{#if condition}}
   Conditional content
   {{/if}}
   ```

3. **Organize templates by category**:
   ```
   templates/
   ├── agents/
   │   ├── backend-developer.template.md
   │   ├── frontend-developer.template.md
   │   └── architect.template.md
   ├── commands/
   │   ├── help.template.md
   │   └── status.template.md
   └── docs/
       └── readme.template.md
   ```

### Variable Interpolation

1. **Provide all required context variables**:

   ```typescript
   // ✅ CORRECT - All required variables provided
   const result = await generator.generateFromFile({
     templatePath: '/templates/agent.template.md',
     context: {
       agentName: 'backend-developer',
       projectType: 'Node.js',
       frameworks: ['NestJS'],
     },
   });

   // ❌ WRONG - Missing required variables
   const result = await generator.generateFromFile({
     templatePath: '/templates/agent.template.md',
     context: {
       agentName: 'backend-developer',
       // Missing projectType, frameworks
     },
   });
   ```

2. **Use type-safe context objects**:

   ```typescript
   interface AgentContext {
     agentName: string;
     projectType: string;
     frameworks: string[];
     expertise: string[];
   }

   const context: AgentContext = {
     agentName: 'backend-developer',
     projectType: 'Node.js',
     frameworks: ['NestJS'],
     expertise: ['REST APIs'],
   };

   await generator.generateFromFile({ templatePath, context });
   ```

3. **Handle missing variables gracefully**:
   ```typescript
   // Provide defaults for optional variables
   const context = {
     agentName: 'backend-developer',
     projectType: projectType || 'Node.js',
     frameworks: frameworks || [],
     expertise: expertise || [],
   };
   ```

### Schema Validation

1. **Define schemas using Zod**:

   ```typescript
   import { z } from 'zod';

   const templateSchema = z.object({
     name: z.string().min(1),
     version: z.string().regex(/^\d+\.\d+\.\d+$/),
     category: z.enum(['development', 'testing', 'architecture']),
     content: z.string().min(100).max(50000),
     requiredContext: z.array(z.string()).optional(),
   });

   type TemplateType = z.infer<typeof templateSchema>;
   ```

2. **Validate output before using**:

   ```typescript
   const result = await generator.generateFromFile({
     templatePath,
     context,
     schema: templateSchema,
   });

   if (!result.isValid) {
     logger.error('Template validation failed', {
       errors: result.errors,
     });
     throw new TemplateValidationError(result.errors);
   }

   // Use validated content
   const validatedContent: TemplateType = result.content;
   ```

3. **Handle validation errors gracefully**:
   ```typescript
   try {
     const result = await generator.generateFromFile({
       templatePath,
       context,
       schema: templateSchema,
     });
   } catch (error) {
     if (error instanceof TemplateValidationError) {
       // Show user-friendly error message
       const errorSummary = error.errors.map((e) => `${e.path}: ${e.message}`).join(', ');
       showErrorMessage(`Template validation failed: ${errorSummary}`);
     }
   }
   ```

### LLM Integration

1. **Use LLM for content expansion sparingly**:

   ```typescript
   // ✅ Good use case: Generating examples, expanding sections
   const result = await generator.generateWithLLM({
     templatePath,
     context,
     llmConfig: {
       prompt: 'Add 3 detailed code examples for each expertise area',
     },
   });

   // ❌ Avoid: Using LLM for simple interpolation (unnecessary cost)
   const result = await generator.generateWithLLM({
     templatePath,
     context,
     llmConfig: {
       prompt: 'Replace {{agentName}} with backend-developer',
     },
   });
   ```

2. **Configure LLM parameters appropriately**:

   ```typescript
   const llmConfig = {
     provider: 'anthropic',
     model: 'claude-3-5-sonnet-20241022',
     temperature: 0.7, // Higher for creative content
     maxTokens: 2000,
     prompt: 'Expand template with detailed examples',
   };
   ```

3. **Handle LLM errors gracefully**:
   ```typescript
   try {
     const result = await generator.generateWithLLM({
       templatePath,
       context,
       llmConfig,
     });
   } catch (error) {
     // Fallback to template without LLM expansion
     logger.warn('LLM expansion failed, using template only', { error });
     const result = await generator.generateFromFile({
       templatePath,
       context,
     });
   }
   ```

### Error Handling

1. **Use typed error classes**:

   ```typescript
   import { TemplateNotFoundError, TemplateValidationError, TemplateInterpolationError } from '@ptah-extension/template-generation';

   try {
     const result = await generator.generateFromFile({ templatePath, context });
   } catch (error) {
     if (error instanceof TemplateNotFoundError) {
       console.error('Template not found:', error.templatePath);
     } else if (error instanceof TemplateValidationError) {
       console.error('Validation failed:', error.errors);
     } else if (error instanceof TemplateInterpolationError) {
       console.error('Interpolation failed:', error.variable);
     }
   }
   ```

2. **Provide context in error messages**:
   ```typescript
   throw new TemplateInterpolationError('Missing variable', {
     variable: 'projectType',
     templatePath: '/templates/agent.template.md',
     availableVariables: Object.keys(context),
   });
   ```

### Performance Optimization

1. **Enable caching for frequently used templates**:

   ```typescript
   const generator = new TemplateGeneratorService({
     logger,
     cacheEnabled: true,
     cacheTTL: 300000, // 5 minutes
     maxCacheSize: 100, // Max 100 templates
   });
   ```

2. **Use batch generation for multiple templates**:

   ```typescript
   // ✅ CORRECT - Parallel generation
   const results = await Promise.all(templatePaths.map((path) => generator.generateFromFile({ templatePath: path, context })));

   // ❌ AVOID - Sequential generation (slower)
   const results = [];
   for (const path of templatePaths) {
     const result = await generator.generateFromFile({
       templatePath: path,
       context,
     });
     results.push(result);
   }
   ```

3. **Minimize LLM calls**:

   ```typescript
   // Generate base content without LLM
   const baseResult = await generator.generateFromFile({
     templatePath,
     context,
   });

   // Use LLM only for specific sections
   if (needsExpansion) {
     const expandedResult = await generator.generateWithLLM({
       template: baseResult.content,
       llmConfig: { prompt: 'Expand examples section only' },
     });
   }
   ```

### Testing

1. **Mock template files for tests**:

   ```typescript
   const mockTemplate = `---
   name: test-agent
   ---
   
   # {{agentName}} Agent
   Expertise: {{expertise}}
   `;

   const result = await generator.generateFromString({
     template: mockTemplate,
     context: { agentName: 'Test', expertise: 'Testing' },
   });

   expect(result.content).toContain('# Test Agent');
   ```

2. **Test schema validation**:

   ```typescript
   it('should validate template output', async () => {
     const result = await generator.generateFromString({
       template: mockTemplate,
       context: { agentName: 'Test' },
       schema: z.object({ agentName: z.string() }),
     });

     expect(result.isValid).toBe(true);
   });
   ```

3. **Test error handling**:
   ```typescript
   it('should throw on missing template', async () => {
     await expect(
       generator.generateFromFile({
         templatePath: '/non-existent.template.md',
         context: {},
       })
     ).rejects.toThrow(TemplateNotFoundError);
   });
   ```

## Integration with Other Libraries

**Uses `@ptah-extension/llm-abstraction`**:

- LLM provider abstraction for content expansion
- Model selection and configuration
- Streaming support for large content

**Uses `@ptah-extension/vscode-core`**:

- Logger for structured logging
- FileSystemManager for template file I/O
- ErrorHandler for error boundaries

**Used by `@ptah-extension/agent-generation`**:

- Agent prompt generation
- Template-based agent creation
- Dynamic content generation

**Consumed by `apps/ptah-extension-vscode`**:

- Agent generation commands
- Template-based documentation generation

## Performance Characteristics

- **Template parsing**: ~5ms per template (cached)
- **Variable interpolation**: ~1ms per variable
- **Schema validation**: ~2ms per validation (Zod)
- **LLM expansion**: 500ms-2s (depends on model and prompt)
- **File I/O**: ~10ms per file read (cached after first load)

## Future Enhancements

- Template inheritance and composition
- Partial template support
- Custom helper functions for Handlebars
- Template versioning and migrations
- Visual template editor
- Template marketplace integration
- Multi-language template support

## Testing

```bash
# Run tests
nx test template-generation

# Run tests with coverage
nx test template-generation --coverage

# Run specific test
nx test template-generation --testFile=template-generator.service.spec.ts
```

## File Paths Reference

- **Services**: `src/lib/services/`
- **Interfaces**: `src/lib/interfaces/`
- **Errors**: `src/lib/errors/`
- **DI**: `src/lib/di/`
- **Entry Point**: `src/index.ts`
