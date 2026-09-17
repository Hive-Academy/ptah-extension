import * as path from 'node:path';
import { stat } from 'node:fs/promises';
import type {
  EditorTarget,
  EditorTargetId,
} from '../interfaces/editor-launcher.interface';
import type { IProcessSpawner } from '../interfaces/process-spawner.interface';
import {
  TERMINAL_DISPLAY_NAME,
  terminalCommand,
  terminalExecutableCandidates,
} from './terminal-launch';

export interface EditorExecutableCandidate {
  readonly kind: 'executable';
  readonly path: string;
}

export interface EditorDetectionDefinition {
  readonly id: EditorTargetId;
  readonly displayName: string;
  readonly command: string;
  readonly installCandidates: readonly EditorExecutableCandidate[];
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
  { id: 'kiro', displayName: 'Kiro', command: 'kiro' },
] as const satisfies readonly EditorDescriptor[];

export interface EditorDetectionOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly stat?: (candidatePath: string) => Promise<{
    readonly mode: number;
    isFile(): boolean;
  }>;
  /**
   * Where results are kept. Omitted: the process-lifetime cache, unless `stat`
   * is injected (then nothing is kept). `null`: never cached. See
   * {@link EditorTargetCache} for what may be kept.
   */
  readonly cache?: EditorTargetCache | null;
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

const EDITOR_APP_NAMES: Readonly<
  Record<Exclude<EditorTargetId, 'terminal'>, string>
> = {
  vscode: 'Visual Studio Code',
  cursor: 'Cursor',
  antigravity: 'Antigravity',
  zed: 'Zed',
  kiro: 'Kiro',
};

/** Return conventional executable locations for an editor on the host OS. */
export function editorExecutableCandidates(
  id: EditorTargetId,
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  homeDir: string,
): readonly string[] {
  // Kiro documents the `kiro` shell command. Installer locations are not
  // treated as stable public API, so detection is PATH-only.
  if (id === 'kiro') return [];
  if (id === 'terminal')
    return terminalExecutableCandidates(platform, env, homeDir);
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

/**
 * Build executable-only detection definitions from the shared editor facts,
 * followed by the external `terminal` target. The terminal is listed by
 * detection only when one of its launchers exists on this machine.
 */
export function createExecutableEditorDefinitions(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  homeDir: string,
): readonly EditorDetectionDefinition[] {
  const descriptors: readonly EditorDescriptor[] = [
    ...EDITOR_DESCRIPTORS,
    {
      id: 'terminal',
      displayName: TERMINAL_DISPLAY_NAME,
      command: terminalCommand(platform),
    },
  ];
  return descriptors.map((descriptor) => ({
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

/**
 * Most candidate `stat` calls one detection runs at once (TASK_2026_437 C14 e).
 *
 * The PATH pass is editors × PATH directories × PATHEXT entries: on a Windows
 * machine with ~40 PATH entries and the default 4-12 extensions that is
 * hundreds to thousands of probes. Run one at a time, each costs a libuv
 * round-trip on the caller's loop and the whole pass stretched boot; run all at
 * once, they flood the libuv thread pool (default size 4) that `fs` shares with
 * every other file read in the process. 8 keeps the pool busy without queueing
 * hundreds of stats behind it.
 */
export const EDITOR_PROBE_CONCURRENCY = 8;

/**
 * What one candidate probe proved.
 *
 * `inconclusive` is a `stat` that failed for a reason other than "the path does
 * not exist" (`EACCES`, `EBUSY`, `EIO`, a network drive timing out, an injected
 * probe that throws a bare error). The candidate is not reported — it cannot be
 * safely launched — but the detection that saw it must not be cached, because
 * the same path may answer on the next call.
 */
type ProbeVerdict = 'available' | 'absent' | 'inconclusive';

/** `stat` codes that prove a candidate is not there. */
const DEFINITIVELY_ABSENT_CODES: ReadonlySet<string> = new Set([
  'ENOENT',
  'ENOTDIR',
]);

function isDefinitiveAbsence(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code: unknown = (error as { code?: unknown }).code;
  return typeof code === 'string' && DEFINITIVELY_ABSENT_CODES.has(code);
}

async function probeCandidate(
  candidatePath: string,
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  statCandidate: NonNullable<EditorDetectionOptions['stat']>,
): Promise<ProbeVerdict> {
  let candidateStat: Awaited<
    ReturnType<NonNullable<EditorDetectionOptions['stat']>>
  >;
  try {
    candidateStat = await statCandidate(candidatePath);
  } catch (error: unknown) {
    // degradation-audit: optional-capability - an unreadable candidate cannot be safely launched; a failure that is not ENOENT/ENOTDIR also marks the detection uncacheable
    return isDefinitiveAbsence(error) ? 'absent' : 'inconclusive';
  }
  if (!candidateStat.isFile()) return 'absent';
  if (platform === 'win32') {
    const extension = path.win32.extname(candidatePath).toUpperCase();
    return pathExtensions(platform, env).some(
      (executableExtension) => executableExtension.toUpperCase() === extension,
    )
      ? 'available'
      : 'absent';
  }
  return (candidateStat.mode & 0o111) !== 0 ? 'available' : 'absent';
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

function pathValueOf(
  env: Readonly<Record<string, string | undefined>>,
): string {
  return env['PATH'] ?? env['Path'] ?? '';
}

/** Run `visit` over `items` with at most `limit` calls outstanding. */
async function visitWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  visit: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await visit(item);
    }
  };
  const lanes = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: lanes }, () => lane()));
}

/** The ordered candidate paths one pass probes for one definition. */
interface PassCandidates {
  readonly definition: EditorDetectionDefinition;
  readonly paths: readonly string[];
}

interface PassResult {
  /** The first available candidate per definition, in definition order. */
  readonly found: ReadonlyMap<EditorTargetId, string>;
  /** False when a candidate ahead of the chosen one could not be probed. */
  readonly conclusive: boolean;
}

/**
 * Pick, per definition, the FIRST available path in candidate order — the
 * answer the one-at-a-time walk gave — while probing up to
 * {@link EDITOR_PROBE_CONCURRENCY} candidates at once.
 *
 * A probe dequeued after an earlier candidate of the same definition already
 * matched is skipped: it cannot change the answer. Probes that are already
 * running when a match lands finish and are ignored.
 */
async function runProbePass(
  passes: readonly PassCandidates[],
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  statCandidate: NonNullable<EditorDetectionOptions['stat']>,
): Promise<PassResult> {
  const bestIndex = passes.map(() => Number.POSITIVE_INFINITY);
  const firstInconclusive = passes.map(() => Number.POSITIVE_INFINITY);
  const probes = passes.flatMap((pass, passIndex) =>
    pass.paths.map((candidatePath, order) => ({
      passIndex,
      order,
      candidatePath,
    })),
  );

  await visitWithConcurrency(
    probes,
    EDITOR_PROBE_CONCURRENCY,
    async ({ passIndex, order, candidatePath }) => {
      if (order > bestIndex[passIndex]) return;
      const verdict = await probeCandidate(
        candidatePath,
        platform,
        env,
        statCandidate,
      );
      if (verdict === 'available') {
        bestIndex[passIndex] = Math.min(bestIndex[passIndex], order);
      } else if (verdict === 'inconclusive') {
        firstInconclusive[passIndex] = Math.min(
          firstInconclusive[passIndex],
          order,
        );
      }
    },
  );

  const found = new Map<EditorTargetId, string>();
  let conclusive = true;
  passes.forEach((pass, passIndex) => {
    // An inconclusive probe AFTER the chosen candidate cannot change the answer;
    // one BEFORE it (or with nothing chosen) could have been the real match.
    if (firstInconclusive[passIndex] < bestIndex[passIndex]) conclusive = false;
    const index = bestIndex[passIndex];
    if (Number.isFinite(index))
      found.set(pass.definition.id, pass.paths[index]);
  });
  return { found, conclusive };
}

interface DetectionOutcome {
  readonly targets: EditorTarget[];
  /** Every probe that could decide the result answered definitively. */
  readonly conclusive: boolean;
}

async function runDetection(
  definitions: readonly EditorDetectionDefinition[],
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  statCandidate: NonNullable<EditorDetectionOptions['stat']>,
): Promise<DetectionOutcome> {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const delimiter = platform === 'win32' ? ';' : ':';
  const directories = pathValueOf(env).split(delimiter).filter(Boolean);
  const extensions = pathExtensions(platform, env);

  const onPath = await runProbePass(
    definitions.map((definition) => ({
      definition,
      paths: directories.flatMap((directory) =>
        extensions.map((extension) =>
          pathApi.resolve(directory, `${definition.command}${extension}`),
        ),
      ),
    })),
    platform,
    env,
    statCandidate,
  );

  const installed = await runProbePass(
    definitions
      .filter((definition) => !onPath.found.has(definition.id))
      .map((definition) => ({
        definition,
        paths: definition.installCandidates.map((candidate) =>
          pathApi.resolve(candidate.path),
        ),
      })),
    platform,
    env,
    statCandidate,
  );

  const targets: EditorTarget[] = [];
  for (const found of [onPath.found, installed.found]) {
    for (const definition of definitions) {
      const executablePath = found.get(definition.id);
      if (executablePath === undefined) continue;
      targets.push({
        id: definition.id,
        displayName: definition.displayName,
        executablePath,
      });
    }
  }
  return {
    targets,
    conclusive: onPath.conclusive && installed.conclusive,
  };
}

/**
 * Detection results keyed by everything that decides them.
 *
 * The rule for what may be kept (TASK_2026_437 C14 e):
 * - A detection is cached for the life of the cache (the process, for the
 *   default one) only when it SUCCEEDED and was CONCLUSIVE — every probe that
 *   could have decided the answer returned "found" or "definitively absent"
 *   (`ENOENT`/`ENOTDIR`, not a file, not executable).
 * - A detection that rejected, or that saw an inconclusive probe ahead of its
 *   answer, is served to the callers that were already waiting on it and then
 *   dropped, so the next call probes again. A transient `EBUSY` on a network
 *   drive must not hide an editor for the rest of the session.
 * - Concurrent calls with the same key share one in-flight detection.
 *
 * An editor installed or removed while the process runs is not seen until the
 * process restarts, unless `PATH`/`PATHEXT` also change (a new key). That is
 * the accepted cost: the answer rarely changes and the probe is boot work.
 */
export class EditorTargetCache {
  private readonly entries = new Map<string, Promise<EditorTarget[]>>();

  /** Drop every kept result. */
  clear(): void {
    this.entries.clear();
  }

  /**
   * The kept or in-flight result for `key`, or a new detection. Called by
   * `detectEditorTargets`; the rule it applies is the class doc above.
   */
  resolve(
    key: string,
    detect: () => Promise<{
      readonly targets: EditorTarget[];
      readonly conclusive: boolean;
    }>,
  ): Promise<EditorTarget[]> {
    const existing = this.entries.get(key);
    if (existing !== undefined) return existing;
    const entry: Promise<EditorTarget[]> = detect().then(
      (outcome) => {
        if (!outcome.conclusive) this.evict(key, entry);
        return outcome.targets;
      },
      (error: unknown) => {
        this.evict(key, entry);
        throw error;
      },
    );
    this.entries.set(key, entry);
    return entry;
  }

  private evict(key: string, entry: Promise<EditorTarget[]>): void {
    if (this.entries.get(key) === entry) this.entries.delete(key);
  }
}

/**
 * The process-lifetime cache every default-probing call shares. Only used when
 * the caller did not inject `stat`: an injected probe answers from its own
 * world, and sharing its results with real-filesystem callers would be wrong.
 */
const PROCESS_EDITOR_TARGET_CACHE = new EditorTargetCache();

/**
 * `PATH` + `PATHEXT` are the task's cache key; platform and the definitions
 * are in it too, because they also decide the answer (VS Code's host filters
 * out `vscode`, and `homeDir`/`LOCALAPPDATA` shape the install candidates).
 */
function detectionCacheKey(
  definitions: readonly EditorDetectionDefinition[],
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
): string {
  return JSON.stringify([
    platform,
    pathValueOf(env),
    env['PATHEXT'] ?? null,
    definitions.map((definition) => [
      definition.id,
      definition.displayName,
      definition.command,
      definition.installCandidates.map((candidate) => candidate.path),
    ]),
  ]);
}

/**
 * Detect editors in two passes: PATH first, then verified install locations.
 *
 * Probes run with bounded concurrency ({@link EDITOR_PROBE_CONCURRENCY}) and
 * the result is cached per {@link EditorTargetCache}'s rule: the process cache
 * when `stat` is not injected, `options.cache` when given, none when
 * `options.cache` is `null`. The returned array is always a fresh copy.
 */
export async function detectEditorTargets(
  definitions: readonly EditorDetectionDefinition[],
  options: EditorDetectionOptions = {},
): Promise<EditorTarget[]> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const statCandidate = options.stat ?? stat;
  const detect = (): Promise<DetectionOutcome> =>
    runDetection(definitions, env, platform, statCandidate);

  const cache =
    options.cache === undefined
      ? options.stat === undefined
        ? PROCESS_EDITOR_TARGET_CACHE
        : null
      : options.cache;
  if (cache === null) return (await detect()).targets;

  const targets = await cache.resolve(
    detectionCacheKey(definitions, env, platform),
    detect,
  );
  return [...targets];
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
  if (target.id === 'terminal')
    throw new Error(`${target.displayName} cannot open a file`);
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
