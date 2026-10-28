import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type {
  ProviderAccountBinding,
  ProviderAccountSelection,
  SessionId,
} from '@ptah-extension/shared';
import { createMockModelSettings } from '../../../test-utils/mock-settings';
import {
  ChatSlashCommandRouterService,
  gateMainSessionAccount,
} from './chat-slash-command-router.service';

/**
 * Main-chat account precedence (implementation-plan rev1 Component 9 table).
 * The gate resolves a selection and never reserves a route: admission, lease
 * and binding belong to the SDK run that receives the resolved selection.
 */

const ROOT = '/c/projects/router-accounts';
const SESSION = '5b0d6f43-5a55-4bd2-9a39-4e0d0b0b7c11' as SessionId;
const TAB = 'c3f0a9a2-8f0c-4f4e-9c36-8d3d4b0b2a10';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const BINDING: ProviderAccountBinding = {
  version: 1,
  provider: 'claude',
  profileId: A,
  routeRevision: 0,
  routeFingerprint: 'a'.repeat(64),
  authEpoch: 0,
  runId: '33333333-3333-4333-8333-333333333333',
  identity: { kind: 'known', ownerKey: 'b'.repeat(64) },
};

function fakes(options: { bound?: boolean; stored?: string | null; authMethod?: string } = {}) {
  const accounts = {
    selection: jest.fn().mockReturnValue({ profileId: options.stored ?? null, revision: 1 }),
    lookupBySdkSession: jest.fn(),
    // Tripwires: the gate must never reserve or settle a route.
    admitClaudeRoute: jest.fn(),
    releaseReservation: jest.fn(),
  };
  const activeProvider = {
    resolveActiveAuthForPath: jest.fn().mockReturnValue({
      authMethod: options.authMethod ?? 'claudeCli',
      providerId: 'anthropic',
    }),
  };
  const metadata = {
    get: jest.fn().mockResolvedValue(options.bound ? { accountBinding: BINDING } : null),
    resolveAccountBinding: jest.fn().mockResolvedValue(options.bound ? BINDING : null),
    getAccountBound: jest.fn().mockResolvedValue(true),
  };
  return { accounts, activeProvider, metadata };
}

type Fakes = ReturnType<typeof fakes>;

function expectNoReservation(f: Fakes): void {
  expect(f.accounts.admitClaudeRoute).not.toHaveBeenCalled();
  expect(f.accounts.releaseReservation).not.toHaveBeenCalled();
}

const named = (profileId: string) => ({ kind: 'named' as const, profileId });

describe('gateMainSessionAccount precedence on a fresh run', () => {
  it.each<[string, ProviderAccountSelection | undefined, string | null, ReturnType<typeof named> | undefined]>([
    ['explicit named over a stored default', named(A), B, named(A)],
    ['explicit ambient over a stored default', { kind: 'ambient' }, B, undefined],
    ['omitted with a stored default', { kind: 'omitted' }, B, named(B)],
    ['absent with a stored default', undefined, B, named(B)],
    ['omitted without a stored default', { kind: 'omitted' }, null, undefined],
  ])('%s', async (_label, accountSelection, stored, expected) => {
    const f = fakes({ stored });
    await expect(
      gateMainSessionAccount(f, { workspacePath: ROOT, accountSelection }),
    ).resolves.toEqual(expected);
    expectNoReservation(f);
  });

  it('explicit ambient adds no account, auth or storage call', async () => {
    const f = fakes({ stored: B });
    await gateMainSessionAccount(f, { workspacePath: ROOT, accountSelection: { kind: 'ambient' } });
    expect(f.accounts.selection).not.toHaveBeenCalled();
    expect(f.activeProvider.resolveActiveAuthForPath).not.toHaveBeenCalled();
    expect(f.metadata.get).not.toHaveBeenCalled();
  });

  it.each(['apiKey', 'thirdParty'])('a %s provider keeps today\'s ambient behaviour', async (authMethod) => {
    const f = fakes({ stored: B, authMethod });
    await expect(
      gateMainSessionAccount(f, { workspacePath: ROOT, accountSelection: named(A) }),
    ).resolves.toBeUndefined();
    expect(f.accounts.selection).not.toHaveBeenCalled();
    expectNoReservation(f);
  });

  it('a host without the account service refuses a named selection as unavailable-storage', async () => {
    const f = fakes();
    await expect(
      gateMainSessionAccount({ metadata: f.metadata }, { workspacePath: ROOT, accountSelection: named(A) }),
    ).rejects.toMatchObject({ code: 'unavailable-storage' });
  });
});

describe('gateMainSessionAccount precedence on a bound run', () => {
  it.each<[string, ProviderAccountSelection | undefined]>([
    ['absent', undefined],
    ['omitted', { kind: 'omitted' }],
    ['the same profile', named(A)],
  ])('%s selection resolves the stored binding, never the default', async (_label, accountSelection) => {
    const f = fakes({ bound: true, stored: B });
    await expect(
      gateMainSessionAccount(f, { sessionId: SESSION, workspacePath: ROOT, accountSelection }),
    ).resolves.toEqual(named(A));
    expect(f.accounts.selection).not.toHaveBeenCalled();
    expectNoReservation(f);
  });

  it.each<[string, ProviderAccountSelection]>([
    ['a different profile', named(B)],
    ['ambient', { kind: 'ambient' }],
  ])('%s refuses conflict and keeps the conversation', async (_label, accountSelection) => {
    const f = fakes({ bound: true });
    await expect(
      gateMainSessionAccount(f, { sessionId: SESSION, accountSelection }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expectNoReservation(f);
  });

  it('an unbound legacy session stays ambient and refuses a retroactive named selection', async () => {
    const f = fakes({ stored: B });
    await expect(gateMainSessionAccount(f, { sessionId: SESSION })).resolves.toBeUndefined();
    await expect(
      gateMainSessionAccount(f, { sessionId: SESSION, accountSelection: named(A) }),
    ).rejects.toMatchObject({ code: 'invalid-bound' });
    expect(f.accounts.selection).not.toHaveBeenCalled();
  });
});

describe('ChatSlashCommandRouterService account forwarding', () => {
  function router(f: Fakes) {
    const stream = (async function* () {
      /* no inference */
    })();
    const sdk = {
      executeSlashCommand: jest.fn().mockResolvedValue(stream),
      interruptSession: jest.fn().mockResolvedValue(undefined),
    };
    type Args = ConstructorParameters<typeof ChatSlashCommandRouterService>;
    const service = new ChatSlashCommandRouterService(
      createMockLogger() as unknown as Logger,
      { broadcastMessage: jest.fn() } as unknown as Args[1],
      createMockModelSettings(),
      sdk as unknown as Args[3],
      {
        intercept: jest.fn().mockReturnValue({
          action: 'new-query',
          commandName: 'review',
          rawCommand: '/review',
        }),
      } as unknown as Args[4],
      {
        isMcpServerRunning: jest.fn().mockReturnValue(false),
        resolveEnhancedPromptsContent: jest.fn().mockResolvedValue(undefined),
      } as unknown as Args[5],
      { streamEventsToWebview: jest.fn() } as unknown as Args[6],
      {
        resolveStoredModel: (_path: string, model: string) =>
          model || 'default',
        resolveProviderProfileForWorkspace: jest.fn().mockResolvedValue(undefined),
      } as unknown as Args[7],
      undefined,
      f.accounts as unknown as Args[9],
      f.activeProvider as unknown as Args[10],
      f.metadata as unknown as Args[11],
    );
    return { service, sdk };
  }

  it('a bound session relaunch carries the stored named selection', async () => {
    const f = fakes({ bound: true });
    const { service, sdk } = router(f);
    await expect(
      service.routeFollowUpSlashCommand('/review', SESSION, TAB, ROOT, { sessionId: SESSION, tabId: TAB, prompt: '/review' }),
    ).resolves.toEqual({ success: true, sessionId: SESSION });
    expect(sdk.executeSlashCommand).toHaveBeenCalledWith(
      SESSION,
      '/review',
      expect.objectContaining({ accountSelection: named(A) }),
    );
    expectNoReservation(f);
  });

  it('an unbound session relaunch keeps the ambient argument shape', async () => {
    const f = fakes({ stored: B });
    const { service, sdk } = router(f);
    await service.routeFollowUpSlashCommand('/review', SESSION, TAB, ROOT, {
      sessionId: SESSION,
      tabId: TAB,
      prompt: '/review',
    });
    expect(sdk.executeSlashCommand.mock.calls[0][2]).not.toHaveProperty('accountSelection');
    expect(f.accounts.selection).not.toHaveBeenCalled();
  });

  it('a conflicting selection refuses before any relaunch', async () => {
    const f = fakes({ bound: true });
    const { service, sdk } = router(f);
    await expect(
      service.routeFollowUpSlashCommand('/review', SESSION, TAB, ROOT, {
        sessionId: SESSION,
        tabId: TAB,
        prompt: '/review',
        accountSelection: named(B),
      }),
    ).resolves.toMatchObject({ success: false, accountRefusal: { code: 'conflict' } });
    expect(sdk.executeSlashCommand).not.toHaveBeenCalled();
  });

  it('a named relaunch refusal keeps its typed code instead of AUTH_REQUIRED', async () => {
    const f = fakes({ bound: true });
    const { service, sdk } = router(f);
    sdk.executeSlashCommand.mockRejectedValue({
      code: 'unavailable-storage',
      summary: 'The session account could not be verified. The conversation was preserved.',
    });
    const result = await service.routeFollowUpSlashCommand('/review', SESSION, TAB, ROOT, {
      sessionId: SESSION,
      tabId: TAB,
      prompt: '/review',
    });
    expect(result).toMatchObject({ success: false, accountRefusal: { code: 'unavailable-storage' } });
    expect(result).not.toHaveProperty('errorCode');
  });
});
