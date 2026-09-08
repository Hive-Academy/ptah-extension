import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  detectEditorTargets,
  type EditorDetectionDefinition,
  type EditorDetectionOptions,
  type EditorTarget,
  type IEditorLauncher,
  type IProcessSpawner,
} from '@ptah-extension/platform-core';

export interface VscodeEditorLauncherOptions extends EditorDetectionOptions {
  readonly definitions?: readonly EditorDetectionDefinition[];
  readonly homeDir?: string;
}

export interface VscodeEditorApi {
  openFile(filePath: string, line?: number): Promise<void>;
  openWorkspace(workspaceRoot: string): Promise<void>;
}

const defaultVscodeApi: VscodeEditorApi = {
  async openFile(filePath, line) {
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(filePath),
    );
    const editor = await vscode.window.showTextDocument(document);
    if (line === undefined) return;
    const position = new vscode.Position(line - 1, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
      new vscode.Range(position, position),
      vscode.TextEditorRevealType.InCenter,
    );
  },
  async openWorkspace(workspaceRoot) {
    await vscode.commands.executeCommand(
      'vscode.openFolder',
      vscode.Uri.file(workspaceRoot),
      false,
    );
  },
};

function definitionsFor(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  homeDir: string,
): readonly EditorDetectionDefinition[] {
  const localAppData =
    env['LOCALAPPDATA'] ?? path.join(homeDir, 'AppData', 'Local');
  const programFiles = env['ProgramFiles'] ?? 'C:\\Program Files';
  const candidates = (id: 'cursor' | 'antigravity' | 'zed'): string[] => {
    if (platform === 'darwin') {
      const appName = {
        cursor: 'Cursor',
        antigravity: 'Antigravity',
        zed: 'Zed',
      }[id];
      const relative =
        id === 'zed'
          ? 'Contents/MacOS/cli'
          : `Contents/Resources/app/bin/${id}`;
      return [`/Applications/${appName}.app/${relative}`];
    }
    if (platform === 'win32') {
      const appName = {
        cursor: 'Cursor',
        antigravity: 'Antigravity',
        zed: 'Zed',
      }[id];
      return [
        path.join(localAppData, 'Programs', appName, `${appName}.exe`),
        path.join(programFiles, appName, `${appName}.exe`),
      ];
    }
    return [
      path.join(homeDir, '.local', 'bin', id),
      `/usr/local/bin/${id}`,
      `/usr/bin/${id}`,
    ];
  };
  return [
    {
      id: 'cursor',
      displayName: 'Cursor',
      command: 'cursor',
      installCandidates: candidates('cursor').map((candidatePath) => ({
        path: candidatePath,
      })),
    },
    {
      id: 'antigravity',
      displayName: 'Antigravity',
      command: 'antigravity',
      installCandidates: candidates('antigravity').map((candidatePath) => ({
        path: candidatePath,
      })),
    },
    {
      id: 'zed',
      displayName: 'Zed',
      command: 'zed',
      installCandidates: candidates('zed').map((candidatePath) => ({
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

export class VscodeEditorLauncher implements IEditorLauncher {
  constructor(
    private readonly spawner: IProcessSpawner,
    private readonly vscodeApi: VscodeEditorApi = defaultVscodeApi,
    private readonly options: VscodeEditorLauncherOptions = {},
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
    if (target.id === 'vscode') {
      await this.vscodeApi.openFile(normalizedPath, line);
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
    if (target.id === 'vscode') {
      await this.vscodeApi.openWorkspace(normalizedRoot);
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
      throw new Error(`${target.displayName} has no executable launch path`);
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
