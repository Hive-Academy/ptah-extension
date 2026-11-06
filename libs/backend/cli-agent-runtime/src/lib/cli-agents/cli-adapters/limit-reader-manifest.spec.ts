import { AntigravityCliAdapter } from './antigravity-cli.adapter';
import { CopilotSdkAdapter } from './copilot-sdk.adapter';
import { CopilotPermissionBridge } from './copilot-permission-bridge';
import { CursorCliAdapter } from './cursor-cli.adapter';
import { GrokCliAdapter } from './grok-cli.adapter';
import { OpencodeCliAdapter } from './opencode-cli.adapter';
import { PiCliAdapter } from './pi-cli.adapter';

describe('CLI limit reader manifests', () => {
  it.each([
    ['grok', new GrokCliAdapter(), 'grok'],
    ['antigravity', new AntigravityCliAdapter(), 'antigravity'],
    ['opencode', new OpencodeCliAdapter(), 'opencode-go'],
  ] as const)('%s names its registered plan usage reader', (_cli, adapter, source) => {
    expect(adapter.capabilities().limitReader).toEqual({ state: 'available', source });
  });

  it.each([
    ['copilot', new CopilotSdkAdapter(new CopilotPermissionBridge())],
    ['cursor', new CursorCliAdapter()],
    ['pi', new PiCliAdapter()],
  ] as const)('%s has no reliable reader', (_cli, adapter) => {
    expect(adapter.capabilities().limitReader.state).toBe('no-reliable-source');
  });
});
