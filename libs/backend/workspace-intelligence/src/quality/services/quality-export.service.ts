/**
 * Quality Export Service
 *
 * Generates quality reports in Markdown, JSON, and CSV formats
 * from ProjectIntelligence data. Handles proper formatting,
 * table generation, and CSV field escaping.
 *
 * TASK_2025_144: Phase G - Reporting and Visualization
 *
 * @packageDocumentation
 */

import { injectable, inject } from 'tsyringe';
import type {
  ProjectIntelligence,
  AntiPattern,
  QualityGap,
  Recommendation,
} from '@ptah-extension/shared';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import type { IQualityExportService } from '../interfaces';

// ============================================
// Service Implementation
// ============================================

/**
 * QualityExportService
 *
 * Transforms ProjectIntelligence data into exportable report formats.
 * Supports Markdown (human-readable), JSON (machine-readable), and
 * CSV (spreadsheet-compatible) formats.
 *
 * Design Pattern: Strategy Pattern (format selection)
 * SOLID: Single Responsibility (report generation only)
 *
 * @example
 * ```typescript
 * const service = container.resolve<QualityExportService>(
 *   TOKENS.QUALITY_EXPORT_SERVICE
 * );
 *
 * const markdown = service.exportMarkdown(intelligence);
 * const json = service.exportJson(intelligence);
 * const csv = service.exportCsv(intelligence);
 * ```
 */
@injectable()
export class QualityExportService implements IQualityExportService {
  /**
   * Creates a new QualityExportService.
   *
   * @param logger - Logger for diagnostic output
   */
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    this.logger.debug('QualityExportService initialized');
  }

  /**
   * Export assessment as a formatted Markdown report.
   *
   * Generates a comprehensive report including:
   * - Header with project metadata and score
   * - Summary text
   * - Anti-patterns table
   * - Quality gaps table
   * - Strengths list
   * - Prioritized recommendations
   *
   * @param intelligence - Full project intelligence data
   * @returns Markdown-formatted report string
   */
  exportMarkdown(intelligence: ProjectIntelligence): string {
    this.logger.debug('Generating Markdown export');

    const { workspaceContext, qualityAssessment, prescriptiveGuidance } =
      intelligence;

    const lines: string[] = [];

    // Header
    lines.push('# Code Quality Report');
    lines.push('');
    lines.push(
      `**Generated**: ${new Date(intelligence.timestamp).toISOString()}`
    );
    lines.push(
      `**Project**: ${workspaceContext.projectType}${
        workspaceContext.framework ? ` (${workspaceContext.framework})` : ''
      }`
    );
    lines.push(`**Score**: ${qualityAssessment.score}/100`);
    lines.push(`**Files Analyzed**: ${qualityAssessment.sampledFiles.length}`);
    lines.push(
      `**Analysis Duration**: ${qualityAssessment.analysisDurationMs}ms`
    );
    lines.push('');

    // Summary
    lines.push('## Summary');
    lines.push('');
    lines.push(prescriptiveGuidance.summary);
    lines.push('');

    // Anti-Patterns table
    lines.push('## Anti-Patterns Detected');
    lines.push('');
    if (qualityAssessment.antiPatterns.length === 0) {
      lines.push('No anti-patterns detected. Excellent!');
    } else {
      lines.push('| Type | Severity | File | Line | Frequency | Message |');
      lines.push('| ---- | -------- | ---- | ---- | --------- | ------- |');
      for (const pattern of qualityAssessment.antiPatterns) {
        lines.push(this.formatAntiPatternRow(pattern));
      }
    }
    lines.push('');

    // Quality Gaps table
    lines.push('## Quality Gaps');
    lines.push('');
    if (qualityAssessment.gaps.length === 0) {
      lines.push('No quality gaps identified.');
    } else {
      lines.push('| Area | Priority | Description | Recommendation |');
      lines.push('| ---- | -------- | ----------- | -------------- |');
      for (const gap of qualityAssessment.gaps) {
        lines.push(this.formatGapRow(gap));
      }
    }
    lines.push('');

    // Strengths
    lines.push('## Strengths');
    lines.push('');
    if (qualityAssessment.strengths.length === 0) {
      lines.push('No specific strengths identified.');
    } else {
      for (const strength of qualityAssessment.strengths) {
        lines.push(`- ${strength}`);
      }
    }
    lines.push('');

    // Recommendations
    lines.push('## Recommendations');
    lines.push('');
    if (prescriptiveGuidance.recommendations.length === 0) {
      lines.push('No recommendations at this time.');
    } else {
      for (const rec of prescriptiveGuidance.recommendations) {
        lines.push(this.formatRecommendation(rec));
      }
    }
    lines.push('');

    // Incremental stats (if available)
    if (qualityAssessment.incrementalStats) {
      const stats = qualityAssessment.incrementalStats;
      lines.push('## Analysis Statistics');
      lines.push('');
      lines.push(`- **Cached Files**: ${stats.cachedFiles}`);
      lines.push(`- **Fresh Files**: ${stats.freshFiles}`);
      lines.push(
        `- **Cache Hit Rate**: ${(stats.cacheHitRate * 100).toFixed(1)}%`
      );
      lines.push('');
    }

    // Footer
    lines.push('---');
    lines.push('*Generated by Ptah Extension - Code Quality Assessment*');
    lines.push('');

    const result = lines.join('\n');
    this.logger.debug('Markdown export generated', {
      lineCount: lines.length,
      byteLength: result.length,
    });

    return result;
  }

  /**
   * Export assessment as formatted JSON.
   *
   * Serializes the full ProjectIntelligence object with
   * 2-space indentation for readability.
   *
   * @param intelligence - Full project intelligence data
   * @returns JSON-formatted string
   */
  exportJson(intelligence: ProjectIntelligence): string {
    this.logger.debug('Generating JSON export');

    const result = JSON.stringify(intelligence, null, 2);

    this.logger.debug('JSON export generated', {
      byteLength: result.length,
    });

    return result;
  }

  /**
   * Export anti-patterns as CSV rows.
   *
   * Generates a CSV file with one row per anti-pattern.
   * Header: type,severity,file,line,column,frequency,message,suggestion
   *
   * Handles proper CSV escaping for fields containing:
   * - Commas
   * - Double quotes (escaped as "")
   * - Newlines
   *
   * @param intelligence - Full project intelligence data
   * @returns CSV-formatted string with header row
   */
  exportCsv(intelligence: ProjectIntelligence): string {
    this.logger.debug('Generating CSV export');

    const rows: string[] = [];

    // Header row
    rows.push('type,severity,file,line,column,frequency,message,suggestion');

    // Data rows
    for (const pattern of intelligence.qualityAssessment.antiPatterns) {
      const fields = [
        pattern.type,
        pattern.severity,
        pattern.location.file,
        String(pattern.location.line ?? ''),
        String(pattern.location.column ?? ''),
        String(pattern.frequency),
        pattern.message,
        pattern.suggestion,
      ];

      rows.push(fields.map((field) => this.escapeCsvField(field)).join(','));
    }

    const result = rows.join('\n');

    this.logger.debug('CSV export generated', {
      rowCount: rows.length - 1, // Exclude header
      byteLength: result.length,
    });

    return result;
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  /**
   * Formats a single anti-pattern as a Markdown table row.
   *
   * @param pattern - Anti-pattern to format
   * @returns Markdown table row string
   */
  private formatAntiPatternRow(pattern: AntiPattern): string {
    const file = this.escapeMarkdownTableCell(pattern.location.file);
    const line = pattern.location.line ?? '-';
    const message = this.escapeMarkdownTableCell(pattern.message);

    return `| ${pattern.type} | ${pattern.severity} | ${file} | ${line} | ${pattern.frequency} | ${message} |`;
  }

  /**
   * Formats a single quality gap as a Markdown table row.
   *
   * @param gap - Quality gap to format
   * @returns Markdown table row string
   */
  private formatGapRow(gap: QualityGap): string {
    const description = this.escapeMarkdownTableCell(gap.description);
    const recommendation = this.escapeMarkdownTableCell(gap.recommendation);

    return `| ${gap.area} | ${gap.priority} | ${description} | ${recommendation} |`;
  }

  /**
   * Formats a single recommendation as a Markdown list item.
   *
   * @param rec - Recommendation to format
   * @returns Markdown-formatted recommendation string
   */
  private formatRecommendation(rec: Recommendation): string {
    const lines: string[] = [];
    lines.push(`${rec.priority}. **[${rec.category}]** ${rec.issue}`);
    lines.push(`   - ${rec.solution}`);

    if (rec.exampleFiles && rec.exampleFiles.length > 0) {
      lines.push(
        `   - Example files: ${rec.exampleFiles
          .map((f) => `\`${f}\``)
          .join(', ')}`
      );
    }

    return lines.join('\n');
  }

  /**
   * Escapes a string for use in a Markdown table cell.
   *
   * Replaces pipe characters and newlines that would break
   * table formatting.
   *
   * @param value - String to escape
   * @returns Escaped string safe for Markdown table cells
   */
  private escapeMarkdownTableCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\n/g, ' ').replace(/\r/g, '');
  }

  /**
   * Escapes a string for use as a CSV field.
   *
   * RFC 4180 compliant escaping:
   * - Fields containing commas, quotes, or newlines are enclosed in double quotes
   * - Double quotes within the field are escaped by doubling them ("")
   *
   * @param value - String to escape
   * @returns Properly escaped CSV field
   */
  private escapeCsvField(value: string): string {
    // If field contains comma, double quote, or newline, wrap in quotes
    if (
      value.includes(',') ||
      value.includes('"') ||
      value.includes('\n') ||
      value.includes('\r')
    ) {
      // Escape double quotes by doubling them
      const escaped = value.replace(/"/g, '""');
      return `"${escaped}"`;
    }

    return value;
  }
}
