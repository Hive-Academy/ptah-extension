// Network domain tool types and guards.
// Tools: WebFetch, WebSearch.
// Extracted from tool-input-guards.ts (TASK_2025_291 Wave C2) — zero behavior change.

// --- TOOL INPUT TYPES ---
/** WebFetch tool input — Tool: WebFetch (fetch web content). */
export interface WebFetchToolInput {
  /** The URL to fetch content from */
  url: string;
  /** The prompt to run on the fetched content */
  prompt: string;
}
/** WebSearch tool input — Tool: WebSearch (search the web). */
export interface WebSearchToolInput {
  /** The search query to use */
  query: string;
  /** Only include results from these domains */
  allowed_domains?: string[];
  /** Never include results from these domains */
  blocked_domains?: string[];
}

// --- TOOL OUTPUT TYPES ---
/** WebFetch tool output interface */
export interface WebFetchToolOutput {
  /** AI model's response to the prompt */
  response: string;
  /** URL that was fetched */
  url: string;
  /** Final URL after redirects */
  final_url?: string;
  /** HTTP status code */
  status_code?: number;
}
/** WebSearch tool output interface */
export interface WebSearchToolOutput {
  /** Search results */
  results: Array<{
    title: string;
    url: string;
    snippet: string;
    /** Additional metadata if available */
    metadata?: Record<string, unknown>;
  }>;
  /** Total number of results */
  total_results: number;
  /** The query that was searched */
  query: string;
}

// --- TOOL INPUT TYPE GUARDS ---
/** Type guard for WebFetch tool input */
export function isWebFetchToolInput(
  input: unknown,
): input is WebFetchToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'url' in input &&
    typeof (input as WebFetchToolInput).url === 'string' &&
    'prompt' in input &&
    typeof (input as WebFetchToolInput).prompt === 'string'
  );
}
/** Type guard for WebSearch tool input */
export function isWebSearchToolInput(
  input: unknown,
): input is WebSearchToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'query' in input &&
    typeof (input as WebSearchToolInput).query === 'string'
  );
}

// --- TOOL OUTPUT TYPE GUARDS ---
/** Type guard for WebFetch tool output */
export function isWebFetchToolOutput(
  output: unknown,
): output is WebFetchToolOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    'response' in output &&
    'url' in output
  );
}
/** Type guard for WebSearch tool output */
export function isWebSearchToolOutput(
  output: unknown,
): output is WebSearchToolOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    'results' in output &&
    Array.isArray((output as WebSearchToolOutput).results) &&
    'query' in output
  );
}
