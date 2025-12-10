/**
 * Template Storage Service Tests
 *
 * Comprehensive test suite for TemplateStorageService covering:
 * - Template loading from disk
 * - YAML frontmatter parsing
 * - Template validation
 * - Caching behavior
 * - Error handling
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readdir, readFile } from 'fs/promises';

// Mock vscode-core to avoid VS Code dependency
jest.mock('@ptah-extension/vscode-core', () => ({
  Logger: jest.fn(),
  TOKENS: {
    LOGGER: Symbol.for('Logger'),
  },
}));

// Mock fs/promises
jest.mock('fs/promises');

import { TemplateStorageService } from './template-storage.service';

const mockReaddir = readdir as jest.MockedFunction<typeof readdir>;
const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;

// Mock Logger interface
interface MockLogger {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  logWithContext: jest.Mock;
  show: jest.Mock;
  dispose: jest.Mock;
}

describe('TemplateStorageService', () => {
  let service: TemplateStorageService;
  let mockLogger: MockLogger;

  // Sample valid template content
  const validTemplateContent = `---
id: backend-developer
name: Backend Developer
version: 1.0.0
applicabilityRules:
  projectTypes: [Node, Python]
  frameworks: [Express, Django]
  monorepoTypes: []
  minimumRelevanceScore: 70
  alwaysInclude: false
variables:
  - name: projectContext
    description: Project context
    required: true
    source: project-context
llmSections:
  - id: architecture
    topic: Architecture patterns
    prompt: Describe architecture
    maxTokens: 1000
---

# Backend Developer

Template content here with {{projectContext}} variable.

<!-- LLM:architecture -->
Architecture section
<!-- /LLM -->
`;

  const anotherValidTemplateContent = `---
id: frontend-developer
name: Frontend Developer
version: 1.0.0
applicabilityRules:
  projectTypes: [React, Angular]
  frameworks: [React, Angular]
  monorepoTypes: []
  minimumRelevanceScore: 60
  alwaysInclude: false
variables: []
llmSections: []
---

# Frontend Developer

Frontend template content.
`;

  const alwaysIncludeTemplateContent = `---
id: orchestrate
name: Orchestrate Command
version: 1.0.0
applicabilityRules:
  projectTypes: []
  frameworks: []
  monorepoTypes: []
  minimumRelevanceScore: 100
  alwaysInclude: true
variables: []
llmSections: []
---

# Orchestrate

Core orchestration logic.
`;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock logger
    mockLogger = {
      debug: jest.fn() as any,
      info: jest.fn() as any,
      warn: jest.fn() as any,
      error: jest.fn() as any,
      logWithContext: jest.fn() as any,
      show: jest.fn() as any,
      dispose: jest.fn() as any,
    };

    // Create service instance with test templates path
    service = new TemplateStorageService(
      mockLogger as any,
      '/test/templates/agents'
    );
  });

  describe('loadAllTemplates', () => {
    it('should successfully load all templates from directory', async () => {
      // Arrange
      mockReaddir.mockResolvedValue([
        'backend-developer.template.md',
        'frontend-developer.template.md',
        'README.md', // Should be ignored (not .template.md)
      ] as any);

      mockReadFile
        .mockResolvedValueOnce(validTemplateContent)
        .mockResolvedValueOnce(anotherValidTemplateContent);

      // Act
      const result = await service.loadAllTemplates();

      // Assert
      expect(result.isOk()).toBe(true);
      const templates = result.value!;
      expect(templates).toHaveLength(2);
      expect(templates[0].id).toBe('backend-developer');
      expect(templates[0].name).toBe('Backend Developer');
      expect(templates[0].version).toBe('1.0.0');
      expect(templates[1].id).toBe('frontend-developer');
      expect(mockReaddir).toHaveBeenCalledTimes(1);
      expect(mockReadFile).toHaveBeenCalledTimes(2);
    });

    it('should return cached templates on subsequent calls', async () => {
      // Arrange
      mockReaddir.mockResolvedValue(['backend-developer.template.md'] as any);
      mockReadFile.mockResolvedValue(validTemplateContent);

      // Act
      const result1 = await service.loadAllTemplates();
      const result2 = await service.loadAllTemplates();

      // Assert
      expect(result1.isOk()).toBe(true);
      expect(result2.isOk()).toBe(true);
      expect(result1.value).toEqual(result2.value);
      // Should only read directory once
      expect(mockReaddir).toHaveBeenCalledTimes(1);
      expect(mockReadFile).toHaveBeenCalledTimes(1);
    });

    it('should return empty array when templates directory does not exist', async () => {
      // Arrange
      const error: NodeJS.ErrnoException = new Error('Directory not found');
      error.code = 'ENOENT';
      mockReaddir.mockRejectedValue(error);

      // Act
      const result = await service.loadAllTemplates();

      // Assert
      expect(result.isOk()).toBe(true);
      expect(result.value).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Templates directory does not exist',
        expect.any(Object)
      );
    });

    it('should return empty array when no template files found', async () => {
      // Arrange
      mockReaddir.mockResolvedValue(['README.md', 'package.json'] as any);

      // Act
      const result = await service.loadAllTemplates();

      // Assert
      expect(result.isOk()).toBe(true);
      expect(result.value).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No template files found',
        expect.any(Object)
      );
    });

    it('should continue loading other templates when one fails', async () => {
      // Arrange
      mockReaddir.mockResolvedValue([
        'backend-developer.template.md',
        'invalid-template.template.md',
        'frontend-developer.template.md',
      ] as any);

      const invalidTemplateContent = `---
id: invalid
name: Invalid Template
---
Content without required fields
`;

      mockReadFile
        .mockResolvedValueOnce(validTemplateContent)
        .mockResolvedValueOnce(invalidTemplateContent)
        .mockResolvedValueOnce(anotherValidTemplateContent);

      // Act
      const result = await service.loadAllTemplates();

      // Assert
      expect(result.isOk()).toBe(true);
      const templates = result.value!;
      expect(templates).toHaveLength(2); // Only valid templates
      expect(templates[0].id).toBe('backend-developer');
      expect(templates[1].id).toBe('frontend-developer');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should return error when all templates fail to load', async () => {
      // Arrange
      mockReaddir.mockResolvedValue([
        'invalid1.template.md',
        'invalid2.template.md',
      ] as any);

      const invalidContent = `---
invalid yaml
---`;

      mockReadFile
        .mockResolvedValueOnce(invalidContent)
        .mockResolvedValueOnce(invalidContent);

      // Act
      const result = await service.loadAllTemplates();

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Failed to load all templates');
    });
  });

  describe('loadTemplate', () => {
    it('should successfully load a single template by ID', async () => {
      // Arrange
      mockReadFile.mockResolvedValue(validTemplateContent);

      // Act
      const result = await service.loadTemplate('backend-developer');

      // Assert
      expect(result.isOk()).toBe(true);
      const template = result.value!;
      expect(template.id).toBe('backend-developer');
      expect(template.name).toBe('Backend Developer');
      expect(template.version).toBe('1.0.0');
      expect(template.applicabilityRules.projectTypes).toEqual([
        'Node',
        'Python',
      ]);
      expect(template.variables).toHaveLength(1);
      expect(template.llmSections).toHaveLength(1);
    });

    it('should return cached template on subsequent calls', async () => {
      // Arrange
      mockReadFile.mockResolvedValue(validTemplateContent);

      // Act
      const result1 = await service.loadTemplate('backend-developer');
      const result2 = await service.loadTemplate('backend-developer');

      // Assert
      expect(result1.isOk()).toBe(true);
      expect(result2.isOk()).toBe(true);
      expect(result1.value).toEqual(result2.value);
      // Should only read file once (second call uses cache)
      expect(mockReadFile).toHaveBeenCalledTimes(1);
    });

    it('should return error when template file not found', async () => {
      // Arrange
      const error: NodeJS.ErrnoException = new Error('File not found');
      error.code = 'ENOENT';
      mockReadFile.mockRejectedValue(error);

      // Act
      const result = await service.loadTemplate('non-existent');

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Template file not found');
    });

    it('should return error when YAML frontmatter is invalid', async () => {
      // Arrange
      const invalidContent = `---
invalid: [yaml: syntax
---
Content`;
      mockReadFile.mockResolvedValue(invalidContent);

      // Act
      const result = await service.loadTemplate('invalid-yaml');

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain(
        'Failed to parse YAML frontmatter'
      );
    });

    it('should return error when required field is missing', async () => {
      // Arrange
      const contentMissingName = `---
id: test
version: 1.0.0
applicabilityRules:
  projectTypes: []
  frameworks: []
  monorepoTypes: []
  minimumRelevanceScore: 50
  alwaysInclude: false
---
Content`;
      mockReadFile.mockResolvedValue(contentMissingName);

      // Act
      const result = await service.loadTemplate('missing-name');

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Missing required field');
      expect(result.error?.message).toContain('name');
    });

    it('should return error when applicabilityRules is missing fields', async () => {
      // Arrange
      const contentMissingRuleField = `---
id: test
name: Test
version: 1.0.0
applicabilityRules:
  projectTypes: []
  frameworks: []
---
Content`;
      mockReadFile.mockResolvedValue(contentMissingRuleField);

      // Act
      const result = await service.loadTemplate('missing-rule-field');

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain(
        'Missing required field in applicabilityRules'
      );
    });

    it('should return error when content is empty', async () => {
      // Arrange
      const contentEmpty = `---
id: test
name: Test
version: 1.0.0
applicabilityRules:
  projectTypes: []
  frameworks: []
  monorepoTypes: []
  minimumRelevanceScore: 50
  alwaysInclude: false
---
`;
      mockReadFile.mockResolvedValue(contentEmpty);

      // Act
      const result = await service.loadTemplate('empty-content');

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain(
        'Template content cannot be empty'
      );
    });
  });

  describe('getApplicableTemplates', () => {
    beforeEach(() => {
      // Setup: Load all templates first
      mockReaddir.mockResolvedValue([
        'backend-developer.template.md',
        'frontend-developer.template.md',
        'orchestrate.template.md',
      ] as any);

      mockReadFile
        .mockResolvedValueOnce(validTemplateContent)
        .mockResolvedValueOnce(anotherValidTemplateContent)
        .mockResolvedValueOnce(alwaysIncludeTemplateContent);
    });

    it('should return templates matching project type', async () => {
      // Act
      const result = await service.getApplicableTemplates('Node');

      // Assert
      expect(result.isOk()).toBe(true);
      const templates = result.value!;
      // Should include: backend-developer (Node in projectTypes) + orchestrate (alwaysInclude)
      expect(templates.length).toBeGreaterThanOrEqual(2);
      const templateIds = templates.map((t) => t.id);
      expect(templateIds).toContain('backend-developer');
      expect(templateIds).toContain('orchestrate'); // Always include
    });

    it('should return templates with alwaysInclude regardless of project type', async () => {
      // Act
      const result = await service.getApplicableTemplates('Go');

      // Assert
      expect(result.isOk()).toBe(true);
      const templates = result.value!;
      // Should include at least: orchestrate (alwaysInclude)
      expect(templates.length).toBeGreaterThanOrEqual(1);
      const templateIds = templates.map((t) => t.id);
      expect(templateIds).toContain('orchestrate');
    });

    it('should be case-insensitive when matching project types', async () => {
      // Act
      const result1 = await service.getApplicableTemplates('node');
      const result2 = await service.getApplicableTemplates('NODE');
      const result3 = await service.getApplicableTemplates('Node');

      // Assert
      expect(result1.isOk()).toBe(true);
      expect(result2.isOk()).toBe(true);
      expect(result3.isOk()).toBe(true);
      // All should return same templates
      expect(result1.value!.length).toBe(result2.value!.length);
      expect(result2.value!.length).toBe(result3.value!.length);
    });

    it('should return all templates when filter finds no specific matches', async () => {
      // Act
      const result = await service.getApplicableTemplates('Unknown');

      // Assert
      expect(result.isOk()).toBe(true);
      const templates = result.value!;
      // Should include at least: orchestrate (alwaysInclude)
      expect(templates.length).toBeGreaterThanOrEqual(1);
      const templateIds = templates.map((t) => t.id);
      expect(templateIds).toContain('orchestrate');
    });
  });

  describe('cache management', () => {
    it('should clear cache when clearCache is called', async () => {
      // Arrange
      mockReaddir.mockResolvedValue(['backend-developer.template.md'] as any);
      mockReadFile.mockResolvedValue(validTemplateContent);

      // Act
      await service.loadAllTemplates();
      const stats1 = service.getCacheStats();
      service.clearCache();
      const stats2 = service.getCacheStats();

      // Assert
      expect(stats1.size).toBe(1);
      expect(stats1.loaded).toBe(true);
      expect(stats2.size).toBe(0);
      expect(stats2.loaded).toBe(false);
    });

    it('should reload templates from disk after cache clear', async () => {
      // Arrange
      mockReaddir.mockResolvedValue(['backend-developer.template.md'] as any);
      mockReadFile.mockResolvedValue(validTemplateContent);

      // Act
      await service.loadAllTemplates();
      service.clearCache();
      await service.loadAllTemplates();

      // Assert
      // Should read directory twice (once before clear, once after)
      expect(mockReaddir).toHaveBeenCalledTimes(2);
      expect(mockReadFile).toHaveBeenCalledTimes(2);
    });

    it('should return correct cache statistics', async () => {
      // Arrange
      mockReaddir.mockResolvedValue([
        'backend-developer.template.md',
        'frontend-developer.template.md',
      ] as any);
      mockReadFile
        .mockResolvedValueOnce(validTemplateContent)
        .mockResolvedValueOnce(anotherValidTemplateContent);

      // Act
      const stats1 = service.getCacheStats();
      await service.loadAllTemplates();
      const stats2 = service.getCacheStats();

      // Assert
      expect(stats1.size).toBe(0);
      expect(stats1.loaded).toBe(false);
      expect(stats2.size).toBe(2);
      expect(stats2.loaded).toBe(true);
    });
  });

  describe('validation', () => {
    it('should validate projectTypes is an array', async () => {
      // Arrange
      const invalidContent = `---
id: test
name: Test
version: 1.0.0
applicabilityRules:
  projectTypes: "invalid"
  frameworks: []
  monorepoTypes: []
  minimumRelevanceScore: 50
  alwaysInclude: false
---
Content`;
      mockReadFile.mockResolvedValue(invalidContent);

      // Act
      const result = await service.loadTemplate('invalid-project-types');

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('projectTypes must be an array');
    });

    it('should validate minimumRelevanceScore is a number between 0-100', async () => {
      // Arrange
      const invalidContent = `---
id: test
name: Test
version: 1.0.0
applicabilityRules:
  projectTypes: []
  frameworks: []
  monorepoTypes: []
  minimumRelevanceScore: 150
  alwaysInclude: false
---
Content`;
      mockReadFile.mockResolvedValue(invalidContent);

      // Act
      const result = await service.loadTemplate('invalid-score');

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain(
        'must be a number between 0 and 100'
      );
    });

    it('should validate alwaysInclude is a boolean', async () => {
      // Arrange
      const invalidContent = `---
id: test
name: Test
version: 1.0.0
applicabilityRules:
  projectTypes: []
  frameworks: []
  monorepoTypes: []
  minimumRelevanceScore: 50
  alwaysInclude: "yes"
---
Content`;
      mockReadFile.mockResolvedValue(invalidContent);

      // Act
      const result = await service.loadTemplate('invalid-always-include');

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain(
        'alwaysInclude must be a boolean'
      );
    });
  });
});
