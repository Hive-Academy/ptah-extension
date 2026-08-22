/**
 * The blocked-path log line (TASK_2026_306, Batch 6 / Task 6.2).
 *
 * The state being explained is real and was captured live
 * (`tmp/logs/coldstart-306.log:844`): the claude target reported
 * `missing=13, foreign=19, writeFailed=0` on every pass, forever, with no
 * surface anywhere saying that the thirteen were REFUSALS rather than failures.
 * A blocked path is filtered out before `plan.writes` is built
 * (`targets/claude-target.ts:189-194`), so `writeFailed: 0` was never evidence
 * that those writes had succeeded.
 *
 * Source-under-test: `HarnessReconcilerService.log` + `ClaudeTarget` +
 * `createVscodeMcpTarget`.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  blockedTargetPaths,
  type HarnessTargetId,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import { ManagedManifestStore } from '../manifest-store/managed-manifest';
import { createStaticSourceResolver } from '../sources/plugin-config-source-resolver';
import type {
  HarnessSourceState,
  IHarnessCliDetector,
} from '../sources/harness-source.port';
import { ClaudeTarget } from '../targets/claude-target';
import { createVscodeMcpTarget } from '../targets/rival-targets';
import { HarnessReconcilerService } from './harness-reconciler.service';

const BLOCKED_MESSAGE =
  '[harness-sync] Blocked: desired paths an unowned file occupies — refused, not failed';
const SUMMARY_GAPS = '[harness-sync] Reconcile finished with gaps';
const SUMMARY_CLEAN = '[harness-sync] Reconcile complete';

interface BlockedPath {
  target: HarnessTargetId;
  relPath: string;
  reason: string;
}

interface BlockedDetail {
  reason: string;
  mode: string;
  scope: string;
  targetCount: number;
  blocked: number;
  note: string;
  action: string;
  paths: BlockedPath[];
}

interface FakeLogger {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
}

function makeFakeLogger(): FakeLogger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function detectorFor(installed: HarnessTargetId[]): IHarnessCliDetector {
  const set = new Set(installed);
  return { isInstalled: (target) => Promise.resolve(set.has(target)) };
}

/** Every `logger.warn` payload logged under the given message. */
function warnPayloads(logger: FakeLogger, message: string): unknown[] {
  return logger.warn.mock.calls
    .filter((call) => call[0] === message)
    .map((call) => call[1]);
}

function blockedDetail(logger: FakeLogger): BlockedDetail {
  const payloads = warnPayloads(logger, BLOCKED_MESSAGE);
  expect(payloads).toHaveLength(1);
  return payloads[0] as BlockedDetail;
}

describe('HarnessReconcilerService — the blocked-path line', () => {
  let ws: string;
  let sourcesRoot: string;
  let home: string;
  let logger: FakeLogger;

  /** Two skills and one command in the user layer, plus one MCP intent. */
  function writeSources(): HarnessSourceState {
    const skillsRoot = join(sourcesRoot, 'skills');
    const commandsRoot = join(sourcesRoot, 'commands');
    const agentsRoot = join(sourcesRoot, 'agents');
    mkdirSync(commandsRoot, { recursive: true });
    mkdirSync(agentsRoot, { recursive: true });

    for (const slug of ['alpha', 'beta']) {
      mkdirSync(join(skillsRoot, slug), { recursive: true });
      writeFileSync(
        join(skillsRoot, slug, 'SKILL.md'),
        `---\nname: ${slug}\ndescription: the ${slug} skill\n---\n${slug} body\n`,
        'utf-8',
      );
    }
    writeFileSync(join(commandsRoot, 'run-it.md'), 'command body\n', 'utf-8');

    return {
      layout: { skillsRoot, commandsRoot, agentsRoot },
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
      mcpIntents: [
        {
          serverKey: 'wanted',
          registryName: 'io.github.example/wanted',
          config: { type: 'stdio', command: 'wanted-server' },
          targets: ['vscode'],
        },
      ],
    };
  }

  function buildReconciler(
    sourceState: HarnessSourceState,
  ): HarnessReconcilerService {
    const store = new ManagedManifestStore((message, detail) =>
      logger.warn(message, detail),
    );
    return new HarnessReconcilerService(
      logger as unknown as Logger,
      new HarnessManifestBuilder(),
      store,
      createStaticSourceResolver(sourceState),
      [
        new ClaudeTarget(store),
        createVscodeMcpTarget({
          manifestStore: store,
          detector: detectorFor(['vscode']),
          homeDir: home,
        }),
      ],
    );
  }

  /**
   * The captured shape, in miniature: a desired skill slug occupied by a
   * directory the user wrote, an undesired foreign skill beside it, and a
   * desired MCP key the user already defines.
   */
  function writeOccupants(): void {
    mkdirSync(join(ws, '.claude', 'skills', 'alpha'), { recursive: true });
    writeFileSync(
      join(ws, '.claude', 'skills', 'alpha', 'SKILL.md'),
      'hand-written by the user\n',
      'utf-8',
    );

    // Foreign but NOT desired — a skill of the user's own. It must never reach
    // the blocked line: nothing about it is a gap.
    mkdirSync(join(ws, '.claude', 'skills', 'mine'), { recursive: true });
    writeFileSync(
      join(ws, '.claude', 'skills', 'mine', 'SKILL.md'),
      'my own notes\n',
      'utf-8',
    );

    mkdirSync(join(ws, '.vscode'), { recursive: true });
    writeFileSync(
      join(ws, '.vscode', 'mcp.json'),
      JSON.stringify(
        {
          servers: {
            'user-thing': { type: 'stdio', command: 'the-users-server' },
            wanted: { type: 'stdio', command: 'the-users-other-server' },
          },
        },
        null,
        2,
      ),
      'utf-8',
    );
  }

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-blocked-ws-'));
    sourcesRoot = mkdtempSync(join(tmpdir(), 'harness-blocked-src-'));
    home = mkdtempSync(join(tmpdir(), 'harness-blocked-home-'));
    logger = makeFakeLogger();
  });

  afterEach(() => {
    for (const dir of [ws, sourcesRoot, home]) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('names every blocked path, and only the blocked ones', async () => {
    const reconciler = buildReconciler(writeSources());
    writeOccupants();

    await reconciler.reconcile(ws, { mode: 'full', reason: 'activation' });

    const detail = blockedDetail(logger);
    expect(detail.paths.map((entry) => entry.relPath).sort()).toEqual([
      '.claude/skills/alpha',
      '.vscode/mcp.json#wanted',
    ]);
    expect(detail.blocked).toBe(2);
    // Foreign, but nobody asked for it. A gap it is not.
    expect(detail.paths.map((entry) => entry.relPath)).not.toContain(
      '.claude/skills/mine',
    );
  });

  it('states the refusal in words, per path, and distinguishes an occupied path from an occupied server key', async () => {
    const reconciler = buildReconciler(writeSources());
    writeOccupants();

    await reconciler.reconcile(ws, { mode: 'full', reason: 'activation' });

    const byPath = new Map(
      blockedDetail(logger).paths.map((entry) => [entry.relPath, entry]),
    );
    expect(byPath.get('.claude/skills/alpha')?.reason).toBe(
      'occupied by a file or directory Ptah does not own',
    );
    expect(byPath.get('.claude/skills/alpha')?.target).toBe('claude');
    expect(byPath.get('.vscode/mcp.json#wanted')?.reason).toBe(
      'the config file already defines this server key, and Ptah did not write it',
    );
    expect(byPath.get('.vscode/mcp.json#wanted')?.target).toBe('vscode');
  });

  it('leads the user action with MOVE, warns the occupant may be their own, and never presents deletion as the remedy', async () => {
    const reconciler = buildReconciler(writeSources());
    writeOccupants();

    await reconciler.reconcile(ws, { mode: 'full', reason: 'activation' });

    const { action } = blockedDetail(logger);
    // Nothing about these paths proves Ptah wrote them, and `--fix` writes over
    // whatever the move leaves behind. Advising deletion would trade the user's
    // possibly-irreplaceable work for a tidier count.
    expect(action).toMatch(/^Move the occupant aside/);
    expect(action).toContain('may be your own work');
    expect(action).toContain('ptah harness doctor --fix');
    expect(action.toLowerCase()).not.toContain('delete');
  });

  it('says a refusal is not a write failure, and labels its scope like the summary', async () => {
    const reconciler = buildReconciler(writeSources());
    writeOccupants();

    await reconciler.reconcile(ws, { mode: 'full', reason: 'activation' });

    const detail = blockedDetail(logger);
    expect(detail.note).toContain('`writeFailed` can never report one');
    // Scope-labelled the same way the summary is (Task 5.3), so the two lines
    // cannot be read as one target's numbers beside another's.
    expect(detail.scope).toBe('all-targets');
    expect(detail.targetCount).toBe(2);
    expect(detail.reason).toBe('activation');
    expect(detail.mode).toBe('full');
  });

  it('emits no blocked line at all when nothing is blocked', async () => {
    const reconciler = buildReconciler(writeSources());
    // No occupants written: every desired path is free.

    await reconciler.reconcile(ws, { mode: 'full', reason: 'activation' });

    expect(warnPayloads(logger, BLOCKED_MESSAGE)).toEqual([]);
    expect(logger.debug).toHaveBeenCalledWith(
      SUMMARY_CLEAN,
      expect.objectContaining({ missing: 0, writeFailed: 0 }),
    );
  });

  it('leaves the existing summary line intact, still gated on writeFailed or missing', async () => {
    const reconciler = buildReconciler(writeSources());
    writeOccupants();

    await reconciler.reconcile(ws, { mode: 'full', reason: 'activation' });

    const summaries = warnPayloads(logger, SUMMARY_GAPS);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toEqual(
      expect.objectContaining({
        scope: 'all-targets',
        missing: 2,
        writeFailed: 0,
      }),
    );
    // The summary has gained no field. `blocked` is derived, never transmitted.
    expect(summaries[0]).not.toHaveProperty('blocked');
    expect(summaries[0]).not.toHaveProperty('action');
  });

  it('adds no write and removes none: the occupants survive byte-identical and writeFailed stays empty', async () => {
    const reconciler = buildReconciler(writeSources());
    writeOccupants();

    const health = await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'activation',
    });

    expect(
      readFileSync(join(ws, '.claude', 'skills', 'alpha', 'SKILL.md'), 'utf-8'),
    ).toBe('hand-written by the user\n');
    const config = JSON.parse(
      readFileSync(join(ws, '.vscode', 'mcp.json'), 'utf-8'),
    ) as { servers: Record<string, { command?: string }> };
    expect(config.servers['wanted'].command).toBe('the-users-other-server');

    for (const target of health.targets) {
      expect(target.writeFailed).toEqual([]);
    }
    // And the desired artifacts that were NOT blocked still landed.
    expect(
      readFileSync(join(ws, '.claude', 'skills', 'beta', 'SKILL.md'), 'utf-8'),
    ).toContain('beta body');
  });

  it('keeps reporting the same blocked set on a second, converged pass', async () => {
    const reconciler = buildReconciler(writeSources());
    writeOccupants();

    await reconciler.reconcile(ws, { mode: 'full', reason: 'activation' });
    logger.warn.mockClear();
    await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'content-download-complete',
    });

    // Identical counts across passes are the signature of a CONVERGED steady
    // state, which is exactly what the captured log shows twice.
    const detail = blockedDetail(logger);
    expect(detail.blocked).toBe(2);
    expect(detail.reason).toBe('content-download-complete');
  });

  it('stays silent on a preflight pass, while still reporting the gap in the summary', async () => {
    const reconciler = buildReconciler(writeSources());
    writeOccupants();

    await reconciler.reconcile(ws, { mode: 'full', reason: 'activation' });
    logger.warn.mockClear();
    // Preflight is every session start, throttled to 60 s per workspace root.
    // The blocked set is a permanent steady state, so repeating the whole path
    // object per session would bury the activation line it accompanies.
    const health = await reconciler.reconcile(ws, {
      mode: 'preflight',
      reason: 'session-start',
    });

    expect(warnPayloads(logger, BLOCKED_MESSAGE)).toEqual([]);
    // The gap itself is NOT hidden: the summary still warns, and the health
    // report a caller reads still carries both lists.
    expect(warnPayloads(logger, SUMMARY_GAPS)).toHaveLength(1);
    const stillBlocked = health.targets.flatMap((target) =>
      blockedTargetPaths(target),
    );
    expect(stillBlocked.sort()).toEqual([
      '.claude/skills/alpha',
      '.vscode/mcp.json#wanted',
    ]);
  });
});
