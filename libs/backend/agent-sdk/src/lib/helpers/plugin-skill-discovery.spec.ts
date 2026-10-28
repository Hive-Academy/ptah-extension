/**
 * discoverPluginSkills reports both ids of a skill: `skillId` is the
 * directory name the plugin config's `disabledSkillIds` uses, `skillName` is
 * the frontmatter name shown to the model. The two can differ.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { discoverPluginSkills } from './plugin-skill-discovery';

function writeSkill(
  pluginDir: string,
  directory: string,
  frontmatter: string,
): void {
  const dir = path.join(pluginDir, 'skills', directory);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\n${frontmatter}\n---\n\nBody.\n`,
  );
}

describe('discoverPluginSkills', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-skill-discovery-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('sets skillId to the directory name and skillName to the frontmatter name', () => {
    const plugin = path.join(root, 'acme');
    writeSkill(
      plugin,
      'code-review',
      'name: Acme Code Review\ndescription: Reviews code',
    );

    expect(discoverPluginSkills([plugin])).toEqual([
      {
        pluginId: 'acme',
        skillId: 'code-review',
        skillName: 'Acme Code Review',
        description: 'Reviews code',
      },
    ]);
  });

  it('keeps skillId equal to skillName when the frontmatter name matches the directory', () => {
    const plugin = path.join(root, 'ptah-core');
    writeSkill(plugin, 'orchestration', 'name: orchestration');

    expect(discoverPluginSkills([plugin])).toEqual([
      {
        pluginId: 'ptah-core',
        skillId: 'orchestration',
        skillName: 'orchestration',
        description: 'orchestration',
      },
    ]);
  });
});
