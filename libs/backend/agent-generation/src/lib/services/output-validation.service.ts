/**
 * Output Validation Service
 *
 * Multi-layered validation service for LLM-generated content.
 * Validates schema structure, safety, and factual accuracy.
 *
 * @module @ptah-extension/agent-generation/services
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import { IOutputValidationService } from '../interfaces/output-validation.interface';
import {
  ValidationResult,
  ValidationIssue,
  AgentProjectContext,
} from '../types/core.types';

/**
 * Sensitive data patterns to detect in content.
 * These patterns identify potential security risks like API keys, tokens, and passwords.
 */
const SENSITIVE_PATTERNS = [
  // API keys (generic pattern)
  /(?:api[_-]?key|apikey)['":\s]*=?\s*['"]?[a-zA-Z0-9_-]{20,}/gi,
  // Passwords
  /(?:password|passwd|pwd)['":\s]*=?\s*['"]?[^\s'"]{8,}/gi,
  // Secrets and tokens
  /(?:secret|token)['":\s]*=?\s*['"]?[a-zA-Z0-9_-]{20,}/gi,
  // OpenAI API keys
  /sk-[a-zA-Z0-9]{48}/g,
  // GitHub personal access tokens
  /ghp_[a-zA-Z0-9]{36}/g,
  // AWS access keys
  /AKIA[0-9A-Z]{16}/g,
  // Private keys
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi,
];

/**
 * Malicious code patterns to detect.
 * These patterns identify potential script injection or malicious code execution.
 */
const MALICIOUS_PATTERNS = [
  // Script tags
  /<script[^>]*>/gi,
  // JavaScript protocol
  /javascript:/gi,
  // Eval and similar dangerous functions
  /\beval\s*\(/gi,
  /\bFunction\s*\(/gi,
  // Data URIs with scripts
  /data:text\/html[^,]*,/gi,
  // Event handlers in HTML
  /\bon\w+\s*=/gi,
];

/**
 * Scoring weights for validation dimensions.
 */
const VALIDATION_WEIGHTS = {
  SCHEMA: 40, // 40 points for structural correctness
  SAFETY: 30, // 30 points for security
  FACTUAL: 30, // 30 points for accuracy
};

/**
 * Validation thresholds.
 */
const THRESHOLDS = {
  VALID_SCORE: 70, // Minimum score for valid content
  REVIEW_THRESHOLD: 60, // Scores below this need human review
  MIN_CONTENT_LENGTH: 100, // Minimum content length
  MAX_CONTENT_LENGTH: 50000, // Maximum content length
};

/**
 * Service for validating LLM-generated content.
 *
 * Implements comprehensive multi-tier validation:
 * 1. Schema Validation: Structure, markers, YAML frontmatter
 * 2. Safety Validation: Security risks, malicious code, sensitive data
 * 3. Factual Accuracy: File paths, frameworks, API references
 *
 * @example
 * ```typescript
 * const result = await validator.validate(generatedContent, projectContext);
 * if (result.isOk()) {
 *   const validation = result.value;
 *   if (validation.isValid && validation.score >= 70) {
 *     console.log('Content passed validation');
 *   } else {
 *     console.warn('Content has issues:', validation.issues);
 *   }
 * }
 * ```
 */
@injectable()
export class OutputValidationService implements IOutputValidationService {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    this.logger.debug('OutputValidationService initialized');
  }

  /**
   * Validate generated content for quality and safety.
   *
   * Performs comprehensive validation across multiple dimensions:
   * - Schema: Template structure, YAML frontmatter, markers
   * - Safety: No malicious code, no sensitive data exposure
   * - Factual: Valid file paths, correct frameworks, accurate APIs
   *
   * @param content - Generated content to validate
   * @param context - Extended project context for factual validation
   * @returns Result containing validation result with issues and score, or Error
   */
  async validate(
    content: string,
    context: AgentProjectContext
  ): Promise<Result<ValidationResult, Error>> {
    try {
      this.logger.debug('Validating generated content', {
        contentLength: content.length,
        projectType: context.projectType,
      });

      // Run all validation tiers
      const schemaResult = this.validateSchema(content);
      const safetyResult = this.validateSafety(content);

      // If safety validation fails critically (score 0), fail immediately
      // This ensures malicious content is never accepted regardless of other scores
      if (safetyResult.score === 0 && !safetyResult.isValid) {
        this.logger.warn('Content failed safety validation critically', {
          safetyScore: safetyResult.score,
          issueCount: safetyResult.issues.length,
        });

        return Result.ok({
          isValid: false,
          issues: [...schemaResult.issues, ...safetyResult.issues],
          score: safetyResult.score, // Return 0 to indicate critical failure
        });
      }

      const factualResult = this.validateFactualAccuracy(content, context);

      // Combine issues from all tiers
      const allIssues = [
        ...schemaResult.issues,
        ...safetyResult.issues,
        ...factualResult.issues,
      ];

      // Calculate total score
      const totalScore =
        schemaResult.score + safetyResult.score + factualResult.score;

      // Determine validity (score >= threshold AND no critical errors)
      const hasCriticalErrors = allIssues.some(
        (issue) => issue.severity === 'error'
      );
      const isValid =
        totalScore >= THRESHOLDS.VALID_SCORE && !hasCriticalErrors;

      // Add review warning if score is borderline
      if (
        totalScore >= THRESHOLDS.REVIEW_THRESHOLD &&
        totalScore < THRESHOLDS.VALID_SCORE
      ) {
        allIssues.push({
          severity: 'warning',
          message: `Content quality is borderline (score: ${totalScore}/100). Consider human review.`,
          suggestion: 'Review content manually before using in production.',
        });
      }

      const validationResult: ValidationResult = {
        isValid,
        issues: allIssues,
        score: totalScore,
      };

      this.logger.info('Validation complete', {
        isValid,
        score: totalScore,
        issueCount: allIssues.length,
        schemaScore: schemaResult.score,
        safetyScore: safetyResult.score,
        factualScore: factualResult.score,
      });

      return Result.ok(validationResult);
    } catch (error) {
      this.logger.error(
        'Validation failed with unexpected error',
        error as Error
      );
      return Result.err(
        new Error(`Validation failed: ${(error as Error).message}`)
      );
    }
  }

  /**
   * Check for hallucinations in generated content.
   *
   * Validates factual accuracy by checking for:
   * - Non-existent file paths
   * - Invalid framework references
   * - Non-existent package imports
   * - Incorrect API references
   *
   * @param content - Generated content to check for hallucinations
   * @param context - Extended project context for factual validation
   * @returns Result containing array of hallucination descriptions, or Error
   */
  async checkHallucinations(
    content: string,
    context: AgentProjectContext
  ): Promise<Result<string[], Error>> {
    try {
      this.logger.debug('Checking for hallucinations', {
        contentLength: content.length,
        projectType: context.projectType,
      });

      const hallucinations: string[] = [];

      // Extract file path references (e.g., `src/app/...`, `libs/...`)
      const filePathPattern =
        /(?:^|\s)([a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+)/gm;
      const pathMatches = content.matchAll(filePathPattern);

      for (const match of pathMatches) {
        const filePath = match[1];
        // Check if path might reference a file in project
        const isRelevantPath = context.relevantFiles.some(
          (file) =>
            file.relativePath.includes(filePath) ||
            filePath.includes(file.relativePath)
        );

        // If path looks like project file but not found, it might be hallucinated
        if (!isRelevantPath && this.looksLikeProjectPath(filePath, context)) {
          hallucinations.push(
            `Referenced file path "${filePath}" not found in project context`
          );
        }
      }

      // Check framework references
      const frameworkPattern =
        /\b(React|Vue|Angular|Express|NestJS|Django|FastAPI|Rails)\b/g;
      const frameworkMatches = content.matchAll(frameworkPattern);

      for (const match of frameworkMatches) {
        const framework = match[1];
        const isKnownFramework = context.frameworks.some(
          (f) => f.toString().toLowerCase() === framework.toLowerCase()
        );

        if (!isKnownFramework) {
          hallucinations.push(
            `Referenced framework "${framework}" not found in project tech stack`
          );
        }
      }

      // Check import statements
      const importPattern = /import\s+.*\s+from\s+['"]([^'"]+)['"]/g;
      const importMatches = content.matchAll(importPattern);

      for (const match of importMatches) {
        const packageName = match[1];
        // Check if it's a known package in tech stack
        const isKnownPackage = context.techStack.frameworks.some(
          (fw) => fw.toLowerCase() === packageName.toLowerCase()
        );

        // If it's not a relative import and not in tech stack, might be hallucinated
        if (
          !packageName.startsWith('.') &&
          !packageName.startsWith('@') &&
          !isKnownPackage
        ) {
          hallucinations.push(
            `Import statement references unknown package "${packageName}"`
          );
        }
      }

      this.logger.info('Hallucination check complete', {
        hallucinationCount: hallucinations.length,
      });

      return Result.ok(hallucinations);
    } catch (error) {
      this.logger.error(
        'Hallucination check failed with unexpected error',
        error as Error
      );
      return Result.err(
        new Error(`Hallucination check failed: ${(error as Error).message}`)
      );
    }
  }

  /**
   * Validate schema structure and required sections.
   *
   * Checks:
   * - Content length constraints
   * - YAML frontmatter presence and structure
   * - Template marker closure
   * - Required markdown sections
   *
   * @param content - Content to validate
   * @returns Validation result with schema-specific issues and score (0-40)
   */
  private validateSchema(content: string): ValidationResult {
    const issues: ValidationIssue[] = [];
    let score = VALIDATION_WEIGHTS.SCHEMA;

    // Check empty content
    if (!content || content.trim().length === 0) {
      issues.push({
        severity: 'error',
        message: 'Content is empty',
        suggestion: 'Regenerate content with valid template',
      });
      return { isValid: false, issues, score: 0 };
    }

    // Check minimum length
    if (content.length < THRESHOLDS.MIN_CONTENT_LENGTH) {
      issues.push({
        severity: 'error',
        message: `Content too short (${content.length} chars, minimum ${THRESHOLDS.MIN_CONTENT_LENGTH})`,
        suggestion: 'Regenerate with more detailed content',
      });
      score -= 15;
    }

    // Check maximum length
    if (content.length > THRESHOLDS.MAX_CONTENT_LENGTH) {
      issues.push({
        severity: 'warning',
        message: `Content very long (${content.length} chars, maximum ${THRESHOLDS.MAX_CONTENT_LENGTH})`,
        suggestion: 'Consider splitting into multiple files',
      });
      score -= 5;
    }

    // Check for YAML frontmatter
    const hasFrontmatter = /^---\s*\n[\s\S]*?\n---\s*\n/.test(content);
    if (!hasFrontmatter) {
      issues.push({
        severity: 'error',
        message: 'Missing YAML frontmatter',
        suggestion: 'Add frontmatter with metadata (---\\n...\\n---)',
      });
      score -= 15;
    } else {
      // Validate frontmatter structure
      const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
      if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1];

        // Check for required frontmatter fields (common in agent templates)
        const hasId = /\bid\s*:/i.test(frontmatter);
        const hasName = /\bname\s*:/i.test(frontmatter);
        const hasVersion = /\bversion\s*:/i.test(frontmatter);

        if (!hasId || !hasName || !hasVersion) {
          issues.push({
            severity: 'warning',
            message:
              'YAML frontmatter missing recommended fields (id, name, version)',
            suggestion: 'Add metadata fields for better tracking',
          });
          score -= 5;
        }
      }
    }

    // Check for template markers (LLM sections)
    const llmMarkerPattern = /<!-- LLM:(\w+) -->/g;
    const llmOpenMarkers = Array.from(content.matchAll(llmMarkerPattern));
    const llmCloseMarkers = (content.match(/<!-- \/LLM -->/g) || []).length;

    if (llmOpenMarkers.length !== llmCloseMarkers) {
      issues.push({
        severity: 'error',
        message: `Mismatched LLM markers (${llmOpenMarkers.length} open, ${llmCloseMarkers} close)`,
        suggestion:
          'Ensure all <!-- LLM:id --> markers have matching <!-- /LLM -->',
      });
      score -= 10;
    }

    // Check for static markers
    const staticOpenMarkers = (content.match(/<!-- STATIC -->/g) || []).length;
    const staticCloseMarkers = (content.match(/<!-- \/STATIC -->/g) || [])
      .length;

    if (staticOpenMarkers !== staticCloseMarkers) {
      issues.push({
        severity: 'warning',
        message: `Mismatched STATIC markers (${staticOpenMarkers} open, ${staticCloseMarkers} close)`,
        suggestion:
          'Ensure all <!-- STATIC --> markers have matching <!-- /STATIC -->',
      });
      score -= 5;
    }

    // Check for basic markdown structure (headers)
    const hasHeaders = /^#{1,6}\s+.+$/m.test(content);
    if (!hasHeaders) {
      issues.push({
        severity: 'warning',
        message: 'No markdown headers found',
        suggestion: 'Add section headers for better organization',
      });
      score -= 5;
    }

    // Ensure score doesn't go negative
    score = Math.max(0, score);

    return {
      isValid: score > 0,
      issues,
      score,
    };
  }

  /**
   * Validate safety and security concerns.
   *
   * Checks:
   * - Malicious code patterns (script injection, eval, etc.)
   * - Sensitive data exposure (API keys, passwords, tokens)
   * - External resource references
   *
   * @param content - Content to validate
   * @returns Validation result with safety-specific issues and score (0-30)
   */
  private validateSafety(content: string): ValidationResult {
    const issues: ValidationIssue[] = [];
    let score = VALIDATION_WEIGHTS.SAFETY;

    // Check for malicious code patterns
    for (const pattern of MALICIOUS_PATTERNS) {
      const matches = content.matchAll(pattern);
      const matchArray = Array.from(matches);

      if (matchArray.length > 0) {
        issues.push({
          severity: 'error',
          message: `Detected potentially malicious code pattern: ${pattern.source}`,
          suggestion:
            'Remove script tags, eval calls, and dangerous code execution patterns',
        });
        // Critical security issue - fail immediately
        return { isValid: false, issues, score: 0 };
      }
    }

    // Check for sensitive data patterns
    let sensitiveDataFound = false;
    for (const pattern of SENSITIVE_PATTERNS) {
      const matches = content.matchAll(pattern);
      const matchArray = Array.from(matches);

      if (matchArray.length > 0) {
        sensitiveDataFound = true;
        issues.push({
          severity: 'error',
          message: `Detected potential sensitive data: ${pattern.source}`,
          suggestion:
            'Remove API keys, passwords, tokens, and other credentials from content',
        });
        score -= 10;
      }
    }

    // If sensitive data found, fail validation
    if (sensitiveDataFound) {
      return { isValid: false, issues, score: Math.max(0, score) };
    }

    // Check for external URLs (potential security risk)
    const urlPattern = /https?:\/\/(?!localhost|127\.0\.0\.1)[^\s)'"]+/gi;
    const urls = Array.from(content.matchAll(urlPattern));

    if (urls.length > 0) {
      // Filter to non-whitelisted domains
      const whitelistedDomains = [
        'github.com',
        'npmjs.com',
        'docs.anthropic.com',
        'code.visualstudio.com',
        'microsoft.com',
      ];

      const suspiciousUrls = urls.filter((match) => {
        const url = match[0];
        return !whitelistedDomains.some((domain) => url.includes(domain));
      });

      if (suspiciousUrls.length > 0) {
        issues.push({
          severity: 'warning',
          message: `Found ${suspiciousUrls.length} external URL(s) to non-whitelisted domains`,
          suggestion: 'Review external URLs for security and privacy concerns',
        });
        score -= 5;
      }
    }

    // Check for base64 encoded content (might hide malicious code)
    const base64Pattern = /[A-Za-z0-9+/]{100,}={0,2}/g;
    const base64Matches = Array.from(content.matchAll(base64Pattern));

    if (base64Matches.length > 0) {
      issues.push({
        severity: 'info',
        message: `Found ${base64Matches.length} potential base64 encoded string(s)`,
        suggestion: 'Review base64 content to ensure it is legitimate',
      });
      score -= 2;
    }

    // Ensure score doesn't go negative
    score = Math.max(0, score);

    return {
      isValid: score > 0,
      issues,
      score,
    };
  }

  /**
   * Validate factual accuracy against project context.
   *
   * Checks:
   * - File path references exist in project
   * - Framework references match tech stack
   * - Import statements reference known packages
   * - Configuration options are valid
   *
   * @param content - Content to validate
   * @param context - Project context for validation
   * @returns Validation result with factual-specific issues and score (0-30)
   */
  private validateFactualAccuracy(
    content: string,
    context: AgentProjectContext
  ): ValidationResult {
    const issues: ValidationIssue[] = [];
    let score = VALIDATION_WEIGHTS.FACTUAL;

    // If no context provided, skip factual validation (use schema + safety only)
    if (
      !context ||
      !context.relevantFiles ||
      context.relevantFiles.length === 0
    ) {
      this.logger.warn(
        'No project context provided, skipping factual validation'
      );
      return {
        isValid: true,
        issues: [
          {
            severity: 'info',
            message: 'Factual validation skipped (no project context)',
          },
        ],
        score: VALIDATION_WEIGHTS.FACTUAL, // Full score since we can't validate
      };
    }

    // Check file path references
    const filePathPattern = /(?:^|\s)([a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+)/gm;
    const pathMatches = Array.from(content.matchAll(filePathPattern));

    let invalidPathCount = 0;
    for (const match of pathMatches) {
      const filePath = match[1];

      // Check if path exists in project
      const pathExists = context.relevantFiles.some(
        (file) =>
          file.relativePath.includes(filePath) ||
          filePath.includes(file.relativePath)
      );

      // If it looks like a project path but doesn't exist, flag it
      if (!pathExists && this.looksLikeProjectPath(filePath, context)) {
        invalidPathCount++;
        if (invalidPathCount <= 3) {
          // Only report first 3 to avoid spam
          issues.push({
            severity: 'warning',
            message: `Referenced file path "${filePath}" not found in project`,
            suggestion: 'Verify file paths reference actual project files',
          });
        }
      }
    }

    if (invalidPathCount > 0) {
      score -= Math.min(10, invalidPathCount * 3);
    }

    // Check framework references
    const frameworkPattern =
      /\b(React|Vue|Angular|Express|NestJS|Django|FastAPI|Rails|Flask|Laravel|Spring)\b/g;
    const frameworkMatches = Array.from(content.matchAll(frameworkPattern));

    let invalidFrameworkCount = 0;
    for (const match of frameworkMatches) {
      const framework = match[1];
      const isKnown = context.techStack.frameworks.some((fw) =>
        fw.toLowerCase().includes(framework.toLowerCase())
      );

      if (!isKnown) {
        invalidFrameworkCount++;
        if (invalidFrameworkCount <= 2) {
          // Only report first 2
          issues.push({
            severity: 'warning',
            message: `Referenced framework "${framework}" not in project tech stack`,
            suggestion:
              'Ensure framework references match actual project dependencies',
          });
        }
      }
    }

    if (invalidFrameworkCount > 0) {
      score -= Math.min(10, invalidFrameworkCount * 5);
    }

    // Check language references
    const languagePattern =
      /\b(TypeScript|JavaScript|Python|Java|Rust|Go|C\+\+|C#|Ruby|PHP)\b/g;
    const languageMatches = Array.from(content.matchAll(languagePattern));

    let invalidLanguageCount = 0;
    for (const match of languageMatches) {
      const language = match[1];
      const isKnown = context.techStack.languages.some(
        (lang) => lang.toLowerCase() === language.toLowerCase()
      );

      if (!isKnown) {
        invalidLanguageCount++;
      }
    }

    if (invalidLanguageCount > 0) {
      issues.push({
        severity: 'info',
        message: `Referenced ${invalidLanguageCount} language(s) not in project tech stack`,
        suggestion: 'Verify language references are accurate',
      });
      score -= Math.min(5, invalidLanguageCount * 2);
    }

    // Ensure score doesn't go negative
    score = Math.max(0, score);

    return {
      isValid: score > 0,
      issues,
      score,
    };
  }

  /**
   * Determine if a file path looks like it belongs to the project.
   *
   * Heuristics:
   * - Starts with common project directories (src, lib, apps, libs)
   * - Contains project-specific patterns from monorepo type
   * - Matches file extensions used in project
   *
   * @param filePath - File path to check
   * @param context - Project context
   * @returns True if path looks like a project path
   */
  private looksLikeProjectPath(
    filePath: string,
    context: AgentProjectContext
  ): boolean {
    // Common project directory prefixes
    const projectPrefixes = ['src/', 'lib/', 'libs/', 'apps/', 'packages/'];
    const hasProjectPrefix = projectPrefixes.some((prefix) =>
      filePath.startsWith(prefix)
    );

    if (hasProjectPrefix) {
      return true;
    }

    // Check if it has file extensions used in project
    const projectExtensions = context.relevantFiles.map((file) => {
      const parts = file.relativePath.split('.');
      return parts.length > 1 ? `.${parts[parts.length - 1]}` : '';
    });

    const pathExtension = filePath.includes('.')
      ? `.${filePath.split('.').pop()}`
      : '';

    if (pathExtension && projectExtensions.includes(pathExtension)) {
      return true;
    }

    return false;
  }
}
