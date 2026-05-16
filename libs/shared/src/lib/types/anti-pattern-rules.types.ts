/**
 * Anti-Pattern Rule Types
 *
 * Type definitions for the anti-pattern detection rule engine.
 * Enables extensible, configurable pattern detection.
 *
 * @packageDocumentation
 */

import type {
  AntiPatternType,
  AntiPatternSeverity,
  CodeLocation,
} from './quality-assessment.types';

/**
 * Utility type for values that may be returned synchronously or asynchronously.
 *
 * Used by {@link AntiPatternRule.detect} so individual rules can opt into async
 * detection (e.g. AST-backed analyses) while leaving existing sync rules
 * unchanged. Consumers must `await Promise.resolve(...)` the result to handle
 * both cases uniformly.
 */
export type MaybeAsync<T> = T | Promise<T>;

/**
 * Match result from a single pattern detection
 */
export interface AntiPatternMatch {
  /** Type of pattern matched */
  type: AntiPatternType;
  /** Location in file */
  location: CodeLocation;
  /** Matched text (for context) */
  matchedText?: string;
  /** Additional context data */
  metadata?: Record<string, unknown>;
}

/**
 * Detection method used by the rule
 */
export type DetectionMethod = 'regex' | 'ast' | 'heuristic';

/**
 * Rule category for grouping related rules.
 */
export type RuleCategory =
  | 'typescript'
  | 'error-handling'
  | 'architecture'
  | 'testing'
  | 'angular'
  | 'nestjs'
  | 'react';

/**
 * Rule definition for anti-pattern detection
 */
export interface AntiPatternRule {
  /** Unique rule identifier */
  id: AntiPatternType;
  /** Human-readable name */
  name: string;
  /** Description of what the rule detects */
  description: string;
  /** Severity level */
  severity: AntiPatternSeverity;
  /** Detection method */
  method: DetectionMethod;
  /** Category (for grouping) */
  category: RuleCategory;
  /** File extensions this rule applies to */
  fileExtensions: string[];
  /**
   * Detection function.
   *
   * Rules may execute synchronously (e.g. regex scans) or asynchronously
   * (e.g. AST/tree-sitter-backed analyses). Callers must normalize the
   * return value with `await Promise.resolve(rule.detect(...))`.
   *
   * @param content - File content to analyze
   * @param filePath - Relative file path
   * @returns Array of detected matches (or a Promise resolving to one)
   */
  detect: (content: string, filePath: string) => MaybeAsync<AntiPatternMatch[]>;
  /**
   * Suggestion generator
   * @param match - The detected match
   * @returns Human-readable suggestion for fixing the issue
   */
  getSuggestion: (match: AntiPatternMatch) => string;
  /** Whether rule is enabled by default */
  enabledByDefault: boolean;
}

/**
 * Rule configuration for customization
 */
export interface RuleConfiguration {
  /** Rule ID */
  ruleId: AntiPatternType;
  /** Whether rule is enabled */
  enabled: boolean;
  /** Override severity */
  severity?: AntiPatternSeverity;
  /** Custom threshold (for rules with thresholds) */
  threshold?: number;
}

/**
 * Rule registry interface for managing all rules
 */
export interface AntiPatternRuleRegistry {
  /**
   * Get all registered rules
   * @returns Array of all enabled rules
   */
  getRules(): AntiPatternRule[];

  /**
   * Get rules by category
   * @param category - Rule category to filter by
   * @returns Array of rules in the specified category
   */
  getRulesByCategory(category: RuleCategory): AntiPatternRule[];

  /**
   * Get rules for specific file extension
   * @param extension - File extension (e.g., '.ts')
   * @returns Array of rules applicable to the file type
   */
  getRulesForExtension(extension: string): AntiPatternRule[];

  /**
   * Register a new rule
   * @param rule - Rule to register
   */
  registerRule(rule: AntiPatternRule): void;

  /**
   * Configure a rule
   * @param ruleId - Rule identifier
   * @param config - Configuration to apply
   */
  configureRule(
    ruleId: AntiPatternType,
    config: Partial<RuleConfiguration>,
  ): void;
}
