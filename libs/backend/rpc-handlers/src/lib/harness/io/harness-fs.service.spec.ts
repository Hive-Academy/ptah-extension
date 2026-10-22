import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { UserLayerMirrorService } from '@ptah-extension/agent-generation';
import { HarnessFsService } from './harness-fs.service';

describe('HarnessFsService mirror root', () => {
  function makeService(workspace: IWorkspaceProvider | null) {
    const mirror: jest.Mocked<Pick<UserLayerMirrorService, 'mirrorAll'>> = {
      mirrorAll: jest.fn().mockResolvedValue(undefined),
    };
    const service = new HarnessFsService(
      null as never,
      null as never,
      mirror as never,
      workspace,
    );
    return { service, mirror };
  }

  it('delivers the default root to the user-layer mirror', async () => {
    const { service, mirror } = makeService(null);

    await service['mirrorHarnessPlugin']('/plugin');

    expect(mirror.mirrorAll).toHaveBeenCalledWith({
      pluginPaths: [],
      harnessPluginRoots: ['/plugin'],
      synthesizedSkillsRoot: path.join(os.homedir(), '.ptah', 'skills'),
    });
  });

  it('delivers a configured alternate root to the user-layer mirror', async () => {
    const alternateRoot = path.join(os.tmpdir(), 'alternate-ptah-skills');
    const workspace = {
      getConfiguration: <T>(_section: string, key: string): T => {
        expect(key).toBe('skillSynthesis.skillsRoot');
        return alternateRoot as T;
      },
    } as IWorkspaceProvider;
    const { service, mirror } = makeService(workspace);

    await service['mirrorHarnessPlugin']('/plugin');

    expect(mirror.mirrorAll).toHaveBeenCalledWith({
      pluginPaths: [],
      harnessPluginRoots: ['/plugin'],
      synthesizedSkillsRoot: alternateRoot,
    });
  });
});
