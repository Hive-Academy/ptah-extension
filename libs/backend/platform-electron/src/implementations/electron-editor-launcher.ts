import * as os from 'node:os';
import * as path from 'node:path';
import {
  detectEditorTargets,
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
  const programFiles = env['ProgramFiles'] ?? 'C:\\Program Files';
  const executableCandidates = (
    id: 'vscode' | 'cursor' | 'antigravity' | 'zed',
  ): string[] => {
    if (platform === 'darwin') {
      const appName = {
        vscode: 'Visual Studio Code',
        cursor: 'Cursor',
        antigravity: 'Antigravity',
        zed: 'Zed',
      }[id];
      const relative =
        id === 'zed'
          ? 'Contents/MacOS/cli'
          : `Contents/Resources/app/bin/${id === 'vscode' ? 'code' : id}`;
      return [`/Applications/${appName}.app/${relative}`];
    }
    if (platform === 'win32') {
      const appName = {
        vscode: 'Microsoft VS Code',
        cursor: 'Cursor',
        antigravity: 'Antigravity',
        zed: 'Zed',
      }[id];
      const exeName = id === 'vscode' ? 'Code' : appName;
      return [
        path.join(localAppData, 'Programs', appName, `${exeName}.exe`),
        path.join(programFiles, appName, `${exeName}.exe`),
      ];
    }
    const command = id === 'vscode' ? 'code' : id;
    return [
      path.join(homeDir, '.local', 'bin', command),
      `/usr/local/bin/${command}`,
      `/usr/bin/${command}`,
    ];
  };
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
        path: candidatePath,
      })),
      ...(id === 'vscode' || id === 'cursor'
        ? appMarker(id).map((candidatePath) => ({
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

function normalizeAbsolute(candidatePath: string, label: string): string {
  if (!path.isAbsolute(candidatePath))
    throw new Error(`${label} must be absolute`);
  return path.normalize(candidatePath);
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
    const normalizedPath = normalizeAbsolute(filePath, 'File path');
    if (line !== undefined && (!Number.isInteger(line) || line < 1))
      throw new Error('Line must be a positive integer');
    if (target.deepLinkScheme) {
      await this.shell.openExternal(
        deepLink(target.deepLinkScheme, normalizedPath, line),
      );
      return;
    }
    const location =
      line === undefined ? normalizedPath : `${normalizedPath}:${line}`;
    await this.spawn(
      target,
      target.id === 'zed' ? [location] : ['-g', location],
      path.dirname(normalizedPath),
    );
  }

  async openWorkspace(
    target: EditorTarget,
    workspaceRoot: string,
  ): Promise<void> {
    const normalizedRoot = normalizeAbsolute(workspaceRoot, 'Workspace root');
    if (target.deepLinkScheme) {
      await this.shell.openExternal(
        deepLink(target.deepLinkScheme, normalizedRoot),
      );
      return;
    }
    await this.spawn(target, [normalizedRoot], normalizedRoot);
  }

  private async spawn(
    target: EditorTarget,
    args: readonly string[],
    cwd: string,
  ): Promise<void> {
    if (!target.executablePath)
      throw new Error(`${target.displayName} has no launch route`);
    const handle = this.spawner.spawnProcess({
      command: normalizeAbsolute(target.executablePath, 'Editor executable'),
      args,
      cwd,
      env: process.env,
      detached: process.platform !== 'win32',
      needsConsole: false,
    });
    if ((await handle.whenSpawned) === null)
      throw new Error(`Failed to launch ${target.displayName}`);
  }
}
