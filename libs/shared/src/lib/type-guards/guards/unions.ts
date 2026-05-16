// Cross-domain union types and tool-name maps.

import type {
  EditToolInput,
  EditToolOutput,
  LSPToolInput,
  ListMcpResourcesToolInput,
  ListMcpResourcesToolOutput,
  NotebookEditToolInput,
  NotebookEditToolOutput,
  ReadMcpResourceToolInput,
  ReadMcpResourceToolOutput,
  ReadToolInput,
  ReadToolOutput,
  WriteToolInput,
  WriteToolOutput,
} from './fs';
import type {
  GlobToolInput,
  GlobToolOutput,
  GrepToolInput,
  GrepToolOutput,
} from './search';
import type {
  WebFetchToolInput,
  WebFetchToolOutput,
  WebSearchToolInput,
  WebSearchToolOutput,
} from './net';
import type {
  AskUserQuestionToolInput,
  AskUserQuestionToolOutput,
  BashOutputToolInput,
  BashOutputToolOutput,
  BashToolInput,
  BashToolOutput,
  ExitPlanModeToolInput,
  ExitPlanModeToolOutput,
  KillBashToolOutput,
  KillShellToolInput,
  TaskOutputToolInput,
  TaskStopToolInput,
  TaskToolInput,
  TaskToolOutput,
  TodoWriteToolInput,
  TodoWriteToolOutput,
} from './exec';

/** Union type of ALL tool input types */
export type ToolInput =
  | ReadToolInput
  | WriteToolInput
  | EditToolInput
  | BashToolInput
  | BashOutputToolInput
  | GrepToolInput
  | GlobToolInput
  | TaskToolInput
  | TaskOutputToolInput
  | TaskStopToolInput
  | KillShellToolInput
  | WebFetchToolInput
  | WebSearchToolInput
  | TodoWriteToolInput
  | AskUserQuestionToolInput
  | NotebookEditToolInput
  | ExitPlanModeToolInput
  | ListMcpResourcesToolInput
  | ReadMcpResourceToolInput
  | LSPToolInput;

/** Union type of ALL tool output types */
export type ToolOutput =
  | TaskToolOutput
  | AskUserQuestionToolOutput
  | BashToolOutput
  | BashOutputToolOutput
  | EditToolOutput
  | ReadToolOutput
  | WriteToolOutput
  | GlobToolOutput
  | GrepToolOutput
  | KillBashToolOutput
  | NotebookEditToolOutput
  | WebFetchToolOutput
  | WebSearchToolOutput
  | TodoWriteToolOutput
  | ExitPlanModeToolOutput
  | ListMcpResourcesToolOutput
  | ReadMcpResourceToolOutput;

/**
 * Map of tool names to their input types
 * Enables type-safe tool input lookup
 */
export interface ToolInputMap {
  Read: ReadToolInput;
  Write: WriteToolInput;
  Edit: EditToolInput;
  Bash: BashToolInput;
  BashOutput: BashOutputToolInput;
  Grep: GrepToolInput;
  Glob: GlobToolInput;
  Task: TaskToolInput;
  TaskOutput: TaskOutputToolInput;
  TaskStop: TaskStopToolInput;
  KillShell: KillShellToolInput;
  WebFetch: WebFetchToolInput;
  WebSearch: WebSearchToolInput;
  TodoWrite: TodoWriteToolInput;
  AskUserQuestion: AskUserQuestionToolInput;
  NotebookEdit: NotebookEditToolInput;
  ExitPlanMode: ExitPlanModeToolInput;
  ListMcpResources: ListMcpResourcesToolInput;
  ReadMcpResource: ReadMcpResourceToolInput;
  LSP: LSPToolInput;
}

/**
 * Map of tool names to their output types
 * Enables type-safe tool output lookup
 */
export interface ToolOutputMap {
  Task: TaskToolOutput;
  AskUserQuestion: AskUserQuestionToolOutput;
  Bash: BashToolOutput;
  BashOutput: BashOutputToolOutput;
  Edit: EditToolOutput;
  Read: ReadToolOutput;
  Write: WriteToolOutput;
  Glob: GlobToolOutput;
  Grep: GrepToolOutput;
  KillShell: KillBashToolOutput;
  NotebookEdit: NotebookEditToolOutput;
  WebFetch: WebFetchToolOutput;
  WebSearch: WebSearchToolOutput;
  TodoWrite: TodoWriteToolOutput;
  ExitPlanMode: ExitPlanModeToolOutput;
  ListMcpResources: ListMcpResourcesToolOutput;
  ReadMcpResource: ReadMcpResourceToolOutput;
}

/** Known tool names */
export type ToolName = keyof ToolInputMap;

/** Get typed tool input for a specific tool */
export type GetToolInput<T extends ToolName> = ToolInputMap[T];

/** Get typed tool output for a specific tool */
export type GetToolOutput<T extends keyof ToolOutputMap> = ToolOutputMap[T];
