import 'reflect-metadata';

jest.mock('os', () => {
  const actual = jest.requireActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: jest.fn(actual.homedir),
  };
});

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { HarnessConfig } from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';

import { HarnessPromptBuilderService } from './harness-prompt-builder.service';
import { HarnessConfigStore } from './harness-config-store.service';

function harnessConfig(): HarnessConfig {
  return {
    name: 'test-harness',
    persona: { label: '', description: '', goals: [] },
    agents: {
      enabledAgents: {
        reviewer: {
          enabled: true,
          modelTier: 'sonnet',
          autoApprove: false,
        },
      },
    },
    skills: { selectedSkills: [], createdSkills: [] },
    prompt: { systemPrompt: '', enhancedSections: {} },
    mcp: { servers: [], enabledTools: {} },
    claudeMd: {
      generateProjectClaudeMd: true,
      customSections: {},
      previewContent: '# New project instructions',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('HarnessConfigStore', () => {
  let root: string;
  let logger: ReturnType<typeof createMockLogger>;
  let service: HarnessConfigStore;

  beforeEach(async () => {
    root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'harness-config-store-'),
    );
    jest.mocked(os.homedir).mockReturnValue(root);
    logger = createMockLogger();
    service = new HarnessConfigStore(
      logger as unknown as Logger,
      new HarnessPromptBuilderService(),
    );
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  describe('writeClaudeMdToWorkspace', () => {
    it('writes CLAUDE.md without creating a backup when none exists', async () => {
      const result = await service.writeClaudeMdToWorkspace(
        root,
        harnessConfig(),
      );

      const claudeMdPath = path.join(root, '.claude', 'CLAUDE.md');
      expect(result).toEqual({ claudeMdPath });
      expect(result.backupPath).toBeUndefined();
      await expect(fs.readFile(claudeMdPath, 'utf-8')).resolves.toBe(
        '# New project instructions',
      );
      await expect(fs.access(`${claudeMdPath}.bak`)).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(logger.debug).toHaveBeenCalledWith(
        'Wrote CLAUDE.md to workspace',
        expect.objectContaining({ backedUp: false }),
      );
    });

    it('backs up an existing CLAUDE.md before writing the new content', async () => {
      const claudeDir = path.join(root, '.claude');
      const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');
      const backupPath = `${claudeMdPath}.bak`;
      await fs.mkdir(claudeDir, { recursive: true });
      await fs.writeFile(claudeMdPath, '# Old instructions', 'utf-8');

      const result = await service.writeClaudeMdToWorkspace(
        root,
        harnessConfig(),
      );

      expect(result).toEqual({ claudeMdPath, backupPath });
      await expect(fs.readFile(backupPath, 'utf-8')).resolves.toBe(
        '# Old instructions',
      );
      await expect(fs.readFile(claudeMdPath, 'utf-8')).resolves.toBe(
        '# New project instructions',
      );
      expect(logger.debug).toHaveBeenCalledWith(
        'Wrote CLAUDE.md to workspace',
        expect.objectContaining({ backedUp: true }),
      );
    });
  });

  describe('updatePtahSettings', () => {
    it('creates missing settings.json with the harness keys', async () => {
      await expect(
        service.updatePtahSettings(harnessConfig()),
      ).resolves.toBeUndefined();

      const raw = await fs.readFile(
        path.join(root, '.ptah', 'settings.json'),
        'utf-8',
      );
      const settings = JSON.parse(raw) as Record<string, unknown>;
      expect(settings['harness.agents']).toEqual({
        reviewer: {
          enabled: true,
          modelTier: 'sonnet',
          autoApprove: false,
        },
      });
      expect(settings['harness.lastApplied']).toBe('test-harness');
      expect(settings['harness.lastAppliedAt']).toEqual(expect.any(String));
    });

    it('does not overwrite malformed settings.json', async () => {
      const settingsDir = path.join(root, '.ptah');
      const settingsPath = path.join(settingsDir, 'settings.json');
      await fs.mkdir(settingsDir, { recursive: true });
      await fs.writeFile(settingsPath, '{ malformed', 'utf-8');

      await expect(
        service.updatePtahSettings(harnessConfig()),
      ).rejects.toBeInstanceOf(SyntaxError);
      await expect(fs.readFile(settingsPath, 'utf-8')).resolves.toBe(
        '{ malformed',
      );
    });
  });
});
