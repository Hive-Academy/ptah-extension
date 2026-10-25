import { SessionId } from '@ptah-extension/shared';
import type { SessionMetadataStore } from '../session-metadata-store';
import { createCodexChatMetadataPort } from './codex-chat-metadata-port';
const workspace = process.platform === 'win32' ? 'D:/workspace' : '/workspace';
const home = process.platform === 'win32' ? 'd:\\home' : '/home';
describe('native metadata port', () => {
  it('maps native identity through the sole metadata writer and rejects mismatched IDs', async () => {
    const updateCodexExecution = jest
      .fn<
        ReturnType<SessionMetadataStore['updateCodexExecution']>,
        Parameters<SessionMetadataStore['updateCodexExecution']>
      >()
      .mockResolvedValue(undefined);
    const port = createCodexChatMetadataPort({ updateCodexExecution });
    const sessionId = SessionId.from('33333333-3333-4333-8333-333333333333');
    const identity = {
      threadId: sessionId,
      contextId: 'context',
      processGeneration: 1,
      normalizedHome: home,
      workspaceId: workspace,
      providerId: 'openai-codex',
      profileFingerprint: 'profile',
    };
    await port.save(sessionId, identity);
    expect(updateCodexExecution).toHaveBeenCalledTimes(1);
    expect(updateCodexExecution.mock.calls[0][1](undefined)).toEqual({
      version: 1,
      sessionId,
      runtime: 'codex-app-server',
      providerId: 'openai-codex',
      workspaceId: workspace,
      codex: { normalizedHome: home },
    });
    await expect(
      port.save(sessionId, { ...identity, threadId: 'other' }),
    ).rejects.toThrow('Codex session/thread identity mismatch');
    expect(updateCodexExecution).toHaveBeenCalledTimes(1);
  });
});
