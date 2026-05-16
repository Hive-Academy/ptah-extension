// Execution / agent-control domain tool types and guards.
// Tools: Bash, BashOutput, KillShell, Task, TaskOutput, TaskStop, TodoWrite,
// AskUserQuestion, ExitPlanMode, plus isAgentDispatchTool.

// --- TOOL INPUT TYPES ---
/** Bash tool input — Tool: Bash (execute bash command). */
export interface BashToolInput {
  /** The command to execute */
  command: string;
  /** Clear, concise description of what this command does in 5-10 words */
  description?: string;
  /** Optional timeout in milliseconds (max 600000) */
  timeout?: number;
  /** Set to true to dangerously disable sandbox mode */
  dangerouslyDisableSandbox?: boolean;
  /** Set to true to run this command in the background */
  run_in_background?: boolean;
}
/** BashOutput tool input — Tool: BashOutput (retrieve output from background bash shell). */
export interface BashOutputToolInput {
  /** The ID of the background shell to retrieve output from */
  bash_id: string;
  /** Optional regex to filter output lines */
  filter?: string;
}
/** Task tool input — Tool: Task (invoke subagent). */
export interface TaskToolInput {
  /** A short (3-5 word) description of the task */
  description: string;
  /** The task for the agent to perform */
  prompt: string;
  /** The type of specialized agent to use for this task */
  subagent_type: string;
  /** Optional agent ID to resume from a previous invocation */
  resume?: string;
  /** Set to true to run this agent in the background. SDK returns an immediate placeholder tool_result with output_file path. */
  run_in_background?: boolean;
  /** Optional model override for the subagent */
  model?: 'sonnet' | 'opus' | 'haiku';
  /** Maximum number of agentic turns before stopping */
  max_turns?: number;
}
/** TaskOutput tool input — Tool: TaskOutput (get output from background task). */
export interface TaskOutputToolInput {
  /** The task ID to get output from */
  task_id: string;
  /** Whether to wait for completion (default true) */
  block?: boolean;
  /** Max wait time in ms */
  timeout?: number;
}
/** TaskStop tool input — Tool: TaskStop (stop a running background task — agent or shell). */
export interface TaskStopToolInput {
  /** The ID of the background task to stop */
  task_id?: string;
  /** @deprecated Use task_id instead */
  shell_id?: string;
}
/** KillShell tool input — Tool: KillShell (kill a background bash shell). */
export interface KillShellToolInput {
  /** The ID of the background shell to kill */
  shell_id: string;
}
/** TodoWrite tool input — Tool: TodoWrite (manage task list). */
export interface TodoWriteToolInput {
  /** The updated todo list */
  todos: TodoItem[];
}
/** Individual todo item */
export interface TodoItem {
  /** The task description */
  content: string;
  /** The task status */
  status: 'pending' | 'in_progress' | 'completed';
  /** Active form of the task description */
  activeForm: string;
}
/** AskUserQuestion tool input — Tool: AskUserQuestion (ask user clarifying questions). */
export interface AskUserQuestionToolInput {
  /** Questions to ask the user (1-4 questions) */
  questions: QuestionItem[];
  /** User answers populated by the permission system */
  answers?: Record<string, string>;
}
/** Individual question item */
export interface QuestionItem {
  /** The complete question to ask the user */
  question: string;
  /** Very short label displayed as a chip/tag (max 12 chars) */
  header: string;
  /** The available choices (2-4 options) */
  options: QuestionOption[];
  /** Set to true to allow multiple selections */
  multiSelect: boolean;
}
/** Question option */
export interface QuestionOption {
  /** Display text for this option (1-5 words) */
  label: string;
  /** Explanation of what this option means */
  description: string;
}
/** ExitPlanMode tool input — Tool: ExitPlanMode (exit planning mode). */
export interface ExitPlanModeToolInput {
  /** The plan to run by the user for approval */
  plan: string;
}

// --- TOOL OUTPUT TYPES ---
/** Task tool output — Tool: Task (result from subagent). */
export interface TaskToolOutput {
  /** Final result message from the subagent */
  result: string;
  /** Token usage statistics */
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  /** Total cost in USD */
  total_cost_usd?: number;
  /** Execution duration in milliseconds */
  duration_ms?: number;
}
/** AskUserQuestion tool output interface */
export interface AskUserQuestionToolOutput {
  /** The questions that were asked */
  questions: QuestionItem[];
  /** The answers provided by the user */
  answers: Record<string, string>;
}
/** Bash tool output interface */
export interface BashToolOutput {
  /** Combined stdout and stderr output */
  output: string;
  /** Exit code of the command */
  exitCode: number;
  /** Whether the command was killed due to timeout */
  killed?: boolean;
  /** Shell ID for background processes */
  shellId?: string;
}
/** BashOutput tool output interface */
export interface BashOutputToolOutput {
  /** New output since last check */
  output: string;
  /** Current shell status */
  status: 'running' | 'completed' | 'failed';
  /** Exit code (when completed) */
  exitCode?: number;
}
/** KillBash tool output interface */
export interface KillBashToolOutput {
  /** Success message */
  message: string;
  /** ID of the killed shell */
  shell_id: string;
}
/** TodoWrite tool output interface */
export interface TodoWriteToolOutput {
  /** Success message */
  message: string;
  /** Current todo statistics */
  stats: {
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
  };
}
/** ExitPlanMode tool output interface */
export interface ExitPlanModeToolOutput {
  /** Confirmation message */
  message: string;
  /** Whether user approved the plan */
  approved?: boolean;
}

// --- TOOL INPUT TYPE GUARDS ---
/** Type guard for Bash tool input */
export function isBashToolInput(input: unknown): input is BashToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'command' in input &&
    typeof (input as BashToolInput).command === 'string'
  );
}
/** Type guard for BashOutput tool input */
export function isBashOutputToolInput(
  input: unknown,
): input is BashOutputToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'bash_id' in input &&
    typeof (input as BashOutputToolInput).bash_id === 'string'
  );
}
/** Type guard for Task tool input */
export function isTaskToolInput(input: unknown): input is TaskToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'subagent_type' in input &&
    typeof (input as TaskToolInput).subagent_type === 'string'
  );
}
/** Type guard for TaskOutput tool input */
export function isTaskOutputToolInput(
  input: unknown,
): input is TaskOutputToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'task_id' in input &&
    typeof (input as TaskOutputToolInput).task_id === 'string'
  );
}
/** Type guard for TaskStop tool input */
export function isTaskStopToolInput(
  input: unknown,
): input is TaskStopToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    ('task_id' in input || 'shell_id' in input)
  );
}
/** Type guard for KillShell tool input */
export function isKillShellToolInput(
  input: unknown,
): input is KillShellToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'shell_id' in input &&
    typeof (input as KillShellToolInput).shell_id === 'string'
  );
}
/** Type guard for TodoWrite tool input */
export function isTodoWriteToolInput(
  input: unknown,
): input is TodoWriteToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'todos' in input &&
    Array.isArray((input as TodoWriteToolInput).todos)
  );
}
/** Type guard for AskUserQuestion tool input */
export function isAskUserQuestionToolInput(
  input: unknown,
): input is AskUserQuestionToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'questions' in input &&
    Array.isArray((input as AskUserQuestionToolInput).questions)
  );
}
/** Type guard for ExitPlanMode tool input */
export function isExitPlanModeToolInput(
  input: unknown,
): input is ExitPlanModeToolInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'plan' in input &&
    typeof (input as ExitPlanModeToolInput).plan === 'string'
  );
}

// --- AGENT DISPATCH TOOL DETECTION ---
/**
 * Known tool names used by the Claude Agent SDK for subagent dispatch.
 * SDK renamed "Task" to "Agent" in v2.1.x — both must be recognized
 * for backward compatibility with existing JSONL session files.
 */
const AGENT_DISPATCH_TOOL_NAMES = new Set([
  'Task', // SDK <= v2.0.x
  'Agent', // SDK >= v2.1.x
  'dispatch_agent',
  'dispatch_subagent',
]);
/**
 * Checks if a tool name represents a subagent dispatch tool.
 * Supports both old ("Task") and new ("Agent") SDK naming conventions.
 */
export function isAgentDispatchTool(toolName: string): boolean {
  return AGENT_DISPATCH_TOOL_NAMES.has(toolName);
}

// --- TOOL OUTPUT TYPE GUARDS ---
/** Type guard for Task tool output */
export function isTaskToolOutput(output: unknown): output is TaskToolOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    'result' in output &&
    typeof (output as TaskToolOutput).result === 'string'
  );
}
/** Type guard for Bash tool output */
export function isBashToolOutput(output: unknown): output is BashToolOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    'output' in output &&
    'exitCode' in output
  );
}
/** Type guard for TodoWrite tool output */
export function isTodoWriteToolOutput(
  output: unknown,
): output is TodoWriteToolOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    'message' in output &&
    'stats' in output
  );
}
