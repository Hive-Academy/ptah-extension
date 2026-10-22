import * as os from 'node:os';
import * as path from 'node:path';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  resolveSkillsRoot,
  SKILLS_ROOT_KEY,
  SKILLS_ROOT_SECTION,
} from './skills-root';

describe('resolveSkillsRoot', () => {
  it('uses the shipped skills root by default', () => {
    expect(resolveSkillsRoot(null)).toBe(
      path.join(os.homedir(), '.ptah', 'skills'),
    );
  });

  it('reads the configured alternate root from the workspace', () => {
    const configuredRoot = path.join(os.tmpdir(), 'alternate-ptah-skills');
    const workspace = {
      getConfiguration: <T>(section: string, key: string): T => {
        expect(section).toBe(SKILLS_ROOT_SECTION);
        expect(key).toBe(SKILLS_ROOT_KEY);
        return `  ${configuredRoot}  ` as T;
      },
    } as IWorkspaceProvider;

    expect(resolveSkillsRoot(workspace)).toBe(configuredRoot);
  });
});
