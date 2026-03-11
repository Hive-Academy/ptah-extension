/**
 * Anti-Pattern Rule Registry
 *
 * Central registry for all anti-pattern detection rules.
 * Provides rule management, filtering, and configuration capabilities.
 *
 * The RuleRegistry implements the AntiPatternRuleRegistry interface from shared,
 * enabling O(1) rule lookup by ID and efficient filtering by category/extension.
 *
 * TASK_2025_141: Unified Project Intelligence with Code Quality Assessment
 *
 * @packageDocumentation
 */

import type {
  AntiPatternRule,
  AntiPatternType,
  RuleConfiguration,
  RuleCategory,
} from '@ptah-extension/shared';

// Import rule modules
import { typescriptRules } from './typescript-rules';
import { errorHandlingRules } from './error-handling-rules';
import { architectureRules } from './architecture-rules';
import { testingRules } from './testing-rules';
import { angularRules } from './angular-rules';
import { nestjsRules } from './nestjs-rules';
import { reactRules } from './react-rules';

// ============================================
// Rule Aggregation
// ============================================

/**
 * All built-in anti-pattern detection rules.
 *
 * This constant combines all rule categories into a single array
 * for easy registration with the RuleRegistry.
 *
 * Categories included:
 * - TypeScript rules (explicit any, ts-ignore, non-null assertion)
 * - Error handling rules (empty catch, console-only catch)
 * - Architecture rules (file too large, too many imports, function too large)
 * - Testing rules (no assertions, all skipped)
 * - Angular rules (change detection, subscriptions, circular DI, large component, trackBy)
 * - NestJS rules (missing decorator, controller logic, unsafe queries, missing guard, circular module)
 * - React rules (missing key, state mutation, useEffect deps, large component, inline function props)
 *
 * @example
 * ```typescript
 * import { ALL_RULES } from './rules';
 *
 * console.log(`Total rules: ${ALL_RULES.length}`);
 * ALL_RULES.forEach(rule => {
 *   console.log(`[${rule.category}] ${rule.name}: ${rule.description}`);
 * });
 * ```
 */
export const ALL_RULES: AntiPatternRule[] = [
  ...typescriptRules,
  ...errorHandlingRules,
  ...architectureRules,
  ...testingRules,
  ...angularRules,
  ...nestjsRules,
  ...reactRules,
];

// ============================================
// Rule Registry
// ============================================

/**
 * Central registry for managing anti-pattern detection rules.
 *
 * The RuleRegistry provides:
 * - O(1) rule lookup by ID
 * - Category-based filtering
 * - File extension filtering
 * - Rule configuration (enable/disable, severity override)
 *
 * Design Pattern: Registry Pattern
 * - Centralized rule management
 * - Decoupled from detection logic
 * - Extensible through registerRule()
 *
 * @example
 * ```typescript
 * const registry = new RuleRegistry();
 *
 * // Get all enabled rules
 * const rules = registry.getRules();
 *
 * // Get TypeScript rules only
 * const tsRules = registry.getRulesByCategory('typescript');
 *
 * // Get rules for .ts files
 * const forTsFiles = registry.getRulesForExtension('.ts');
 *
 * // Disable a specific rule
 * registry.configureRule('typescript-explicit-any', { enabled: false });
 *
 * // Register a custom rule
 * registry.registerRule(myCustomRule);
 * ```
 */
export class RuleRegistry {
  /** Map of rule ID to rule for O(1) lookup */
  private rules: Map<AntiPatternType, AntiPatternRule> = new Map();

  /** Map of rule ID to configuration overrides */
  private configurations: Map<AntiPatternType, Partial<RuleConfiguration>> =
    new Map();

  /**
   * Creates a new RuleRegistry with all built-in rules registered.
   *
   * @example
   * ```typescript
   * const registry = new RuleRegistry();
   * console.log(`Registered ${registry.getRules().length} rules`);
   * ```
   */
  constructor() {
    // Register all built-in rules
    ALL_RULES.forEach((rule) => this.registerRule(rule));
  }

  /**
   * Registers a new rule with the registry.
   *
   * If a rule with the same ID already exists, it will be replaced.
   * This allows for custom rule implementations to override built-in rules.
   *
   * @param rule - The rule to register
   *
   * @example
   * ```typescript
   * const customRule: AntiPatternRule = {
   *   id: 'typescript-explicit-any',
   *   name: 'Custom Any Detection',
   *   // ... rest of rule definition
   * };
   *
   * registry.registerRule(customRule);
   * ```
   */
  registerRule(rule: AntiPatternRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * Configures a rule with custom settings.
   *
   * Configuration options:
   * - enabled: Enable or disable the rule
   * - severity: Override the default severity
   * - threshold: Custom threshold for rules that support it
   *
   * @param ruleId - ID of the rule to configure
   * @param config - Configuration options to apply
   *
   * @example
   * ```typescript
   * // Disable explicit any detection
   * registry.configureRule('typescript-explicit-any', { enabled: false });
   *
   * // Make ts-ignore an error instead of warning
   * registry.configureRule('typescript-ts-ignore', { severity: 'error' });
   * ```
   */
  configureRule(
    ruleId: AntiPatternType,
    config: Partial<RuleConfiguration>
  ): void {
    const existing = this.configurations.get(ruleId) || {};
    this.configurations.set(ruleId, { ...existing, ...config });
  }

  /**
   * Gets all enabled rules.
   *
   * A rule is included if:
   * - It is registered in the registry
   * - It is enabled by default OR explicitly enabled in configuration
   * - It is NOT explicitly disabled in configuration
   *
   * @returns Array of enabled rules
   *
   * @example
   * ```typescript
   * const rules = registry.getRules();
   * console.log(`${rules.length} rules enabled`);
   * ```
   */
  getRules(): AntiPatternRule[] {
    return Array.from(this.rules.values()).filter((rule) => {
      const config = this.configurations.get(rule.id);

      // Explicitly disabled
      if (config?.enabled === false) {
        return false;
      }

      // Explicitly enabled OR enabled by default
      return config?.enabled === true || rule.enabledByDefault;
    });
  }

  /**
   * Gets enabled rules filtered by category.
   *
   * @param category - Rule category to filter by
   * @returns Array of enabled rules in the specified category
   *
   * @example
   * ```typescript
   * const tsRules = registry.getRulesByCategory('typescript');
   * console.log(`TypeScript rules: ${tsRules.length}`);
   *
   * const errorRules = registry.getRulesByCategory('error-handling');
   * console.log(`Error handling rules: ${errorRules.length}`);
   * ```
   */
  getRulesByCategory(category: RuleCategory): AntiPatternRule[] {
    return this.getRules().filter((rule) => rule.category === category);
  }

  /**
   * Gets enabled rules applicable to a specific file extension.
   *
   * Rules are matched if their fileExtensions array includes the
   * specified extension.
   *
   * @param extension - File extension including dot (e.g., '.ts')
   * @returns Array of enabled rules for the file type
   *
   * @example
   * ```typescript
   * const tsRules = registry.getRulesForExtension('.ts');
   * console.log(`Rules for .ts files: ${tsRules.length}`);
   *
   * const jsRules = registry.getRulesForExtension('.js');
   * console.log(`Rules for .js files: ${jsRules.length}`);
   * ```
   */
  getRulesForExtension(extension: string): AntiPatternRule[] {
    return this.getRules().filter((rule) =>
      rule.fileExtensions.includes(extension)
    );
  }

  /**
   * Gets a specific rule by its ID.
   *
   * Returns the rule regardless of whether it is enabled.
   * Use this to inspect rule details or check if a rule exists.
   *
   * @param ruleId - ID of the rule to retrieve
   * @returns The rule if found, undefined otherwise
   *
   * @example
   * ```typescript
   * const rule = registry.getRule('typescript-explicit-any');
   * if (rule) {
   *   console.log(`Found rule: ${rule.name}`);
   * }
   * ```
   */
  getRule(ruleId: AntiPatternType): AntiPatternRule | undefined {
    return this.rules.get(ruleId);
  }

  /**
   * Gets the effective severity for a rule.
   *
   * Returns the configured severity if set, otherwise the rule's default severity.
   *
   * @param ruleId - ID of the rule
   * @returns Effective severity or undefined if rule not found
   *
   * @example
   * ```typescript
   * registry.configureRule('typescript-ts-ignore', { severity: 'error' });
   * const severity = registry.getEffectiveSeverity('typescript-ts-ignore');
   * // Returns 'error' (configured) instead of 'warning' (default)
   * ```
   */
  getEffectiveSeverity(ruleId: AntiPatternType): string | undefined {
    const rule = this.rules.get(ruleId);
    if (!rule) {
      return undefined;
    }

    const config = this.configurations.get(ruleId);
    return config?.severity ?? rule.severity;
  }

  /**
   * Checks if a rule is currently enabled.
   *
   * @param ruleId - ID of the rule to check
   * @returns True if the rule is enabled, false otherwise
   *
   * @example
   * ```typescript
   * if (registry.isRuleEnabled('typescript-explicit-any')) {
   *   console.log('Explicit any detection is enabled');
   * }
   * ```
   */
  isRuleEnabled(ruleId: AntiPatternType): boolean {
    const rule = this.rules.get(ruleId);
    if (!rule) {
      return false;
    }

    const config = this.configurations.get(ruleId);
    if (config?.enabled !== undefined) {
      return config.enabled;
    }

    return rule.enabledByDefault;
  }

  /**
   * Resets all rule configurations to defaults.
   *
   * Clears all custom configurations, returning rules to their
   * default enabled/disabled state and severity.
   *
   * @example
   * ```typescript
   * registry.configureRule('typescript-ts-ignore', { enabled: false });
   * registry.resetConfigurations();
   * // ts-ignore is now enabled again (its default)
   * ```
   */
  resetConfigurations(): void {
    this.configurations.clear();
  }
}

// ============================================
// Re-exports
// ============================================

// Export rule modules for direct access
export { typescriptRules } from './typescript-rules';
export { errorHandlingRules } from './error-handling-rules';
export { architectureRules } from './architecture-rules';
export { testingRules } from './testing-rules';
export { angularRules } from './angular-rules';
export { nestjsRules } from './nestjs-rules';
export { reactRules } from './react-rules';

// Export individual rules for selective use
export {
  explicitAnyRule,
  tsIgnoreRule,
  nonNullAssertionRule,
} from './typescript-rules';

export { emptyCatchRule, consoleOnlyCatchRule } from './error-handling-rules';

export {
  fileTooLargeRule,
  tooManyImportsRule,
  functionTooLargeRule,
} from './architecture-rules';

export { noAssertionsRule, allSkippedRule } from './testing-rules';

// Angular rules (TASK_2025_144 Phase E2)
export {
  improperChangeDetectionRule,
  subscriptionLeakRule,
  circularDependencyRule,
  largeComponentRule as angularLargeComponentRule,
  missingTrackByRule,
} from './angular-rules';

// NestJS rules (TASK_2025_144 Phase E2)
export {
  missingDecoratorRule,
  controllerLogicRule,
  unsafeRepositoryRule,
  missingGuardRule,
  circularModuleRule,
} from './nestjs-rules';

// React rules (TASK_2025_144 Phase E2)
export {
  missingKeyRule,
  directStateMutationRule,
  useEffectDependenciesRule,
  largeComponentRule as reactLargeComponentRule,
  inlineFunctionPropRule,
} from './react-rules';

// Export rule-base utilities
export {
  createRegexRule,
  createHeuristicRule,
  getFileExtension,
  hasMatchingExtension,
  getLineFromPosition,
  type RegexRuleConfig,
  type HeuristicRuleConfig,
} from './rule-base';
