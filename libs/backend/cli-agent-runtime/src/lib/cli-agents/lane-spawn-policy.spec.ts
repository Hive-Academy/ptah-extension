import type { CliAdapterManifest } from '@ptah-extension/shared';
import {
  applyLaneArgvPolicy,
  LaneSpawnPolicyError,
  translateLaneSpawnPolicy,
} from './lane-spawn-policy';

const codex: CliAdapterManifest = {
  messaging: {
    steer: { state: 'supported' },
    interrupt: { state: 'unsupported', reason: 'No interrupt.' },
    continuation: { state: 'supported' },
    resume: { state: 'supported' },
  },
  roleChannel: 'developer-instructions',
  permissionModes: {
    plan: { state: 'supported', nativeMode: 'read-only', networkModes: ['allow', 'deny'] },
    ask: { state: 'unsupported', reason: 'No approval route.', networkModes: [] },
    'auto-edit': { state: 'supported', nativeMode: 'workspace-write', networkModes: ['allow', 'deny'] },
    yolo: { state: 'supported', nativeMode: 'danger-full-access', networkModes: ['allow'] },
  },
  networkModes: {
    allow: { state: 'supported' },
    deny: { state: 'supported' },
  },
  limitReader: { state: 'available', source: 'openai-codex' },
  mcp: { state: 'supported' },
};

describe('lane spawn policy', () => {
  it('maps Codex workspace writes with native network denial', () => {
    expect(translateLaneSpawnPolicy('codex', codex, {
      permission: 'auto-edit', network: 'deny',
    })).toMatchObject({
      cli: 'codex', sandboxMode: 'workspace-write', networkAccess: false,
    });
  });

  it('refuses Codex yolo with network denial before launch', () => {
    expect(() => translateLaneSpawnPolicy('codex', codex, {
      permission: 'yolo', network: 'deny',
    })).toThrow(LaneSpawnPolicyError);
    try {
      translateLaneSpawnPolicy('codex', codex, { permission: 'yolo', network: 'deny' });
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(LaneSpawnPolicyError);
      if (error instanceof LaneSpawnPolicyError) {
        expect(error.refusal).toMatchObject({
          code: 'UNSUPPORTED_LANE_POLICY', field: 'combination',
        });
      }
    }
  });

  it('refuses unsupported network denial for Claude', () => {
    const claude = {
      ...codex,
      networkModes: {
        allow: { state: 'supported' as const },
        deny: { state: 'unsupported' as const, reason: 'No native sandbox.' },
      },
    };
    expect(() => translateLaneSpawnPolicy('claude', claude, {
      permission: 'plan', network: 'deny',
    })).toThrow(LaneSpawnPolicyError);
  });

  it('leaves omitted argv options byte identical', () => {
    const args = ['run', '--auto', '--model', 'fixture'];
    expect(applyLaneArgvPolicy(args, { addArgs: [], removeArgs: [] })).toEqual(args);
  });
});
