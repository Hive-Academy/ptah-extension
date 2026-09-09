import * as os from 'node:os';
import * as path from 'node:path';
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

export interface ElectronEditorShellApi {
  openExternal(url: string): Promise<void>;
}

export interface ElectronEditorLauncherOptions extends EditorDetectionOptions {
  readonly definitions?: readonly EditorDetectionDefinition[];
  readonly homeDir?: string;
}

function definitionsFor(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  homeDir: string,
): readonly EditorDetectionDefinition[] {
  const localAppData =
    env['LOCALAPPDATA'] ?? path.join(homeDir, 'AppData', 'Local');
  const executableCandidates = (
    id: 'vscode' | 'cursor' | 'antigravity' | 'zed',
  ): readonly string[] =>
    editorExecutableCandidates(id, platform, env, homeDir);
  const appMarker = (id: 'vscode' | 'cursor'): string[] => {
    if (platform === 'darwin')
      return [
        `/Applications/${id === 'vscode' ? 'Visual Studio Code' : 'Cursor'}.app`,
      ];
    if (platform === 'win32') {
      const name = id === 'vscode' ? 'Microsoft VS Code' : 'Cursor';
      return [path.join(localAppData, 'Programs', name)];
    }
    return [];
  };
  const definition = (
    id: 'vscode' | 'cursor' | 'antigravity' | 'zed',
    displayName: string,
    command: string,
  ): EditorDetectionDefinition => ({
    id,
    displayName,
    command,
    installCandidates: [
      ...executableCandidates(id).map((candidatePath) => ({
        kind: 'executable' as const,
        path: candidatePath,
      })),
      ...(id === 'vscode' || id === 'cursor'
          ? appMarker(id).map((candidatePath) => ({
            kind: 'application-marker' as const,
            path: candidatePath,
            deepLinkScheme:
              id === 'vscode' ? ('vscode' as const) : ('cursor' as const),
          }))
        : []),
    ],
  });
  return [
    definition('vscode', 'VS Code', 'code'),
    definition('cursor', 'Cursor', 'cursor'),
    definition('antigravity', 'Antigravity', 'antigravity'),
    definition('zed', 'Zed', 'zed'),
  ];
}

function deepLink(
  scheme: 'vscode' | 'cursor',
  resourcePath: string,
  line?: number,
): string {
  const slashPath = resourcePath.replace(/\\/g, '/');
  const encodedPath = encodeURI(slashPath)
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F');
  return `${scheme}://file/${encodedPath}${line === undefined ? '' : `:${line}`}`;
}

export class ElectronEditorLauncher implements IEditorLauncher {
  constructor(
    private readonly spawner: IProcessSpawner,
    private readonly shell: ElectronEditorShellApi,
    private readonly options: ElectronEditorLauncherOptions = {},
  ) {}

  detect(): Promise<EditorTarget[]> {
    const platform = this.options.platform ?? process.platform;
    const env = this.options.env ?? process.env;
    return detectEditorTargets(
      this.options.definitions ??
        definitionsFor(platform, env, this.options.homeDir ?? os.homedir()),
      this.options,
    );
  }

  async openFile(
    target: EditorTarget,
    filePath: string,
    line?: number,
  ): Promise<void> {
    const launch = prepareEditorFileLaunch(target, filePath, line);
    if (target.deepLinkScheme) {
      await this.shell.openExternal(
        deepLink(target.deepLinkScheme, launch.normalizedPath, line),
      );
      return;
    }
    await spawnEditorProcess(this.spawner, target, launch.args, launch.cwd);
  }

  async openWorkspace(
    target: EditorTarget,
    workspaceRoot: string,
  ): Promise<void> {
    const launch = prepareEditorWorkspaceLaunch(workspaceRoot);
    if (target.deepLinkScheme) {
      await this.shell.openExternal(
        deepLink(target.deepLinkScheme, launch.normalizedRoot),
      );
      return;
    }
    await spawnEditorProcess(this.spawner, target, launch.args, launch.cwd);
  }
}
