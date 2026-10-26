// Future options stay rejected until their native semantics have been reviewed.
const supportedKeys = [
  'projectPath',
  'workspaceId',
  'model',
  'tabId',
  'prompt',
  'name',
  'sessionName',
  'sessionTitle',
  'runtime',
  'permissionLevel',
  'effort',
  'systemPrompt',
  'enhancedPromptsContent',
  'outputStyleBody',
  'files',
  'images',
] as const;

const supported = new Set<string>(supportedKeys);
const stripped = new Set([
  'mcpServerRunning',
  'workflowsDisabled',
  'includePartialMessages',
]);

type SupportedOptions<T> = T extends object
  ? Pick<T, Extract<keyof T, (typeof supportedKeys)[number]>>
  : never;

export class CodexChatOptionError extends Error {
  readonly code = 'unsupported-option';

  constructor(readonly key: string) {
    super(`Codex chat does not support the "${key}" option.`);
    this.name = 'CodexChatOptionError';
  }
}

/** Return only reviewed inputs; diagnostics carry key names, never values. */
export function classifyCodexChatOptions<T extends object>(config: T) {
  const entries: [string, unknown][] = [];
  const strippedKeys: string[] = [];
  const rejected: string[] = [];
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) continue;
    if (supported.has(key)) {
      entries.push([key, value]);
    } else if (
      stripped.has(key) ||
      (key === 'mcpServersOverride' &&
        value !== null &&
        typeof value === 'object' &&
        Object.keys(value).length === 0)
    ) {
      strippedKeys.push(key);
    } else {
      rejected.push(key);
    }
  }
  return {
    supported: Object.fromEntries(entries) as SupportedOptions<T>,
    stripped: strippedKeys,
    rejected,
  };
}
