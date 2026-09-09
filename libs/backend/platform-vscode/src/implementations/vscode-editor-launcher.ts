import * as os from 'node:os';
import * as vscode from 'vscode';
import {
  createExecutableEditorDefinitions,
  detectEditorTargets,
  prepareEditorFileLaunch,
  prepareEditorWorkspaceLaunch,
  spawnEditorProcess,
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
  return createExecutableEditorDefinitions(platform, env, homeDir).filter(
    (definition) => definition.id !== 'vscode',
  );
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
    if (target.id === 'vscode') {
      await this.vscodeApi.openWorkspace(launch.normalizedRoot);
      return;
    }
    await spawnEditorProcess(this.spawner, target, launch.args, launch.cwd);
  }
}
