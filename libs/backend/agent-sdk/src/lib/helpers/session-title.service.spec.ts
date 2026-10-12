import 'reflect-metadata';

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  renameSession: jest.fn(),
}));

const sdkModuleMock = require('@anthropic-ai/claude-agent-sdk') as {
  renameSession: jest.Mock | undefined;
};

import type { Logger } from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { SessionTitleService } from './session-title.service';
import type { SessionMetadataStore } from '../session-metadata-store';

const SESSION_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';

function makeService(
  opts: {
    metadataWorkspaceId?: string | null;
  } = {},
): {
  service: SessionTitleService;
  logger: MockLogger;
  metadataStore: { get: jest.Mock };
} {
  const logger = createMockLogger();
  const metadataStore = {
    get: jest
      .fn()
      .mockResolvedValue(
        opts.metadataWorkspaceId === null
          ? null
          : { workspaceId: opts.metadataWorkspaceId ?? 'D:/ws/from-metadata' },
      ),
  };

  const service = new SessionTitleService(
    logger as unknown as Logger,
    metadataStore as unknown as SessionMetadataStore,
  );
  return { service, logger, metadataStore };
}

describe('SessionTitleService.retitle', () => {
  beforeEach(() => {
    sdkModuleMock.renameSession = jest.fn().mockResolvedValue(undefined);
  });

  it("calls the SDK's renameSession with the raw title", async () => {
    // Raw, not slugified: the title is the surface a human reads. The
    // slugified form belongs to the registry `--name`, which is a different
    // surface and is fixed at spawn.
    const { service } = makeService();

    await expect(
      service.retitle(SESSION_ID, 'Refactor the billing module'),
    ).resolves.toBe(true);

    expect(sdkModuleMock.renameSession).toHaveBeenCalledWith(
      SESSION_ID,
      'Refactor the billing module',
      { dir: 'D:/ws/from-metadata' },
    );
  });

  it("pins the project directory to the session's own workspace, not the active one", async () => {
    const { service } = makeService({ metadataWorkspaceId: 'D:/ws/other' });

    await service.retitle(SESSION_ID, 'Title');

    expect(sdkModuleMock.renameSession).toHaveBeenCalledWith(
      SESSION_ID,
      'Title',
      { dir: 'D:/ws/other' },
    );
  });

  it('omits `dir` for a session with no metadata, never using the active folder', async () => {
    const { service } = makeService({ metadataWorkspaceId: null });

    await service.retitle(SESSION_ID, 'Title');

    expect(sdkModuleMock.renameSession).toHaveBeenCalledWith(
      SESSION_ID,
      'Title',
      undefined,
    );
  });

  it('logs and swallows a rejected renameSession — a rename must never fail in the UI', async () => {
    sdkModuleMock.renameSession = jest
      .fn()
      .mockRejectedValue(new Error('session file is locked'));
    const { service, logger } = makeService();

    await expect(service.retitle(SESSION_ID, 'Title')).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not update the session title'),
      expect.objectContaining({ reason: 'session file is locked' }),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('narrows a non-Error rejection instead of assuming `.message`', async () => {
    sdkModuleMock.renameSession = jest.fn().mockRejectedValue('plain string');
    const { service, logger } = makeService();

    await expect(service.retitle(SESSION_ID, 'Title')).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'plain string' }),
    );
  });

  it('reports a missing SDK export rather than throwing', async () => {
    sdkModuleMock.renameSession = undefined;
    const { service, logger } = makeService();

    await expect(service.retitle(SESSION_ID, 'Title')).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("'renameSession' is not a function"),
      expect.objectContaining({ sessionId: SESSION_ID }),
    );
  });
});
