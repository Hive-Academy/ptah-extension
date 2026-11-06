import { AgentId, type AgentProcessInfo, type CliAdapterManifest } from '@ptah-extension/shared';
import type { SdkHandle } from '../cli-adapters/cli-adapter.interface';
import { resolveEffectiveLaneCapabilities } from './agent-effective-capabilities';

const supported = { state: 'supported' } as const;
const unsupported = { state: 'unsupported' } as const;
const potential: CliAdapterManifest = {
  messaging: { steer: unsupported, interrupt: supported, continuation: supported, resume: supported },
  roleChannel: 'task-prompt', permissionModes: {},
  networkModes: { allow: supported, deny: unsupported },
  limitReader: { state: 'no-reliable-source' }, mcp: supported,
};

const info: AgentProcessInfo = {
  agentId: AgentId.create(), cli: 'pi', task: 'test', workingDirectory: '.',
  status: 'running', startedAt: new Date(0).toISOString(), cliSessionId: 'session',
};

describe('resolveEffectiveLaneCapabilities', () => {
  it('uses live handle probes, including Pi steer, instead of CLI names or potential steer', () => {
    const handle: SdkHandle = {
      abort: new AbortController(), done: Promise.resolve(0), onOutput: jest.fn(),
      steer: jest.fn(), interrupt: jest.fn(), continue: jest.fn(),
      supportsInterrupt: () => true, supportsContinuation: () => true,
    };
    const effective = resolveEffectiveLaneCapabilities(info, potential, handle, false, 123);
    expect(effective).toMatchObject({ source: 'live-handle', resolvedAt: 123,
      messaging: { steer: supported, interrupt: supported, continuation: supported } });
  });

  it('disables live operations after release while retaining session resume capability', () => {
    const effective = resolveEffectiveLaneCapabilities(info, potential, undefined, true, 456);
    expect(effective).toMatchObject({ source: 'restored-record', resolvedAt: 456,
      messaging: { steer: { state: 'unsupported' }, interrupt: { state: 'unsupported' },
        continuation: { state: 'unsupported' }, resume: supported } });
    expect(resolveEffectiveLaneCapabilities({ ...info, cliSessionId: undefined }, potential)
      .messaging.resume.state).toBe('unsupported');
  });
});
