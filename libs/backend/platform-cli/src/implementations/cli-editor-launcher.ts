import * as os from 'node:os';
import {
  detectEditorTargets,
  editorExecutableCandidates,
  prepareEditorFileLaunch,
  prepareEditorWorkspaceLaunch,
  spawnEditorProcess,
  type EditorDetectionDefinition,
  type EditorDetectionOptions,
  type EditorTarget,
  type IEditorLauncher,
  type IProcessSpawner,
} from '@ptah-extension/platform-core';

export interface CliEditorLauncherOptions extends EditorDetectionOptions {
  readonly definitions?: readonly EditorDetectionDefinition[];
  readonly homeDir?: string;
}

function installCandidates(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  homeDir: string,
): readonly EditorDetectionDefinition[] {
  return [
    {
      id: 'vscode',
      displayName: 'VS Code',
      command: 'code',
      installCandidates: editorExecutableCandidates(
        'vscode',
        platform,
        env,
        homeDir,
      ).map((candidatePath) => ({ path: candidatePath })),
    },
    {
      id: 'cursor',
      displayName: 'Cursor',
      command: 'cursor',
      installCandidates: editorExecutableCandidates(
        'cursor',
        platform,
        env,
        homeDir,
      ).map((candidatePath) => ({ path: candidatePath })),
    },
    {
      id: 'antigravity',
      displayName: 'Antigravity',
      command: 'antigravity',
      installCandidates: editorExecutableCandidates(
        'antigravity',
        platform,
        env,
        homeDir,
      ).map((candidatePath) => ({ path: candidatePath })),
    },
    {
      id: 'zed',
      displayName: 'Zed',
      command: 'zed',
      installCandidates: editorExecutableCandidates(
        'zed',
        platform,
        env,
        homeDir,
      ).map((candidatePath) => ({ path: candidatePath })),
    },
  ];
}

export class CliEditorLauncher implements IEditorLauncher {
  constructor(
    private readonly spawner: IProcessSpawner,
    private readonly options: CliEditorLauncherOptions = {},
  ) {}

  detect(): Promise<EditorTarget[]> {
    const platform = this.options.platform ?? process.platform;
    const env = this.options.env ?? process.env;
    const definitions =
      this.options.definitions ??
      installCandidates(platform, env, this.options.homeDir ?? os.homedir());
    return detectEditorTargets(definitions, this.options);
  }

  async openFile(
    target: EditorTarget,
    filePath: string,
    line?: number,
  ): Promise<void> {
    const launch = prepareEditorFileLaunch(target, filePath, line);
    await spawnEditorProcess(this.spawner, target, launch.args, launch.cwd);
  }

  async openWorkspace(
    target: EditorTarget,
    workspaceRoot: string,
  ): Promise<void> {
    const launch = prepareEditorWorkspaceLaunch(workspaceRoot);
    await spawnEditorProcess(this.spawner, target, launch.args, launch.cwd);
  }
}
