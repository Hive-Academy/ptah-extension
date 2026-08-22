/**
 * The consent-gated repair (TASK_2026_306, Batch 8 / Tasks 8.2 + 8.4).
 *
 * Source-under-test: `lib/repair/blocked-repair.service.ts`, driven against a
 * REAL reconciler, REAL targets and a real temp workspace. The doubles here are
 * the logger and — in the failure cases only — the propagation service, because
 * the one thing a real filesystem cannot be made to do on demand across
 * platforms is fail a write at a chosen path.
 *
 * The captured shape, in miniature: two skills and a command in the user layer,
 * with the user's own directories already sitting on two of the three desired
 * paths. That is `missing=13, writeFailed=0` (`tmp/logs/coldstart-306.log:844`)
 * scaled down to something a spec can assert every byte of.
 *
 * Every case here is about not destroying unowned work. `it` titles say which
 * invariant they pin, because the failure mode this batch guards against is
 * silent and permanent.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * A `rename` that can be told to COPY INSTEAD OF MOVING and report success —
 * see the identical stub in `quarantine.spec.ts` for why this is the only way
 * to reach `assertMoved`'s source-side check, and why it must copy rather than
 * do nothing. Default is off and delegates to the real `rename`, so every other
 * case in this file, and the reconciler and copy engine they drive, behave
 * exactly as they did before.
 */
let renameLiesFor: ((from: string, to: string) => boolean) | null = null;

jest.mock('fs/promises', () => {
  const actual = jest.requireActual('fs/promises');
  return {
    ...actual,
    rename: async (from: string, to: string): Promise<void> => {
      if (renameLiesFor?.(from, to) === true) {
        await actual.cp(from, to, { recursive: true });
        return; // reports success; the source survives
      }
      return actual.rename(from, to);
    },
  };
});

import {
  blockedTargetPaths,
  type HarnessHealth,
  type HarnessTargetId,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import { ManagedManifestStore } from '../manifest-store/managed-manifest';
import { HarnessPropagationService } from '../propagation/harness-propagation.service';
import { QUARANTINE_DIR_NAME } from '../quarantine/quarantine';
import { HarnessReconcilerService } from '../reconciler/harness-reconciler.service';
import { createStaticSourceResolver } from '../sources/plugin-config-source-resolver';
import { NO_USER_LAYER_REFRESH } from '../sources/user-layer-refresher.port';
import type {
  HarnessSourceState,
  IHarnessCliDetector,
} from '../sources/harness-source.port';
import { ClaudeTarget } from '../targets/claude-target';
import { createVscodeMcpTarget } from '../targets/rival-targets';
import { HarnessBlockedRepairService } from './blocked-repair.service';

const FIXED = new Date('2026-08-23T14:15:30.123Z');
const STAMP = '20260823T141530123';

const ALPHA = '.claude/skills/alpha';
const RUN_IT = '.claude/commands/run-it.md';
const MCP_KEY = '.vscode/mcp.json#wanted';

const USER_SKILL = 'hand-written by the user\n';
const USER_COMMAND = 'the user wrote this command\n';

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

describe('HarnessBlockedRepairService', () => {
  let ws: string;
  let sourcesRoot: string;
  let home: string;
  let logger: FakeLogger;
  let reconciler: HarnessReconcilerService;
  let propagation: HarnessPropagationService;

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
    writeFileSync(
      join(commandsRoot, 'run-it.md'),
      'the managed command body\n',
      'utf-8',
    );

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

  /** Occupants on two desired paths, one foreign-but-undesired, one MCP key. */
  function writeOccupants(): void {
    mkdirSync(join(ws, '.claude', 'skills', 'alpha'), { recursive: true });
    writeFileSync(
      join(ws, '.claude', 'skills', 'alpha', 'SKILL.md'),
      USER_SKILL,
      'utf-8',
    );

    // Foreign but NOT desired. Nobody may repair it — it is not a gap.
    mkdirSync(join(ws, '.claude', 'skills', 'mine'), { recursive: true });
    writeFileSync(
      join(ws, '.claude', 'skills', 'mine', 'SKILL.md'),
      'my own notes\n',
      'utf-8',
    );

    mkdirSync(join(ws, '.claude', 'commands'), { recursive: true });
    writeFileSync(
      join(ws, '.claude', 'commands', 'run-it.md'),
      USER_COMMAND,
      'utf-8',
    );

    mkdirSync(join(ws, '.vscode'), { recursive: true });
    writeFileSync(
      join(ws, '.vscode', 'mcp.json'),
      JSON.stringify(
        {
          servers: {
            wanted: { type: 'stdio', command: 'the-users-other-server' },
          },
        },
        null,
        2,
      ),
      'utf-8',
    );
  }

  function buildReconciler(state: HarnessSourceState): void {
    const store = new ManagedManifestStore((message, detail) =>
      logger.warn(message, detail as Record<string, unknown>),
    );
    reconciler = new HarnessReconcilerService(
      logger as unknown as Logger,
      new HarnessManifestBuilder(),
      store,
      createStaticSourceResolver(state),
      [
        new ClaudeTarget(store),
        createVscodeMcpTarget({
          manifestStore: store,
          detector: detectorFor(['vscode']),
          homeDir: home,
        }),
      ],
    );
    propagation = new HarnessPropagationService(
      logger as unknown as Logger,
      reconciler,
      NO_USER_LAYER_REFRESH,
    );
  }

  function makeService(
    propagationOverride?: HarnessPropagationService,
  ): HarnessBlockedRepairService {
    return new HarnessBlockedRepairService(
      logger as unknown as Logger,
      reconciler,
      propagationOverride ?? propagation,
      () => FIXED,
    );
  }

  const abs = (relPath: string): string => join(ws, ...relPath.split('/'));

  const quarantineFor = (relPath: string): string => {
    const parts = relPath.split('/');
    const name = parts.pop() as string;
    return join(ws, ...parts, QUARANTINE_DIR_NAME, `${name}-${STAMP}`);
  };

  /** Snapshot of every file under `dir`, for a byte-identical assertion. */
  function snapshot(dir: string, prefix = ''): Record<string, string> {
    const out: Record<string, string> = {};
    let names: string[];
    try {
      names = readdirSync(dir, { withFileTypes: true }).map((e) => e.name);
    } catch {
      return out;
    }
    for (const name of names.sort()) {
      const full = join(dir, name);
      const key = prefix === '' ? name : `${prefix}/${name}`;
      try {
        Object.assign(out, snapshot(full, key));
        if (readdirSync(full).length === 0) out[key] = '<empty dir>';
      } catch {
        out[key] = readFileSync(full, 'utf-8');
      }
    }
    return out;
  }

  const blockedIn = (health: HarnessHealth): string[] =>
    health.targets.flatMap((target) => blockedTargetPaths(target)).sort();

  beforeEach(async () => {
    ws = mkdtempSync(join(tmpdir(), 'harness-repair-ws-'));
    sourcesRoot = mkdtempSync(join(tmpdir(), 'harness-repair-src-'));
    home = mkdtempSync(join(tmpdir(), 'harness-repair-home-'));
    logger = makeFakeLogger();
    renameLiesFor = null;
    buildReconciler(writeSources());
    writeOccupants();
    // The steady state the repair starts from: one converged activation pass.
    await reconciler.reconcile(ws, { mode: 'full', reason: 'activation' });
  });

  afterEach(() => {
    renameLiesFor = null;
    for (const dir of [ws, sourcesRoot, home]) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ------------------------------------------------------------ the premise

  it('starts from the captured shape: three blocked paths, and writeFailed is 0', async () => {
    const health = await reconciler.verify(ws);
    expect(blockedIn(health)).toEqual([ALPHA, RUN_IT, MCP_KEY].sort());
    for (const target of health.targets) {
      expect(target.writeFailed).toEqual([]);
    }
  });

  // --------------------------------------------------------------- consent

  it('an EMPTY selection runs no pass at all and leaves the workspace byte-identical', async () => {
    const before = snapshot(ws);
    // Asserted on the CALLS, not only on the bytes. A converged tree is
    // byte-identical after a redundant pass too, so a disk comparison alone
    // would pass against an implementation that reconciles on every decline.
    const verify = jest.spyOn(reconciler, 'verify');
    const propagate = jest.spyOn(propagation, 'propagate');

    const report = await makeService().repair(ws, []);

    expect(report).toEqual({ paths: [], repaired: 0, health: null });
    expect(verify).not.toHaveBeenCalled();
    expect(propagate).not.toHaveBeenCalled();
    expect(snapshot(ws)).toEqual(before);
  });

  it('never touches a blocked path the user did NOT consent to', async () => {
    await makeService().repair(ws, [{ target: 'claude', relPath: ALPHA }]);

    // `run-it.md` was equally blocked and equally repairable. It was not
    // ticked, so it is exactly as the user left it and still blocked.
    expect(readFileSync(abs(RUN_IT), 'utf-8')).toBe(USER_COMMAND);
    expect(existsSync(quarantineFor(RUN_IT))).toBe(false);
    expect(blockedIn(await reconciler.verify(ws))).toContain(RUN_IT);
  });

  it('refuses a path that is not in the blocked set, rather than moving it', async () => {
    // Foreign, but nobody asked for it. This is the case that would turn the
    // RPC into a general-purpose "move this directory" primitive.
    const propagate = jest.spyOn(propagation, 'propagate');

    const report = await makeService().repair(ws, [
      { target: 'claude', relPath: '.claude/skills/mine' },
    ]);

    // A fully rejected selection reaches no write pass at all.
    expect(propagate).not.toHaveBeenCalled();

    expect(report.paths[0].outcome).toBe('not-blocked');
    expect(report.paths[0].quarantinePath).toBeUndefined();
    expect(report.repaired).toBe(0);
    expect(
      readFileSync(join(ws, '.claude', 'skills', 'mine', 'SKILL.md'), 'utf-8'),
    ).toBe('my own notes\n');
    // Refused before any pass ran, so the caller's report is still current.
    expect(report.health).toBeNull();
  });

  it('refuses a blocked MCP server key — there is no directory to move aside', async () => {
    const report = await makeService().repair(ws, [
      { target: 'vscode', relPath: MCP_KEY },
    ]);

    expect(report.paths[0].outcome).toBe('not-a-path');
    expect(report.paths[0].reason).toContain('nothing to move aside');
    const config = JSON.parse(
      readFileSync(join(ws, '.vscode', 'mcp.json'), 'utf-8'),
    ) as { servers: Record<string, { command?: string }> };
    expect(config.servers['wanted'].command).toBe('the-users-other-server');
  });

  // -------------------------------------------------- move, then and only then

  it('the occupant is in QUARANTINE, and its path VACANT, before the write pass is even called', async () => {
    // The ordering invariant, observed rather than argued. Nothing may be
    // written at a blocked path until the occupant is provably elsewhere.
    const observed: Array<{ inQuarantine: boolean; pathVacant: boolean }> = [];
    const watched = {
      propagate: (cwd: string, reason: string) => {
        observed.push({
          inQuarantine: existsSync(join(quarantineFor(ALPHA), 'SKILL.md')),
          pathVacant: !existsSync(abs(ALPHA)),
        });
        return propagation.propagate(cwd, reason, { mode: 'full' });
      },
    } as unknown as HarnessPropagationService;

    await makeService(watched).repair(ws, [
      { target: 'claude', relPath: ALPHA },
    ]);

    expect(observed).toEqual([{ inQuarantine: true, pathVacant: true }]);
  });

  it('repairs the consented path: original quarantined intact, managed copy in its place', async () => {
    const report = await makeService().repair(ws, [
      { target: 'claude', relPath: ALPHA },
    ]);

    expect(report.repaired).toBe(1);
    expect(report.paths[0]).toEqual({
      target: 'claude',
      relPath: ALPHA,
      outcome: 'repaired',
      quarantinePath: quarantineFor(ALPHA),
    });
    // The user's work: moved, not destroyed. This is discriminator D1.
    expect(readFileSync(join(quarantineFor(ALPHA), 'SKILL.md'), 'utf-8')).toBe(
      USER_SKILL,
    );
    // And Ptah's copy is now where it belongs.
    expect(readFileSync(join(abs(ALPHA), 'SKILL.md'), 'utf-8')).toContain(
      'alpha body',
    );
  });

  it('a subsequent reconcile reports `missing` reduced by exactly the repaired count, writeFailed still 0', async () => {
    const before = await reconciler.verify(ws);
    const beforeMissing = before.targets.reduce(
      (n, t) => n + t.missing.length,
      0,
    );

    const report = await makeService().repair(ws, [
      { target: 'claude', relPath: ALPHA },
    ]);

    const after = await reconciler.verify(ws);
    const afterMissing = after.targets.reduce(
      (n, t) => n + t.missing.length,
      0,
    );
    expect(beforeMissing - afterMissing).toBe(report.repaired);
    for (const target of after.targets) {
      expect(target.writeFailed).toEqual([]);
    }
    expect(blockedIn(after)).toEqual([RUN_IT, MCP_KEY].sort());
  });

  it('repairs a partial selection and leaves every unselected blocked path exactly as it was', async () => {
    const report = await makeService().repair(ws, [
      { target: 'claude', relPath: RUN_IT },
    ]);

    expect(report.repaired).toBe(1);
    expect(readFileSync(quarantineFor(RUN_IT), 'utf-8')).toBe(USER_COMMAND);
    expect(readFileSync(abs(RUN_IT), 'utf-8')).toBe(
      'the managed command body\n',
    );
    // The other two are untouched and still blocked.
    expect(readFileSync(join(abs(ALPHA), 'SKILL.md'), 'utf-8')).toBe(
      USER_SKILL,
    );
    expect(blockedIn(await reconciler.verify(ws))).toEqual(
      [ALPHA, MCP_KEY].sort(),
    );
  });

  it('is idempotent: a second call on a repaired path is refused, not a second quarantine entry', async () => {
    const service = makeService();
    await service.repair(ws, [{ target: 'claude', relPath: ALPHA }]);

    const second = await service.repair(ws, [
      { target: 'claude', relPath: ALPHA },
    ]);

    expect(second.paths[0].outcome).toBe('not-blocked');
    expect(second.repaired).toBe(0);
    expect(
      readdirSync(join(ws, '.claude', 'skills', QUARANTINE_DIR_NAME)),
    ).toEqual([`alpha-${STAMP}`]);
  });

  // --------------------------------------------------------- partial failure

  it('a FAILED move means no write at that path — and the other paths still repair', async () => {
    // A file sitting where `.claude/skills/.ptah-quarantine` must go. Nothing
    // in the skills directory can be quarantined; the command directory is
    // unaffected. No mock: the failure is real and so is the isolation.
    writeFileSync(
      join(ws, '.claude', 'skills', QUARANTINE_DIR_NAME),
      'not a directory',
      'utf-8',
    );

    const report = await makeService().repair(ws, [
      { target: 'claude', relPath: ALPHA },
      { target: 'claude', relPath: RUN_IT },
    ]);

    expect(report.paths[0].outcome).toBe('move-failed');
    expect(report.paths[0].reason).toContain('nothing was written here');
    // Untouched — and, crucially, the reconcile that followed did NOT write
    // over it. That is structural: the occupant is still unowned, so the plan
    // classifies it foreign and it never enters `plan.writes`.
    expect(readFileSync(join(abs(ALPHA), 'SKILL.md'), 'utf-8')).toBe(
      USER_SKILL,
    );
    expect(blockedIn(await reconciler.verify(ws))).toContain(ALPHA);

    // One failing path did not abort the rest.
    expect(report.paths[1].outcome).toBe('repaired');
    expect(report.repaired).toBe(1);
    expect(readFileSync(quarantineFor(RUN_IT), 'utf-8')).toBe(USER_COMMAND);
  });

  it('a rename that RESOLVES WITHOUT MOVING is caught, and nothing is written at that path', async () => {
    // The failure `assertMoved`'s source-side check exists for, and the only
    // way to produce it: a filesystem that reports a successful move and does
    // not perform one. If the check were removed, the repair would believe the
    // path was vacant and hand it to the write pass with the user's directory
    // still sitting on it.
    renameLiesFor = (from) => from === abs(ALPHA);
    const propagate = jest.spyOn(propagation, 'propagate');

    const report = await makeService().repair(ws, [
      { target: 'claude', relPath: ALPHA },
    ]);

    expect(report.paths[0].outcome).toBe('move-failed');
    // The SOURCE-side half of the assertion, specifically. A destination-side
    // check alone passes here, because the destination really did appear.
    expect(report.paths[0].reason).toContain('is still in place');
    expect(report.paths[0].reason).toContain('nothing was written here');
    // The user's directory is untouched and no write pass ever ran.
    expect(readFileSync(join(abs(ALPHA), 'SKILL.md'), 'utf-8')).toBe(
      USER_SKILL,
    );
    expect(propagate).not.toHaveBeenCalled();
    expect(report.health).toBeNull();
    // A lying rename leaves its copy in the quarantine. That is not cleaned up:
    // deleting it would put an `rm` back on the repair path for cosmetics, and
    // a duplicate of the user's own directory inside the undo store is exactly
    // the harmless direction to be wrong in.
    expect(readFileSync(join(quarantineFor(ALPHA), 'SKILL.md'), 'utf-8')).toBe(
      USER_SKILL,
    );
  });

  it('every consented path failing to move runs no pass and changes nothing', async () => {
    writeFileSync(
      join(ws, '.claude', 'skills', QUARANTINE_DIR_NAME),
      'not a directory',
      'utf-8',
    );
    const before = snapshot(ws);

    const report = await makeService().repair(ws, [
      { target: 'claude', relPath: ALPHA },
    ]);

    expect(report.paths[0].outcome).toBe('move-failed');
    expect(report.health).toBeNull();
    expect(snapshot(ws)).toEqual(before);
  });

  it('restores the occupant when the managed write does not land', async () => {
    // The pass could not run. Everything moved is therefore unwritten, and an
    // unwritten path must get its original back rather than sit empty.
    const deadPropagation = {
      propagate: () => Promise.resolve(null),
    } as unknown as HarnessPropagationService;

    const report = await makeService(deadPropagation).repair(ws, [
      { target: 'claude', relPath: ALPHA },
    ]);

    expect(report.paths[0].outcome).toBe('restored');
    expect(report.repaired).toBe(0);
    expect(readFileSync(join(abs(ALPHA), 'SKILL.md'), 'utf-8')).toBe(
      USER_SKILL,
    );
    expect(existsSync(quarantineFor(ALPHA))).toBe(false);
    // Back to the state it started in, and reported as such.
    expect(blockedIn(report.health as HarnessHealth)).toContain(ALPHA);
  });

  it('restores when the pass ran but this path is still missing — a real write failure', async () => {
    const stillMissing = {
      propagate: async (): Promise<HarnessHealth> => {
        const health = await reconciler.verify(ws);
        return health;
      },
    } as unknown as HarnessPropagationService;

    const report = await makeService(stillMissing).repair(ws, [
      { target: 'claude', relPath: ALPHA },
    ]);

    // `verify` over a vacant path reports it missing (a planned write), which
    // is exactly the shape a failed write produces.
    expect(report.paths[0].outcome).toBe('restored');
    expect(readFileSync(join(abs(ALPHA), 'SKILL.md'), 'utf-8')).toBe(
      USER_SKILL,
    );
  });

  it('NAMES the quarantine path when the write failed AND the restore failed', async () => {
    const destroysQuarantine = {
      propagate: (): Promise<null> => {
        rmSync(quarantineFor(ALPHA), { recursive: true, force: true });
        return Promise.resolve(null);
      },
    } as unknown as HarnessPropagationService;

    const report = await makeService(destroysQuarantine).repair(ws, [
      { target: 'claude', relPath: ALPHA },
    ]);

    expect(report.paths[0].outcome).toBe('restore-failed');
    // A bare failure message that does not name the path is a failing
    // implementation: at this point the directory is in one place only.
    expect(report.paths[0].quarantinePath).toBe(quarantineFor(ALPHA));
    expect(report.paths[0].reason).toContain(quarantineFor(ALPHA));
  });

  // ------------------------------------------------- the quarantine is invisible

  it('a populated quarantine changes NOTHING about health — not foreign, not missing, not expected', async () => {
    const baseline = await reconciler.verify(ws);

    mkdirSync(join(ws, '.claude', 'skills', QUARANTINE_DIR_NAME, 'gamma-1'), {
      recursive: true,
    });
    writeFileSync(
      join(ws, '.claude', 'skills', QUARANTINE_DIR_NAME, 'gamma-1', 'SKILL.md'),
      'a quarantined original\n',
      'utf-8',
    );
    mkdirSync(join(ws, '.claude', 'commands', QUARANTINE_DIR_NAME), {
      recursive: true,
    });
    writeFileSync(
      join(ws, '.claude', 'commands', QUARANTINE_DIR_NAME, `x.md-${STAMP}`),
      'another one\n',
      'utf-8',
    );

    const withQuarantine = await reconciler.verify(ws);

    const shape = (health: HarnessHealth) =>
      health.targets.map((t) => ({
        target: t.target,
        expected: t.expected,
        found: t.found,
        missing: [...t.missing].sort(),
        foreign: [...t.foreign].sort(),
      }));
    expect(shape(withQuarantine)).toEqual(shape(baseline));
  });

  it('a full reconcile never reaps, rewrites or reports the quarantine', async () => {
    await makeService().repair(ws, [{ target: 'claude', relPath: ALPHA }]);
    const quarantined = join(quarantineFor(ALPHA), 'SKILL.md');

    await reconciler.reconcile(ws, { mode: 'full', reason: 'activation' });
    await reconciler.reconcile(ws, { mode: 'full', reason: 'activation' });

    // Two more passes and the user's original is still there, byte-identical.
    expect(readFileSync(quarantined, 'utf-8')).toBe(USER_SKILL);
    const health = await reconciler.verify(ws);
    for (const target of health.targets) {
      expect(target.foreign.join('|')).not.toContain(QUARANTINE_DIR_NAME);
      expect(target.removed.join('|')).not.toContain(QUARANTINE_DIR_NAME);
    }
  });
});
