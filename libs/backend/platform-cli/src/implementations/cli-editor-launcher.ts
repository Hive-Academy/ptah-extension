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

export interface CliEditorLauncherOptions extends EditorDetectionOptions {
  readonly definitions?: readonly EditorDetectionDefinition[];
  readonly homeDir?: string;
}

function installCandidates(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  homeDir: string,
): readonly EditorDetectionDefinition[] {
  const localAppData =
    env['LOCALAPPDATA'] ?? path.join(homeDir, 'AppData', 'Local');
  const programFiles = env['ProgramFiles'] ?? 'C:\\Program Files';
  const executable = (name: string): string[] => {
    if (platform === 'darwin') {
      const appNames: Record<string, string> = {
        code: 'Visual Studio Code',
        cursor: 'Cursor',
        antigravity: 'Antigravity',
        zed: 'Zed',
      };
      const appName = appNames[name];
      const relative =
        name === 'zed'
          ? 'Contents/MacOS/cli'
          : `Contents/Resources/app/bin/${name}`;
      return [`/Applications/${appName}.app/${relative}`];
    }
    if (platform === 'win32') {
      const names: Record<string, string> = {
        code: 'Microsoft VS Code',
        cursor: 'Cursor',
        antigravity: 'Antigravity',
        zed: 'Zed',
      };
      const appName = names[name];
      const exeName = name === 'code' ? 'Code' : appName;
      return [
        path.join(localAppData, 'Programs', appName, `${exeName}.exe`),
        path.join(programFiles, appName, `${exeName}.exe`),
      ];
    }
    return [
      path.join(homeDir, '.local', 'bin', name),
      `/usr/local/bin/${name}`,
      `/usr/bin/${name}`,
    ];
  };

  return [
    {
      id: 'vscode',
      displayName: 'VS Code',
      command: 'code',
      installCandidates: executable('code').map((candidatePath) => ({
        path: candidatePath,
      })),
    },
    {
      id: 'cursor',
      displayName: 'Cursor',
      command: 'cursor',
      installCandidates: executable('cursor').map((candidatePath) => ({
        path: candidatePath,
      })),
    },
    {
      id: 'antigravity',
      displayName: 'Antigravity',
      command: 'antigravity',
      installCandidates: executable('antigravity').map((candidatePath) => ({
        path: candidatePath,
      })),
    },
    {
      id: 'zed',
      displayName: 'Zed',
      command: 'zed',
      installCandidates: executable('zed').map((candidatePath) => ({
        path: candidatePath,
      })),
    },
  ];
}

function normalizeAbsolute(candidatePath: string, label: string): string {
  if (!path.isAbsolute(candidatePath))
    throw new Error(`${label} must be absolute`);
  return path.normalize(candidatePath);
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
    const normalizedPath = normalizeAbsolute(filePath, 'File path');
    if (line !== undefined && (!Number.isInteger(line) || line < 1))
      throw new Error('Line must be a positive integer');
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
    await this.spawn(target, [normalizedRoot], normalizedRoot);
  }

  private async spawn(
    target: EditorTarget,
    args: readonly string[],
    cwd: string,
  ): Promise<void> {
    if (!target.executablePath)
      throw new Error(`${target.displayName} has no executable launch path`);
    const command = normalizeAbsolute(
      target.executablePath,
      'Editor executable',
    );
    const handle = this.spawner.spawnProcess({
      command,
      args,
      cwd,
      env: process.env,
      detached: process.platform !== 'win32',
      needsConsole: false,
    });
    const pid = await handle.whenSpawned;
    if (pid === null) throw new Error(`Failed to launch ${target.displayName}`);
  }
}
