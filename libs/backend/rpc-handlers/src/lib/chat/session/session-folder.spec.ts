import 'reflect-metadata';
import { promises as fs } from 'node:fs';
import { chmod, mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  resolveSessionFolder,
  validateSessionPolicyRoot,
} from './session-folder';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
let base: string;
let project: string;
let child: string;
let outside: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'ptah-folder-'));
  project = join(base, 'project');
  child = join(project, 'child');
  outside = join(base, 'outside');
  await Promise.all([mkdir(child, { recursive: true }), mkdir(outside)]);
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

function provider(folders = [project]) {
  return createMockWorkspaceProvider({
    folders,
  }) as unknown as IWorkspaceProvider;
}
function platformInfo() {
  return {
    type: 'cli',
    extensionPath: join(base, 'app'),
    globalStoragePath: join(base, 'storage'),
    workspaceStoragePath: join(base, 'workspace-storage'),
  } as never;
}
function resolve(
  metadata: { workspaceId: string; workingDirectory?: string } | null,
  folders = [project],
) {
  return resolveSessionFolder({
    sessionId: SESSION_ID,
    metadataStore: { get: jest.fn().mockResolvedValue(metadata) },
    workspaceProvider: provider(folders),
    platformInfo: platformInfo(),
    logger: createMockLogger() as unknown as Logger,
  });
}

describe('resolveSessionFolder', () => {
  it('uses the saved child cwd', async () => {
    await expect(
      resolve({ workspaceId: project, workingDirectory: child }),
    ).resolves.toBe(child);
  });
  it('refuses a removed distinct cwd without falling back', async () => {
    await rm(child, { recursive: true });
    await expect(
      resolve({ workspaceId: project, workingDirectory: child }),
    ).rejects.toMatchObject({ errorCode: 'SESSION_FOLDER_UNAVAILABLE' });
  });
  it('accepts missing and identical cwd legacy metadata', async () => {
    await expect(resolve({ workspaceId: project })).resolves.toBe(project);
    await expect(
      resolve({ workspaceId: project, workingDirectory: project }),
    ).resolves.toBe(project);
  });
  it('rejects an unknown session id', async () => {
    await expect(resolve(null)).rejects.toMatchObject({
      errorCode: 'SESSION_NOT_FOUND',
    });
  });
  it('rejects an unauthorized child despite an authorized parent', async () => {
    await expect(
      resolve({ workspaceId: project, workingDirectory: outside }),
    ).rejects.toMatchObject({ errorCode: 'SESSION_FOLDER_UNAVAILABLE' });
  });
  it('rejects symlink escape from a registered folder', async () => {
    const link = join(project, 'escape');
    await symlink(outside, link, 'dir');
    await expect(
      resolve({ workspaceId: project, workingDirectory: link }),
    ).rejects.toMatchObject({ errorCode: 'SESSION_FOLDER_UNAVAILABLE' });
  });
  it('resolves physical aliases for identity checks', async () => {
    const alias = join(project, 'alias');
    await symlink(child, alias, 'dir');
    await expect(
      validateSessionPolicyRoot(alias, provider(), platformInfo()),
    ).resolves.toBe(child);
  });
  it('accepts a readable Windows directory mode without Unix execute bits', async () => {
    const stat = jest.spyOn(fs, 'stat').mockResolvedValueOnce({
      isDirectory: () => true,
      mode: 0o40666,
    } as never);
    try {
      await expect(
        validateSessionPolicyRoot(child, provider(), platformInfo()),
      ).resolves.toBe(child);
    } finally {
      stat.mockRestore();
    }
  });
  it('rejects an uncheckable path', async () => {
    await expect(
      resolve({
        workspaceId: project,
        workingDirectory: join(project, 'missing'),
      }),
    ).rejects.toMatchObject({ errorCode: 'SESSION_FOLDER_UNAVAILABLE' });
  });
  it('rejects a physically unreadable directory despite an authorized parent', async () => {
    await chmod(child, 0o000);
    try {
      await expect(
        resolve({ workspaceId: project, workingDirectory: child }),
      ).rejects.toMatchObject({ errorCode: 'SESSION_FOLDER_UNAVAILABLE' });
    } finally {
      await chmod(child, 0o700);
    }
  });
  it('rejects a dangling symlink filesystem error', async () => {
    const broken = join(project, 'broken');
    await symlink(join(base, 'missing'), broken, 'dir');
    await expect(
      resolve({ workspaceId: project, workingDirectory: broken }),
    ).rejects.toMatchObject({ errorCode: 'SESSION_FOLDER_UNAVAILABLE' });
  });
  it('rejects malformed root values', async () => {
    await expect(
      validateSessionPolicyRoot(
        [] as unknown as string,
        provider(),
        platformInfo(),
      ),
    ).rejects.toMatchObject({ errorCode: 'SESSION_FOLDER_UNAVAILABLE' });
  });
});
