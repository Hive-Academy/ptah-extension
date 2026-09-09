import * as path from 'node:path';
import { stat } from 'node:fs/promises';
import type {
  EditorTarget,
  EditorTargetId,
} from '../interfaces/editor-launcher.interface';
import type { IProcessSpawner } from '../interfaces/process-spawner.interface';

export interface EditorExecutableCandidate {
  readonly kind: 'executable';
  readonly path: string;
}

export interface EditorApplicationMarkerCandidate {
  readonly kind: 'application-marker';
  readonly path: string;
  readonly deepLinkScheme: 'vscode' | 'cursor';
}

export type EditorInstallCandidate =
  | EditorExecutableCandidate
  | EditorApplicationMarkerCandidate;

export interface EditorDetectionDefinition {
  readonly id: EditorTargetId;
  readonly displayName: string;
  readonly command: string;
  readonly installCandidates: readonly EditorInstallCandidate[];
}

export interface EditorDescriptor {
  readonly id: EditorTargetId;
  readonly displayName: string;
  readonly command: string;
}

export const EDITOR_DESCRIPTORS = [
  { id: 'vscode', displayName: 'VS Code', command: 'code' },
  { id: 'cursor', displayName: 'Cursor', command: 'cursor' },
  {
    id: 'antigravity',
    displayName: 'Antigravity',
    command: 'antigravity',
  },
  { id: 'zed', displayName: 'Zed', command: 'zed' },
] as const satisfies readonly EditorDescriptor[];

export interface EditorDetectionOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly stat?: (candidatePath: string) => Promise<{
    readonly mode: number;
    isFile(): boolean;
  }>;
}

export interface EditorFileLaunch {
  readonly normalizedPath: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

export interface EditorWorkspaceLaunch {
  readonly normalizedRoot: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

const EDITOR_APP_NAMES: Readonly<Record<EditorTargetId, string>> = {
  vscode: 'Visual Studio Code',
  cursor: 'Cursor',
  antigravity: 'Antigravity',
  zed: 'Zed',
};

/** Return conventional executable locations for an editor on the host OS. */
export function editorExecutableCandidates(
  id: EditorTargetId,
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  homeDir: string,
): readonly string[] {
  const command = id === 'vscode' ? 'code' : id;
  const appName =
    id === 'vscode' && platform === 'win32'
      ? 'Microsoft VS Code'
      : EDITOR_APP_NAMES[id];
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'darwin') {
    const relative =
      id === 'zed'
        ? 'Contents/MacOS/cli'
        : `Contents/Resources/app/bin/${command}`;
    return [`/Applications/${appName}.app/${relative}`];
  }
  if (platform === 'win32') {
    const localAppData =
      env['LOCALAPPDATA'] ?? pathApi.join(homeDir, 'AppData', 'Local');
    const programFiles = env['ProgramFiles'] ?? 'C:\\Program Files';
    const executableName = id === 'vscode' ? 'Code' : appName;
    return [
      pathApi.join(localAppData, 'Programs', appName, `${executableName}.exe`),
      pathApi.join(programFiles, appName, `${executableName}.exe`),
    ];
  }
  return [
    pathApi.join(homeDir, '.local', 'bin', command),
    `/usr/local/bin/${command}`,
    `/usr/bin/${command}`,
  ];
}

/** Build executable-only detection definitions from the shared editor facts. */
export function createExecutableEditorDefinitions(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  homeDir: string,
): readonly EditorDetectionDefinition[] {
  return EDITOR_DESCRIPTORS.map((descriptor) => ({
    ...descriptor,
    installCandidates: editorExecutableCandidates(
      descriptor.id,
      platform,
      env,
      homeDir,
    ).map((candidatePath) => ({
      kind: 'executable' as const,
      path: candidatePath,
    })),
  }));
}

async function isCandidateAvailable(
  candidate: EditorInstallCandidate,
  candidatePath: string,
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  statCandidate: NonNullable<EditorDetectionOptions['stat']>,
): Promise<boolean> {
  try {
    const candidateStat = await statCandidate(candidatePath);
    if (candidate.kind === 'application-marker') return true;
    if (!candidateStat.isFile()) return false;
    if (platform === 'win32') {
      const extension = path.win32.extname(candidatePath).toUpperCase();
      return pathExtensions(platform, env).some(
        (executableExtension) =>
          executableExtension.toUpperCase() === extension,
      );
    }
    return (candidateStat.mode & 0o111) !== 0;
  } catch {
    // degradation-audit: optional-capability — an unreadable candidate cannot be safely launched
    return false;
  }
}

function pathExtensions(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  if (platform !== 'win32') return [''];
  const configured = env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD';
  return configured
    .split(';')
    .map((extension) => extension.trim())
    .filter(Boolean);
}

async function findOnPath(
  command: string,
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  statCandidate: NonNullable<EditorDetectionOptions['stat']>,
): Promise<string | undefined> {
  const pathValue = env['PATH'] ?? env['Path'] ?? '';
  const extensions = pathExtensions(platform, env);
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const delimiter = platform === 'win32' ? ';' : ':';
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = pathApi.resolve(directory, `${command}${extension}`);
      if (
        await isCandidateAvailable(
          { kind: 'executable', path: candidate },
          candidate,
          platform,
          env,
          statCandidate,
        )
      )
        return candidate;
    }
  }
  return undefined;
}

/** Detect editors in two passes: PATH first, then verified install locations. */
export async function detectEditorTargets(
  definitions: readonly EditorDetectionDefinition[],
  options: EditorDetectionOptions = {},
): Promise<EditorTarget[]> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const statCandidate = options.stat ?? stat;
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const targets: EditorTarget[] = [];
  const detected = new Set<EditorTargetId>();

  for (const definition of definitions) {
    const executablePath = await findOnPath(
      definition.command,
      env,
      platform,
      statCandidate,
    );
    if (!executablePath) continue;
    targets.push({
      id: definition.id,
      displayName: definition.displayName,
      executablePath,
    });
    detected.add(definition.id);
  }

  for (const definition of definitions) {
    if (detected.has(definition.id)) continue;
    for (const candidate of definition.installCandidates) {
      const normalizedPath = pathApi.resolve(candidate.path);
      if (
        !(await isCandidateAvailable(
          candidate,
          normalizedPath,
          platform,
          env,
          statCandidate,
        ))
      )
        continue;
      targets.push({
        id: definition.id,
        displayName: definition.displayName,
        ...(candidate.kind === 'application-marker'
          ? { deepLinkScheme: candidate.deepLinkScheme }
          : { executablePath: normalizedPath }),
      });
      detected.add(definition.id);
      break;
    }
  }

  return targets;
}

function normalizeAbsolute(candidatePath: string, label: string): string {
  if (!path.isAbsolute(candidatePath))
    throw new Error(`${label} must be absolute`);
  return path.normalize(candidatePath);
}

/** Validate a file request and build the argv used by external editor CLIs. */
export function prepareEditorFileLaunch(
  target: EditorTarget,
  filePath: string,
  line?: number,
): EditorFileLaunch {
  const normalizedPath = normalizeAbsolute(filePath, 'File path');
  if (line !== undefined && (!Number.isInteger(line) || line < 1))
    throw new Error('Line must be a positive integer');
  const location =
    line === undefined ? normalizedPath : `${normalizedPath}:${line}`;
  return {
    normalizedPath,
    args: target.id === 'zed' ? [location] : ['-g', location],
    cwd: path.dirname(normalizedPath),
  };
}

/** Validate a workspace request and build the argv used by editor CLIs. */
export function prepareEditorWorkspaceLaunch(
  workspaceRoot: string,
): EditorWorkspaceLaunch {
  const normalizedRoot = normalizeAbsolute(workspaceRoot, 'Workspace root');
  return {
    normalizedRoot,
    args: [normalizedRoot],
    cwd: normalizedRoot,
  };
}

/** Launch a detected editor executable using argv, never a shell command. */
export async function spawnEditorProcess(
  spawner: IProcessSpawner,
  target: EditorTarget,
  args: readonly string[],
  cwd: string,
): Promise<void> {
  if (!target.executablePath)
    throw new Error(`${target.displayName} has no executable launch path`);
  const handle = spawner.spawnProcess({
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
