/**
 * GatewayService.sendTest — unit tests for the "Send test" button RPC path.
 *
 * Locks four contracts on the actual {@link GatewayService.sendTest} API:
 *
 *   1. With no approved binding for the requested platform, the method
 *      returns `{ ok: false, error: 'no-approved-binding' }` and never
 *      touches the adapter.
 *   2. With an approved binding present, the canned literal is sent through
 *      `adapter.sendMessage`, the outbound row is persisted via
 *      `MessageStore.insert`, and `BindingStore.touch` is called.
 *   3. When `bindingId` is provided but no approved binding matches, the
 *      method returns `{ ok: false, error: 'binding-not-approved' }`.
 *   4. When the adapter throws, the error message is returned in the
 *      `{ ok: false, error }` shape (no exception escapes).
 *
 * Adapters are injected via `configureForTest` so we never construct grammy /
 * discord / slack clients. Other dependencies are minimal jest mocks.
 */
import 'reflect-metadata';

import { GatewayService } from './gateway.service';
import { BindingId, type GatewayBinding } from './types';
import type { BindingStore } from './binding.store';
import type { MessageStore } from './message.store';
import type { ITokenVault } from './token-vault.interface';
import type { GrammyTelegramAdapter } from './adapters/telegram/grammy.adapter';
import type { DiscordAdapter } from './adapters/discord/discord.adapter';
import type { BoltSlackAdapter } from './adapters/slack/bolt.adapter';
import type { FfmpegDecoder } from './voice/ffmpeg-decoder';
import type { WhisperTranscriber } from './voice/whisper-transcriber';
import type {
  IMessagingAdapter,
  SendResult,
} from './adapters/adapter.interface';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { GatewaySettings } from '@ptah-extension/settings-core';

function createLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function createMockGatewaySettings(): jest.Mocked<GatewaySettings> {
  const handle = () => ({
    get: jest.fn().mockResolvedValue(''),
    set: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  });
  return {
    telegramTokenCipher: handle(),
    discordTokenCipher: handle(),
    slackBotTokenCipher: handle(),
    slackAppTokenCipher: handle(),
  } as unknown as jest.Mocked<GatewaySettings>;
}

function createWorkspace(): IWorkspaceProvider {
  return {
    getConfiguration: jest.fn(),
    setConfiguration: jest.fn(),
  } as unknown as IWorkspaceProvider;
}

function createBindingStore(): jest.Mocked<BindingStore> {
  return {
    findById: jest.fn(),
    findByExternal: jest.fn(),
    list: jest.fn(),
    upsertPending: jest.fn(),
    approve: jest.fn(),
    setStatus: jest.fn(),
    touch: jest.fn(),
  } as unknown as jest.Mocked<BindingStore>;
}

function createMessageStore(): jest.Mocked<MessageStore> {
  return {
    insert: jest.fn(),
    list: jest.fn(),
    listVoicePathsOlderThan: jest.fn(),
  } as unknown as jest.Mocked<MessageStore>;
}

function createAdapter(
  platform: 'telegram' | 'discord' | 'slack',
): jest.Mocked<IMessagingAdapter> {
  return {
    platform,
    start: jest.fn(),
    stop: jest.fn(),
    isRunning: jest.fn().mockReturnValue(true),
    sendMessage: jest
      .fn()
      .mockResolvedValue({ externalMsgId: 'msg-1' } as SendResult),
    editMessage: jest.fn(),
    on: jest.fn(),
  } as unknown as jest.Mocked<IMessagingAdapter>;
}

function makeBinding(
  overrides: Partial<Omit<GatewayBinding, 'id'>> & {
    platform: GatewayBinding['platform'];
    externalChatId: string;
    id?: string;
  },
): GatewayBinding {
  const { id: rawId, ...rest } = overrides;
  return {
    id: BindingId.create(rawId ?? 'binding-1'),
    displayName: null,
    approvalStatus: 'approved',
    ptahSessionId: null,
    workspaceRoot: null,
    pairingCode: null,
    createdAt: 0,
    approvedAt: 0,
    lastActiveAt: null,
    ...rest,
  };
}

interface Suite {
  service: GatewayService;
  bindings: jest.Mocked<BindingStore>;
  messages: jest.Mocked<MessageStore>;
  telegramAdapter: jest.Mocked<IMessagingAdapter>;
}

function buildSuite(): Suite {
  const logger = createLogger();
  const workspace = createWorkspace();
  const vault = {
    encrypt: jest.fn(),
    decrypt: jest.fn(),
  } as unknown as ITokenVault;
  const bindings = createBindingStore();
  const messages = createMessageStore();
  const telegramAdapter = createAdapter('telegram');

  // Adapter shells injected via tsyringe in production are unused here — the
  // service's internal `adapters` map is populated via `configureForTest`.
  const placeholder = {} as unknown as GrammyTelegramAdapter;
  const discord = {} as unknown as DiscordAdapter;
  const slack = {} as unknown as BoltSlackAdapter;
  const ffmpeg = {} as unknown as FfmpegDecoder;
  const whisper = {
    configure: jest.fn(),
  } as unknown as WhisperTranscriber;

  const service = new GatewayService(
    logger,
    workspace,
    vault,
    bindings,
    messages,
    placeholder,
    discord,
    slack,
    ffmpeg,
    whisper,
    createMockGatewaySettings(),
  );
  service.configureForTest({ telegram: telegramAdapter });
  return { service, bindings, messages, telegramAdapter };
}

describe('GatewayService.sendTest', () => {
  it('returns no-approved-binding when no approved binding exists', async () => {
    const { service, bindings, telegramAdapter } = buildSuite();
    bindings.list.mockReturnValue([]);

    const result = await service.sendTest({ platform: 'telegram' });

    expect(result).toEqual({ ok: false, error: 'no-approved-binding' });
    expect(bindings.list).toHaveBeenCalledWith({
      platform: 'telegram',
      status: 'approved',
    });
    expect(telegramAdapter.sendMessage).not.toHaveBeenCalled();
  });

  it('routes the canned message through adapter.sendMessage and persists outbound', async () => {
    const { service, bindings, messages, telegramAdapter } = buildSuite();
    const binding = makeBinding({
      platform: 'telegram',
      externalChatId: 'chat-42',
      id: 'binding-7',
    });
    bindings.list.mockReturnValue([binding]);

    const result = await service.sendTest({ platform: 'telegram' });

    expect(telegramAdapter.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegramAdapter.sendMessage).toHaveBeenCalledWith(
      'chat-42',
      'Ptah test message — gateway is wired up correctly.',
    );
    expect(messages.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingId: binding.id,
        direction: 'outbound',
        externalMsgId: 'msg-1',
      }),
    );
    expect(bindings.touch).toHaveBeenCalledWith(binding.id);
    expect(result).toEqual({
      ok: true,
      bindingId: 'binding-7',
      externalMsgId: 'msg-1',
    });
  });

  it('returns binding-not-approved when bindingId does not match an approved binding', async () => {
    const { service, bindings, telegramAdapter } = buildSuite();
    // Approved list returns a different binding id than the one requested.
    bindings.list.mockReturnValue([
      makeBinding({
        platform: 'telegram',
        externalChatId: 'chat-1',
        id: 'binding-A',
      }),
    ]);

    const result = await service.sendTest({
      platform: 'telegram',
      bindingId: BindingId.create('binding-Z'),
    });

    expect(result).toEqual({ ok: false, error: 'binding-not-approved' });
    expect(telegramAdapter.sendMessage).not.toHaveBeenCalled();
  });

  it('returns adapter-not-running when the platform has no adapter configured', async () => {
    const { service } = buildSuite();
    // Suite only configured `telegram`; `discord` is absent from the map.
    const result = await service.sendTest({ platform: 'discord' });

    expect(result).toEqual({ ok: false, error: 'adapter-not-running' });
  });

  it('surfaces adapter errors as { ok: false, error } without throwing', async () => {
    const { service, bindings, telegramAdapter } = buildSuite();
    bindings.list.mockReturnValue([
      makeBinding({ platform: 'telegram', externalChatId: 'chat-1' }),
    ]);
    telegramAdapter.sendMessage.mockRejectedValue(new Error('rate-limited'));

    const result = await service.sendTest({ platform: 'telegram' });

    expect(result).toEqual({ ok: false, error: 'rate-limited' });
  });
});
