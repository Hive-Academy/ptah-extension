/**
 * VscodeCopilotAuthService — logout-tombstone specs (TASK_2026_172 Issue 2).
 *
 * The VS Code subclass is where a base-class-only fix would leak: both of its
 * overrides run their `vscode.authentication.getSession()` path BEFORE
 * delegating to `super`, so `tryRestoreAuth()` would have silently re-signed
 * the user in from the editor's own GitHub session even with the Ptah logout
 * tombstone set, and `login()` could succeed via that same session and return
 * without ever reaching the base class that clears the tombstone.
 *
 * `vscode` is stubbed per-spec (the repo-wide `__mocks__/vscode.ts` has no
 * `authentication` surface) so this file owns its own session fixture.
 */

import 'reflect-metadata';

jest.mock('axios');

jest.mock('./copilot-file-auth', () => ({
  readCopilotToken: jest.fn(),
  writeCopilotToken: jest.fn(),
}));

jest.mock('./copilot-device-code-auth', () => ({
  executeDeviceCodeFlow: jest.fn(),
  requestDeviceCode: jest.fn(),
  pollForAccessToken: jest.fn(),
}));

const mockGetSession = jest.fn();

jest.mock('vscode', () => ({
  version: '1.100.0',
  authentication: {
    getSession: (...args: unknown[]) => mockGetSession(...args),
  },
}));

import axios from 'axios';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import {
  createMockUserInteraction,
  createMockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import {
  PlatformType,
  type IPlatformInfo,
} from '@ptah-extension/platform-core';
import type { ISettingsStore } from '@ptah-extension/settings-core';
import { VscodeCopilotAuthService } from './vscode-copilot-auth.service';
import type { CopilotTokenResponse } from './copilot-provider.types';
import * as fileAuth from './copilot-file-auth';

interface AxiosLikeResponse<T> {
  data: T;
}

type AxiosGetMock = jest.MockedFunction<
  <T = unknown>(url: string, config?: unknown) => Promise<AxiosLikeResponse<T>>
>;

const mockedAxios = axios as unknown as { get: AxiosGetMock };
const mockedReadCopilotToken = fileAuth.readCopilotToken as jest.MockedFunction<
  typeof fileAuth.readCopilotToken
>;

const TOMBSTONE_KEY = 'provider.github-copilot.loggedOut';

interface FakeSettingsStore extends ISettingsStore {
  values: Map<string, unknown>;
}

function createFakeSettingsStore(
  initial: Record<string, unknown> = {},
): FakeSettingsStore {
  const values = new Map<string, unknown>(Object.entries(initial));
  const unsupported = (): never => {
    throw new Error('not used by VscodeCopilotAuthService');
  };
  return {
    values,
    readGlobal: (<T>(key: string) =>
      values.get(key) as T | undefined) as ISettingsStore['readGlobal'],
    writeGlobal: (async (key: string, value: unknown) => {
      values.set(key, value);
    }) as ISettingsStore['writeGlobal'],
    readSecret: unsupported,
    writeSecret: unsupported,
    deleteSecret: unsupported,
    watchGlobal: unsupported,
    watchSecret: unsupported,
    flushSync: () => undefined,
  } as FakeSettingsStore;
}

function makeService(settings: Record<string, unknown> = {}): {
  service: VscodeCopilotAuthService;
  settingsStore: FakeSettingsStore;
  logger: MockLogger;
} {
  const logger = createMockLogger();
  const platformInfo: IPlatformInfo = {
    type: PlatformType.VSCode,
    extensionPath: '/fake/extension',
    globalStoragePath: '/fake/global',
    workspaceStoragePath: '/fake/workspace',
  };
  const settingsStore = createFakeSettingsStore(settings);
  const service = new VscodeCopilotAuthService(
    logger as unknown as Logger,
    platformInfo,
    createMockUserInteraction(),
    createMockWorkspaceProvider(),
    settingsStore,
  );
  return { service, settingsStore, logger };
}

function makeTokenResponse(): AxiosLikeResponse<CopilotTokenResponse> {
  return {
    data: {
      token: 'tid_vscode',
      expires_at: Math.floor(Date.now() / 1000) + 3_600,
      endpoints: { api: 'https://api.githubcopilot.com' },
    },
  };
}

/** A live VS Code GitHub session — the credential source under test. */
function editorSession(): {
  accessToken: string;
  account: { label: string };
} {
  return { accessToken: 'gho_vscode_session', account: { label: 'octocat' } };
}

describe('VscodeCopilotAuthService — logout tombstone', () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockedReadCopilotToken.mockReset();
    mockedAxios.get = jest.fn() as AxiosGetMock;
  });

  it('skips the VS Code native session on silent restore when the tombstone is set', async () => {
    mockGetSession.mockResolvedValue(editorSession());
    mockedAxios.get.mockResolvedValue(makeTokenResponse());
    mockedReadCopilotToken.mockResolvedValue('gho_file_token');

    const { service } = makeService({ [TOMBSTONE_KEY]: true });

    await expect(service.tryRestoreAuth()).resolves.toBe(false);
    // Neither credential source was consulted.
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockedReadCopilotToken).not.toHaveBeenCalled();
  });

  it('restores from the VS Code native session when no tombstone is set', async () => {
    mockGetSession.mockResolvedValue(editorSession());
    mockedAxios.get.mockResolvedValue(makeTokenResponse());

    const { service } = makeService();

    await expect(service.tryRestoreAuth()).resolves.toBe(true);
    expect(mockGetSession).toHaveBeenCalled();
  });

  it('explicit login() clears the tombstone even when it succeeds via the VS Code session (never reaching super.login)', async () => {
    mockGetSession.mockResolvedValue(editorSession());
    mockedAxios.get.mockResolvedValue(makeTokenResponse());

    const { service, settingsStore } = makeService({ [TOMBSTONE_KEY]: true });

    await expect(service.login()).resolves.toBe(true);

    expect(settingsStore.values.get(TOMBSTONE_KEY)).toBe(false);
    // The base-class file path was never used — proving the clear happened in
    // the override, not via `super.login()`.
    expect(mockedReadCopilotToken).not.toHaveBeenCalled();
    // Silent restore works again after the explicit re-login.
    await expect(service.tryRestoreAuth()).resolves.toBe(true);
  });

  it('logout() sets the tombstone and leaves the shared hosts.json untouched', async () => {
    const { service, settingsStore } = makeService();

    await service.logout();

    expect(settingsStore.values.get(TOMBSTONE_KEY)).toBe(true);
    expect(mockedReadCopilotToken).not.toHaveBeenCalled();
  });
});
