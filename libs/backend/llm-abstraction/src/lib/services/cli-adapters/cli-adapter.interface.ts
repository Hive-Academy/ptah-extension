/**
 * CLI Adapter Interface
 * TASK_2025_157: Extensible adapter pattern for CLI agent integration
 *
 * Adding a new CLI agent (e.g., Claude CLI, Aider) requires only:
 * 1. Implement this interface
 * 2. Register in CliDetectionService
 */
import type { CliType, CliDetectionResult } from '@ptah-extension/shared';

export interface CliCommandOptions {
  readonly task: string;
  readonly workingDirectory: string;
  readonly files?: string[];
  readonly taskFolder?: string;
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
}
