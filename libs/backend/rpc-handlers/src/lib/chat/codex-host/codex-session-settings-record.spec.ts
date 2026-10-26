import 'reflect-metadata';
import type { CodexChatAdapterPorts } from '@ptah-extension/agent-sdk';
import { SessionId, type SessionRuntimeIdentity } from '@ptah-extension/shared';
import {
  createCodexSessionSettingsRecord,
  CodexSessionSettingsError,
} from './codex-session-settings-record';

const sessionId = SessionId.from('11111111-1111-4111-8111-111111111111');
const profileResult: Awaited<ReturnType<CodexChatAdapterPorts['profile']>> = {
  profile: {
    contextId: 'context',
    consumer: 'chat',
    normalizedHome: '/home',
    providerId: 'openai-codex',
    workspaceId: '/work',
    cwd: '/work',
    model: 'gpt-5',
    effort: 'high',
    permissionLevel: 'ask',
    approvalPolicy: 'on-request',
    sandboxPolicy: {
      mode: 'read-only',
      networkAccess: false,
      writableRoots: [],
    },
    instructionSources: [],
    mcpServers: [],
    attachments: [],
    profileFingerprint: 'fingerprint',
  },
};
const identity: SessionRuntimeIdentity = {
  version: 1,
  sessionId,
  runtime: 'codex-app-server',
  providerId: 'openai-codex',
  workspaceId: '/work',
  codex: { normalizedHome: '/home' },
};

function harness(persisted?: SessionRuntimeIdentity) {
  const values = new Map<string, unknown>();
  const readForPath = jest.fn(
    (key: string, _path: string, _appScopable?: boolean): unknown =>
      values.get(key),
  );
  const record = createCodexSessionSettingsRecord({
    identities: { lookup: () => (persisted ? { persisted } : undefined) },
    scopeResolver: { readForPath },
  });
  return { record, values, readForPath };
}

describe('Codex session settings record', () => {
  it('returns the recorded model, effort, permission and workspace without consulting current settings', () => {
    const h = harness();
    h.record.record(sessionId, profileResult);
    expect(h.record.settings(sessionId)).toEqual({
      workspacePath: '/work',
      authKey: 'thirdParty.openai-codex',
      model: 'gpt-5',
      effort: 'high',
      permissionLevel: 'ask',
    });
    expect(h.readForPath).not.toHaveBeenCalled();
  });
  it('reads an inactive session from its persisted provider and workspace namespace', () => {
    const h = harness(identity);
    h.values.set('provider.thirdParty.openai-codex.selectedModel', 'gpt-5.1');
    h.values.set('provider.thirdParty.openai-codex.reasoningEffort', 'medium');
    h.values.set('autopilot.enabled', true);
    h.values.set('autopilot.permissionLevel', 'auto-edit');
    expect(h.record.settings(sessionId)).toEqual({
      workspacePath: '/work',
      authKey: 'thirdParty.openai-codex',
      model: 'gpt-5.1',
      effort: 'medium',
      permissionLevel: 'auto-edit',
    });
    expect(h.readForPath).toHaveBeenCalledWith(
      'provider.thirdParty.openai-codex.selectedModel',
      '/work',
      true,
    );
    expect(h.readForPath).toHaveBeenCalledWith(
      'provider.thirdParty.openai-codex.reasoningEffort',
      '/work',
      true,
    );
  });
  it('throws a typed unknown-session error instead of choosing defaults', () => {
    const h = harness();
    expect(() => h.record.settings(sessionId)).toThrow(
      CodexSessionSettingsError,
    );
    expect(() => h.record.settings(sessionId)).toThrow(
      expect.objectContaining({ code: 'unknown-session' }),
    );
  });
  it('derives third-party namespaces from the bound provider rather than focused auth', () => {
    const h = harness({ ...identity, providerId: 'custom-codex' });
    h.values.set('authMethod', 'claudeCli');
    h.values.set(
      'provider.thirdParty.custom-codex.selectedModel',
      'custom-model',
    );
    expect(h.record.settings(sessionId).authKey).toBe(
      'thirdParty.custom-codex',
    );
    expect(h.record.settings(sessionId).model).toBe('custom-model');
    h.record.record(sessionId, {
      profile: { ...profileResult.profile, providerId: 'custom-codex' },
    });
    expect(h.record.settings(sessionId).authKey).toBe(
      'thirdParty.custom-codex',
    );
  });
  it('rejects malformed persisted effort', () => {
    const h = harness(identity);
    h.values.set('provider.thirdParty.openai-codex.reasoningEffort', 'invalid');
    expect(() => h.record.settings(sessionId)).toThrow(
      expect.objectContaining({ code: 'invalid-settings' }),
    );
  });
  it('releases recorded settings at teardown', () => {
    const h = harness();
    h.record.record(sessionId, profileResult);
    h.record.dispose();
    expect(() => h.record.settings(sessionId)).toThrow(
      CodexSessionSettingsError,
    );
  });
  it('records a session when the adapter opens it and releases it when it closes', () => {
    const h = harness();
    expect(() => h.record.settings(sessionId)).toThrow(
      CodexSessionSettingsError,
    );
    h.record.lifecycle.opened(sessionId, profileResult);
    expect(h.record.settings(sessionId).model).toBe('gpt-5');
    h.record.lifecycle.closed(sessionId);
    expect(() => h.record.settings(sessionId)).toThrow(
      CodexSessionSettingsError,
    );
  });
});
