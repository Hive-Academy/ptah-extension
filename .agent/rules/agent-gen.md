---
trigger: glob
globs: libs/backend/agent-generation/**/*.ts
---

# agent-gen - Intelligent Agent Generation System

**Active**: Working in `libs/backend/agent-generation/**/*.ts`

## Purpose

The **agent-generation library** orchestrates AI-powered generation of Claude agent markdown files (`.claude/agents/*.md`) tailored to workspace context using LLM providers, template management, and output validation.

## Responsibilities

✅ **Template Management**: Load, cache, parse Markdown + YAML frontmatter  
✅ **LLM Generation**: Invoke AI with workspace context  
✅ **Output Validation**: Zod schema, safety, accuracy checks  
✅ **File Writing**: Atomic I/O to `.claude/agents/`  
✅ **Agent Selection**: Project-based recommendations  
✅ **Setup Status**: State management

❌ **NOT**: LLM providers (→ llm-abstraction), Workspace analysis (→ workspace-intelligence)

## Services

```
libs/backend/agent-generation/src/lib/
├── services/
│   ├── template-storage.service.ts
│   ├── content-generation.service.ts
│   ├── output-validation.service.ts
│   ├── file-writer.service.ts
│   ├── agent-selection.service.ts
│   └── setup-status.service.ts
├── utils/content-processor.ts
├── patterns/index.ts
└── errors/agent-generation.error.ts
```

## Template Storage

### Format (Markdown + YAML)

```markdown
---
name: backend-developer
description: Backend specialist
version: 1.0.0
---

# Backend Developer

## Purpose

{{purpose}}

## Context

- Project: {{projectType}}
- Frameworks: {{frameworks}}
```

### Loading

```typescript
import { TemplateStorageService } from '@ptah-extension/agent-generation';

const templateStorage = container.resolve(TemplateStorageService);

const template = await templateStorage.loadTemplate('backend-developer');
// { name: 'backend-developer', content: '...', frontmatter: {...} }

const templates = await templateStorage.listTemplates();
// ['backend-developer', 'frontend-developer', 'architect']

const metadata = await templateStorage.getTemplateMetadata('backend-developer');
```

**Caching**: First call loads from disk, subsequent calls use cache.

## Content Generation

```typescript
import { ContentGenerationService } from '@ptah-extension/agent-generation';

const contentGen = container.resolve(ContentGenerationService);

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
// { content: '# Backend Developer\n...', metadata: {...}, validationErrors: [] }
```

### Retry Logic

```typescript
try {
  const result = await contentGen.generateContent(request);
} catch (error) {
  if (error instanceof GenerationFailedError) {
    // Retry with different model
    const retry = await contentGen.generateContent({
      ...request,
      model: 'claude-3-opus-20240229',
    });
  } else if (error instanceof TemplateNotFoundError) {
    logger.error('Template not found', { template: error.templateName });
  }
}
```

## Output Validation

```typescript
import { OutputValidationService } from '@ptah-extension/agent-generation';

const validator = container.resolve(OutputValidationService);

const validationResult = await validator.validate({
  content: generatedAgentContent,
  schema: agentContentSchema,
});

if (!validationResult.isValid) {
  console.error('Validation errors:', validationResult.errors);
  // [{ field: 'frontmatter.name', message: 'Required' }]
} else {
  await fileWriter.writeAgentFile({
    agentName: 'backend-developer',
    content: validationResult.data,
  });
}
```

**3-Stage Validation**: Schema (Zod) → Safety (XSS/injection) → Factual accuracy (optional)

## File Writer

```typescript
import { AgentFileWriterService } from '@ptah-extension/agent-generation';

const fileWriter = container.resolve(AgentFileWriterService);

await fileWriter.writeAgentFile({
  correlationId: 'corr-456',
  agentName: 'backend-developer',
  content: generatedContent,
  overwrite: false,
});
// Written to: .claude/agents/backend-developer.md

const existingAgents = await fileWriter.listAgentFiles();
// ['backend-developer.md', 'frontend-developer.md']

await fileWriter.deleteAgentFile({
  correlationId: 'corr-789',
  agentName: 'backend-developer',
});
```

### Overwrite Protection

```typescript
const exists = await fileWriter.agentFileExists('backend-developer');
if (exists) {
  const confirm = await promptUser('Overwrite?');
  await fileWriter.writeAgentFile({
    agentName: 'backend-developer',
    content,
    overwrite: confirm,
  });
}
```

## Agent Selection

```typescript
import { AgentSelectionService } from '@ptah-extension/agent-generation';

const agentSelection = container.resolve(AgentSelectionService);

const recommendations = await agentSelection.getRecommendations({
  correlationId: 'corr-111',
  projectType: 'Node.js',
  frameworks: ['NestJS', 'Angular'],
  complexity: 'high',
});
// [
//   { agentName: 'backend-developer', score: 0.95, reason: 'NestJS' },
//   { agentName: 'frontend-developer', score: 0.90, reason: 'Angular' },
//   { agentName: 'architect', score: 0.85, reason: 'High complexity' }
// ]

const agent = await agentSelection.selectAgent({
  correlationId: 'corr-222',
  agentName: 'backend-developer',
});
```

## Setup Status

```typescript
import { SetupStatusService } from '@ptah-extension/agent-generation';

const setupStatus = container.resolve(SetupStatusService);

const status = setupStatus.getStatus();
// { isInitialized: true, hasAgents: true, agentCount: 5, errors: [] }

setupStatus.updateStatus({
  isInitialized: true,
  hasAgents: true,
  agentCount: 5,
});

setupStatus.onStatusChange((newStatus) => {
  console.log('Status changed:', newStatus);
});
```

## Content Processor

```typescript
import { ContentProcessor } from '@ptah-extension/agent-generation';

// Parse frontmatter
const { frontmatter, content } = ContentProcessor.parseFrontmatter(`---
name: backend-developer
version: 1.0.0
---
# Backend
`);
// frontmatter: { name: 'backend-developer', version: '1.0.0' }
// content: '# Backend'

// Interpolate variables
const interpolated = ContentProcessor.interpolate('Project: {{projectType}}', { projectType: 'Node.js' });
// 'Project: Node.js'

const formatted = ContentProcessor.formatMarkdown(rawMarkdown);
```

## Orchestration Patterns

### Sequential

```typescript
import { SequentialPattern } from '@ptah-extension/agent-generation';

const result = await SequentialPattern.execute([async () => await templateStorage.loadTemplate('backend-developer'), async (template) => await contentGen.generateContent({ template }), async (content) => await fileWriter.writeAgentFile({ content })]);
```

### Parallel

```typescript
import { ParallelPattern } from '@ptah-extension/agent-generation';

const results = await ParallelPattern.execute([() => templateStorage.loadTemplate('backend-developer'), () => templateStorage.loadTemplate('frontend-developer'), () => templateStorage.loadTemplate('architect')]);
```

## Testing

```typescript
describe('ContentGenerationService', () => {
  let contentGen: ContentGenerationService;
  let mockLlmProvider: jest.Mocked<LlmProvider>;

  beforeEach(() => {
    mockLlmProvider = {
      generateContent: jest.fn().mockResolvedValue({
        content: '# Mock Agent',
        tokens: 100,
      }),
    };
    contentGen = new ContentGenerationService(mockLlmProvider, logger);
  });

  it('should generate with LLM', async () => {
    const result = await contentGen.generateContent({
      correlationId: 'corr-123',
      template: 'backend-developer',
      context: { projectType: 'Node.js' },
      model: 'claude-3-5-sonnet-20241022',
    });
    expect(result.content).toContain('# Mock Agent');
  });

  it('should validate content', async () => {
    const result = await validator.validate({
      content: invalidContent,
      schema: agentContentSchema,
    });
    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });
});
```

## Rules

1. **Template Caching** - Cache after first load. Never reload unless invalidated.

2. **Atomic Writes** - Write to temp file, then rename. Never partial writes.

3. **Overwrite Protection** - Throw if `overwrite: false` and file exists. Never silent overwrite.

4. **Validate Before Write** - Content MUST pass validation before disk write.

5. **Correlation IDs** - All operations MUST include correlation IDs for tracing.

6. **LLM Fallback** - If LLM fails, fall back to generic template. Never return empty.

7. **Type Safety** - All templates MUST have TypeScript interfaces for frontmatter.

## Commands

```bash
nx build agent-generation
nx test agent-generation
nx run agent-generation:typecheck
nx lint agent-generation
```
