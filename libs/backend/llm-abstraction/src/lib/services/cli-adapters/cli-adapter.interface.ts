/**
 * CLI Adapter Interface
 * TASK_2025_157: Extensible adapter pattern for CLI agent integration
 *
 * Adding a new CLI agent (e.g., Claude CLI, Aider) requires only:
 * 1. Implement this interface
 * 2. Register in CliDetectionService
 */
import type {
  CliType,
  CliDetectionResult,
  CliOutputSegment,
} from '@ptah-extension/shared';

/** Model info returned by CLI adapter's listModels() */
export interface CliModelInfo {
  readonly id: string;
  readonly name: string;
}

export interface CliCommandOptions {
  readonly task: string;
  readonly workingDirectory: string;
  readonly files?: string[];
  readonly taskFolder?: string;
  /** Model identifier for SDK-based agents (e.g., 'claude-3.5-sonnet', 'gpt-4o'). Used to filter model selection. */
  readonly model?: string;
  /** Resolved absolute binary path from CLI detection. SDK adapters that spawn child processes should use this instead of bare binary names (avoids ENOENT on Windows). */
  readonly binaryPath?: string;
  /** Port of the running Ptah HTTP MCP server. When provided, adapters that support it will configure a direct MCP connection (bypassing VS Code's IDE bridge which blocks headless permissions). */
  readonly mcpPort?: number;
  /** Resume a previous CLI session by its CLI-native session ID. When set, the adapter adds appropriate resume flags (e.g., --resume for Gemini). */
  readonly resumeSessionId?: string;
  /** Project-specific guidance to provide as system context. Adapters with native system prompt support (Gemini) handle this natively; others prepend to task prompt via buildTaskPrompt(). */
  readonly projectGuidance?: string;
}

export interface CliCommand {
  readonly binary: string;
  readonly args: string[];
  readonly env?: Record<string, string>;
}

/**
 * Handle returned by SDK-based adapters.
 * AgentProcessManager uses this instead of ChildProcess when present.
 */
export interface SdkHandle {
  /** Abort controller to cancel the SDK operation */
  readonly abort: AbortController;
  /** Promise that resolves when SDK execution completes. Resolves with exit code (0=success, 1=error). */
  readonly done: Promise<number>;
  /** Register a callback to receive output data from the SDK execution. */
  readonly onOutput: (callback: (data: string) => void) => void;
  /** Register a callback to receive structured output segments. Optional — only SDK adapters with structured event data implement this. */
  readonly onSegment?: (callback: (segment: CliOutputSegment) => void) => void;
  /** Get CLI-native session ID (e.g., Gemini session UUID from init event). Returns undefined if not yet available or not supported by this adapter. */
  readonly getSessionId?: () => string | undefined;
}

export interface CliAdapter {
  /** CLI identifier */
  readonly name: CliType;
  /** Human-readable display name */
  readonly displayName: string;

  /**
   * Detect if this CLI is installed and functional
   * Runs `which`/`where` and version check
   */
  detect(): Promise<CliDetectionResult>;

  /**
   * Build the command and arguments to spawn the CLI in headless mode
   */
  buildCommand(options: CliCommandOptions): CliCommand;

  /**
   * Whether this CLI supports stdin steering (interactive input while running)
   */
  supportsSteer(): boolean;

  /**
   * Strip ANSI escape codes, progress bars, and other non-content output
   */
  parseOutput(raw: string): string;

  /**
   * Optional: Run task via SDK instead of CLI subprocess.
   * If implemented, AgentProcessManager will use this instead of buildCommand() + spawn().
   * Adapters that return a value here are "SDK-based" adapters.
   */
  runSdk?(options: CliCommandOptions): Promise<SdkHandle>;

  /**
   * Optional: List available models for this CLI.
   * Returns curated/dynamic model list, or null if not supported.
   */
  listModels?(): Promise<CliModelInfo[]>;
}
