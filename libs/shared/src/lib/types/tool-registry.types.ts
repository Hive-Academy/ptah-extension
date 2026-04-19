/**
 * IToolRegistry — Platform-agnostic tool registry for agent runtimes.
 *
 * Introduced to decouple agent adapters (SDK-based, LangChain-based) from
 * concrete tool implementations. A minimal registry is wired in the app
 * layer that bridges a hand-picked set of tools to the vscode-lm-tools
 * handlers or to built-in DeepAgents file tools.
 *
 * Tool executors receive typed input and return arbitrary output. Runtimes
 * adapt the registry into their native tool representation (LangChain
 * DynamicStructuredTool, SDK MCP tool, etc.).
 */

/**
 * JSON Schema describing a tool's input. Loose typing because runtimes
 * convert this to their own shape (LangChain uses Zod, SDK uses raw JSON
 * Schema). Consumers MUST NOT read arbitrary fields off this — use the
 * conversion helpers each runtime provides.
 */
export type ToolInputJsonSchema = {
  readonly type: 'object';
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly description?: string;
};

/**
 * A single tool definition.
 */
export interface ToolDef {
  /** Tool name — must be unique within a registry. */
  readonly name: string;
  /** Human-readable description. Shown to the model. */
  readonly description: string;
  /** Input schema (JSON Schema, object type). */
  readonly inputSchema: ToolInputJsonSchema;
  /**
   * Execute the tool. Input is validated to match inputSchema by the caller.
   * Output shape is runtime-specific; it is passed back to the model
   * stringified/JSON-encoded as appropriate.
   */
  execute(input: Record<string, unknown>): Promise<unknown>;
}

/**
 * Tool registry contract. Runtimes read the available tool set at session
 * start. Implementations may filter by runtime capabilities or permissions.
 */
export interface IToolRegistry {
  /** List all tools currently available. */
  listTools(): readonly ToolDef[];
  /** Look up a tool by name, or undefined if not registered. */
  getTool(name: string): ToolDef | undefined;
}
