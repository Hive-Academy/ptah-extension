/**
 * CLI Agents Module - Barrel Exports
 *
 * TASK_2025_291 Wave C5: Relocated from the deleted `@ptah-extension/llm-abstraction`
 * library. CLI agents are external agent processes (Gemini, Codex, Copilot, Cursor)
 * that Ptah spawns and coordinates via stdio — they are peers of the Agent SDK,
 * not LLM providers, hence `cli-agents/` lives as a sibling of `providers/`.
 */

export { CliDetectionService } from './cli-detection.service';
export { AgentProcessManager } from './agent-process-manager.service';
export * from './cli-adapters';
export { CliPluginSyncService } from './cli-skill-sync';
export type { ICliSkillInstaller } from './cli-skill-sync';
