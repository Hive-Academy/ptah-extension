/**
 * Angular Anti-Pattern Detection Rules
 *
 * Provides rules for detecting common Angular anti-patterns that
 * can lead to performance issues, memory leaks, and maintainability problems.
 *
 * Rules included:
 * - Improper change detection (missing OnPush or manual detectChanges)
 * - Subscription leaks (unmanaged .subscribe() calls)
 * - Circular dependency indicators (forwardRef usage)
 * - Large components (>500 lines)
 * - Missing trackBy in *ngFor / track in @for
 *
 * TASK_2025_144: Phase E2 - Framework-Specific Anti-Pattern Rules
 *
 * @packageDocumentation
 */

import type { AntiPatternRule, AntiPatternMatch } from '@ptah-extension/shared';
import {
  createRegexRule,
  createHeuristicRule,
  getLineFromPosition,
} from './rule-base';

// ============================================
// Angular Rules
// ============================================

/**
 * Detects Angular components without OnPush change detection or
 * with manual detectChanges() calls indicating improper change detection.
 *
 * Components using Default change detection strategy trigger full
 * change detection on every event, which degrades rendering performance
 * in complex component trees.
 *
 * Detection logic:
 * 1. Confirm file has @Component decorator
 * 2. Check if ChangeDetectionStrategy.OnPush is set
 * 3. Check for manual detectChanges() calls
 * 4. Flag if @Component present without OnPush, or if detectChanges() is called
 *
 * @severity warning - Performance impact, can be intentional in some cases
 *
 * @example Detected patterns:
 * ```typescript
 * @Component({
 *   selector: 'app-list',
 *   template: `<div>...</div>`
 * })
 * export class ListComponent { }  // Detected: missing OnPush
 *
 * @Component({
 *   changeDetection: ChangeDetectionStrategy.OnPush,
 *   ...
 * })
 * export class GoodComponent { }  // NOT detected
 * ```
 */
export const improperChangeDetectionRule: AntiPatternRule = createHeuristicRule(
  {
    id: 'angular-improper-change-detection',
    name: 'Improper Change Detection',
    description:
      'Detects Angular components without OnPush change detection strategy or with manual detectChanges() calls',
    severity: 'warning',
    category: 'angular',
    fileExtensions: ['.ts'],
    check: (content: string, filePath: string): AntiPatternMatch[] => {
      const matches: AntiPatternMatch[] = [];

      // Only check files with @Component decorator
      const hasComponent = /@Component\s*\(/.test(content);
      if (!hasComponent) {
        return [];
      }

      // Check for OnPush change detection
      const hasOnPush = /ChangeDetectionStrategy\s*\.\s*OnPush/.test(content);

      // Check for manual detectChanges calls
      const detectChangesPattern = /\.detectChanges\s*\(/g;
      let detectMatch: RegExpExecArray | null;

      if (!hasOnPush) {
        // Find the @Component decorator position for location
        const componentMatch = /@Component\s*\(/.exec(content);
        const line = componentMatch
          ? getLineFromPosition(content, componentMatch.index)
          : 1;

        matches.push({
          type: 'angular-improper-change-detection',
          location: {
            file: filePath,
            line,
          },
          metadata: {
            reason: 'missing-onpush',
          },
        });
      }

      // Also flag detectChanges calls (even with OnPush, these indicate improper patterns)
      while ((detectMatch = detectChangesPattern.exec(content)) !== null) {
        matches.push({
          type: 'angular-improper-change-detection',
          location: {
            file: filePath,
            line: getLineFromPosition(content, detectMatch.index),
          },
          matchedText: detectMatch[0],
          metadata: {
            reason: 'manual-detect-changes',
          },
        });
      }

      return matches;
    },
    suggestionTemplate:
      'Use `ChangeDetectionStrategy.OnPush` to improve rendering performance. ' +
      'Avoid manual `detectChanges()` calls -- use signals or the async pipe instead.',
  }
);

/**
 * Detects .subscribe() calls in Angular component files without
 * corresponding cleanup patterns (takeUntilDestroyed, unsubscribe, DestroyRef).
 *
 * Unmanaged subscriptions cause memory leaks when components are destroyed
 * without unsubscribing from active observables.
 *
 * Detection logic:
 * 1. Confirm file is a component (has @Component)
 * 2. Count .subscribe() occurrences
 * 3. Check for cleanup patterns: takeUntilDestroyed, takeUntil, unsubscribe, DestroyRef, ngOnDestroy
 * 4. Flag if subscribes exist but no cleanup patterns found
 *
 * @severity warning - Memory leak risk
 *
 * @example Detected patterns:
 * ```typescript
 * @Component({ ... })
 * export class MyComponent {
 *   ngOnInit() {
 *     this.data$.subscribe(val => this.data = val); // Detected: no cleanup
 *   }
 * }
 * ```
 */
export const subscriptionLeakRule: AntiPatternRule = createHeuristicRule({
  id: 'angular-subscription-leak',
  name: 'Subscription Leak',
  description:
    'Detects .subscribe() calls in Angular components without proper cleanup (takeUntilDestroyed, unsubscribe, DestroyRef)',
  severity: 'warning',
  category: 'angular',
  fileExtensions: ['.ts'],
  check: (content: string, filePath: string): AntiPatternMatch[] => {
    // Only check files with @Component decorator
    const hasComponent = /@Component\s*\(/.test(content);
    if (!hasComponent) {
      return [];
    }

    // Count .subscribe() calls
    const subscribeMatches = content.match(/\.subscribe\s*\(/g);
    if (!subscribeMatches || subscribeMatches.length === 0) {
      return [];
    }

    // Check for cleanup patterns
    const hasCleanupPattern =
      /takeUntilDestroyed|takeUntil\s*\(|\.unsubscribe\s*\(|DestroyRef|ngOnDestroy/.test(
        content
      );

    if (hasCleanupPattern) {
      return [];
    }

    // Find the first .subscribe() location for reporting
    const firstSubscribe = /\.subscribe\s*\(/.exec(content);
    const line = firstSubscribe
      ? getLineFromPosition(content, firstSubscribe.index)
      : 1;

    return [
      {
        type: 'angular-subscription-leak',
        location: {
          file: filePath,
          line,
        },
        metadata: {
          subscribeCount: subscribeMatches.length,
        },
      },
    ];
  },
  suggestionTemplate:
    'Use `takeUntilDestroyed(this.destroyRef)` or the `async` pipe to automatically ' +
    'clean up subscriptions. Unmanaged subscriptions cause memory leaks.',
});

/**
 * Detects forwardRef() usage in Angular files which often indicates
 * circular dependency injection issues.
 *
 * Pattern: Matches `forwardRef(() =>` syntax
 *
 * @severity warning - Indicates potential circular DI design issue
 *
 * @example Detected patterns:
 * ```typescript
 * constructor(@Inject(forwardRef(() => ParentService)) private parent: ParentService) {}
 * ```
 */
export const circularDependencyRule: AntiPatternRule = createRegexRule({
  id: 'angular-circular-dependency',
  name: 'Angular Circular Dependency',
  description:
    'Detects forwardRef() usage which often indicates circular DI dependencies',
  severity: 'warning',
  category: 'angular',
  fileExtensions: ['.ts'],
  pattern: /forwardRef\s*\(\s*\(\)\s*=>/g,
  suggestionTemplate:
    'Refactor to eliminate circular dependencies. Consider introducing a shared ' +
    'interface or moving shared logic to a separate service.',
});

/**
 * Detects Angular components exceeding 500 lines, which indicates
 * the component has too many responsibilities.
 *
 * Detection logic:
 * 1. Confirm file has @Component decorator
 * 2. Count total lines
 * 3. Flag if > 500 lines
 *
 * @severity warning - Maintainability issue
 *
 * @example Detected scenarios:
 * ```
 * src/app/dashboard.component.ts  // 700 lines -> warning
 * src/app/header.component.ts     // 150 lines -> not detected
 * ```
 */
export const largeComponentRule: AntiPatternRule = createHeuristicRule({
  id: 'angular-large-component',
  name: 'Angular Large Component',
  description:
    'Detects Angular components exceeding 500 lines indicating too many responsibilities',
  severity: 'warning',
  category: 'angular',
  fileExtensions: ['.ts'],
  check: (content: string, filePath: string): AntiPatternMatch[] => {
    // Only check files with @Component decorator
    const hasComponent = /@Component\s*\(/.test(content);
    if (!hasComponent) {
      return [];
    }

    const lineCount = content.split('\n').length;

    if (lineCount > 500) {
      return [
        {
          type: 'angular-large-component',
          location: { file: filePath },
          metadata: {
            lineCount,
            threshold: 500,
            severity: lineCount > 1000 ? 'error' : 'warning',
          },
        },
      ];
    }

    return [];
  },
  suggestionTemplate:
    'Split this component into smaller, focused components. Extract logic into ' +
    'services and use composition over inheritance.',
});

/**
 * Detects *ngFor without trackBy function, or @for without track expression.
 *
 * Without trackBy/@for track, Angular re-renders all list items on every change,
 * causing performance degradation and DOM flickering in large lists.
 *
 * Detection logic (heuristic):
 * 1. Scan for *ngFor directives and check for trackBy in the same context
 * 2. Scan for @for blocks and check for track keyword
 * 3. Flag any usage missing the tracking mechanism
 *
 * @severity info - Performance optimization, not a bug
 *
 * @example Detected patterns:
 * ```html
 * <div *ngFor="let item of items">{{item}}</div>  <!-- Detected: missing trackBy -->
 * @for (item of items) { ... }                     <!-- Detected: missing track -->
 *
 * <div *ngFor="let item of items; trackBy: trackFn">  <!-- NOT detected -->
 * @for (item of items; track item.id) { ... }          <!-- NOT detected -->
 * ```
 */
export const missingTrackByRule: AntiPatternRule = createHeuristicRule({
  id: 'angular-missing-trackby',
  name: 'Missing TrackBy / Track',
  description:
    'Detects *ngFor without trackBy function or @for without track expression',
  severity: 'info',
  category: 'angular',
  fileExtensions: ['.ts', '.html'],
  check: (content: string, filePath: string): AntiPatternMatch[] => {
    const matches: AntiPatternMatch[] = [];

    // Check for *ngFor without trackBy
    // Pattern: *ngFor="let x of y" without trackBy in the directive string
    const ngForPattern = /\*ngFor\s*=\s*"([^"]*)"/g;
    let ngForMatch: RegExpExecArray | null;

    while ((ngForMatch = ngForPattern.exec(content)) !== null) {
      const directiveValue = ngForMatch[1];
      if (!directiveValue.includes('trackBy')) {
        matches.push({
          type: 'angular-missing-trackby',
          location: {
            file: filePath,
            line: getLineFromPosition(content, ngForMatch.index),
          },
          matchedText: ngForMatch[0],
          metadata: {
            directive: '*ngFor',
          },
        });
      }
    }

    // Check for @for blocks without track
    // Pattern: @for (...) { where the parenthesized part does not include '; track'
    const forBlockPattern = /@for\s*\(([^)]*)\)/g;
    let forMatch: RegExpExecArray | null;

    while ((forMatch = forBlockPattern.exec(content)) !== null) {
      const forExpression = forMatch[1];
      if (!/;\s*track\b/.test(forExpression)) {
        matches.push({
          type: 'angular-missing-trackby',
          location: {
            file: filePath,
            line: getLineFromPosition(content, forMatch.index),
          },
          matchedText: forMatch[0],
          metadata: {
            directive: '@for',
          },
        });
      }
    }

    return matches;
  },
  suggestionTemplate:
    'Add a `trackBy` function to `*ngFor` or `track` expression to `@for` ' +
    'to prevent unnecessary DOM re-rendering.',
});

// ============================================
// Exports
// ============================================

/**
 * All Angular anti-pattern detection rules.
 *
 * Import this array to register all Angular rules with the RuleRegistry,
 * or import individual rules for selective registration.
 *
 * @example
 * ```typescript
 * import { angularRules, RuleRegistry } from './rules';
 *
 * const registry = new RuleRegistry();
 * angularRules.forEach(rule => registry.registerRule(rule));
 * ```
 */
export const angularRules: AntiPatternRule[] = [
  improperChangeDetectionRule,
  subscriptionLeakRule,
  circularDependencyRule,
  largeComponentRule,
  missingTrackByRule,
];
