/**
 * `anthropic-tool-merger` — merges caller-supplied Anthropic `tools[]` with
 * workspace MCP / plugin-skill tools collected via `WorkspaceMcpCollector`.
 *
 * TASK_2026_104 P2 (Anthropic-compatible HTTP proxy).
 *
 * Precedence rule: **caller wins on collision**. The proxy is a transparent
 * extension of the caller's Anthropic request — if the caller declares a
 * tool with the same name as a workspace tool, we keep the caller's tool
 * (its schema, description, etc.) and emit a `proxy.warning` notification
 * naming the collisions so the operator can investigate.
 *
 * The merger is a pure function — no IO, no side effects beyond the
 * collisions array it returns. The proxy service is responsible for emitting
 * the warning notification when the array is non-empty.
 */

/**
 * Anthropic tool definition (subset). The proxy preserves the full caller-
 * supplied object verbatim; only `name` is consulted for collision detection.
 */
export interface AnthropicToolDefinition {
  /** Tool identifier — unique within the request. */
  readonly name: string;
  /** Human-readable description. */
  readonly description?: string;
  /** JSON Schema for the tool input. */
  readonly input_schema?: Record<string, unknown>;
  /** Anthropic computer-use / file-system tool subtypes (passthrough). */
  readonly type?: string;
  /** Allow arbitrary additional fields — the merger never reads them. */
  readonly [extra: string]: unknown;
}

/** Outcome of `mergeAnthropicTools`. */
export interface ToolMergeResult {
  /** Final merged list, caller-first followed by workspace-only tools. */
  readonly tools: AnthropicToolDefinition[];
  /**
   * Names of workspace tools that collided with caller tools and were
   * dropped. Empty when there were no collisions.
   */
  readonly collisions: string[];
}

/**
 * Merge caller-supplied tools with workspace tools.
 *
 *   - Caller tools come first (they take precedence on name collision).
 *   - Workspace tools are appended in stable order, skipping any whose
 *     `name` already appears in the caller list.
 *   - Returned `collisions[]` lists the dropped workspace tool names so the
 *     proxy can emit a `proxy.warning` notification.
 *
 * Inputs are NOT mutated — both arrays are shallow-copied into the output.
 */
export function mergeAnthropicTools(
  callerTools: ReadonlyArray<AnthropicToolDefinition> | undefined,
  workspaceTools: ReadonlyArray<AnthropicToolDefinition>,
): ToolMergeResult {
  const caller = Array.isArray(callerTools) ? callerTools : [];
  const callerNames = new Set<string>();
  for (const tool of caller) {
    if (typeof tool?.name === 'string' && tool.name.length > 0) {
      callerNames.add(tool.name);
    }
  }

  const merged: AnthropicToolDefinition[] = [...caller];
  const collisions: string[] = [];
  for (const tool of workspaceTools) {
    if (typeof tool?.name !== 'string' || tool.name.length === 0) continue;
    if (callerNames.has(tool.name)) {
      collisions.push(tool.name);
      continue;
    }
    merged.push(tool);
    // Defend against duplicate workspace tools (shouldn't happen, but if it
    // does we'd drop them silently rather than re-flag as a caller collision).
    callerNames.add(tool.name);
  }

  return { tools: merged, collisions };
}
