import type { CodexExecutionProfileInput } from '@ptah-extension/codex-runtime';
import type { CliCommandOptions } from '../cli-adapter.interface';
import {
  codexRejectionNamesUserServer,
  essentialCodexConfigEntries,
} from './codex-config-rejection';
import { codexModelRejectionMessage } from './codex-model-rejection';

const efforts = new Set(['low', 'medium', 'high', 'xhigh']);

export const CONFIG_REJECTED_NOTICE =
  'Codex rejected the lane config; this run drops lane budgets and optional feature overrides, so Codex defaults apply';
export const USER_SERVERS_ON_NOTICE =
  'Codex named one of your MCP servers as the cause, so your own MCP servers are enabled for this lane';

export function validatedEffort(value: string | undefined): string | undefined {
  return value !== undefined && efforts.has(value) ? value : undefined;
}

export function essentialLaneSession(
  session: CodexExecutionProfileInput['session'],
  rejectedKey: string | undefined,
): CodexExecutionProfileInput['session'] {
  const lane = session.lane;
  const rejectionText = rejectedKey ? `in \`${rejectedKey}\`` : '';
  const entries = essentialCodexConfigEntries([
    'model_auto_compact_token_limit=1',
    'tool_output_token_limit=1',
    ...(lane?.disabledUserMcpServers?.length ? ['mcp_servers={user={enabled=false}}'] : []),
  ], rejectionText);
  const keepUserServers = entries.some((entry) => entry.startsWith('mcp_servers={'));
  const reenableUserServers = Boolean(lane?.disabledUserMcpServers?.length) && !keepUserServers;
  return {
    ...session,
    ...(lane ? {
      lane: {
        ...lane,
        autoCompactTokens: undefined,
        toolOutputTokenLimit: undefined,
        agentsEnabled: undefined,
        pluginsEnabled: undefined,
        appsEnabled: undefined,
        includeSkillInstructions: undefined,
        ...(reenableUserServers ? {
          disabledUserMcpServers: [],
          suppressedTools: lane.suppressedTools.filter((tool) => !tool.startsWith('mcp:')),
        } : {}),
      },
    } : {}),
  };
}

export function configRejectedNotice(
  session: CodexExecutionProfileInput['session'],
  rejectedKey: string | undefined,
): string {
  return session.lane?.disabledUserMcpServers?.length &&
    rejectedKey && codexRejectionNamesUserServer(`in \`${rejectedKey}\``)
    ? `${CONFIG_REJECTED_NOTICE}. ${USER_SERVERS_ON_NOTICE}`
    : CONFIG_REJECTED_NOTICE;
}

export function terminalModelAdvice(
  text: string,
  options: CliCommandOptions,
): string | undefined {
  const secrets = [process.env.CODEX_API_KEY, process.env.OPENAI_API_KEY]
    .filter((value): value is string => typeof value === 'string' && value !== '');
  return codexModelRejectionMessage(text, options.model, options.modelSource, secrets);
}
