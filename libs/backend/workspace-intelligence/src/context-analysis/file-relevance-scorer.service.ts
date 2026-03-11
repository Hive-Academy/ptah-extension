/**
 * File Relevance Scoring Service
 *
 * Ranks files by relevance to a user query using keyword matching and heuristics.
 * This service is critical for context optimization - it determines which files
 * are most likely to be relevant to answering the user's question.
 *
 * @module workspace-intelligence/context-analysis
 */

import { injectable } from 'tsyringe';
import { IndexedFile, FileType } from '../types/workspace.types';
import { SymbolIndex } from '../ast/dependency-graph.service';
import { ImportInfo } from '../ast/ast-analysis.interfaces';

/**
 * File relevance scoring result
 */
export interface FileRelevanceResult {
  /** The file being scored */
  file: IndexedFile;
  /** Relevance score (higher = more relevant) */
  score: number;
  /** Reasons for the score (for debugging/transparency) */
  reasons: string[];
}

/**
 * FileRelevanceScorerService
 *
 * Implements keyword-based relevance scoring for intelligent file selection.
 * Uses multiple heuristics to determine file relevance:
 *
 * 1. Path keyword matching (highest weight)
 * 2. File type relevance (e.g., source files over config)
 * 3. Query-specific patterns (e.g., "test" → prioritize test files)
 *
 * Design Pattern: Strategy Pattern (can be extended with different scoring algorithms)
 * SOLID: Single Responsibility (only handles relevance scoring)
 */
@injectable()
export class FileRelevanceScorerService {
  /**
   * Score a single file's relevance to a query
   *
   * @param file - The indexed file to score
   * @param query - User query string (optional)
   * @returns Relevance score (0-100, higher = more relevant)
   */
  scoreFile(
    file: IndexedFile,
    query?: string,
    symbolIndex?: SymbolIndex,
    activeFileImports?: ImportInfo[]
  ): FileRelevanceResult {
    const reasons: string[] = [];
    let score = 0;

    // No query = all files equally relevant (baseline score)
    if (!query || query.trim().length === 0) {
      return {
        file,
        score: 1.0,
        reasons: ['No query provided - baseline relevance'],
      };
    }

    const normalizedQuery = query.toLowerCase().trim();
    const keywords = this.extractKeywords(normalizedQuery);
    const filePath = file.relativePath.toLowerCase();
    const fileName = filePath.split('/').pop() || '';

    // 1. Path keyword matching (highest priority)
    keywords.forEach((keyword) => {
      // Direct filename match (very high relevance)
      if (fileName.includes(keyword)) {
        score += 10;
        reasons.push(`Filename contains "${keyword}"`);
      }
      // Path component match (high relevance)
      else if (filePath.includes(keyword)) {
        score += 5;
        reasons.push(`Path contains "${keyword}"`);
      }
    });

    // 2. File type relevance (prefer source files over configs/docs)
    switch (file.type) {
      case FileType.Source:
        score += 3;
        reasons.push('Source code file (high relevance)');
        break;
      case FileType.Test:
        // Tests are relevant if query mentions testing
        if (
          normalizedQuery.includes('test') ||
          normalizedQuery.includes('spec')
        ) {
          score += 8;
          reasons.push('Test file matches query context');
        } else {
          score += 1; // Tests less relevant for non-test queries
          reasons.push('Test file (lower relevance for non-test query)');
        }
        break;
      case FileType.Config:
        // Config files relevant if query mentions configuration
        if (
          normalizedQuery.includes('config') ||
          normalizedQuery.includes('setup')
        ) {
          score += 5;
          reasons.push('Configuration file matches query context');
        } else {
          score += 0.5;
          reasons.push('Configuration file (low relevance)');
        }
        break;
      case FileType.Documentation:
        // Docs relevant if query asks for documentation/info
        if (
          normalizedQuery.includes('how') ||
          normalizedQuery.includes('what') ||
          normalizedQuery.includes('doc')
        ) {
          score += 4;
          reasons.push('Documentation matches query type');
        } else {
          score += 0.5;
          reasons.push('Documentation file (low relevance)');
        }
        break;
      case FileType.Asset:
        score += 0.1;
        reasons.push('Asset file (minimal relevance)');
        break;
    }

    // 3. Language-specific patterns
    score += this.scoreByLanguagePattern(file, normalizedQuery, reasons);

    // 4. Framework-specific patterns (Angular, React, Vue, etc.)
    score += this.scoreByFrameworkPattern(file, normalizedQuery, reasons);

    // 5. Common coding task patterns
    score += this.scoreByTaskPattern(file, normalizedQuery, reasons);

    // 6. Symbol-aware scoring (when dependency graph data is available)
    score += this.scoreBySymbols(
      file,
      keywords,
      reasons,
      symbolIndex,
      activeFileImports
    );

    // Normalize score to 0-100 range
    const normalizedScore = Math.min(100, Math.max(0, score));

    return {
      file,
      score: normalizedScore,
      reasons: reasons.length > 0 ? reasons : ['No specific relevance matches'],
    };
  }

  /**
   * Rank multiple files by relevance to a query
   *
   * @param files - Array of indexed files to rank
   * @param query - User query string (optional)
   * @returns Map of file path to relevance score (sorted by score descending)
   */
  rankFiles(
    files: IndexedFile[],
    query?: string,
    symbolIndex?: SymbolIndex,
    activeFileImports?: ImportInfo[]
  ): Map<IndexedFile, number> {
    const scores = new Map<IndexedFile, number>();

    // Score all files
    files.forEach((file) => {
      const result = this.scoreFile(
        file,
        query,
        symbolIndex,
        activeFileImports
      );
      scores.set(file, result.score);
    });

    // Sort by score (highest first)
    const sortedEntries = Array.from(scores.entries()).sort(
      (a, b) => b[1] - a[1]
    );

    return new Map(sortedEntries);
  }

  /**
   * Get top N most relevant files
   *
   * @param files - Array of indexed files to rank
   * @param query - User query string
   * @param limit - Maximum number of files to return
   * @returns Array of top N files with their scores
   */
  getTopFiles(
    files: IndexedFile[],
    query: string,
    limit = 10,
    symbolIndex?: SymbolIndex,
    activeFileImports?: ImportInfo[]
  ): FileRelevanceResult[] {
    const results = files
      .map((file) =>
        this.scoreFile(file, query, symbolIndex, activeFileImports)
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return results;
  }

  /**
   * Extract meaningful keywords from query
   * Removes common stop words and splits on whitespace
   *
   * @private
   */
  private extractKeywords(query: string): string[] {
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'by',
      'from',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'how',
      'what',
      'where',
      'when',
      'why',
      'does',
      'do',
      'did',
    ]);

    return query
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stopWords.has(word));
  }

  /**
   * Score based on language-specific patterns
   *
   * @private
   */
  private scoreByLanguagePattern(
    file: IndexedFile,
    query: string,
    reasons: string[]
  ): number {
    let score = 0;

    // TypeScript/JavaScript patterns
    if (file.language === 'typescript' || file.language === 'javascript') {
      if (query.includes('service') && file.relativePath.includes('service')) {
        score += 5;
        reasons.push('Service file matches TypeScript pattern');
      }
      if (
        query.includes('component') &&
        file.relativePath.includes('component')
      ) {
        score += 5;
        reasons.push('Component file matches pattern');
      }
      if (query.includes('util') && file.relativePath.includes('util')) {
        score += 4;
        reasons.push('Utility file matches pattern');
      }
    }

    // Python patterns
    if (file.language === 'python') {
      if (query.includes('model') && file.relativePath.includes('model')) {
        score += 5;
        reasons.push('Python model file matches pattern');
      }
      if (query.includes('view') && file.relativePath.includes('view')) {
        score += 5;
        reasons.push('Python view file matches pattern');
      }
    }

    return score;
  }

  /**
   * Score based on framework-specific patterns
   *
   * @private
   */
  private scoreByFrameworkPattern(
    file: IndexedFile,
    query: string,
    reasons: string[]
  ): number {
    let score = 0;

    // Angular patterns
    if (file.relativePath.includes('.component.')) {
      if (query.includes('component') || query.includes('ui')) {
        score += 6;
        reasons.push('Angular component matches query');
      }
    }
    if (file.relativePath.includes('.service.')) {
      if (query.includes('service') || query.includes('logic')) {
        score += 6;
        reasons.push('Angular service matches query');
      }
    }
    if (file.relativePath.includes('.guard.')) {
      if (query.includes('auth') || query.includes('guard')) {
        score += 6;
        reasons.push('Angular guard matches query');
      }
    }

    // React patterns
    if (
      file.relativePath.includes('.tsx') ||
      file.relativePath.includes('.jsx')
    ) {
      if (query.includes('component') || query.includes('react')) {
        score += 5;
        reasons.push('React component matches query');
      }
    }

    return score;
  }

  /**
   * Score based on common coding task patterns
   *
   * @private
   */
  private scoreByTaskPattern(
    file: IndexedFile,
    query: string,
    reasons: string[]
  ): number {
    let score = 0;

    // Authentication/Authorization
    if (
      query.includes('auth') ||
      query.includes('login') ||
      query.includes('permission')
    ) {
      if (
        file.relativePath.includes('auth') ||
        file.relativePath.includes('login') ||
        file.relativePath.includes('permission')
      ) {
        score += 7;
        reasons.push('Authentication-related file matches query');
      }
    }

    // Database/Data
    if (
      query.includes('database') ||
      query.includes('data') ||
      query.includes('model')
    ) {
      if (
        file.relativePath.includes('model') ||
        file.relativePath.includes('entity') ||
        file.relativePath.includes('schema')
      ) {
        score += 6;
        reasons.push('Data layer file matches query');
      }
    }

    // API/HTTP
    if (
      query.includes('api') ||
      query.includes('http') ||
      query.includes('request')
    ) {
      if (
        file.relativePath.includes('api') ||
        file.relativePath.includes('http') ||
        file.relativePath.includes('controller')
      ) {
        score += 6;
        reasons.push('API layer file matches query');
      }
    }

    return score;
  }

  /**
   * Score based on exported symbol matches from the dependency graph.
   * Returns 0 immediately when no symbolIndex is provided (zero overhead).
   *
   * Scoring:
   * - +15 per exported symbol whose name contains a query keyword (case-insensitive)
   * - +10 bonus if the file exports a symbol that the active file imports
   *
   * @private
   */
  private scoreBySymbols(
    file: IndexedFile,
    keywords: string[],
    reasons: string[],
    symbolIndex?: SymbolIndex,
    activeFileImports?: ImportInfo[]
  ): number {
    if (!symbolIndex) {
      return 0;
    }

    // Lookup exports for this file by absolute path or relative path
    const fileExports =
      symbolIndex.get(file.path) ?? symbolIndex.get(file.relativePath);

    if (!fileExports || fileExports.length === 0) {
      return 0;
    }

    let score = 0;

    // Check each keyword against exported symbol names
    for (const keyword of keywords) {
      const keywordLower = keyword.toLowerCase();
      for (const exp of fileExports) {
        if (exp.name.toLowerCase().includes(keywordLower)) {
          score += 15;
          reasons.push(`Export symbol '${exp.name}' matches query`);
        }
      }
    }

    // Check if any exported symbol is imported by the active file
    if (activeFileImports && activeFileImports.length > 0) {
      // Build a set of all symbol names imported by the active file for O(1) lookup
      const importedSymbolNames = new Set<string>();
      for (const imp of activeFileImports) {
        if (imp.importedSymbols) {
          for (const sym of imp.importedSymbols) {
            importedSymbolNames.add(sym.toLowerCase());
          }
        }
      }

      if (importedSymbolNames.size > 0) {
        for (const exp of fileExports) {
          if (importedSymbolNames.has(exp.name.toLowerCase())) {
            score += 10;
            reasons.push(
              `Exports symbol '${exp.name}' imported by active file`
            );
          }
        }
      }
    }

    // Cap total symbol score so symbols remain one signal among many
    return Math.min(score, 30);
  }
}
