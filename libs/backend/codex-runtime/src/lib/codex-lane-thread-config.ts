/**
 * The 10b.0b lane transport must use this builder as the single lane MCP source
 * and must not combine it with dotted `mcp_servers.ptah` overrides from
 * `buildCodexMcpConfigOverrides`.
 */
import { z } from 'zod';
import { CODEX_PTAH_TOOL_TIMEOUT_SEC } from './codex-ptah-mcp';
import type { CodexExecutionProfile } from './codex-runtime.types';

const disabledServer = z.strictObject({ enabled: z.literal(false) });
const ptahServer = z.strictObject({
  url: z.url(),
  tool_timeout_sec: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
const serverName = z
  .string()
  .min(1)
  .refine((name) => name.trim().length > 0 && !name.includes('\0'));
const laneServers = z
  .record(serverName, z.union([disabledServer, ptahServer]))
  .refine((servers) =>
    Object.entries(servers).every(([name, server]) =>
      name === 'ptah' ? 'url' in server : 'enabled' in server,
    ),
  );

/** The only config keys a lane may send in a thread/start or thread/resume frame. */
export const codexLaneThreadConfigSchema = z.strictObject({
  agents: z.strictObject({ enabled: z.literal(false) }),
  features: z.strictObject({
    plugins: z.literal(false),
    apps: z.literal(false),
  }),
  skills: z.strictObject({ include_instructions: z.literal(false) }),
  model_auto_compact_token_limit: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
  tool_output_token_limit: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
  web_search: z.enum(['live', 'disabled']),
  approval_policy: z.literal('never'),
  mcp_servers: laneServers.optional(),
});

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export type CodexLaneThreadConfig = DeepReadonly<
  z.output<typeof codexLaneThreadConfigSchema>
>;

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** This builder is pure; only a validated lane profile may reach the runtime. */
export function buildCodexLaneThreadConfig(
  profile: CodexExecutionProfile,
): CodexLaneThreadConfig {
  if (profile.consumer !== 'lane' || profile.lane === undefined) {
    throw new Error('Codex lane thread config requires a lane profile');
  }
  const { lane } = profile;
  const ptahServers = profile.mcpServers.filter((server) => server.name === 'ptah');
  if (ptahServers.length > 1 || profile.mcpServers.length !== ptahServers.length) {
    throw new Error('Lane MCP config accepts only one Ptah server');
  }
  const ptah = ptahServers[0];
  if (ptah !== undefined && ptah.transport !== 'http') {
    throw new Error('Lane Ptah MCP server requires a plain HTTP URL');
  }
  if (
    ptah?.transport === 'http' &&
    (ptah.urlReference !== undefined ||
      ptah.authReference !== undefined ||
      Object.keys(ptah.headerReferences).length > 0)
  ) {
    throw new Error('Lane Ptah MCP server requires a plain HTTP URL');
  }
  if (ptah === undefined && lane.ptahToolTimeoutSeconds !== undefined) {
    throw new Error('Ptah tool timeout requires a Ptah MCP server');
  }
  const entries: [
    string,
    { enabled: false } | { url: string; tool_timeout_sec: number },
  ][] = [
    ...[...new Set(lane.disabledUserMcpServers ?? [])]
      .filter((name) => name !== 'ptah')
      .sort()
      .map((name): [string, { enabled: false }] => [name, { enabled: false }]),
  ];
  if (ptah?.transport === 'http') {
    entries.push([
      'ptah',
      {
        url: ptah.url,
        tool_timeout_sec:
          lane.ptahToolTimeoutSeconds ??
          ptah.toolTimeoutSec ??
          CODEX_PTAH_TOOL_TIMEOUT_SEC,
      },
    ]);
  }
  const config = {
    agents: { enabled: false },
    features: { plugins: false, apps: false },
    skills: { include_instructions: false },
    ...(lane.autoCompactTokens
      ? { model_auto_compact_token_limit: lane.autoCompactTokens }
      : {}),
    ...(lane.toolOutputTokenLimit
      ? { tool_output_token_limit: lane.toolOutputTokenLimit }
      : {}),
    web_search: lane.webSearch ?? 'disabled',
    approval_policy: 'never',
    ...(entries.length > 0 ? { mcp_servers: Object.fromEntries(entries) } : {}),
  };
  const parsed = codexLaneThreadConfigSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error('Invalid Codex lane thread config');
  }
  return freeze(parsed.data);
}
