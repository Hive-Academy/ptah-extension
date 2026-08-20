/**
 * The parity ORACLE (plan §4.4(b), §13, G3).
 *
 * Every other spec in this lib checks that `ClaudeSettingsWriter` produces the
 * bytes we intended. This one checks something the writer cannot check about
 * itself: that the file it chose is the file the SDK's own merge engine
 * actually reads the style from. `resolveSettings()` runs that engine, so
 * `sources[].source` is an independent answer to "which tier supplied this
 * value" — the exact claim Ptah's UI makes when it names the file it wrote
 * (E2, R6).
 *
 * Three things about the shape of this file:
 *
 *  1. **Real filesystem, real paths.** `resolveSettings` reads from disk with
 *     its own I/O, so the mock `IFileSystemProvider` used everywhere else would
 *     leave it nothing to find. The shim below is the smallest real-FS adapter
 *     the writer needs — four of the port's thirteen members — kept local to
 *     this spec so the lib gains no dependency on a platform adapter.
 *  2. **The oracle runs in a child `node`, not in this process.** The SDK ships
 *     ESM-only (`"type": "module"`, `main: sdk.mjs`) and this suite is compiled
 *     to CommonJS by ts-jest, so an in-process `require` of it fails on every
 *     machine — which would have made the availability guard below permanently
 *     true and this spec permanently dead. A child process with a real dynamic
 *     `import()` is the only way the oracle actually runs, and it keeps the
 *     alpha API off this lib's runtime dependency surface entirely.
 *  3. **Guarded, and it degrades to a SKIP.** `resolveSettings` is `@alpha`. If
 *     the export disappears in an SDK upgrade the suite skips rather than
 *     turning the build red — an alpha API's removal is news about the SDK, not
 *     a regression in this lib. The skip is visible in the runner's output, so
 *     a suite that stopped running cannot do so quietly.
 *
 * The user tier is deliberately NOT asserted through the oracle: it resolves
 * against the real home directory, and pointing the SDK at a fake one is not
 * something its options expose. Project and local are the tiers parity
 * actually targets, and they are the two this proves.
 */
import * as os from 'os';
import * as path from 'path';
import * as fsp from 'fs/promises';
import { execFileSync } from 'child_process';
import type {
  IFileSystemProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import { ClaudeSettingsWriter } from './claude-settings.writer';

/** `ResolvedSettings` from `sdk.d.ts`, narrowed to what is asserted here. */
interface ResolvedSettingsLike {
  readonly effective: Record<string, unknown>;
  readonly sources: ReadonlyArray<{
    readonly source: string;
    readonly settings: Record<string, unknown>;
  }>;
}

type SettingSourceLike = 'user' | 'project' | 'local';

const SDK_MODULE = '@anthropic-ai/claude-agent-sdk';

/** Enough of a working directory for `import` to resolve the SDK by name. */
const CHILD_OPTIONS = {
  cwd: path.resolve(__dirname, '..', '..', '..', '..', '..'),
  encoding: 'utf8' as const,
  timeout: 60_000,
};

/**
 * Is the alpha export there at all? One cheap child process at module load,
 * which is also the only honest way to answer the question — the export's
 * presence in `sdk.d.ts` says nothing about the shipped `.mjs`.
 */
function oracleAvailable(): boolean {
  try {
    const probe = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const m = await import(${JSON.stringify(SDK_MODULE)});
         process.stdout.write(typeof m.resolveSettings);`,
      ],
      CHILD_OPTIONS,
    );
    return probe.trim() === 'function';
  } catch {
    return false;
  }
}

/** Run the SDK's own merge engine over a real directory. */
function resolveSettingsViaSdk(
  cwd: string,
  settingSources: readonly SettingSourceLike[],
): ResolvedSettingsLike {
  const raw = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const m = await import(${JSON.stringify(SDK_MODULE)});
       const r = await m.resolveSettings({
         cwd: ${JSON.stringify(cwd)},
         settingSources: ${JSON.stringify([...settingSources])},
       });
       process.stdout.write(JSON.stringify({
         effective: r.effective,
         sources: r.sources.map((s) => ({ source: s.source, settings: s.settings })),
       }));`,
    ],
    CHILD_OPTIONS,
  );
  return JSON.parse(raw) as ResolvedSettingsLike;
}

/** Only what `ClaudeSettingsWriter` calls, backed by the real filesystem. */
function realFileSystem(): IFileSystemProvider {
  return {
    async exists(target: string): Promise<boolean> {
      try {
        await fsp.stat(target);
        return true;
      } catch {
        return false;
      }
    },
    readFile: (target: string): Promise<string> => fsp.readFile(target, 'utf8'),
    async writeFile(target: string, content: string): Promise<void> {
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, content, 'utf8');
    },
    delete: (target: string): Promise<void> => fsp.rm(target, { force: true }),
  } as unknown as IFileSystemProvider;
}

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeWorkspace(root: string): IWorkspaceProvider {
  return {
    getWorkspaceRoot: jest.fn(() => root),
    getWorkspaceFolders: jest.fn(() => [root]),
  } as unknown as IWorkspaceProvider;
}

/** Which tier the merge engine says supplied `outputStyle`, or `null`. */
function sourceOfOutputStyle(resolved: ResolvedSettingsLike): string | null {
  const hit = resolved.sources.find(
    (entry) => entry.settings?.['outputStyle'] !== undefined,
  );
  return hit?.source ?? null;
}

const describeOracle = oracleAvailable() ? describe : describe.skip;

describeOracle('ClaudeSettingsWriter — parity oracle (resolveSettings)', () => {
  // Each case spawns node and the SDK probes MDM/registry on first use.
  jest.setTimeout(120_000);

  let workspaceRoot: string;
  let writer: ClaudeSettingsWriter;

  beforeEach(async () => {
    workspaceRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'ptah-output-style-parity-'),
    );
    writer = new ClaudeSettingsWriter(
      realFileSystem(),
      makeWorkspace(workspaceRoot),
      makeLogger(),
    );
  });

  afterEach(async () => {
    await fsp.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('a project-tier write is read back FROM the project tier', async () => {
    const outcome = await writer.setOutputStyle({
      tier: 'project',
      styleName: 'Terse',
      workspaceRoot,
    });

    expect(outcome.written).toBe(true);
    // The path Ptah's UI shows the user…
    expect(outcome.writtenPath).toBe('.claude/settings.json');

    // …is the tier the SDK's own engine says the value came from.
    const resolved = resolveSettingsViaSdk(workspaceRoot, ['project']);
    expect(resolved.effective['outputStyle']).toBe('Terse');
    expect(sourceOfOutputStyle(resolved)).toBe('project');
  });

  it('a local-tier write is read back FROM the local tier', async () => {
    const outcome = await writer.setOutputStyle({
      tier: 'local',
      styleName: 'Terse',
      workspaceRoot,
    });

    expect(outcome.written).toBe(true);
    expect(outcome.writtenPath).toBe('.claude/settings.local.json');

    const resolved = resolveSettingsViaSdk(workspaceRoot, ['local']);
    expect(resolved.effective['outputStyle']).toBe('Terse');
    expect(sourceOfOutputStyle(resolved)).toBe('local');
  });

  /**
   * The negative half. Without it the two cases above would also pass if the
   * writer had put the value in both files, which would make the UI's claim
   * about WHICH file it changed a coincidence rather than a fact.
   */
  it('a local-tier write is invisible when only the project tier is enabled', async () => {
    await writer.setOutputStyle({
      tier: 'local',
      styleName: 'Terse',
      workspaceRoot,
    });

    const resolved = resolveSettingsViaSdk(workspaceRoot, ['project']);

    expect(resolved.effective['outputStyle']).toBeUndefined();
    expect(sourceOfOutputStyle(resolved)).toBeNull();
  });

  /** Req 2.4 — clearing removes the key rather than writing `"default"`. */
  it('clearing the selection removes the key the engine would have read', async () => {
    await writer.setOutputStyle({
      tier: 'project',
      styleName: 'Terse',
      workspaceRoot,
    });
    await writer.setOutputStyle({
      tier: 'project',
      styleName: 'default',
      workspaceRoot,
    });

    const resolved = resolveSettingsViaSdk(workspaceRoot, ['project']);

    expect(resolved.effective['outputStyle']).toBeUndefined();
  });
});
