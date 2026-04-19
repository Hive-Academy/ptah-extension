/**
 * ToolBridgeService — Converts Ptah's IToolRegistry into LangChain tools
 * that deepagents can consume.
 *
 * PHASE 1 SCOPE
 * -------------
 * Returns an empty array. deepagents ships with a rich built-in toolbelt:
 *   write_todos, read_file, write_file, edit_file, ls, glob, grep, task
 *
 * Those cover the common workflow without bridging vscode-lm-tools.
 * Bridging the LM tools would be scope creep — the user only needs the
 * end-to-end "Ollama streams a reply" path in Phase 1.
 *
 * Phase 2 will:
 *   - Accept an IToolRegistry (injected at the app layer)
 *   - Wrap each tool in LangChain's DynamicStructuredTool
 *   - Translate MCP tool schemas → Zod schemas
 */

import { injectable } from 'tsyringe';

/**
 * Opaque type to represent a LangChain StructuredTool without importing
 * the full type. deepagents accepts `StructuredTool$1[]` which is
 * structurally compatible with any object exposing `name`, `schema`,
 * and `invoke`. In Phase 1 we return an empty array so the type here
 * doesn't matter.
 */
export type BridgedTool = unknown;

@injectable()
export class ToolBridgeService {
  /**
   * Return the set of bridged tools to hand to `createDeepAgent`.
   *
   * Phase 1: empty array — deepagents' built-in tools are sufficient
   * for the first working path.
   */
  async getTools(): Promise<BridgedTool[]> {
    return [];
  }
}
