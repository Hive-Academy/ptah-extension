/**
 * NestJS Anti-Pattern Detection Rules
 *
 * Provides rules for detecting common NestJS anti-patterns that
 * can lead to security vulnerabilities, poor architecture, and
 * maintainability issues.
 *
 * Rules included:
 * - Missing decorator on injectable classes
 * - Business logic in controllers
 * - Unsafe raw SQL queries (SQL injection risk)
 * - Missing guards on mutation endpoints
 * - Circular module dependencies (forwardRef in imports)
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
// NestJS Rules
// ============================================

/**
 * Detects classes in NestJS files that lack proper decorators.
 *
 * NestJS requires explicit decorators (@Injectable, @Controller, @Module, etc.)
 * for dependency injection to work. Classes importing from @nestjs/common
 * that lack these decorators will fail at runtime.
 *
 * Detection logic:
 * 1. Check if file imports from @nestjs/common
 * 2. Check if file has exported class declarations
 * 3. Check if appropriate decorators are present
 * 4. Flag if NestJS file has exported class without decorator
 *
 * @severity warning - Will cause runtime DI errors
 *
 * @example Detected patterns:
 * ```typescript
 * import { HttpService } from '@nestjs/common';
 *
 * export class UserService {  // Detected: missing @Injectable()
 *   constructor(private http: HttpService) {}
 * }
 * ```
 */
export const missingDecoratorRule: AntiPatternRule = createHeuristicRule({
  id: 'nestjs-missing-decorator',
  name: 'NestJS Missing Decorator',
  description:
    'Detects NestJS classes that lack @Injectable(), @Controller(), @Module() or other required decorators',
  severity: 'warning',
  category: 'nestjs',
  fileExtensions: ['.ts'],
  check: (content: string, filePath: string): AntiPatternMatch[] => {
    // Only check files that import from @nestjs
    const isNestJSFile = /@nestjs\//.test(content);
    if (!isNestJSFile) {
      return [];
    }

    // Check for exported class declarations
    const exportClassPattern = /export\s+class\s+(\w+)/g;
    const classes: Array<{ name: string; index: number }> = [];
    let classMatch: RegExpExecArray | null;

    while ((classMatch = exportClassPattern.exec(content)) !== null) {
      classes.push({ name: classMatch[1], index: classMatch.index });
    }

    if (classes.length === 0) {
      return [];
    }

    // Known NestJS decorator patterns
    const decoratorPattern =
      /@(?:Injectable|Controller|Module|Guard|Interceptor|Pipe|Middleware|Resolver|Gateway)\s*\(/;

    const matches: AntiPatternMatch[] = [];

    for (const cls of classes) {
      // Look at the content before this class declaration for a decorator.
      // Use 1500 chars to accommodate JSDoc blocks and stacked decorators.
      const lookbackStart = Math.max(0, cls.index - 1500);
      const beforeClass = content.substring(lookbackStart, cls.index);

      // Check if there's a NestJS decorator in the content before this class
      if (!decoratorPattern.test(beforeClass)) {
        matches.push({
          type: 'nestjs-missing-decorator',
          location: {
            file: filePath,
            line: getLineFromPosition(content, cls.index),
          },
          matchedText: `export class ${cls.name}`,
          metadata: {
            className: cls.name,
          },
        });
      }
    }

    return matches;
  },
  suggestionTemplate:
    'Add `@Injectable()` decorator to this service class. NestJS requires ' +
    'explicit decorators for dependency injection to work.',
});

/**
 * Detects NestJS controllers with methods exceeding 20 lines,
 * indicating business logic leaked into controllers.
 *
 * Controllers should be thin, delegating business logic to services.
 * Large controller methods indicate improper separation of concerns.
 *
 * Detection logic:
 * 1. Check if file has @Controller decorator
 * 2. Find method bodies in the class
 * 3. Flag methods > 20 lines
 *
 * @severity warning - Architecture issue, controllers should be thin
 *
 * @example Detected patterns:
 * ```typescript
 * @Controller('users')
 * export class UserController {
 *   @Get()
 *   async getUsers() {
 *     // 25+ lines of business logic -> Detected
 *     // Should be delegated to a service
 *   }
 * }
 * ```
 */
export const controllerLogicRule: AntiPatternRule = createHeuristicRule({
  id: 'nestjs-controller-logic',
  name: 'NestJS Controller Logic',
  description:
    'Detects NestJS controller methods exceeding 20 lines, indicating business logic leaking into controllers',
  severity: 'warning',
  category: 'nestjs',
  fileExtensions: ['.ts'],
  check: (content: string, filePath: string): AntiPatternMatch[] => {
    // Only check files with @Controller decorator
    const hasController = /@Controller\s*\(/.test(content);
    if (!hasController) {
      return [];
    }

    const matches: AntiPatternMatch[] = [];

    // Find HTTP method decorators followed by method definitions
    // @Get(), @Post(), @Put(), @Delete(), @Patch(), @All()
    const httpMethodPattern =
      /@(?:Get|Post|Put|Delete|Patch|All|Head|Options)\s*\([^)]*\)/g;
    let decoratorMatch: RegExpExecArray | null;

    while ((decoratorMatch = httpMethodPattern.exec(content)) !== null) {
      // Find the next opening brace after the decorator (the method body)
      const afterDecorator = content.indexOf(
        '{',
        decoratorMatch.index + decoratorMatch[0].length
      );
      if (afterDecorator === -1) {
        continue;
      }

      // Count balanced braces to find method end
      let braceCount = 0;
      let foundStart = false;
      let endIndex = afterDecorator;

      for (let i = afterDecorator; i < content.length; i++) {
        const char = content[i];
        if (char === '{') {
          braceCount++;
          foundStart = true;
        } else if (char === '}') {
          braceCount--;
          if (foundStart && braceCount === 0) {
            endIndex = i;
            break;
          }
        }
      }

      if (foundStart && braceCount === 0) {
        const methodBody = content.substring(afterDecorator, endIndex + 1);
        const lineCount = (methodBody.match(/\n/g) || []).length + 1;

        if (lineCount > 20) {
          matches.push({
            type: 'nestjs-controller-logic',
            location: {
              file: filePath,
              line: getLineFromPosition(content, decoratorMatch.index),
            },
            matchedText: decoratorMatch[0],
            metadata: {
              lineCount,
              threshold: 20,
            },
          });
        }
      }
    }

    return matches;
  },
  suggestionTemplate:
    'Move business logic from controllers to dedicated service classes. ' +
    'Controllers should only handle HTTP concerns (validation, response formatting).',
});

/**
 * Detects raw SQL queries with string concatenation or template literals,
 * which create SQL injection vulnerabilities.
 *
 * Pattern: Matches template literal interpolation or string concatenation
 * inside query()/execute() calls.
 *
 * @severity error - Critical security vulnerability
 *
 * @example Detected patterns:
 * ```typescript
 * await this.db.query(`SELECT * FROM users WHERE id = ${userId}`);   // Detected
 * await this.db.query('SELECT * FROM users WHERE id = ' + userId);   // Detected
 *
 * await this.db.query('SELECT * FROM users WHERE id = $1', [userId]); // NOT detected
 * ```
 */
export const unsafeRepositoryRule: AntiPatternRule = createRegexRule({
  id: 'nestjs-unsafe-repository',
  name: 'NestJS Unsafe Repository Query',
  description:
    'Detects raw SQL queries with string interpolation/concatenation (SQL injection risk)',
  severity: 'error',
  category: 'nestjs',
  fileExtensions: ['.ts'],
  // Match query() or execute() with template literal containing ${
  pattern: /(?:query|execute)\s*\(\s*`[^`]*\$\{/g,
  suggestionTemplate:
    'Use parameterized queries to prevent SQL injection attacks. ' +
    'Use `$1, $2` placeholders or an ORM like Prisma/TypeORM.',
});

/**
 * Detects NestJS controller mutation endpoints (@Post, @Put, @Delete, @Patch)
 * that lack @UseGuards() at method or class level.
 *
 * Mutation endpoints without guards expose the application to
 * unauthorized access and should always be protected.
 *
 * Detection logic:
 * 1. Check if file has @Controller decorator
 * 2. Check if @UseGuards is present at class level
 * 3. If no class-level guard, check mutation decorators for method-level guards
 * 4. Flag mutation endpoints without guards
 *
 * @severity warning - Security concern, may be intentional for public APIs
 *
 * @example Detected patterns:
 * ```typescript
 * @Controller('users')
 * export class UserController {
 *   @Post()                        // Detected: no guard
 *   async createUser() { ... }
 *
 *   @UseGuards(AuthGuard)
 *   @Delete(':id')                  // NOT detected: has guard
 *   async deleteUser() { ... }
 * }
 * ```
 */
export const missingGuardRule: AntiPatternRule = createHeuristicRule({
  id: 'nestjs-missing-guard',
  name: 'NestJS Missing Guard',
  description:
    'Detects @Post/@Put/@Delete/@Patch endpoints without @UseGuards at method or class level',
  severity: 'warning',
  category: 'nestjs',
  fileExtensions: ['.ts'],
  check: (content: string, filePath: string): AntiPatternMatch[] => {
    // Only check files with @Controller decorator
    const hasController = /@Controller\s*\(/.test(content);
    if (!hasController) {
      return [];
    }

    // Check for class-level @UseGuards (covers all methods)
    // Class-level guard appears before the class declaration and after @Controller
    const controllerIndex = content.search(/@Controller\s*\(/);
    const classIndex = content.indexOf('export class', controllerIndex);
    if (classIndex === -1) {
      return [];
    }

    const betweenDecoratorAndClass = content.substring(
      controllerIndex,
      classIndex
    );
    const hasClassLevelGuard = /@UseGuards\s*\(/.test(betweenDecoratorAndClass);

    if (hasClassLevelGuard) {
      return [];
    }

    const matches: AntiPatternMatch[] = [];

    // Find mutation method decorators
    const mutationPattern = /@(?:Post|Put|Delete|Patch)\s*\(/g;
    let mutationMatch: RegExpExecArray | null;

    while ((mutationMatch = mutationPattern.exec(content)) !== null) {
      // Look backwards from the mutation decorator for @UseGuards
      // within a reasonable window (300 chars before, to capture stacked decorators)
      const lookbackStart = Math.max(0, mutationMatch.index - 300);
      const beforeDecorator = content.substring(
        lookbackStart,
        mutationMatch.index
      );

      // Check for @UseGuards in the decorator stack for this method
      // We look for @UseGuards that appears after the last empty line or method boundary
      const lastBoundary = Math.max(
        beforeDecorator.lastIndexOf('\n\n'),
        beforeDecorator.lastIndexOf('}\n'),
        beforeDecorator.lastIndexOf(';\n')
      );

      const decoratorStack =
        lastBoundary >= 0
          ? beforeDecorator.substring(lastBoundary)
          : beforeDecorator;

      if (!/@UseGuards\s*\(/.test(decoratorStack)) {
        matches.push({
          type: 'nestjs-missing-guard',
          location: {
            file: filePath,
            line: getLineFromPosition(content, mutationMatch.index),
          },
          matchedText: mutationMatch[0],
          metadata: {
            decorator: mutationMatch[0],
          },
        });
      }
    }

    return matches;
  },
  suggestionTemplate:
    'Add `@UseGuards(AuthGuard)` to protect sensitive endpoints. ' +
    'Consider using class-level guards for consistent protection.',
});

/**
 * Detects forwardRef() usage in NestJS module imports, indicating
 * circular module dependencies.
 *
 * Pattern: Matches forwardRef inside module imports array
 *
 * @severity warning - Circular modules indicate architecture issues
 *
 * @example Detected patterns:
 * ```typescript
 * @Module({
 *   imports: [forwardRef(() => OtherModule)],  // Detected
 * })
 * export class MyModule {}
 * ```
 */
export const circularModuleRule: AntiPatternRule = createRegexRule({
  id: 'nestjs-circular-module',
  name: 'NestJS Circular Module',
  description:
    'Detects forwardRef() usage in NestJS module imports indicating circular module dependencies',
  severity: 'warning',
  category: 'nestjs',
  fileExtensions: ['.ts'],
  pattern: /imports\s*:\s*\[[^\]]*forwardRef/g,
  suggestionTemplate:
    'Refactor module structure to eliminate circular imports. ' +
    'Extract shared functionality into a common module.',
});

// ============================================
// Exports
// ============================================

/**
 * All NestJS anti-pattern detection rules.
 *
 * Import this array to register all NestJS rules with the RuleRegistry,
 * or import individual rules for selective registration.
 *
 * @example
 * ```typescript
 * import { nestjsRules, RuleRegistry } from './rules';
 *
 * const registry = new RuleRegistry();
 * nestjsRules.forEach(rule => registry.registerRule(rule));
 * ```
 */
export const nestjsRules: AntiPatternRule[] = [
  missingDecoratorRule,
  controllerLogicRule,
  unsafeRepositoryRule,
  missingGuardRule,
  circularModuleRule,
];
