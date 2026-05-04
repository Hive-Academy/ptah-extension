/**
 * GatewayService — `testSendToBinding` (Batch A6) unit tests.
 *
 * Locks two contracts:
 *   1. With no approved binding for the requested platform, the method
 *      returns `{ ok: false, error: 'no-approved-binding' }` and does not
 *      touch the adapter.
 *   2. With an approved binding present, the canned literal "Ptah test
 *      message ✓" is sent through `scheduleSend` (Bottleneck wrapper) and
 *      reaches the adapter's `sendMessage`.
 *
 * The tests bypass `start()` so the service runs without a live limiter —
 * `scheduleSend` falls back to direct invocation, which is exactly what the
 * production helper does when called before boot. We assert on that helper
 * being invoked via a spy on the prototype to confirm the wiring.
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

function createLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
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

function createAdapter(
  platform: 'telegram' | 'discord' | 'slack',
): jest.Mocked<IMessagingAdapter> {
  const adapter = {
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
  return adapter;
}

function makeBinding(
  overrides: Partial<GatewayBinding> & {
    platform: GatewayBinding['platform'];
    externalChatId: string;
  },
): GatewayBinding {
  return {
    id: BindingId.create('binding-1'),
    displayName: null,
    approvalStatus: 'approved',
    ptahSessionId: null,
    workspaceRoot: null,
    pairingCode: null,
    createdAt: 0,
    approvedAt: 0,
    lastActiveAt: null,
    ...overrides,
  };
}

interface Suite {
  service: GatewayService;
  bindings: jest.Mocked<BindingStore>;
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
  const messages = { list: jest.fn() } as unknown as MessageStore;
  const telegramAdapter = createAdapter('telegram');

  // Adapter shells injected via tsyringe in production are unused here — the
  // service's internal `adapters` map is populated via `configureForTest` so
  // tests do not need real grammy/discord/slack instances.
  const placeholder = {} as unknown as GrammyTelegramAdapter;
  const discord = {} as unknown as DiscordAdapter;
  const slack = {} as unknown as BoltSlackAdapter;
  const ffmpeg = {} as unknown as FfmpegDecoder;
  const whisper = {
    configure: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
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
  );
  service.configureForTest({ telegram: telegramAdapter });
  return { service, bindings, telegramAdapter };
}

describe('GatewayService.testSendToBinding', () => {
  it('returns no-approved-binding when no binding exists for the platform', async () => {
    const { service, bindings, telegramAdapter } = buildSuite();
    bindings.list.mockReturnValue([]);

    const result = await service.testSendToBinding('telegram');

    expect(result).toEqual({
      ok: false,
      bindingId: '',
      messageId: null,
      error: 'no-approved-binding',
    });
    expect(bindings.list).toHaveBeenCalledWith({
      platform: 'telegram',
      status: 'approved',
    });
    expect(telegramAdapter.sendMessage).not.toHaveBeenCalled();
  });

  it('routes the canned message through scheduleSend → adapter.sendMessage', async () => {
    const { service, bindings, telegramAdapter } = buildSuite();
    bindings.list.mockReturnValue([
      makeBinding({ platform: 'telegram', externalChatId: 'chat-42' }),
    ]);

    // Spy on the private `scheduleSend` to confirm the limiter wrapper is
    // invoked. Cast through unknown to access the private symbol without
    // weakening the production type signature.
    const scheduleSendSpy = jest.spyOn(
      service as unknown as {
        scheduleSend: GatewayService['testSendToBinding'];
      },
      'scheduleSend',
    );

    const result = await service.testSendToBinding('telegram');

    expect(scheduleSendSpy).toHaveBeenCalledTimes(1);
    expect(telegramAdapter.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegramAdapter.sendMessage).toHaveBeenCalledWith(
      'chat-42',
      'Ptah test message ✓',
    );
    expect(result).toEqual({
      ok: true,
      bindingId: 'binding-1',
      messageId: 'msg-1',
    });
  });

  it('returns platform-not-supported for whatsapp (no adapter today)', async () => {
    const { service, telegramAdapter } = buildSuite();

    const result = await service.testSendToBinding('whatsapp');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('platform-not-supported');
    expect(telegramAdapter.sendMessage).not.toHaveBeenCalled();
  });
});
