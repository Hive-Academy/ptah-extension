/**
 * Type definitions for Language Model Tool parameters
 */

export interface IAnalyzeWorkspaceParameters {
  includeHidden?: boolean;
}

export interface ISearchFilesParameters {
  query: string;
  includeImages?: boolean;
  maxResults?: number;
}

export interface IOptimizeContextParameters {
  currentTokens: number;
  targetTokens: number;
}

export interface IGetRelevantFilesParameters {
  taskDescription: string;
  conversationContext?: string;
}

export interface IGetProjectStructureParameters {
  maxDepth?: number;
  includeHidden?: boolean;
}

export interface IGetDiagnosticsParameters {
  filePath?: string;
  severity?: 'error' | 'warning' | 'info' | 'hint';
}
