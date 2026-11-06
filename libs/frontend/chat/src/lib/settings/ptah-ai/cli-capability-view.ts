import type { CliAdapterManifest, LaneCapabilitySupport } from '@ptah-extension/shared';

export type CapabilityState = 'supported' | 'unsupported' | 'unverified';
export interface CliCapabilityLine { readonly label: string; readonly value: string; readonly state: CapabilityState; readonly reason?: string }
export interface CliCapabilityBadge { readonly label: string; readonly value: string; readonly state: CapabilityState }
export interface CliCapabilityGroup { readonly heading: string; readonly lines: readonly CliCapabilityLine[] }
export interface CliCapabilityView { readonly summary: readonly string[]; readonly badges: readonly CliCapabilityBadge[]; readonly lines: readonly CliCapabilityLine[]; readonly groups: readonly CliCapabilityGroup[] }

function support(label: string, capability: LaneCapabilitySupport): CliCapabilityLine {
  return { label, value: capability.state === 'supported' ? 'Supported' : 'Unsupported', state: capability.state,
    reason: capability.state === 'unsupported' ? capability.reason ?? 'No reason provided by the adapter.' : undefined };
}

const ROLE_LABELS: Record<CliAdapterManifest['roleChannel'], string> = {
  'system-prompt': 'System prompt', 'developer-instructions': 'Developer instructions',
  'task-prompt': 'Task prompt', 'agent-selection': 'Agent selection',
};

export function roleDeliveryLabel(channel: string): string {
  return channel === 'preamble' ? 'Preamble' : ROLE_LABELS[channel as CliAdapterManifest['roleChannel']] ?? channel;
}

export function limitSourceLabel(source: string): string {
  const names: Record<string, string> = { 'openai-codex': 'OpenAI Codex', anthropic: 'Anthropic', 'ollama-cloud': 'Ollama Cloud' };
  return names[source] ?? source;
}

/** Potential adapter support, never the effective state of a running lane. */
export function cliCapabilityView(manifest?: CliAdapterManifest): CliCapabilityView {
  if (!manifest) {
    const labels = ['Messaging', 'Permission', 'Network', 'MCP', 'Limit'] as const;
    const badges: CliCapabilityBadge[] = labels.map((label) => ({ label, value: 'Unverified', state: 'unverified' }));
    const lines: CliCapabilityLine[] = labels.map((label) => ({ label, value: 'Unverified', state: 'unverified', reason: 'The adapter did not provide a capability manifest.' }));
    return { summary: badges.map(({ label, value }) => `${label}: ${value}`), badges, lines,
      groups: [{ heading: 'Messaging', lines: lines.slice(0, 1) }, { heading: 'Permissions', lines: lines.slice(1, 2) },
        { heading: 'Network', lines: lines.slice(2, 3) }, { heading: 'Integration', lines: lines.slice(3) }] };
  }

  const messaging = [support('Steer', manifest.messaging.steer), support('Interrupt', manifest.messaging.interrupt),
    support('Continue session', manifest.messaging.continuation), support('Resume saved session', manifest.messaging.resume)];
  const permissionLabels = { plan: 'Plan', ask: 'Ask', 'auto-edit': 'Auto-edit', yolo: 'Yolo' } as const;
  const permissions: CliCapabilityLine[] = (Object.keys(permissionLabels) as (keyof typeof permissionLabels)[]).map((mode) => {
    const capability = manifest.permissionModes[mode];
    return capability
      ? { ...support(permissionLabels[mode], capability), reason: capability.state === 'supported'
          ? `Native mode: ${capability.nativeMode ?? 'adapter default'}. Network: ${capability.networkModes.join(', ') || 'none'}.`
          : capability.reason ?? 'No reason provided by the adapter.' }
      : { label: permissionLabels[mode], value: 'Unverified', state: 'unverified', reason: 'The adapter did not declare this permission mode.' };
  });
  const network = [support('Allow network', manifest.networkModes.allow), support('Deny network', manifest.networkModes.deny)];
  const limit: CliCapabilityLine = manifest.limitReader.state === 'available'
    ? { label: 'Limit reader', value: 'Tracked', state: 'supported', reason: manifest.limitReader.source ? `Source: ${limitSourceLabel(manifest.limitReader.source)}` : undefined }
    : { label: 'Limit reader', value: 'No reliable source', state: 'unsupported', reason: manifest.limitReader.reason ?? 'The adapter has no reliable limit source.' };
  const integration = [support('MCP', manifest.mcp), { label: 'Role delivery', value: roleDeliveryLabel(manifest.roleChannel), state: 'supported' as const }, limit];
  const lines = [...messaging, ...permissions, ...network, ...integration];
  const summaryValue = (items: readonly CliCapabilityLine[], label: (line: CliCapabilityLine) => string) =>
    items.filter((line) => line.state === 'supported').map(label).join(' · ') ||
    (items.some((line) => line.state === 'unverified') ? 'Unverified' : 'unsupported');
  const summaryState = (value: string): CapabilityState => value === 'Unverified' ? 'unverified' : value === 'unsupported' ? 'unsupported' : 'supported';
  const messagingValue = summaryValue(messaging, (line) => line.label.toLowerCase());
  const permissionValue = summaryValue(permissions, (line) => line.label);
  const networkValue = summaryValue(network, (line) => line.label.replace(' network', '').toLowerCase());
  const badges: CliCapabilityBadge[] = [
    { label: 'Messaging', value: messagingValue, state: summaryState(messagingValue) },
    { label: 'Permission', value: permissionValue, state: summaryState(permissionValue) },
    { label: 'Network', value: networkValue, state: summaryState(networkValue) },
    { label: 'MCP', value: manifest.mcp.state === 'supported' ? 'supported' : 'unsupported', state: manifest.mcp.state },
    { label: 'Limit', value: limit.value.toLowerCase(), state: limit.state },
  ];
  return { summary: badges.map(({ label, value }) => `${label}: ${value}`), badges, lines,
    groups: [{ heading: 'Messaging', lines: messaging }, { heading: 'Permissions', lines: permissions },
      { heading: 'Network', lines: network }, { heading: 'Integration', lines: integration }] };
}
