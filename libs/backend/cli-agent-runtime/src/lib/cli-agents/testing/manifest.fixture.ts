import type { AgentRoleChannel, CliAdapterManifest } from '@ptah-extension/shared';

interface ManifestFixtureOptions {
  readonly steer?: boolean;
  readonly interrupt?: boolean;
  readonly continuation?: boolean;
  readonly resume?: boolean;
  readonly roleChannel?: AgentRoleChannel;
}

/** Complete adapter manifest for tests that exercise a specific messaging capability. */
export function manifestFixture(options: ManifestFixtureOptions = {}): CliAdapterManifest {
  const support = (enabled: boolean) => enabled
    ? { state: 'supported' as const }
    : { state: 'unsupported' as const, reason: 'Unavailable in this fixture.' };
  return {
    messaging: {
      steer: support(options.steer ?? false),
      interrupt: support(options.interrupt ?? false),
      continuation: support(options.continuation ?? true),
      resume: support(options.resume ?? true),
    },
    roleChannel: options.roleChannel ?? 'task-prompt',
    permissionModes: {},
    networkModes: {
      allow: { state: 'supported' },
      deny: { state: 'unsupported', reason: 'Unavailable in this fixture.' },
    },
    limitReader: { state: 'no-reliable-source', reason: 'No fixture reader.' },
    mcp: { state: 'unsupported', reason: 'No fixture transport.' },
  };
}
