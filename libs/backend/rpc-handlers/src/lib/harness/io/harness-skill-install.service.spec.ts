/**
 * Behaviour spec for {@link HarnessSkillInstallService}.
 *
 * Verifies the contract `harness:apply` depends on:
 *   - only skills.sh refs are installed; local selections are left alone
 *   - a ref without an installSource becomes a warning, never a silent no-op
 *   - project scope without a workspace root warns instead of shelling out
 *   - CLI failures and spawn errors both surface as warnings, never throws
 */

import 'reflect-metadata';

jest.mock('../../utils/skills-sh-cli', () => ({
  installSkillViaCli: jest.fn(),
}));
jest.mock('fs/promises', () => ({ access: jest.fn() }));
jest.mock('os', () => ({ homedir: jest.fn(() => '/home/user') }));

import { installSkillViaCli } from '../../utils/skills-sh-cli';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { HarnessSkillRef } from '@ptah-extension/shared';
import { HarnessSkillInstallService } from './harness-skill-install.service';

const installMock = installSkillViaCli as jest.MockedFunction<
  typeof installSkillViaCli
>;
const accessMock = fs.access as jest.MockedFunction<typeof fs.access>;

function makeService(): {
  service: HarnessSkillInstallService;
  logger: { error: jest.Mock };
} {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  return {
    service: new HarnessSkillInstallService(logger as unknown as never),
    logger,
  };
}

const marketplaceRef = (
  overrides: Partial<HarnessSkillRef> = {},
): HarnessSkillRef => ({
  skillId: 'frontend-design',
  source: 'skills.sh',
  installSource: 'anthropics/skills',
  ...overrides,
});

beforeEach(() => {
  installMock.mockReset().mockResolvedValue({ success: true });
  accessMock.mockReset().mockResolvedValue(undefined);
});

describe('HarnessSkillInstallService', () => {
  it('returns an empty outcome when there are no refs', async () => {
    const { service } = makeService();

    await expect(service.installSkills(undefined, '/ws')).resolves.toEqual({
      installedPaths: [],
      warnings: [],
    });
    expect(installMock).not.toHaveBeenCalled();
  });

  it('ignores local selections — they are junctioned, not installed', async () => {
    const { service } = makeService();

    const outcome = await service.installSkills(
      [{ skillId: 'tribunal', source: 'local' }],
      '/ws',
    );

    expect(installMock).not.toHaveBeenCalled();
    expect(outcome).toEqual({ installedPaths: [], warnings: [] });
  });

  it('installs a skills.sh ref at project scope and reports the skill directory', async () => {
    const { service } = makeService();

    const outcome = await service.installSkills([marketplaceRef()], '/ws');

    expect(installMock).toHaveBeenCalledWith(
      {
        source: 'anthropics/skills',
        skillId: 'frontend-design',
        scope: 'project',
      },
      '/ws',
    );
    expect(outcome.installedPaths).toEqual([
      path.join('/ws', '.claude', 'skills', 'frontend-design'),
    ]);
    expect(outcome.warnings).toEqual([]);
  });

  it('honours an explicit global scope', async () => {
    const { service } = makeService();

    await service.installSkills([marketplaceRef({ scope: 'global' })], '/ws');

    expect(installMock).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'global' }),
      '/ws',
    );
  });

  it('falls back to the skills root when the installed directory is not found', async () => {
    const { service } = makeService();
    accessMock.mockRejectedValue(new Error('ENOENT'));

    const outcome = await service.installSkills([marketplaceRef()], '/ws');

    expect(outcome.installedPaths).toEqual([
      path.join('/ws', '.claude', 'skills'),
    ]);
  });

  it('warns instead of installing when a skills.sh ref has no installSource', async () => {
    const { service } = makeService();

    const outcome = await service.installSkills(
      [marketplaceRef({ installSource: undefined })],
      '/ws',
    );

    expect(installMock).not.toHaveBeenCalled();
    expect(outcome.warnings).toHaveLength(1);
    expect(outcome.warnings[0]).toContain('frontend-design');
    expect(outcome.warnings[0]).toContain('installSource');
  });

  it('warns when project scope is requested without a workspace root', async () => {
    const { service } = makeService();

    const outcome = await service.installSkills([marketplaceRef()], undefined);

    expect(installMock).not.toHaveBeenCalled();
    expect(outcome.warnings).toEqual([
      'No workspace folder open. Skill "frontend-design" was not installed.',
    ]);
  });

  it('turns a CLI failure into a warning', async () => {
    const { service } = makeService();
    installMock.mockResolvedValue({ success: false, error: 'network down' });

    const outcome = await service.installSkills([marketplaceRef()], '/ws');

    expect(outcome.installedPaths).toEqual([]);
    expect(outcome.warnings).toEqual([
      'Failed to install skill "frontend-design" from anthropics/skills: network down',
    ]);
  });

  it('logs and warns when the CLI cannot be spawned, without throwing', async () => {
    const { service, logger } = makeService();
    installMock.mockRejectedValue(new Error('spawn ENOENT'));

    const outcome = await service.installSkills([marketplaceRef()], '/ws');

    expect(outcome.warnings).toEqual([
      'Failed to install skill "frontend-design": spawn ENOENT',
    ]);
    expect(logger.error).toHaveBeenCalled();
  });

  it('continues past a failed ref and dedupes reported paths', async () => {
    const { service } = makeService();
    installMock
      .mockResolvedValueOnce({ success: false, error: 'boom' })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true });
    accessMock.mockRejectedValue(new Error('ENOENT'));

    const outcome = await service.installSkills(
      [
        marketplaceRef({ skillId: 'a' }),
        marketplaceRef({ skillId: 'b' }),
        marketplaceRef({ skillId: 'c' }),
      ],
      '/ws',
    );

    expect(installMock).toHaveBeenCalledTimes(3);
    expect(outcome.installedPaths).toEqual([
      path.join('/ws', '.claude', 'skills'),
    ]);
    expect(outcome.warnings).toHaveLength(1);
  });
});
