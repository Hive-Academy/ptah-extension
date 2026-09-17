import * as os from 'node:os';
import * as vscode from 'vscode';
import {
  createExecutableEditorDefinitions,
  detectEditorTargets,
  prepareEditorFileLaunch,
  prepareEditorWorkspaceLaunch,
  spawnEditorProcess,
  TERMINAL_DISPLAY_NAME,
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
  /** Open an integrated terminal whose cwd is `workspaceRoot` and show it. */
  openTerminal(workspaceRoot: string): Promise<void>;
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
  openTerminal(workspaceRoot) {
    vscode.window.createTerminal({ cwd: workspaceRoot }).show();
    return Promise.resolve();
  },
};

/**
 * VS Code itself and the terminal are served in-process by this host, so
 * neither is probed on disk.
 */
function definitionsFor(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  homeDir: string,
): readonly EditorDetectionDefinition[] {
  return createExecutableEditorDefinitions(platform, env, homeDir).filter(
    (definition) => definition.id !== 'vscode' && definition.id !== 'terminal',
  );
}

/** The integrated terminal: always available, launched without a path. */
const IN_PROCESS_TERMINAL: EditorTarget = {
  id: 'terminal',
  displayName: TERMINAL_DISPLAY_NAME,
};

export class VscodeEditorLauncher implements IEditorLauncher {
  constructor(
    private readonly spawner: IProcessSpawner,
    private readonly vscodeApi: VscodeEditorApi = defaultVscodeApi,
    private readonly options: VscodeEditorLauncherOptions = {},
  ) {}

  async detect(): Promise<EditorTarget[]> {
    const platform = this.options.platform ?? process.platform;
    const env = this.options.env ?? process.env;
    const editors = await detectEditorTargets(
      this.options.definitions ??
        definitionsFor(platform, env, this.options.homeDir ?? os.homedir()),
      this.options,
    );
    return [
      ...editors.filter(({ id }) => id !== 'terminal'),
      { ...IN_PROCESS_TERMINAL },
    ];
  }

  async openFile(
    target: EditorTarget,
    filePath: string,
    line?: number,
  ): Promise<void> {
    const launch = prepareEditorFileLaunch(target, filePath, line);
    if (target.id === 'vscode') {
      await this.vscodeApi.openFile(launch.normalizedPath, line);
      return;
    }
    await spawnEditorProcess(this.spawner, target, launch.args, launch.cwd);
  }

  async openWorkspace(
    target: EditorTarget,
    workspaceRoot: string,
  ): Promise<void> {
    const launch = prepareEditorWorkspaceLaunch(workspaceRoot);
    if (target.id === 'terminal') {
      await this.vscodeApi.openTerminal(launch.normalizedRoot);
      return;
    }
    if (target.id === 'vscode') {
      await this.vscodeApi.openWorkspace(launch.normalizedRoot);
      return;
    }
    await spawnEditorProcess(this.spawner, target, launch.args, launch.cwd);
  }
}
