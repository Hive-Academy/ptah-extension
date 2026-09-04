/**
 * CLI Agents Module - Barrel Exports
 *
 * library. CLI agents are external agent processes (Codex, Copilot, Cursor)
 * that Ptah spawns and coordinates via stdio — they are peers of the Agent SDK,
 * not LLM providers, hence `cli-agents/` lives as a sibling of `providers/`.
 */

export { CliDetectionService } from './cli-detection.service';
export {
  AgentProcessManager,
  AgentContinueError,
  MIN_CONCURRENT_AGENTS,
  MAX_CONCURRENT_AGENTS,
  DEFAULT_CONCURRENT_AGENTS,
} from './agent-process-manager.service';
export type {
  AgentContinueErrorCode,
  AgentReleaseReason,
} from './agent-process-manager.service';
export * from './cli-adapters';
export {
  createHarnessCliDetector,
  type HarnessCliDetectionReader,
} from './harness-cli-detector';
