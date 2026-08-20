/**
 * Behaviour spec for {@link HarnessSkillInstallService}.
 *
 * Verifies the contract `harness:apply` depends on:
 *   - only skills.sh refs are installed; local selections are left alone
 *   - a ref without an installSource becomes a warning, never a silent no-op
 *   - legacy `.claude/skills` installs are adopted BEFORE anything is written,
 *     so a re-apply updates the source root instead of racing an unowned copy
 *   - every slug a whole-repo install wrote is reported at its source-root path
 *   - install failures and thrown errors both surface as warnings, never throws
 *
 * `SkillsShSourceRootService` is stubbed: this service's job is which calls it
 * makes and what it reports, and the real one writes to `~/.ptah/plugins`.
 */

import 'reflect-metadata';

import * as path from 'path';
import type { HarnessSkillRef } from '@ptah-extension/shared';
import type { SkillsShSourceRootService } from '../../skills-sh/skills-sh-source-root.service';
import { HarnessSkillInstallService } from './harness-skill-install.service';

/** Stands in for `~/.ptah/plugins`; nothing here touches the filesystem. */
const PLUGINS_BASE = path.join('/home', 'user', '.ptah', 'plugins');
const ROOT_ID = 'ptah-skillssh-anthropics-skills';

/** Absolute path a slug is expected to be reported at. */
const rootPath = (slug: string, rootId = ROOT_ID): string =>
  path.join(PLUGINS_BASE, rootId, 'skills', slug);

interface Harness {
  service: HarnessSkillInstallService;
  logger: { warn: jest.Mock; error: jest.Mock };
  sourceRoots: { adoptLegacyInstalls: jest.Mock; install: jest.Mock };
}

function makeService(): Harness {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  class SourceRootsStub {
    readonly adoptLegacyInstalls = jest.fn().mockResolvedValue(0);
    readonly install = jest
      .fn()
      .mockResolvedValue({ success: true, rootId: ROOT_ID, slugs: [] });

    get pluginsBasePath(): string {
      return PLUGINS_BASE;
    }
  }

  const sourceRoots = new SourceRootsStub();

  return {
    service: new HarnessSkillInstallService(
      logger as unknown as never,
      sourceRoots as unknown as SkillsShSourceRootService,
    ),
    logger,
    sourceRoots,
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

describe('HarnessSkillInstallService', () => {
  it('returns an empty outcome when there are no refs', async () => {
    const { service, sourceRoots } = makeService();

    await expect(service.installSkills(undefined, '/ws')).resolves.toEqual({
      installedPaths: [],
      warnings: [],
    });
    expect(sourceRoots.install).not.toHaveBeenCalled();
    expect(sourceRoots.adoptLegacyInstalls).not.toHaveBeenCalled();
  });

  it('ignores local selections — they are propagated, not installed', async () => {
    const { service, sourceRoots } = makeService();

    const outcome = await service.installSkills(
      [{ skillId: 'tribunal', source: 'local' }],
      '/ws',
    );

    expect(sourceRoots.install).not.toHaveBeenCalled();
    expect(outcome).toEqual({ installedPaths: [], warnings: [] });
  });

  it('adopts legacy installs before installing', async () => {
    const { service, sourceRoots } = makeService();
    sourceRoots.install.mockResolvedValue({
      success: true,
      rootId: ROOT_ID,
      slugs: ['frontend-design'],
    });

    await service.installSkills([marketplaceRef()], '/ws');

    expect(sourceRoots.adoptLegacyInstalls).toHaveBeenCalledWith('/ws');
    expect(
      sourceRoots.adoptLegacyInstalls.mock.invocationCallOrder[0],
    ).toBeLessThan(sourceRoots.install.mock.invocationCallOrder[0]);
    expect(sourceRoots.install).toHaveBeenCalledWith({
      source: 'anthropics/skills',
      skillId: 'frontend-design',
    });
  });

  it('reports every slug a whole-repo install wrote', async () => {
    const { service, sourceRoots } = makeService();
    sourceRoots.install.mockResolvedValue({
      success: true,
      rootId: ROOT_ID,
      slugs: ['frontend-design', 'webapp-testing', 'canvas-design'],
    });

    const outcome = await service.installSkills([marketplaceRef()], '/ws');

    expect(outcome.installedPaths).toEqual([
      rootPath('frontend-design'),
      rootPath('webapp-testing'),
      rootPath('canvas-design'),
    ]);
    expect(outcome.warnings).toEqual([]);
  });

  it('warns instead of installing when a skills.sh ref has no installSource', async () => {
    const { service, sourceRoots } = makeService();

    const outcome = await service.installSkills(
      [marketplaceRef({ installSource: undefined })],
      '/ws',
    );

    expect(sourceRoots.install).not.toHaveBeenCalled();
    expect(outcome.warnings).toHaveLength(1);
    expect(outcome.warnings[0]).toContain('frontend-design');
    expect(outcome.warnings[0]).toContain('installSource');
  });

  it('turns an install failure into a warning', async () => {
    const { service, sourceRoots } = makeService();
    sourceRoots.install.mockResolvedValue({
      success: false,
      error: 'network down',
    });

    const outcome = await service.installSkills([marketplaceRef()], '/ws');

    expect(outcome.installedPaths).toEqual([]);
    expect(outcome.warnings).toEqual([
      'Failed to install skill "frontend-design" from anthropics/skills: network down',
    ]);
  });

  it('logs and warns when the install throws, without throwing itself', async () => {
    const { service, logger, sourceRoots } = makeService();
    sourceRoots.install.mockRejectedValue(new Error('spawn ENOENT'));

    const outcome = await service.installSkills([marketplaceRef()], '/ws');

    expect(outcome.warnings).toEqual([
      'Failed to install skill "frontend-design": spawn ENOENT',
    ]);
    expect(logger.error).toHaveBeenCalled();
  });

  it('continues past a failed ref and dedupes reported paths', async () => {
    const { service, sourceRoots } = makeService();
    // Two refs from the same repo overlap: the whole-repo install reports both
    // slugs twice, and the reported set must still name each path once.
    sourceRoots.install
      .mockResolvedValueOnce({ success: false, error: 'boom' })
      .mockResolvedValueOnce({
        success: true,
        rootId: ROOT_ID,
        slugs: ['b', 'c'],
      })
      .mockResolvedValueOnce({
        success: true,
        rootId: ROOT_ID,
        slugs: ['b', 'c'],
      });

    const outcome = await service.installSkills(
      [
        marketplaceRef({ skillId: 'a' }),
        marketplaceRef({ skillId: 'b' }),
        marketplaceRef({ skillId: 'c' }),
      ],
      '/ws',
    );

    expect(sourceRoots.install).toHaveBeenCalledTimes(3);
    expect(outcome.installedPaths).toEqual([rootPath('b'), rootPath('c')]);
    expect(outcome.warnings).toHaveLength(1);
  });
});
