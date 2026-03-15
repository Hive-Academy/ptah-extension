/**
 * Quality RPC Handlers
 *
 * Handles quality dashboard RPC methods:
 * - quality:getAssessment - Get quality assessment (with optional cache bypass)
 * - quality:getHistory - Get historical assessment entries
 * - quality:export - Export quality report in Markdown/JSON/CSV
 *
 * TASK_2025_144: Phase G - Reporting and Visualization
 */

import { injectable, inject } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import * as vscode from 'vscode';
import type {
  QualityGetAssessmentParams,
  QualityGetAssessmentResult,
  QualityGetHistoryParams,
  QualityGetHistoryResult,
  QualityExportParams,
  QualityExportResult,
} from '@ptah-extension/shared';
import type {
  IProjectIntelligenceService,
  IQualityHistoryService,
  IQualityExportService,
} from '@ptah-extension/workspace-intelligence';

/**
 * RPC handlers for quality dashboard operations
 *
 * Bridges frontend RPC calls to backend quality assessment services.
 * Handles error recovery, workspace validation, and cache management.
 *
 * Injection pattern:
 * - Logger and RpcHandler from vscode-core
 * - Quality services from workspace-intelligence (registered in quality/di.ts)
 */
@injectable()
export class QualityRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.PROJECT_INTELLIGENCE_SERVICE)
    private readonly intelligenceService: IProjectIntelligenceService,
    @inject(TOKENS.QUALITY_HISTORY_SERVICE)
    private readonly historyService: IQualityHistoryService,
    @inject(TOKENS.QUALITY_EXPORT_SERVICE)
    private readonly exportService: IQualityExportService
  ) {}

  /**
   * Register all quality RPC methods
   */
  register(): void {
    this.registerGetAssessment();
    this.registerGetHistory();
    this.registerExport();

    this.logger.debug('Quality RPC handlers registered', {
      methods: [
        'quality:getAssessment',
        'quality:getHistory',
        'quality:export',
      ],
    });
  }

  /**
   * quality:getAssessment - Get quality assessment with optional cache bypass
   *
   * Flow:
   * 1. Get workspace folder
   * 2. Optionally invalidate cache (forceRefresh)
   * 3. Call ProjectIntelligenceService.getIntelligence()
   * 4. Record assessment in history
   * 5. Return intelligence + cache status
   */
  private registerGetAssessment(): void {
    this.rpcHandler.registerMethod<
      QualityGetAssessmentParams,
      QualityGetAssessmentResult
    >('quality:getAssessment', async (params) => {
      try {
        this.logger.debug('RPC: quality:getAssessment called', {
          forceRefresh: params?.forceRefresh,
        });

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          throw new Error(
            'No workspace folder open. Please open a folder to analyze.'
          );
        }

        // Optionally invalidate cache for fresh analysis
        if (params?.forceRefresh) {
          this.intelligenceService.invalidateCache(workspaceFolder.uri.fsPath);
        }

        // Track timing to detect if result came from cache
        const preCallMs = Date.now();

        const intelligence = await this.intelligenceService.getIntelligence(
          workspaceFolder.uri.fsPath
        );

        // Determine cache status: fresh analysis takes measurable time,
        // cached results return nearly instantly
        const callDurationMs = Date.now() - preCallMs;
        const fromCache = !params?.forceRefresh && callDurationMs < 50;

        // Only record in history when result is fresh (avoid duplicate entries)
        if (!fromCache) {
          try {
            await this.historyService.recordAssessment(
              intelligence.qualityAssessment
            );
          } catch (historyError) {
            // History recording failure should not block the response
            this.logger.warn('Failed to record assessment in history', {
              error:
                historyError instanceof Error
                  ? historyError.message
                  : String(historyError),
            });
          }
        }

        this.logger.debug('RPC: quality:getAssessment success', {
          score: intelligence.qualityAssessment.score,
          patternCount: intelligence.qualityAssessment.antiPatterns.length,
          fromCache,
        });

        return {
          intelligence,
          fromCache,
        };
      } catch (error) {
        this.logger.error(
          'RPC: quality:getAssessment failed',
          error instanceof Error ? error : new Error(String(error))
        );
        throw error;
      }
    });
  }

  /**
   * quality:getHistory - Get historical assessment entries
   *
   * Returns stored history entries (newest first) with optional limit.
   */
  private registerGetHistory(): void {
    this.rpcHandler.registerMethod<
      QualityGetHistoryParams,
      QualityGetHistoryResult
    >('quality:getHistory', async (params) => {
      try {
        this.logger.debug('RPC: quality:getHistory called', {
          limit: params?.limit,
        });

        const entries = this.historyService.getHistory(params?.limit);

        this.logger.debug('RPC: quality:getHistory success', {
          entryCount: entries.length,
        });

        return { entries };
      } catch (error) {
        this.logger.error(
          'RPC: quality:getHistory failed',
          error instanceof Error ? error : new Error(String(error))
        );
        throw error;
      }
    });
  }

  /**
   * quality:export - Export quality report in specified format
   *
   * Generates a report from the latest assessment data. Requires
   * a prior quality:getAssessment call to populate intelligence data.
   *
   * Supported formats: markdown, json, csv
   */
  private registerExport(): void {
    this.rpcHandler.registerMethod<QualityExportParams, QualityExportResult>(
      'quality:export',
      async (params) => {
        try {
          const format = params?.format;
          if (!format || !['markdown', 'json', 'csv'].includes(format)) {
            throw new Error(
              `Invalid export format: ${format}. Supported formats: markdown, json, csv`
            );
          }

          this.logger.debug('RPC: quality:export called', { format });

          // Get latest intelligence (may use cache)
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
          if (!workspaceFolder) {
            throw new Error(
              'No workspace folder open. Please open a folder to export.'
            );
          }

          const intelligence = await this.intelligenceService.getIntelligence(
            workspaceFolder.uri.fsPath
          );

          // Generate export content based on format
          let content: string;
          let filename: string;
          let mimeType: string;

          switch (format) {
            case 'markdown':
              content = this.exportService.exportMarkdown(intelligence);
              filename = `quality-report-${this.getDateStamp()}.md`;
              mimeType = 'text/markdown';
              break;

            case 'json':
              content = this.exportService.exportJson(intelligence);
              filename = `quality-report-${this.getDateStamp()}.json`;
              mimeType = 'application/json';
              break;

            case 'csv':
              content = this.exportService.exportCsv(intelligence);
              filename = `quality-report-${this.getDateStamp()}.csv`;
              mimeType = 'text/csv';
              break;

            default:
              throw new Error(`Unsupported export format: ${format}`);
          }

          // Save file via VS Code save dialog (webview can't use blob download)
          let saved = false;
          let filePath: string | undefined;

          const defaultUri = vscode.Uri.joinPath(workspaceFolder.uri, filename);

          const saveUri = await vscode.window.showSaveDialog({
            defaultUri,
            filters: this.getFileFilters(format),
            title: 'Save Quality Report',
          });

          if (saveUri) {
            await vscode.workspace.fs.writeFile(
              saveUri,
              Buffer.from(content, 'utf-8')
            );
            saved = true;
            filePath = saveUri.fsPath;
          }

          this.logger.debug('RPC: quality:export success', {
            format,
            filename,
            contentLength: content.length,
            saved,
            filePath,
          });

          return {
            content,
            filename,
            mimeType,
            saved,
            filePath,
          };
        } catch (error) {
          this.logger.error(
            'RPC: quality:export failed',
            error instanceof Error ? error : new Error(String(error))
          );
          throw error;
        }
      }
    );
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  /**
   * Returns VS Code save dialog file filters for a given export format.
   */
  private getFileFilters(format: string): Record<string, string[]> {
    switch (format) {
      case 'markdown':
        return { 'Markdown Files': ['md'] };
      case 'json':
        return { 'JSON Files': ['json'] };
      case 'csv':
        return { 'CSV Files': ['csv'] };
      default:
        return { 'All Files': ['*'] };
    }
  }

  /**
   * Generates a date stamp for export filenames.
   *
   * Format: YYYY-MM-DD
   *
   * @returns Date stamp string
   */
  private getDateStamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
