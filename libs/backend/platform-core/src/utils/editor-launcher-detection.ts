import * as path from 'node:path';
import { access } from 'node:fs/promises';
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
  readonly exists?: (candidatePath: string) => Promise<boolean>;
}

async function defaultExists(candidatePath: string): Promise<boolean> {
  try {
    await access(candidatePath);
    return true;
  } catch {
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
  exists: (candidatePath: string) => Promise<boolean>,
): Promise<string | undefined> {
  const pathValue = env['PATH'] ?? env['Path'] ?? '';
  const extensions = pathExtensions(platform, env);
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const delimiter = platform === 'win32' ? ';' : ':';
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = pathApi.resolve(directory, `${command}${extension}`);
      if (await exists(candidate)) return candidate;
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
  const exists = options.exists ?? defaultExists;
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const targets: EditorTarget[] = [];
  const detected = new Set<EditorTargetId>();

  for (const definition of definitions) {
    const executablePath = await findOnPath(
      definition.command,
      env,
      platform,
      exists,
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
      if (!(await exists(normalizedPath))) continue;
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
