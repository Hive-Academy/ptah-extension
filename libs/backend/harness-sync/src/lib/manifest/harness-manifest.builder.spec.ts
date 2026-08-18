/**
 * HarnessManifestBuilder unit tests — desired-state assembly, collisions and
 * precedence (edge case E20 plus required-coverage items 14/15's slug-level
 * half; the "reaches the target" half of those two lives in the reconciler
 * specs, since it needs a real copy engine).
 *
 * Source-under-test: `HarnessManifestBuilder`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { HarnessManifestBuilder } from './harness-manifest.builder';
import type { HarnessSourceState } from '../sources/harness-source.port';
import { hashDirSync } from '../hash/content-hash';

function writeSkill(
  skillsRoot: string,
  slug: string,
  body = 'skill body',
): void {
  const dir = join(skillsRoot, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${slug}\n---\n${body}\n`,
    'utf-8',
  );
}

function emptyLayout(root: string): HarnessSourceState['layout'] {
  return {
    skillsRoot: join(root, 'skills'),
    commandsRoot: join(root, 'commands'),
    agentsRoot: join(root, 'agents'),
  };
}

describe('HarnessManifestBuilder', () => {
  let root: string;
  let builder: HarnessManifestBuilder;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'harness-sync-builder-'));
    builder = new HarnessManifestBuilder();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('[E20] a slug that only differs by case across two overlay plugins is reported as a case-collision, and the earlier plugin wins the slot', () => {
    // Two directories differing only by case CANNOT coexist under the same
    // parent on default (case-insensitive) NTFS, so the collision is produced
    // across two DIFFERENT plugin directories instead — a realistic shape,
    // since two independently-authored plugins are exactly how this happens.
    const pluginA = join(root, 'plugins', 'ptah-harness-a');
    const pluginB = join(root, 'plugins', 'ptah-harness-b');
    writeSkill(join(pluginA, 'skills'), 'Run-Tests');
    writeSkill(join(pluginB, 'skills'), 'run-tests');

    const state: HarnessSourceState = {
      layout: emptyLayout(root),
      overlayPluginPaths: [pluginA, pluginB],
      disabledSkillIds: [],
      disabledPluginIds: [],
    };

    const desired = builder.build(state);

    expect(desired.skills).toHaveLength(1);
    expect(desired.skills[0]?.slug).toBe('Run-Tests');

    const collision = desired.collisions.find(
      (c) => c.reason === 'case-collision',
    );
    expect(collision).toMatchObject({
      slug: 'run-tests',
      reason: 'case-collision',
      shadowedPluginId: 'ptah-harness-b',
    });
  });

  it('[E20] a slug that is a reserved Windows device name (with an extension-like suffix) is rejected and nothing is written for it', () => {
    // `com1.backup` is creatable on this filesystem (verified empirically) —
    // its STEM is `com1`, which `isReservedSlug` rejects regardless of suffix.
    writeSkill(join(root, 'skills'), 'com1.backup');
    writeSkill(join(root, 'skills'), 'legit-skill');

    const state: HarnessSourceState = {
      layout: emptyLayout(root),
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
    };

    const desired = builder.build(state);

    expect(desired.skills.map((s) => s.slug)).toEqual(['legit-skill']);
    expect(desired.collisions).toContainEqual(
      expect.objectContaining({ slug: 'com1.backup', reason: 'reserved-name' }),
    );
  });

  it('[14] a skill in disabledSkillIds never enters the desired state', () => {
    writeSkill(join(root, 'skills'), 'foo');
    writeSkill(join(root, 'skills'), 'bar');

    const state: HarnessSourceState = {
      layout: emptyLayout(root),
      overlayPluginPaths: [],
      disabledSkillIds: ['bar'],
      disabledPluginIds: [],
    };

    const desired = builder.build(state);

    expect(desired.skills.map((s) => s.slug)).toEqual(['foo']);
  });

  it('[14] a disabled plugin id contributes no overlay skills at all', () => {
    const pluginPath = join(root, 'plugins', 'ptah-harness-extra');
    writeSkill(join(pluginPath, 'skills'), 'only-in-plugin');

    const state: HarnessSourceState = {
      layout: emptyLayout(root),
      overlayPluginPaths: [pluginPath],
      disabledSkillIds: [],
      disabledPluginIds: ['ptah-harness-extra'],
    };

    const desired = builder.build(state);

    expect(desired.skills).toHaveLength(0);
  });

  it('[15] a plugin skill whose slug already exists in the user layer is silently skipped, not reported as a collision (expected mirror case)', () => {
    writeSkill(join(root, 'skills'), 'shared-skill', 'USER CONTENT');
    const pluginPath = join(root, 'plugins', 'ptah-harness-mirror');
    writeSkill(join(pluginPath, 'skills'), 'shared-skill', 'PLUGIN CONTENT');

    const state: HarnessSourceState = {
      layout: emptyLayout(root),
      overlayPluginPaths: [pluginPath],
      disabledSkillIds: [],
      disabledPluginIds: [],
    };

    const desired = builder.build(state);

    expect(desired.skills).toHaveLength(1);
    expect(desired.collisions).toHaveLength(0);
    // The user layer wins the claim, so its content hash (not the plugin's) is
    // what the target will end up copying.
    expect(desired.skills[0]?.contentHash).toBe(
      hashDirSync(join(root, 'skills', 'shared-skill')),
    );
  });

  it('[E2] resolves to sources-missing with zero artifacts when the source roots do not exist', () => {
    const state: HarnessSourceState = {
      layout: emptyLayout(join(root, 'never-created')),
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
    };

    const desired = builder.build(state);

    expect(desired.skills).toHaveLength(0);
    expect(desired.commands).toHaveLength(0);
    expect(desired.sources).toBe('sources-missing');
  });

  it('[E3] resolves to pending-download instead of sources-missing when downloadPending is set', () => {
    const state: HarnessSourceState = {
      layout: emptyLayout(join(root, 'never-created')),
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
    };

    const desired = builder.build(state, { downloadPending: true });

    expect(desired.sources).toBe('pending-download');
  });
});
