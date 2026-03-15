/**
 * Context Enrichment Service
 *
 * Generates .d.ts-style structural summaries from CodeInsights to reduce token
 * usage while preserving API surface information. Structural summaries include
 * imports, class outlines with method signatures, and exported function signatures
 * without implementation bodies.
 *
 * @module libs/backend/workspace-intelligence/context-analysis
 */

import { injectable, inject } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import { AstAnalysisService } from '../ast/ast-analysis.service';
import {
  CodeInsights,
  FunctionInfo,
  ClassInfo,
  ImportInfo,
  ExportInfo,
} from '../ast/ast-analysis.interfaces';
import { SupportedLanguage } from '../ast/ast.types';
import { EXTENSION_LANGUAGE_MAP } from '../ast/tree-sitter.config';
import { TokenCounterService } from '../services/token-counter.service';
import { FileSystemService } from '../services/file-system.service';

/**
 * Result of generating a structural summary for a file.
 */
export interface StructuralSummaryResult {
  /** The summary content (either structural declaration or full content) */
  content: string;
  /** Whether this is a structural summary or full content fallback */
  mode: 'structural' | 'full';
  /** Token count of the summary/content returned */
  tokenCount: number;
  /** Token count of the original full content */
  originalTokenCount: number;
  /** Percentage reduction in tokens (0-100) */
  reductionPercentage: number;
}

/**
 * Context Enrichment Service
 *
 * Produces compact .d.ts-style structural summaries from source files using
 * tree-sitter-based AST analysis. Falls back to full content when the language
 * is unsupported or parsing fails.
 */
@injectable()
export class ContextEnrichmentService {
  constructor(
    private readonly astAnalysis: AstAnalysisService,
    private readonly tokenCounter: TokenCounterService,
    private readonly fileSystem: FileSystemService,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider
  ) {}

  /**
   * Generate a structural summary for a file.
   *
   * Reads the file (or uses provided content), analyzes its AST, and produces
   * a .d.ts-style declaration summary. Falls back to full content if the
   * language is unsupported or parsing fails.
   *
   * @param filePath - Absolute path to the source file
   * @param language - The language identifier (e.g., 'typescript', 'javascript'), or undefined for unsupported
   * @param fullContent - Optional pre-read file content to avoid redundant I/O
   * @returns Structural summary result with token metrics
   */
  async generateStructuralSummary(
    filePath: string,
    language: SupportedLanguage | undefined,
    fullContent?: string
  ): Promise<StructuralSummaryResult> {
    // Read file content if not provided
    let content: string;
    if (fullContent !== undefined) {
      content = fullContent;
    } else {
      try {
        content = await this.fileSystem.readFile(filePath);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `ContextEnrichmentService.generateStructuralSummary() - Failed to read file ${filePath}: ${errorMessage}`
        );
        return this.createFullContentResult('', 0);
      }
    }

    // Handle empty files
    if (!content.trim()) {
      this.logger.debug(
        `ContextEnrichmentService.generateStructuralSummary() - Empty file: ${filePath}`
      );
      const emptyHeader = `// Structural summary: ${this.toRelativePath(
        filePath
      )}\n// Empty file\n`;
      const [headerTokens, originalTokens] = await Promise.all([
        this.tokenCounter.countTokens(emptyHeader),
        this.tokenCounter.countTokens(content),
      ]);
      return {
        content: emptyHeader,
        mode: 'structural',
        tokenCount: headerTokens,
        originalTokenCount: originalTokens,
        reductionPercentage: this.calcReduction(originalTokens, headerTokens),
      };
    }

    // Unsupported language: return full content
    if (!language) {
      this.logger.debug(
        `ContextEnrichmentService.generateStructuralSummary() - Unsupported language for ${filePath}, using full content`
      );
      return this.createFullContentResult(content);
    }

    // Analyze source using AST
    const insightsResult = this.astAnalysis.analyzeSource(
      content,
      language,
      filePath
    );

    if (insightsResult.isErr()) {
      this.logger.warn(
        `ContextEnrichmentService.generateStructuralSummary() - AST analysis failed for ${filePath}: ${insightsResult.error?.message}. Falling back to full content.`
      );
      return this.createFullContentResult(content);
    }

    const insights = insightsResult.value!;
    const declaration = this.formatAsDeclaration(insights, filePath);

    const [summaryTokens, originalTokens] = await Promise.all([
      this.tokenCounter.countTokens(declaration),
      this.tokenCounter.countTokens(content),
    ]);

    return {
      content: declaration,
      mode: 'structural',
      tokenCount: summaryTokens,
      originalTokenCount: originalTokens,
      reductionPercentage: this.calcReduction(originalTokens, summaryTokens),
    };
  }

  /**
   * Format CodeInsights as a .d.ts-style declaration string.
   *
   * Produces a human-readable structural summary with:
   * - Header comment with file stats
   * - Import statements (listed verbatim)
   * - Class outlines with method signatures (no bodies)
   * - Exported function signatures (no bodies)
   * - Re-exports
   *
   * @param insights - Parsed code insights from AST analysis
   * @param filePath - Original file path for the header comment
   * @returns Formatted declaration string
   */
  formatAsDeclaration(insights: CodeInsights, filePath: string): string {
    const lines: string[] = [];
    const relativePath = this.toRelativePath(filePath);

    // Build export lookup for determining which functions/classes are exported
    const exportedNames = this.buildExportedNamesSet(insights.exports);

    // Header comment with stats
    const stats = this.buildStatsLine(insights);
    lines.push(`// Structural summary: ${relativePath}`);
    lines.push(`// ${stats}`);
    lines.push('');

    // Imports (listed verbatim as they are already compact)
    if (insights.imports.length > 0) {
      for (const imp of insights.imports) {
        lines.push(this.formatImport(imp));
      }
      lines.push('');
    }

    // Classes with method signatures
    for (const cls of insights.classes) {
      const isExported = cls.isExported || exportedNames.has(cls.name);
      lines.push(this.formatClass(cls, isExported));
      lines.push('');
    }

    // Standalone functions (not class methods)
    const standaloneFunctions = insights.functions.filter(
      (fn) => !this.isMemberOfAnyClass(fn, insights.classes)
    );

    for (const fn of standaloneFunctions) {
      const isExported = fn.isExported || exportedNames.has(fn.name);
      lines.push(this.formatFunction(fn, isExported));
    }

    // Re-exports
    if (insights.exports) {
      const reExports = insights.exports.filter((e) => e.isReExport);
      if (reExports.length > 0) {
        if (standaloneFunctions.length > 0) {
          lines.push('');
        }
        for (const re of reExports) {
          lines.push(this.formatReExport(re));
        }
      }
    }

    // Clean up trailing whitespace
    let result = lines.join('\n').trimEnd();
    if (result) {
      result += '\n';
    }

    return result;
  }

  // --- Private Helpers ---

  /**
   * Build a set of exported symbol names for quick lookup.
   */
  private buildExportedNamesSet(
    exports: ExportInfo[] | undefined
  ): Set<string> {
    const names = new Set<string>();
    if (exports) {
      for (const exp of exports) {
        if (!exp.isReExport) {
          names.add(exp.name);
        }
      }
    }
    return names;
  }

  /**
   * Build the stats line for the header comment.
   */
  private buildStatsLine(insights: CodeInsights): string {
    const parts: string[] = [];

    const standaloneFunctions = insights.functions.filter(
      (fn) => !this.isMemberOfAnyClass(fn, insights.classes)
    );

    if (standaloneFunctions.length > 0) {
      parts.push(`Functions: ${standaloneFunctions.length}`);
    }
    if (insights.classes.length > 0) {
      parts.push(`Classes: ${insights.classes.length}`);
    }
    if (insights.imports.length > 0) {
      parts.push(`Imports: ${insights.imports.length}`);
    }

    const exportCount = insights.exports?.length ?? 0;
    if (exportCount > 0) {
      parts.push(`Exports: ${exportCount}`);
    }

    return parts.length > 0 ? parts.join(' | ') : 'No declarations found';
  }

  /**
   * Check if a function is a method defined inside one of the classes
   * based on line position overlap.
   */
  private isMemberOfAnyClass(fn: FunctionInfo, classes: ClassInfo[]): boolean {
    if (fn.startLine === undefined) {
      return false;
    }
    for (const cls of classes) {
      if (
        cls.startLine !== undefined &&
        cls.endLine !== undefined &&
        fn.startLine >= cls.startLine &&
        fn.startLine <= cls.endLine
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Format an import statement for the summary.
   */
  private formatImport(imp: ImportInfo): string {
    if (!imp.importedSymbols || imp.importedSymbols.length === 0) {
      // Side-effect import
      return `import '${imp.source}';`;
    }

    if (imp.isNamespace) {
      const nsSymbol = imp.importedSymbols.find((s) => s.startsWith('* as'));
      return `import ${nsSymbol || '* as unknown'} from '${imp.source}';`;
    }

    if (imp.isDefault && imp.importedSymbols.length === 1) {
      return `import ${imp.importedSymbols[0]} from '${imp.source}';`;
    }

    // Named imports (may include a default import alongside named ones)
    const defaultImports = imp.isDefault ? [imp.importedSymbols[0]] : [];
    const namedImports = imp.isDefault
      ? imp.importedSymbols.slice(1)
      : imp.importedSymbols.filter((s) => !s.startsWith('* as'));

    const parts: string[] = [];
    if (defaultImports.length > 0) {
      parts.push(defaultImports[0]);
    }
    if (namedImports.length > 0) {
      parts.push(`{ ${namedImports.join(', ')} }`);
    }

    return `import ${parts.join(', ')} from '${imp.source}';`;
  }

  /**
   * Format a class as an outline with method signatures (no bodies).
   */
  private formatClass(cls: ClassInfo, isExported: boolean): string {
    const prefix = isExported ? 'export ' : '';
    const lines: string[] = [];
    lines.push(`${prefix}class ${cls.name} {`);

    if (cls.methods && cls.methods.length > 0) {
      for (const method of cls.methods) {
        const asyncPrefix = method.isAsync ? 'async ' : '';
        const params = method.parameters.join(', ');
        lines.push(`  ${asyncPrefix}${method.name}(${params});`);
      }
    }

    lines.push('}');
    return lines.join('\n');
  }

  /**
   * Format a standalone function as a signature line (no body).
   */
  private formatFunction(fn: FunctionInfo, isExported: boolean): string {
    const exportPrefix = isExported ? 'export ' : '';
    const asyncPrefix = fn.isAsync ? 'async ' : '';
    const params = fn.parameters.join(', ');
    return `${exportPrefix}${asyncPrefix}function ${fn.name}(${params});`;
  }

  /**
   * Format a re-export statement.
   */
  private formatReExport(exp: ExportInfo): string {
    if (exp.source) {
      return `export { ${exp.name} } from '${exp.source}';`;
    }
    return `export { ${exp.name} };`;
  }

  /**
   * Create a full-content fallback result.
   */
  private async createFullContentResult(
    content: string,
    precomputedTokenCount?: number
  ): Promise<StructuralSummaryResult> {
    const tokenCount =
      precomputedTokenCount ?? (await this.tokenCounter.countTokens(content));
    return {
      content,
      mode: 'full',
      tokenCount,
      originalTokenCount: tokenCount,
      reductionPercentage: 0,
    };
  }

  /**
   * Calculate reduction percentage.
   */
  private calcReduction(original: number, reduced: number): number {
    if (original <= 0) {
      return 0;
    }
    return Math.round(((original - reduced) / original) * 100);
  }

  /**
   * Convert an absolute file path to a workspace-relative path for display.
   */
  private toRelativePath(filePath: string): string {
    const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
    if (workspaceRoot) {
      const normalizedFile = filePath.replace(/\\/g, '/');
      const normalizedRoot = workspaceRoot.replace(/\\/g, '/');
      if (normalizedFile.startsWith(normalizedRoot)) {
        const relative = normalizedFile.slice(normalizedRoot.length);
        return relative.startsWith('/') ? relative.slice(1) : relative;
      }
    }
    // Fallback: return filename from path
    const parts = filePath.replace(/\\/g, '/').split('/');
    return parts.slice(-3).join('/');
  }
}
