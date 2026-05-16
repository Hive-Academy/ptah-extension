// File-system domain tool types and guards.
// Tools: Read, Write, Edit, NotebookEdit, LSP, ListMcpResources, ReadMcpResource.

// --- TOOL INPUT TYPES ---
/** Read tool input — Tool: Read (read file contents). */
export interface ReadToolInput {
  /** The absolute path to the file to read */
  file_path: string;
  /** The line number to start reading from */
  offset?: number;
  /** The number of lines to read */
  limit?: number;
}
/** Write tool input — Tool: Write (write file contents). */
export interface WriteToolInput {
  /** The absolute path to the file to write */
  file_path: string;
  /** The content to write to the file */
  content: string;
}
/** Edit tool input — Tool: Edit (edit file contents). */
export interface EditToolInput {
  /** The absolute path to the file to modify */
  file_path: string;
  /** The text to replace */
  old_string: string;
  /** The text to replace it with (must be different from old_string) */
  new_string: string;
  /** Replace all occurrences of old_string (default false) */
  replace_all?: boolean;
}
/** NotebookEdit tool input — Tool: NotebookEdit (edit Jupyter notebook cells). */
export interface NotebookEditToolInput {
  /** The absolute path to the Jupyter notebook file */
  notebook_path: string;
  /** The ID of the cell to edit */
  cell_id?: string;
  /** The new source for the cell */
  new_source: string;
  /** The type of the cell (code or markdown) */
  cell_type?: 'code' | 'markdown';
  /** The type of edit (replace, insert, delete) */
  edit_mode?: 'replace' | 'insert' | 'delete';
}
/** ListMcpResources tool input — Tool: ListMcpResources (list MCP resources). */
export interface ListMcpResourcesToolInput {
  /** Optional server name to filter resources by */
  server?: string;
}
/** ReadMcpResource tool input — Tool: ReadMcpResource (read MCP resource). */
export interface ReadMcpResourceToolInput {
  /** The MCP server name */
  server: string;
  /** The resource URI to read */
  uri: string;
}
/** LSP tool input — Tool: LSP (Language Server Protocol operations). */
export interface LSPToolInput {
  /** The LSP operation to perform */
  operation:
    | 'goToDefinition'
    | 'findReferences'
    | 'hover'
    | 'documentSymbol'
    | 'workspaceSymbol'
    | 'goToImplementation'
    | 'prepareCallHierarchy'
    | 'incomingCalls'
    | 'outgoingCalls';
  /** The absolute or relative path to the file */
  filePath: string;
  /** The line number (1-based) */
  line: number;
  /** The character offset (1-based) */
  character: number;
}

// --- TOOL OUTPUT TYPES ---
/** Edit tool output interface */
export interface EditToolOutput {
  /** Confirmation message */
  message: string;
  /** Number of replacements made */
  replacements: number;
  /** File path that was edited */
  file_path: string;
}
/** Read tool output — Text file */
export interface ReadTextFileOutput {
  /** File contents with line numbers */
  content: string;
  /** Total number of lines in file */
  total_lines: number;
  /** Lines actually returned */
  lines_returned: number;
}
/** Read tool output — Image file */
export interface ReadImageFileOutput {
  /** Base64 encoded image data */
  image: string;
  /** Image MIME type */
  mime_type: string;
  /** File size in bytes */
  file_size: number;
}
/** Read tool output — PDF file */
export interface ReadPDFFileOutput {
  /** Array of page contents */
  pages: Array<{
    page_number: number;
    text?: string;
    images?: Array<{
      image: string;
      mime_type: string;
    }>;
  }>;
  /** Total number of pages */
  total_pages: number;
}
/** Read tool output — Jupyter notebook */
export interface ReadNotebookFileOutput {
  /** Jupyter notebook cells */
  cells: Array<{
    cell_type: 'code' | 'markdown';
    source: string;
    outputs?: unknown[];
    execution_count?: number;
  }>;
  /** Notebook metadata */
  metadata?: Record<string, unknown>;
}
/** Read tool output — Union type */
export type ReadToolOutput =
  | ReadTextFileOutput
  | ReadImageFileOutput
  | ReadPDFFileOutput
  | ReadNotebookFileOutput;
/** Write tool output interface */
export interface WriteToolOutput {
  /** Success message */
  message: string;
  /** Number of bytes written */
  bytes_written: number;
  /** File path that was written */
  file_path: string;
}
/** NotebookEdit tool output interface */
export interface NotebookEditToolOutput {
  /** Success message */
  message: string;
  /** Type of edit performed */
  edit_type: 'replaced' | 'inserted' | 'deleted';
  /** Cell ID that was affected */
  cell_id?: string;
  /** Total cells in notebook after edit */
  total_cells: number;
}
/** ListMcpResources tool output interface */
export interface ListMcpResourcesToolOutput {
  /** Available resources */
  resources: Array<{
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
    server: string;
  }>;
  /** Total number of resources */
  total: number;
}
/** ReadMcpResource tool output interface */
export interface ReadMcpResourceToolOutput {
  /** Resource contents */
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  }>;
  /** Server that provided the resource */
  server: string;
}

// --- TOOL INPUT TYPE GUARDS ---
/** Type guard for Read tool input */
export function isReadToolInput(input: unknown): input is ReadToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'file_path' in input &&
    typeof (input as ReadToolInput).file_path === 'string'
  );
}
/** Type guard for Write tool input */
export function isWriteToolInput(input: unknown): input is WriteToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'file_path' in input &&
    typeof (input as WriteToolInput).file_path === 'string' &&
    'content' in input &&
    typeof (input as WriteToolInput).content === 'string'
  );
}
/** Type guard for Edit tool input */
export function isEditToolInput(input: unknown): input is EditToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'file_path' in input &&
    typeof (input as EditToolInput).file_path === 'string' &&
    'old_string' in input &&
    typeof (input as EditToolInput).old_string === 'string' &&
    'new_string' in input &&
    typeof (input as EditToolInput).new_string === 'string'
  );
}
/** Type guard for NotebookEdit tool input */
export function isNotebookEditToolInput(
  input: unknown,
): input is NotebookEditToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'notebook_path' in input &&
    typeof (input as NotebookEditToolInput).notebook_path === 'string' &&
    'new_source' in input &&
    typeof (input as NotebookEditToolInput).new_source === 'string'
  );
}
/** Type guard for ListMcpResources tool input */
export function isListMcpResourcesToolInput(
  input: unknown,
): input is ListMcpResourcesToolInput {
  return typeof input === 'object' && input !== null;
}
/** Type guard for ReadMcpResource tool input */
export function isReadMcpResourceToolInput(
  input: unknown,
): input is ReadMcpResourceToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'server' in input &&
    typeof (input as ReadMcpResourceToolInput).server === 'string' &&
    'uri' in input &&
    typeof (input as ReadMcpResourceToolInput).uri === 'string'
  );
}
/** Type guard for LSP tool input */
export function isLSPToolInput(input: unknown): input is LSPToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'operation' in input &&
    'filePath' in input &&
    'line' in input &&
    'character' in input
  );
}

// --- TOOL OUTPUT TYPE GUARDS ---
/** Type guard for Edit tool output */
export function isEditToolOutput(output: unknown): output is EditToolOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    'message' in output &&
    'replacements' in output &&
    'file_path' in output
  );
}
/** Type guard for Write tool output */
export function isWriteToolOutput(output: unknown): output is WriteToolOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    'message' in output &&
    'bytes_written' in output &&
    'file_path' in output
  );
}
