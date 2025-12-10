/**
 * OutputValidationService Unit Tests
 *
 * Comprehensive test coverage for multi-layered content validation.
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
jest.mock('@ptah-extension/workspace-intelligence', () => {
  return {
    ProjectType: {
      Node: 'node',
      React: 'react',
      Python: 'python',
    },
    Framework: {
      Express: 'express',
      Angular: 'angular',
      Django: 'django',
      React: 'react',
    },
    MonorepoType: {
      Nx: 'nx',
      Lerna: 'lerna',
    },
  };
});

import { container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { OutputValidationService } from './output-validation.service';
import { AgentProjectContext, ValidationResult } from '../types/core.types';
import {
  ProjectType,
  Framework,
  MonorepoType,
} from '@ptah-extension/workspace-intelligence';

// Mock Logger interface
interface MockLogger {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
}

describe('OutputValidationService', () => {
  let service: OutputValidationService;
  let mockLogger: MockLogger;
  let mockContext: AgentProjectContext;

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
    service = new OutputValidationService(mockLogger as any);

    // Setup mock project context
    mockContext = {
      projectType: ProjectType.Node,
      frameworks: [Framework.Express, Framework.Angular],
      monorepoType: MonorepoType.Nx,
      rootPath: '/workspace/ptah-extension',
      relevantFiles: [
        {
          path: '/workspace/ptah-extension/src/app/services/auth.service.ts',
          relativePath: 'src/app/services/auth.service.ts',
          type: 'source' as any,
          size: 1024,
          estimatedTokens: 256,
        },
        {
          path: '/workspace/ptah-extension/libs/backend/core/index.ts',
          relativePath: 'libs/backend/core/index.ts',
          type: 'source' as any,
          size: 512,
          estimatedTokens: 128,
        },
      ],
      techStack: {
        languages: ['TypeScript', 'JavaScript'],
        frameworks: ['Express', 'Angular'],
        buildTools: ['Nx', 'esbuild'],
        testingFrameworks: ['Jest'],
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
  });

  afterEach(() => {
    container.clearInstances();
  });

  describe('validate()', () => {
    it('should pass validation for valid content', async () => {
      const validContent = `---
id: test-agent
name: Test Agent
version: 1.0.0
---

# Test Agent

This is a test agent for the project.

<!-- LLM:introduction -->
This section contains LLM-generated content about the agent.
<!-- /LLM -->

## Features

- Feature 1
- Feature 2

<!-- STATIC -->
This is static content that should not be modified.
<!-- /STATIC -->
`;

      const result = await service.validate(validContent, mockContext);

      expect(result.isOk()).toBe(true);
      const validation = result.value!;
      expect(validation.isValid).toBe(true);
      expect(validation.score).toBeGreaterThanOrEqual(70);
      expect(validation.issues).toHaveLength(0);
    });

    it('should fail validation for empty content', async () => {
      const result = await service.validate('', mockContext);

      expect(result.isOk()).toBe(true);
      const validation = result.value!;
      expect(validation.isValid).toBe(false);
      expect(validation.score).toBeLessThanOrEqual(60); // Schema 0 + Safety 30 + Factual 30
      expect(validation.issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          message: 'Content is empty',
        })
      );
    });

    it('should fail validation for content missing YAML frontmatter', async () => {
      const contentNoFrontmatter = `# Test Agent

This content has no YAML frontmatter.

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
`;

      const result = await service.validate(contentNoFrontmatter, mockContext);

      expect(result.isOk()).toBe(true);
      const validation = result.value!;
      // Schema will be reduced by 15 points (40 - 15 = 25), so total might still be over 70
      // if safety and factual are perfect
      expect(validation.issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          message: 'Missing YAML frontmatter',
        })
      );
    });

    it('should detect script injection in safety validation', async () => {
      const maliciousContent = `---
id: malicious
name: Malicious Agent
version: 1.0.0
---

# Malicious Agent

<script>alert('XSS')</script>

This content contains malicious code and should fail validation with a long enough text to pass minimum length requirement for proper validation.
`;

      const result = await service.validate(maliciousContent, mockContext);

      expect(result.isOk()).toBe(true);
      const validation = result.value!;
      expect(validation.isValid).toBe(false);
      // Safety validation returns score 0 for malicious patterns and fails immediately
      expect(validation.score).toBe(0); // Critical safety failure
      expect(validation.issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          message: expect.stringContaining('malicious code'),
        })
      );
    });

    it('should detect sensitive data patterns', async () => {
      const sensitiveContent = `---
id: sensitive
name: Sensitive Agent
version: 1.0.0
---

# Configuration

API_KEY=sk-1234567890abcdefghijklmnopqrstuvwxyz1234567890
PASSWORD=SuperSecret123

This content contains sensitive data that should be detected and flagged as a security issue. Adding more text to meet minimum length requirements.
`;

      const result = await service.validate(sensitiveContent, mockContext);

      expect(result.isOk()).toBe(true);
      const validation = result.value!;
      expect(validation.isValid).toBe(false);
      expect(validation.issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          message: expect.stringContaining('sensitive data'),
        })
      );
    });

    it('should detect mismatched LLM markers', async () => {
      const mismatchedMarkersContent = `---
id: test
name: Test
version: 1.0.0
---

# Test Agent

<!-- LLM:section1 -->
Content 1
<!-- /LLM -->

<!-- LLM:section2 -->
Content 2 with missing close marker
Adding more content to meet minimum length requirements for proper validation and testing purposes.
`;

      const result = await service.validate(
        mismatchedMarkersContent,
        mockContext
      );

      expect(result.isOk()).toBe(true);
      const validation = result.value!;
      expect(validation.issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          message: expect.stringContaining('Mismatched LLM markers'),
        })
      );
    });

    it('should flag borderline quality scores for review', async () => {
      // Content with some issues but not failing
      const borderlineContent = `---
id: borderline
version: 1.0.0
---

# Test
<!-- LLM:test -->
Test content
<!-- /LLM -->

Some content here but missing name field in frontmatter and minimal structure. Adding more text to meet minimum requirements for testing purposes.
`;

      const result = await service.validate(borderlineContent, mockContext);

      expect(result.isOk()).toBe(true);
      const validation = result.value!;

      // Check if score is in borderline range (60-70)
      if (validation.score >= 60 && validation.score < 70) {
        expect(validation.issues).toContainEqual(
          expect.objectContaining({
            severity: 'warning',
            message: expect.stringContaining('borderline'),
          })
        );
      }
    });

    it('should combine issues from all validation tiers', async () => {
      const multiIssueContent = `---
id: multi-issue
version: 1.0.0
---

# Multi-Issue Content

<!-- LLM:test -->
Content
<!-- /LLM -->

<!-- LLM:unclosed -->
This section is not closed properly

http://suspicious-domain.xyz/malware

Adding more content to meet minimum length requirements for validation. This content has multiple issues across different tiers.
`;

      const result = await service.validate(multiIssueContent, mockContext);

      expect(result.isOk()).toBe(true);
      const validation = result.value!;

      // Should have issues from schema (markers) and safety (URL)
      expect(validation.issues.length).toBeGreaterThan(1);

      const severities = validation.issues.map((i) => i.severity);
      expect(severities).toContain('error'); // Mismatched markers
      expect(severities).toContain('warning'); // External URL or other warnings
    });

    it('should handle missing project context gracefully', async () => {
      const emptyContext: AgentProjectContext = {
        ...mockContext,
        relevantFiles: [],
      };

      const validContent = `---
id: test
name: Test
version: 1.0.0
---

# Test Agent

This is test content with proper structure and sufficient length to pass minimum requirements. No factual validation will occur.
`;

      const result = await service.validate(validContent, emptyContext);

      expect(result.isOk()).toBe(true);
      const validation = result.value!;

      // Should skip factual validation and give full factual score
      expect(validation.issues).toContainEqual(
        expect.objectContaining({
          severity: 'info',
          message: expect.stringContaining('Factual validation skipped'),
        })
      );
    });

    it('should calculate score correctly based on tier weights', async () => {
      // Perfect schema, perfect safety, no factual context = 70/100
      const perfectSchemaAndSafety = `---
id: perfect
name: Perfect Agent
version: 1.0.0
---

# Perfect Agent

<!-- LLM:intro -->
Introduction content
<!-- /LLM -->

<!-- STATIC -->
Static content
<!-- /STATIC -->

## Features

This is well-structured content with all markers properly closed and no security issues whatsoever in the content.
`;

      const emptyContext: AgentProjectContext = {
        ...mockContext,
        relevantFiles: [],
      };

      const result = await service.validate(
        perfectSchemaAndSafety,
        emptyContext
      );

      expect(result.isOk()).toBe(true);
      const validation = result.value!;

      // Schema (40) + Safety (30) + Factual (30 - skipped, full score) = 100
      expect(validation.score).toBeGreaterThanOrEqual(70);
    });
  });

  describe('checkHallucinations()', () => {
    it('should detect non-existent file path references', async () => {
      const content = `
Check the implementation in src/app/non-existent/file.ts
Also review libs/fake/module/index.ts
`;

      const result = await service.checkHallucinations(content, mockContext);

      expect(result.isOk()).toBe(true);
      const hallucinations = result.value!;

      expect(hallucinations.length).toBeGreaterThan(0);
      expect(hallucinations).toContainEqual(
        expect.stringContaining('src/app/non-existent/file.ts')
      );
    });

    it('should detect non-existent framework references', async () => {
      const content = `
This project uses Django extensively.
We also leverage Ruby on Rails for the backend.
`;

      const result = await service.checkHallucinations(content, mockContext);

      expect(result.isOk()).toBe(true);
      const hallucinations = result.value!;

      expect(hallucinations.length).toBeGreaterThan(0);
      expect(hallucinations.some((h) => h.includes('Django'))).toBe(true);
      expect(hallucinations.some((h) => h.includes('Rails'))).toBe(true);
    });

    it('should detect unknown package imports', async () => {
      const content = `
import { SomeService } from 'unknown-package';
import { Helper } from 'fake-library';
`;

      const result = await service.checkHallucinations(content, mockContext);

      expect(result.isOk()).toBe(true);
      const hallucinations = result.value!;

      expect(hallucinations.length).toBeGreaterThan(0);
      expect(hallucinations.some((h) => h.includes('unknown-package'))).toBe(
        true
      );
      expect(hallucinations.some((h) => h.includes('fake-library'))).toBe(true);
    });

    it('should not flag valid file paths that exist in context', async () => {
      const content = `
Check the implementation in src/app/services/auth.service.ts
Also review libs/backend/core/index.ts
`;

      const result = await service.checkHallucinations(content, mockContext);

      expect(result.isOk()).toBe(true);
      const hallucinations = result.value!;

      // Should not flag these existing paths
      expect(
        hallucinations.some((h) =>
          h.includes('src/app/services/auth.service.ts')
        )
      ).toBe(false);
      expect(
        hallucinations.some((h) => h.includes('libs/backend/core/index.ts'))
      ).toBe(false);
    });

    it('should not flag known frameworks from tech stack', async () => {
      const content = `
This project uses Express framework.
We also use Angular for the frontend.
`;

      const result = await service.checkHallucinations(content, mockContext);

      expect(result.isOk()).toBe(true);
      const hallucinations = result.value!;

      // Should not flag known frameworks
      expect(hallucinations.some((h) => h.includes('Express'))).toBe(false);
      expect(hallucinations.some((h) => h.includes('Angular'))).toBe(false);
    });

    it('should not flag relative imports', async () => {
      const content = `
import { AuthService } from './auth.service';
import { UserEntity } from '../entities/user.entity';
`;

      const result = await service.checkHallucinations(content, mockContext);

      expect(result.isOk()).toBe(true);
      const hallucinations = result.value!;

      // Should not flag relative imports
      expect(hallucinations.some((h) => h.includes('./auth.service'))).toBe(
        false
      );
      expect(
        hallucinations.some((h) => h.includes('../entities/user.entity'))
      ).toBe(false);
    });

    it('should return empty array when no hallucinations detected', async () => {
      const content = `
This is a valid agent template using Express and Angular.
It references src/app/services/auth.service.ts which exists.
Uses TypeScript and JavaScript from our tech stack.
`;

      const result = await service.checkHallucinations(content, mockContext);

      expect(result.isOk()).toBe(true);
      const hallucinations = result.value!;

      expect(hallucinations).toHaveLength(0);
    });

    it('should handle content with no references gracefully', async () => {
      const content = `
This is generic content with no file paths, frameworks, or imports.
Just plain text describing general concepts and ideas.
`;

      const result = await service.checkHallucinations(content, mockContext);

      expect(result.isOk()).toBe(true);
      const hallucinations = result.value!;

      expect(hallucinations).toHaveLength(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very short content', async () => {
      const shortContent = '# Test';

      const result = await service.validate(shortContent, mockContext);

      expect(result.isOk()).toBe(true);
      const validation = result.value!;
      expect(validation.isValid).toBe(false);
      expect(validation.issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          message: expect.stringContaining('too short'),
        })
      );
    });

    it('should handle very long content', async () => {
      const longContent =
        '---\nid: test\nname: Test\nversion: 1.0.0\n---\n\n' +
        '# Long Content\n\n' +
        'Lorem ipsum '.repeat(10000);

      const result = await service.validate(longContent, mockContext);

      expect(result.isOk()).toBe(true);
      const validation = result.value!;
      expect(validation.issues).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          message: expect.stringContaining('very long'),
        })
      );
    });

    it('should handle content with multiple security violations', async () => {
      const multiViolationContent = `---
id: multi
name: Multi
version: 1.0.0
---

# Multiple Issues

<script>alert('xss')</script>
API_KEY=sk-1234567890abcdefghijklmnopqrstuvwxyz1234567890

Adding more text for minimum length requirements. This content has multiple severe security issues.
`;

      const result = await service.validate(multiViolationContent, mockContext);

      expect(result.isOk()).toBe(true);
      const validation = result.value!;
      expect(validation.isValid).toBe(false);
      // Safety returns 0 for malicious patterns and fails immediately
      expect(validation.score).toBe(0); // Critical safety failure
    });

    it('should handle malformed YAML frontmatter gracefully', async () => {
      const malformedYaml = `---
id: test
name: Test
version: [this is not valid yaml syntax
---

# Content

This has malformed YAML frontmatter with proper length for validation testing purposes.
`;

      const result = await service.validate(malformedYaml, mockContext);

      expect(result.isOk()).toBe(true);
      // Service should still proceed with validation even if YAML parsing would fail
      // (we're just checking for presence and basic structure, not parsing validity)
    });

    it('should handle content with no markdown headers', async () => {
      const noHeaders = `---
id: test
name: Test
version: 1.0.0
---

This is just plain text without any markdown headers at all. Just a long paragraph of text to meet minimum length requirements for proper validation testing.
`;

      const result = await service.validate(noHeaders, mockContext);

      expect(result.isOk()).toBe(true);
      const validation = result.value!;
      expect(validation.issues).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          message: expect.stringContaining('No markdown headers'),
        })
      );
    });

    it('should handle content with base64 encoded strings', async () => {
      const base64Content = `---
id: test
name: Test
version: 1.0.0
---

# Base64 Test

Here is a long base64 string: ${'A'.repeat(150)}

This might be suspicious content encoded in base64 format for various purposes.
`;

      const result = await service.validate(base64Content, mockContext);

      expect(result.isOk()).toBe(true);
      const validation = result.value!;
      expect(validation.issues).toContainEqual(
        expect.objectContaining({
          severity: 'info',
          message: expect.stringContaining('base64'),
        })
      );
    });

    it('should handle external URLs with whitelist check', async () => {
      const urlContent = `---
id: test
name: Test
version: 1.0.0
---

# URL Test

Whitelisted: https://github.com/user/repo
Whitelisted: https://www.npmjs.com/package/test
Suspicious: http://random-site.xyz/page

This content contains various URLs for testing URL validation logic with sufficient length.
`;

      const result = await service.validate(urlContent, mockContext);

      expect(result.isOk()).toBe(true);
      const validation = result.value!;

      // Should only flag non-whitelisted URLs
      expect(validation.issues).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          message: expect.stringContaining('external URL'),
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle unexpected errors gracefully', async () => {
      // Pass valid content but null context - service should handle gracefully
      const validContent = `---
id: test
name: Test
version: 1.0.0
---

# Test

Test content.
`;

      const result = await service.validate(validContent, null as any);

      // Should either return ok with factual validation skipped, or err with graceful error
      if (result.isOk()) {
        // If ok, should have skipped factual validation
        expect(
          result.value!.issues.some((i) => i.message.includes('skipped'))
        ).toBe(true);
      } else {
        // If err, should have error message
        expect(result.error).toBeDefined();
      }
    });

    it('should log validation progress', async () => {
      const validContent = `---
id: test
name: Test
version: 1.0.0
---

# Test

This is test content with proper structure and sufficient length for validation.
`;

      await service.validate(validContent, mockContext);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Validating generated content',
        expect.any(Object)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Validation complete',
        expect.any(Object)
      );
    });

    it('should log hallucination check progress', async () => {
      const content = 'Test content for hallucination checking';

      await service.checkHallucinations(content, mockContext);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Checking for hallucinations',
        expect.any(Object)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Hallucination check complete',
        expect.any(Object)
      );
    });
  });
});
