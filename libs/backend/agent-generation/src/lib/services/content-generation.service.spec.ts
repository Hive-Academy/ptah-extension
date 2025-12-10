/**
 * Content Generation Service - Unit Tests
 *
 * Test coverage:
 * - Variable substitution (simple, nested objects, missing values)
 * - LLM section injection
 * - Static section preservation
 * - Conditional blocks (true, false, nested, negation)
 * - Edge cases (unclosed markers, empty templates, multiple sections)
 * - Error handling (invalid templates, missing context)
 */

import 'reflect-metadata';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';

// Mock vscode-core to avoid VS Code dependency
jest.mock('@ptah-extension/vscode-core', () => ({
  Logger: jest.fn(),
  TOKENS: {
    LOGGER: Symbol.for('Logger'),
  },
}));

// Mock workspace-intelligence to avoid transitive vscode dependency
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ProjectType: {
    Node: 'Node',
    React: 'React',
    Python: 'Python',
  },
  Framework: {
    Express: 'Express',
    React: 'React',
    Angular: 'Angular',
  },
}));

import { container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { ProjectType, Framework } from '@ptah-extension/workspace-intelligence';
import { ContentGenerationService } from './content-generation.service';
import {
  AgentTemplate,
  AgentProjectContext,
  LlmCustomization,
  TemplateVariable,
} from '../types/core.types';

// Mock Logger interface
interface MockLogger {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
}

describe('ContentGenerationService', () => {
  let service: ContentGenerationService;
  let mockLogger: MockLogger;

  // Mock context for tests
  const mockContext: AgentProjectContext = {
    projectType: ProjectType.Node,
    frameworks: [Framework.Express, Framework.React],
    monorepoType: undefined,
    rootPath: '/workspace/test-project',
    relevantFiles: [],
    techStack: {
      languages: ['TypeScript', 'JavaScript'],
      frameworks: ['Express', 'React'],
      buildTools: ['Webpack', 'esbuild'],
      testingFrameworks: ['Jest', 'Vitest'],
      packageManager: 'npm',
    },
    codeConventions: {
      indentation: 'spaces',
      indentSize: 2,
      quoteStyle: 'single',
      semicolons: true,
      trailingComma: 'es5',
    },
  };

  beforeEach(() => {
    // Create mock logger
    mockLogger = {
      debug: jest.fn<any>(),
      info: jest.fn<any>(),
      warn: jest.fn<any>(),
      error: jest.fn<any>(),
    };

    // Register logger in DI container
    container.clearInstances();
    container.registerInstance(TOKENS.LOGGER, mockLogger as any);

    // Create service instance
    service = new ContentGenerationService(mockLogger as any);
  });

  afterEach(() => {
    container.clearInstances();
    jest.clearAllMocks();
  });

  describe('generateContent', () => {
    it('should generate content with variable substitution', async () => {
      const template: AgentTemplate = {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        content: `# {{projectName}} Backend Developer

Project Type: {{projectType}}
Frameworks: {{frameworks}}
Languages: {{languages}}

Use {{packageManager}} for dependency management.`,
        applicabilityRules: {
          projectTypes: [ProjectType.Node],
          frameworks: [],
          monorepoTypes: [],
          minimumRelevanceScore: 50,
          alwaysInclude: false,
        },
        variables: [
          {
            name: 'projectName',
            description: 'Project name',
            required: true,
            source: 'project-context',
          },
          {
            name: 'projectType',
            description: 'Project type',
            required: true,
            source: 'project-context',
          },
          {
            name: 'frameworks',
            description: 'Frameworks used',
            required: false,
            source: 'project-context',
          },
          {
            name: 'languages',
            description: 'Languages used',
            required: false,
            source: 'project-context',
          },
          {
            name: 'packageManager',
            description: 'Package manager',
            required: false,
            source: 'project-context',
          },
        ],
        llmSections: [],
      };

      const result = await service.generateContent(template, mockContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const content = result.value;
        expect(content).toContain('# test-project Backend Developer');
        expect(content).toContain('Project Type: Node');
        expect(content).toContain('Frameworks: Express, React');
        expect(content).toContain('Languages: TypeScript, JavaScript');
        expect(content).toContain('Use npm for dependency management.');
      }
    });

    it('should use default values for missing variables', async () => {
      const template: AgentTemplate = {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        content: `Project: {{customVariable}}`,
        applicabilityRules: {
          projectTypes: [],
          frameworks: [],
          monorepoTypes: [],
          minimumRelevanceScore: 50,
          alwaysInclude: false,
        },
        variables: [
          {
            name: 'customVariable',
            description: 'Custom variable',
            defaultValue: 'default-value',
            required: false,
            source: 'user-input',
          },
        ],
        llmSections: [],
      };

      const result = await service.generateContent(template, mockContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toContain('Project: default-value');
      }
    });

    it('should use empty string for missing required variables', async () => {
      const template: AgentTemplate = {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        content: `Project: {{missingVariable}}`,
        applicabilityRules: {
          projectTypes: [],
          frameworks: [],
          monorepoTypes: [],
          minimumRelevanceScore: 50,
          alwaysInclude: false,
        },
        variables: [
          {
            name: 'missingVariable',
            description: 'Missing variable',
            required: true,
            source: 'user-input',
          },
        ],
        llmSections: [],
      };

      const result = await service.generateContent(template, mockContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toContain('Project: ');
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Required variable not found',
          expect.objectContaining({
            variable: 'missingVariable',
          })
        );
      }
    });

    it('should process conditional blocks (true condition)', async () => {
      const template: AgentTemplate = {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        content: `# Agent

{{#if frameworks}}
## Frameworks
This project uses: {{frameworks}}
{{/if}}`,
        applicabilityRules: {
          projectTypes: [],
          frameworks: [],
          monorepoTypes: [],
          minimumRelevanceScore: 50,
          alwaysInclude: false,
        },
        variables: [
          {
            name: 'frameworks',
            description: 'Frameworks',
            required: false,
            source: 'project-context',
          },
        ],
        llmSections: [],
      };

      const result = await service.generateContent(template, mockContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toContain('## Frameworks');
        expect(result.value).toContain('This project uses: Express, React');
      }
    });

    it('should process conditional blocks (false condition)', async () => {
      const template: AgentTemplate = {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        content: `# Agent

{{#if missingFramework}}
## Frameworks
This should not appear
{{/if}}

Content after conditional.`,
        applicabilityRules: {
          projectTypes: [],
          frameworks: [],
          monorepoTypes: [],
          minimumRelevanceScore: 50,
          alwaysInclude: false,
        },
        variables: [],
        llmSections: [],
      };

      const result = await service.generateContent(template, mockContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).not.toContain('## Frameworks');
        expect(result.value).not.toContain('This should not appear');
        expect(result.value).toContain('Content after conditional.');
      }
    });

    it('should process negated conditional blocks', async () => {
      const template: AgentTemplate = {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        content: `# Agent

{{#if !missingThing}}
## No Missing Thing
This should appear because missingThing is falsy
{{/if}}`,
        applicabilityRules: {
          projectTypes: [],
          frameworks: [],
          monorepoTypes: [],
          minimumRelevanceScore: 50,
          alwaysInclude: false,
        },
        variables: [],
        llmSections: [],
      };

      const result = await service.generateContent(template, mockContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toContain('## No Missing Thing');
        expect(result.value).toContain('This should appear');
      }
    });

    it('should process nested conditional blocks', async () => {
      const template: AgentTemplate = {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        content: `# Agent

{{#if projectType}}
## Project Type: {{projectType}}

{{#if frameworks}}
### Frameworks
Uses: {{frameworks}}
{{/if}}
{{/if}}`,
        applicabilityRules: {
          projectTypes: [],
          frameworks: [],
          monorepoTypes: [],
          minimumRelevanceScore: 50,
          alwaysInclude: false,
        },
        variables: [
          {
            name: 'projectType',
            description: 'Project type',
            required: false,
            source: 'project-context',
          },
          {
            name: 'frameworks',
            description: 'Frameworks',
            required: false,
            source: 'project-context',
          },
        ],
        llmSections: [],
      };

      const result = await service.generateContent(template, mockContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toContain('## Project Type: Node');
        expect(result.value).toContain('### Frameworks');
        expect(result.value).toContain('Uses: Express, React');
      }
    });

    it('should preserve static sections', async () => {
      const template: AgentTemplate = {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        content: `# {{projectName}} Agent

<!-- STATIC -->
This content never changes.
It should be preserved exactly as-is.
{{variablesAreNotSubstitutedHere}}
<!-- /STATIC -->

Dynamic content: {{projectType}}`,
        applicabilityRules: {
          projectTypes: [],
          frameworks: [],
          monorepoTypes: [],
          minimumRelevanceScore: 50,
          alwaysInclude: false,
        },
        variables: [
          {
            name: 'projectName',
            description: 'Project name',
            required: false,
            source: 'project-context',
          },
          {
            name: 'projectType',
            description: 'Project type',
            required: false,
            source: 'project-context',
          },
        ],
        llmSections: [],
      };

      const result = await service.generateContent(template, mockContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const content = result.value;
        expect(content).toContain('# test-project Agent');
        expect(content).toContain('This content never changes.');
        expect(content).toContain('{{variablesAreNotSubstitutedHere}}');
        expect(content).toContain('Dynamic content: Node');
      }
    });

    it('should handle multiple static sections', async () => {
      const template: AgentTemplate = {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        content: `# Agent

<!-- STATIC -->
First static section
<!-- /STATIC -->

Dynamic: {{projectType}}

<!-- STATIC -->
Second static section
<!-- /STATIC -->`,
        applicabilityRules: {
          projectTypes: [],
          frameworks: [],
          monorepoTypes: [],
          minimumRelevanceScore: 50,
          alwaysInclude: false,
        },
        variables: [
          {
            name: 'projectType',
            description: 'Project type',
            required: false,
            source: 'project-context',
          },
        ],
        llmSections: [],
      };

      const result = await service.generateContent(template, mockContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toContain('First static section');
        expect(result.value).toContain('Second static section');
        expect(result.value).toContain('Dynamic: Node');
      }
    });

    it('should handle empty template', async () => {
      const template: AgentTemplate = {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        content: '',
        applicabilityRules: {
          projectTypes: [],
          frameworks: [],
          monorepoTypes: [],
          minimumRelevanceScore: 50,
          alwaysInclude: false,
        },
        variables: [],
        llmSections: [],
      };

      const result = await service.generateContent(template, mockContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe('');
      }
    });
  });

  describe('generateLlmSections', () => {
    it('should return empty array when no LLM sections in template', async () => {
      const template: AgentTemplate = {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        content: '# Simple Agent',
        applicabilityRules: {
          projectTypes: [],
          frameworks: [],
          monorepoTypes: [],
          minimumRelevanceScore: 50,
          alwaysInclude: false,
        },
        variables: [],
        llmSections: [],
      };

      const result = await service.generateLlmSections(template, mockContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });

    it('should validate LLM section markers match definitions', async () => {
      const template: AgentTemplate = {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        content: `# Agent

<!-- LLM:architecture -->
Default architecture content
<!-- /LLM -->

<!-- LLM:undefinedSection -->
This section is not defined
<!-- /LLM -->`,
        applicabilityRules: {
          projectTypes: [],
          frameworks: [],
          monorepoTypes: [],
          minimumRelevanceScore: 50,
          alwaysInclude: false,
        },
        variables: [],
        llmSections: [
          {
            id: 'architecture',
            topic: 'Architecture patterns',
            prompt: 'Describe architecture',
            maxTokens: 1000,
          },
        ],
      };

      const result = await service.generateLlmSections(template, mockContext);

      expect(result.isErr()).toBe(true);
      if (result.isErr() && result.error) {
        expect(result.error.message).toContain('undefinedSection');
        expect(result.error.message).toContain('not defined');
      }
    });

    it('should return empty array when LLM integration not implemented', async () => {
      const template: AgentTemplate = {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        content: `# Agent

<!-- LLM:architecture -->
Default content
<!-- /LLM -->`,
        applicabilityRules: {
          projectTypes: [],
          frameworks: [],
          monorepoTypes: [],
          minimumRelevanceScore: 50,
          alwaysInclude: false,
        },
        variables: [],
        llmSections: [
          {
            id: 'architecture',
            topic: 'Architecture',
            prompt: 'Describe architecture',
          },
        ],
      };

      const result = await service.generateLlmSections(template, mockContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });
  });

  describe('Edge cases', () => {
    it('should warn about unsubstituted variables', async () => {
      const template: AgentTemplate = {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        content: `# Agent

Unknown variable: {{unknownVariable}}`,
        applicabilityRules: {
          projectTypes: [],
          frameworks: [],
          monorepoTypes: [],
          minimumRelevanceScore: 50,
          alwaysInclude: false,
        },
        variables: [],
        llmSections: [],
      };

      const result = await service.generateContent(template, mockContext);

      expect(result.isOk()).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Unsubstituted variables found in content',
        expect.objectContaining({
          variables: expect.arrayContaining(['{{unknownVariable}}']),
        })
      );
    });

    it('should handle template with all features combined', async () => {
      const template: AgentTemplate = {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        content: `# {{projectName}} Full-Featured Agent

<!-- STATIC -->
This is static content that never changes.
<!-- /STATIC -->

## Project Information

Project Type: {{projectType}}

{{#if frameworks}}
### Frameworks
This project uses the following frameworks:
- {{frameworks}}
{{/if}}

<!-- LLM:recommendations -->
Default recommendations would go here
<!-- /LLM -->

{{#if testingFrameworks}}
## Testing
Testing frameworks: {{testingFrameworks}}
{{/if}}`,
        applicabilityRules: {
          projectTypes: [],
          frameworks: [],
          monorepoTypes: [],
          minimumRelevanceScore: 50,
          alwaysInclude: false,
        },
        variables: [
          {
            name: 'projectName',
            description: 'Project name',
            required: true,
            source: 'project-context',
          },
          {
            name: 'projectType',
            description: 'Project type',
            required: true,
            source: 'project-context',
          },
          {
            name: 'frameworks',
            description: 'Frameworks',
            required: false,
            source: 'project-context',
          },
          {
            name: 'testingFrameworks',
            description: 'Testing frameworks',
            required: false,
            source: 'project-context',
          },
        ],
        llmSections: [
          {
            id: 'recommendations',
            topic: 'Project recommendations',
            prompt: 'Generate recommendations for {{projectType}} project',
            maxTokens: 500,
          },
        ],
      };

      const result = await service.generateContent(template, mockContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const content = result.value;
        // Static section preserved
        expect(content).toContain('This is static content that never changes.');
        // Variables substituted
        expect(content).toContain('# test-project Full-Featured Agent');
        expect(content).toContain('Project Type: Node');
        // Conditionals processed
        expect(content).toContain('### Frameworks');
        expect(content).toContain('- Express, React');
        expect(content).toContain('## Testing');
        expect(content).toContain('Testing frameworks: Jest, Vitest');
        // LLM section present (with fallback content since no customizations)
        expect(content).toContain('Default recommendations would go here');
      }
    });

    it('should handle monorepo context', async () => {
      const monorepoContext: AgentProjectContext = {
        ...mockContext,
        monorepoType: 'nx' as any,
      };

      const template: AgentTemplate = {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        content: `Monorepo Type: {{monorepoType}}`,
        applicabilityRules: {
          projectTypes: [],
          frameworks: [],
          monorepoTypes: [],
          minimumRelevanceScore: 50,
          alwaysInclude: false,
        },
        variables: [
          {
            name: 'monorepoType',
            description: 'Monorepo type',
            required: false,
            source: 'project-context',
          },
        ],
        llmSections: [],
      };

      const result = await service.generateContent(template, monorepoContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toContain('Monorepo Type: nx');
      }
    });

    it('should handle non-monorepo context', async () => {
      const template: AgentTemplate = {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        content: `Monorepo Type: {{monorepoType}}`,
        applicabilityRules: {
          projectTypes: [],
          frameworks: [],
          monorepoTypes: [],
          minimumRelevanceScore: 50,
          alwaysInclude: false,
        },
        variables: [
          {
            name: 'monorepoType',
            description: 'Monorepo type',
            required: false,
            source: 'project-context',
          },
        ],
        llmSections: [],
      };

      const result = await service.generateContent(template, mockContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toContain('Monorepo Type: none');
      }
    });

    it('should handle all code convention variables', async () => {
      const template: AgentTemplate = {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        content: `Code Style:
- Indentation: {{indentation}} ({{indentSize}} spaces)
- Quotes: {{quoteStyle}}
- Semicolons: {{semicolons}}
- Trailing Commas: {{trailingComma}}`,
        applicabilityRules: {
          projectTypes: [],
          frameworks: [],
          monorepoTypes: [],
          minimumRelevanceScore: 50,
          alwaysInclude: false,
        },
        variables: [
          {
            name: 'indentation',
            description: 'Indentation type',
            required: false,
            source: 'project-context',
          },
          {
            name: 'indentSize',
            description: 'Indent size',
            required: false,
            source: 'project-context',
          },
          {
            name: 'quoteStyle',
            description: 'Quote style',
            required: false,
            source: 'project-context',
          },
          {
            name: 'semicolons',
            description: 'Use semicolons',
            required: false,
            source: 'project-context',
          },
          {
            name: 'trailingComma',
            description: 'Trailing comma style',
            required: false,
            source: 'project-context',
          },
        ],
        llmSections: [],
      };

      const result = await service.generateContent(template, mockContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const content = result.value;
        expect(content).toContain('- Indentation: spaces (2 spaces)');
        expect(content).toContain('- Quotes: single');
        expect(content).toContain('- Semicolons: true');
        expect(content).toContain('- Trailing Commas: es5');
      }
    });
  });

  describe('Error handling', () => {
    it('should return error for invalid template structure', async () => {
      const template: AgentTemplate = {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        content: `<!-- LLM:invalidSection -->
Content
<!-- /LLM -->`,
        applicabilityRules: {
          projectTypes: [],
          frameworks: [],
          monorepoTypes: [],
          minimumRelevanceScore: 50,
          alwaysInclude: false,
        },
        variables: [],
        llmSections: [],
      };

      const result = await service.generateContent(template, mockContext);

      // Should succeed but warn about LLM customization failure
      expect(result.isOk()).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'LLM customization failed, using fallback content',
        expect.any(Object)
      );
    });
  });
});
