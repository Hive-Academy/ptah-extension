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
  harnessBlockedWordingViolations,
  HARNESS_BLOCKED_APPROVED_ACTIONS,
  HARNESS_BLOCKED_WARN_MESSAGE,
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
import { HarnessStateStore } from '../gitignore/harness-state-store';

/**
 * Skills are gated per workspace since TASK_2026_316, and a fresh temp
 * workspace has no manifest evidence, so the migration correctly gates it. This
 * suite predates the gate and is about something else, so the selection is
 * recorded up front rather than re-tested. The gate itself is owned by
 * `reconciler/harness-reconciler.skill-consent.spec.ts`.
 */
function grantSkillSync(workspaceRoot: string): void {
  const store = new HarnessStateStore();
  store.save(workspaceRoot, {
    ...store.load(workspaceRoot),
    skillSyncMode: 'all',
  });
}

/**
 * The message the WARN is logged under, from the shared allowlist rather than
 * a copy. It is prose on the same line as the action, so it is under the same
 * guard, and this suite finds the payload by it.
 */
const BLOCKED_MESSAGE = HARNESS_BLOCKED_WARN_MESSAGE;
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

/**
 * Every string anywhere in the logged payload, however deeply nested.
 *
 * Collected structurally rather than by naming `note`, `action` and each
 * path's `reason`, so a prose field added to this payload later is under the
 * wording guard the day it lands. `JSON.stringify` is not used because it
 * escapes the quotes inside the action ("Your harness is short"), which would
 * make the approved sentence unfindable in its own line.
 */
function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap(stringsIn);
  }
  return [];
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
    grantSkillSync(ws);
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

  it('leads the user action with MOVE, warns the occupant may be their own, and never presents destruction as the remedy anywhere in the line', async () => {
    const reconciler = buildReconciler(writeSources());
    writeOccupants();

    await reconciler.reconcile(ws, { mode: 'full', reason: 'activation' });

    const detail = blockedDetail(logger);
    const { action } = detail;
    // Nothing about these paths proves Ptah wrote them, and `--fix` writes over
    // whatever the move leaves behind. Advising deletion would trade the user's
    // possibly-irreplaceable work for a tidier count.
    //
    // Kept as substrings even though the line below pins the sentence WHOLE:
    // they document WHY the string says what it says, and they survive the
    // switch to equality at no cost.
    expect(action).toMatch(/^Move the occupant aside/);
    expect(action).toContain('may be your own work');
    expect(action).toContain('read it before you discard anything');
    expect(action).toContain('ptah harness doctor --fix');

    // The guard proper: an exact-match ALLOWLIST, not a denylist of verbs.
    //
    // This case used to scan the line for eight regexes. A denylist can only
    // ban the phrasings somebody thought of, and "purge", "wipe", "drop",
    // "nuke", "clear out" and "get rid of" all passed it while reading to a
    // user as exactly the instruction the rule forbids. So the check is
    // inverted: the sentence must ALREADY be on the list in
    // `libs/shared/src/lib/types/harness-blocked-wording.ts`, character for
    // character. Brittleness is the feature — a reworded safety-critical
    // instruction should be re-approved by a human, not re-scanned by a regex.
    //
    // The scope stays the WHOLE line, not the action clause. Task 12.1
    // inserted a sentence into the middle of this paragraph, and a destructive
    // verb moved into `note` or into a per-path `reason` would have passed an
    // action-only check. Every string in the payload is collected, so a NEW
    // prose field added later is covered without this case being touched.
    expect(action).toBe(HARNESS_BLOCKED_APPROVED_ACTIONS['reconcile-warn']);
    expect(
      harnessBlockedWordingViolations({
        surface: 'reconcile-warn',
        action,
        wholeText: [BLOCKED_MESSAGE, ...stringsIn(detail)].join(' | '),
      }),
    ).toEqual([]);
  });

  it('names the Dashboard harness card, so the line is not a dead end for a user without a terminal', async () => {
    const reconciler = buildReconciler(writeSources());
    writeOccupants();

    await reconciler.reconcile(ws, { mode: 'full', reason: 'activation' });

    const { action } = blockedDetail(logger);
    // A log line cannot be clicked, so naming the destination IS the entry
    // point. The card's own heading is the label, verbatim — a user reading
    // the log and then opening the home must find the words they just read.
    expect(action).toContain('Your harness is short');
    expect(action).toContain('Dashboard');
    // Both routes, not one instead of the other: the CLI still clears it and
    // the card only shows it.
    expect(action).toContain('ptah harness doctor --fix');
    // The card discloses; it does not repair. Describing it as a fix would
    // claim an ownership of these paths that nothing here establishes.
    expect(action.toLowerCase()).not.toMatch(/\bfix (it|them|this)\b/);
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

  it('[346] a second converged pass says so in one debug line instead of repeating the whole list', async () => {
    const reconciler = buildReconciler(writeSources());
    writeOccupants();

    await reconciler.reconcile(ws, { mode: 'full', reason: 'activation' });
    // The first pass is the one that reports. Pinned here rather than assumed,
    // because "emitted once" and "never emitted" fail this case identically.
    expect(blockedDetail(logger).blocked).toBe(2);
    logger.warn.mockClear();
    logger.debug.mockClear();

    await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'content-download-complete',
    });

    // `full` is not rare: activation, the download callback, every folder
    // change and every plugin toggle are all `full`, and one captured session
    // emitted this identical twelve-path object five times
    // (`tmp/logs/log.log:1286, 1290, 1315, 1824, 2154`). A converged set is
    // not news, so it does not get the WARN again…
    expect(warnPayloads(logger, BLOCKED_MESSAGE)).toEqual([]);
    // …but the pass is not silent about having checked, or a reader could not
    // tell "still blocked" from "nobody looked".
    expect(logger.debug).toHaveBeenCalledWith(
      '[harness-sync] Blocked set unchanged since the last full pass',
      expect.objectContaining({
        reason: 'content-download-complete',
        blocked: 2,
      }),
    );
  });

  it('[346] re-emits the full WARN the moment the set actually changes, and again when it empties', async () => {
    const reconciler = buildReconciler(writeSources());
    writeOccupants();

    await reconciler.reconcile(ws, { mode: 'full', reason: 'activation' });
    logger.warn.mockClear();
    logger.debug.mockClear();

    // A NEW blocked path: a skill that did not exist in the user layer during
    // the first pass, whose destination the user has since occupied.
    // Suppression is keyed on the SET, not on "have I ever warned about this
    // workspace" — a growing blocked set the user cannot see would be strictly
    // worse than the repetition this dedupe removes.
    mkdirSync(join(sourcesRoot, 'skills', 'gamma'), { recursive: true });
    writeFileSync(
      join(sourcesRoot, 'skills', 'gamma', 'SKILL.md'),
      '---\nname: gamma\ndescription: the gamma skill\n---\ngamma body\n',
      'utf-8',
    );
    mkdirSync(join(ws, '.claude', 'skills', 'gamma'), { recursive: true });
    writeFileSync(
      join(ws, '.claude', 'skills', 'gamma', 'SKILL.md'),
      'also hand-written by the user\n',
      'utf-8',
    );
    await reconciler.reconcile(ws, { mode: 'full', reason: 'plugins:save' });

    const grown = blockedDetail(logger);
    expect(grown.blocked).toBe(3);
    expect(grown.paths.map((entry) => entry.relPath).sort()).toEqual([
      '.claude/skills/alpha',
      '.claude/skills/gamma',
      '.vscode/mcp.json#wanted',
    ]);
    // The wording guard still holds on the re-emitted line — this is the same
    // payload builder, and a second emit path must not become a second wording.
    expect(grown.action).toBe(
      HARNESS_BLOCKED_APPROVED_ACTIONS['reconcile-warn'],
    );
    expect(
      harnessBlockedWordingViolations({
        surface: 'reconcile-warn',
        action: grown.action,
        wholeText: [BLOCKED_MESSAGE, ...stringsIn(grown)].join(' | '),
      }),
    ).toEqual([]);

    // And a set that CLEARS is reported too. "The last thing I saw was three
    // blocked paths" must not be the final word on a workspace since repaired.
    logger.warn.mockClear();
    logger.debug.mockClear();
    for (const slug of ['alpha', 'gamma']) {
      rmSync(join(ws, '.claude', 'skills', slug), {
        recursive: true,
        force: true,
      });
    }
    writeFileSync(
      join(ws, '.vscode', 'mcp.json'),
      JSON.stringify({ servers: {} }, null, 2),
      'utf-8',
    );
    await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'harness:reconcile',
    });

    expect(warnPayloads(logger, BLOCKED_MESSAGE)).toEqual([]);
    expect(logger.debug).toHaveBeenCalledWith(
      '[harness-sync] Blocked set is now empty; every desired path is free',
      expect.objectContaining({ reason: 'harness:reconcile' }),
    );
  });

  it('[346] tracks each workspace separately, so switching folders is not read as a change in either', async () => {
    const reconciler = buildReconciler(writeSources());
    writeOccupants();

    const other = mkdtempSync(join(tmpdir(), 'harness-blocked-ws2-'));
    grantSkillSync(other);
    try {
      await reconciler.reconcile(ws, { mode: 'full', reason: 'activation' });
      // A different root with nothing blocked. It must neither inherit the
      // first workspace's suppression nor clear it.
      await reconciler.reconcile(other, {
        mode: 'full',
        reason: 'workspace-folders-changed',
      });
      logger.warn.mockClear();
      logger.debug.mockClear();

      await reconciler.reconcile(ws, {
        mode: 'full',
        reason: 'workspace-folders-changed',
      });

      expect(warnPayloads(logger, BLOCKED_MESSAGE)).toEqual([]);
      expect(logger.debug).toHaveBeenCalledWith(
        '[harness-sync] Blocked set unchanged since the last full pass',
        expect.objectContaining({ blocked: 2 }),
      );
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
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
