import * as path from 'node:path';
import { stat } from 'node:fs/promises';
import type {
  EditorTarget,
  EditorTargetId,
} from '../interfaces/editor-launcher.interface';

export interface EditorInstallCandidate {
  readonly path: string;
  readonly deepLinkScheme?: 'vscode' | 'cursor';
}

export interface EditorDetectionDefinition {
  readonly id: EditorTargetId;
  readonly displayName: string;
  readonly command: string;
  readonly installCandidates: readonly EditorInstallCandidate[];
}

export interface EditorDetectionOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly stat?: (candidatePath: string) => Promise<{
    readonly mode: number;
    isFile(): boolean;
  }>;
}

async function isExecutableCandidate(
  candidatePath: string,
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  statCandidate: NonNullable<EditorDetectionOptions['stat']>,
): Promise<boolean> {
  try {
    const candidateStat = await statCandidate(candidatePath);
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
      if (await isExecutableCandidate(candidate, platform, env, statCandidate))
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
        !(await isExecutableCandidate(
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
        ...(candidate.deepLinkScheme
          ? { deepLinkScheme: candidate.deepLinkScheme }
          : { executablePath: normalizedPath }),
      });
      detected.add(definition.id);
      break;
    }
  }

  return targets;
}
