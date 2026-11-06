import type { CliAdapterManifest } from '@ptah-extension/shared';
import { cliCapabilityView } from './cli-capability-view';
import { limitSourceLabel, roleDeliveryLabel } from './cli-capability-view';

const unsupported = { state: 'unsupported' as const, reason: 'Adapter cannot use this mode.' };
const supported = { state: 'supported' as const };

const manifest: CliAdapterManifest = {
  messaging: { steer: supported, interrupt: unsupported, continuation: supported, resume: supported },
  roleChannel: 'task-prompt',
  permissionModes: {
    plan: { ...supported, networkModes: ['deny'], nativeMode: 'read-only' },
    ask: { ...unsupported, networkModes: [] },
  },
  networkModes: { allow: supported, deny: unsupported },
  mcp: supported,
  limitReader: { state: 'no-reliable-source', reason: 'No usage endpoint.' },
};

describe('cliCapabilityView', () => {
  it('keeps an absent manifest explicitly unverified', () => {
    expect(cliCapabilityView().summary).toEqual([
      'Messaging: Unverified', 'Permission: Unverified', 'Network: Unverified', 'MCP: Unverified', 'Limit: Unverified',
    ]);
  });

  it('uses an unverified warning badge when no permission mode is supported', () => {
    const view = cliCapabilityView({ ...manifest, permissionModes: {} });
    expect(view.badges.find((badge) => badge.label === 'Permission')).toEqual({
      label: 'Permission', value: 'Unverified', state: 'unverified',
    });
  });

  it('projects live support and unsupported reasons', () => {
    const view = cliCapabilityView(manifest);
    expect(view.summary).toContain('Messaging: steer · continue session · resume saved session');
    expect(view.lines.find((line) => line.label === 'Interrupt')).toEqual({
      label: 'Interrupt', value: 'Unsupported', state: 'unsupported', reason: 'Adapter cannot use this mode.',
    });
    expect(view.lines.find((line) => line.label === 'Limit reader')?.reason).toBe('No usage endpoint.');
    expect(view.lines.find((line) => line.label === 'Yolo')?.value).toBe('Unverified');
    expect(view.lines.find((line) => line.label === 'Role delivery')?.value).toBe('Task prompt');
    expect(view.groups.map((group) => group.heading)).toEqual(['Messaging', 'Permissions', 'Network', 'Integration']);
  });

  it.each([
    ['system-prompt', 'System prompt'],
    ['developer-instructions', 'Developer instructions'],
    ['task-prompt', 'Task prompt'],
  ] as const)('labels role channel %s as %s', (roleChannel, label) => {
    expect(cliCapabilityView({ ...manifest, roleChannel }).lines.find((line) => line.label === 'Role delivery')?.value).toBe(label);
  });

  it('labels known limit sources and preserves unknown ids', () => {
    expect(limitSourceLabel('openai-codex')).toBe('OpenAI Codex');
    expect(limitSourceLabel('anthropic')).toBe('Anthropic');
    expect(limitSourceLabel('custom-reader')).toBe('custom-reader');
    const view = cliCapabilityView({ ...manifest, limitReader: { state: 'available', source: 'openai-codex' } });
    expect(view.lines.find((line) => line.label === 'Limit reader')?.reason).toBe('Source: OpenAI Codex');
  });

  it('labels preamble role delivery', () => {
    expect(roleDeliveryLabel('preamble')).toBe('Preamble');
  });
});
