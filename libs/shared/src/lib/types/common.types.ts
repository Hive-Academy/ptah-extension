export interface ContextInfo {
  includedFiles: string[];
  excludedFiles: string[];
  tokenEstimate: number;
  optimizations: OptimizationSuggestion[];
}

export interface OptimizationSuggestion {
  type: 'exclude_pattern' | 'include_only' | 'summarize';
  description: string;
  estimatedSavings: number;
  autoApplicable: boolean;
  files?: string[];
}

export interface WorkspaceInfo {
  name: string;
  path: string;
  type: string;
}

export interface TokenUsage {
  used: number;
  max: number;
  cost?: number;
}
