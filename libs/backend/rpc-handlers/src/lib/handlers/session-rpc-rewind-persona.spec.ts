import 'reflect-metadata';

jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ProjectType: {},
  Framework: {},
  MonorepoType: {},
  FileType: {},
}));

import { SessionRpcHandlers } from './session-rpc.handlers';
import { SYSTEM_PROMPT_MAX_LENGTH } from './chat-rpc.schema';

const sessionId = '11111111-1111-4111-8111-111111111111';

function handler() {
  let callback: (
    params: Record<string, unknown>,
  ) => Promise<unknown> = async () => undefined;
  const ensureSessionActiveForRewind = jest
    .fn()
    .mockResolvedValue({ resumed: true });
  const subject = Object.assign(Object.create(SessionRpcHandlers.prototype), {
    rpcHandler: {
      registerMethod: jest.fn((_name: string, cb: typeof callback) => {
        callback = cb;
      }),
    },
    validateSessionId: jest.fn().mockReturnValue(sessionId),
    validateUserMessageId: jest.fn().mockReturnValue('message'),
    sanitizeAnchorHint: jest.fn().mockReturnValue(undefined),
    authorizeSessionAccess: jest.fn().mockResolvedValue(undefined),
    sdkAdapter: {
      isSessionActive: jest.fn().mockReturnValue(false),
      rewindFiles: jest
        .fn()
        .mockResolvedValue({ canRewind: true, filesChanged: [] }),
    },
    metadataStore: {
      get: jest.fn().mockResolvedValue({ workspaceId: '/workspace' }),
    },
    // Ambient host: the account gate admits a session with no account binding.
    chatSession: {
      ensureSessionActiveForRewind,
      gateSessionAccount: jest.fn().mockResolvedValue(undefined),
    },
    logger: { debug: jest.fn(), info: jest.fn(), error: jest.fn() },
    sentryService: { captureException: jest.fn() },
  }) as SessionRpcHandlers;
  subject['registerRewindFiles']();
  return { callback, ensureSessionActiveForRewind };
}

describe('session:rewindFiles persona boundary', () => {
  it.each([undefined, 'Persona text'])(
    'passes optional persona %s only when resuming',
    async (systemPrompt) => {
      const { callback, ensureSessionActiveForRewind } = handler();
      await callback({ sessionId, userMessageId: 'message', systemPrompt });
      expect(ensureSessionActiveForRewind).toHaveBeenCalledWith(
        sessionId,
        sessionId,
        '/workspace',
        systemPrompt,
      );
    },
  );

  it.each([42, 'x'.repeat(SYSTEM_PROMPT_MAX_LENGTH + 1)])(
    'rejects invalid persona before activation',
    async (systemPrompt) => {
      const { callback, ensureSessionActiveForRewind } = handler();
      await expect(
        callback({ sessionId, userMessageId: 'message', systemPrompt }),
      ).rejects.toThrow('Invalid systemPrompt');
      expect(ensureSessionActiveForRewind).not.toHaveBeenCalled();
    },
  );
});
