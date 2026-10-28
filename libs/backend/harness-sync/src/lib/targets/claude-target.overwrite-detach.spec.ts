/**
 * The Claude target never overwrites a save made after planning
 * (TASK_2026_701 P1 review finding A1; D8).
 *
 * The plan schedules an `update` only for an owned copy that still held what
 * Ptah wrote, and a `create` only for a vacant path. Editor saves are not
 * serialized by the workspace lock, so apply re-decides on what is really
 * there: an owned copy is detached and decided on, a late edit is put back and
 * reported kept, and every publish is an exclusive create.
 *
 * Interleavings are produced deterministically by editing the workspace
 * between `plan` and `apply`.
 *
 * Source-under-test: `ClaudeTarget.plan` / `ClaudeTarget.apply` over a real
 * temp workspace and real temp sources. Nothing reaches the real home
 * directory.
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
import { hashDir, hashFile } from '../hash/content-hash';
import type { HarnessDesiredState } from '../manifest/desired-state.types';
import {
  emptyManifest,
  ManagedManifestStore,
  type ManagedManifest,
} from '../manifest-store/managed-manifest';
import { ClaudeTarget } from './claude-target';

const SKILL = '.claude/skills/alpha';
const COMMAND = '.claude/commands/run-it.md';
const HISTORY = '.ptah/harness/.history';

describe('ClaudeTarget — detach before replacing, exclusive create (P1 review A1)', () => {
  let tempRoot: string;
  let ws: string;
  let skillSource: string;
  let commandSource: string;
  let target: ClaudeTarget;

  const abs = (relPath: string): string => join(ws, ...relPath.split('/'));

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'harness-claude-detach-'));
    ws = join(tempRoot, 'workspace');
    skillSource = join(tempRoot, 'sources', 'skills', 'alpha');
    commandSource = join(tempRoot, 'sources', 'commands', 'run-it.md');
    mkdirSync(ws, { recursive: true });
    mkdirSync(skillSource, { recursive: true });
    mkdirSync(join(tempRoot, 'sources', 'commands'), { recursive: true });
    writeSources('v1');
    target = new ClaudeTarget(new ManagedManifestStore());
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function writeSources(version: string): void {
    writeFileSync(
      join(skillSource, 'SKILL.md'),
      `---\nname: alpha\ndescription: d\n---\nskill ${version}\n`,
      'utf-8',
    );
    writeFileSync(commandSource, `command ${version}\n`, 'utf-8');
  }

  async function desired(): Promise<HarnessDesiredState> {
    return {
      skills: [
        {
          slug: 'alpha',
          sourceDir: skillSource,
          contentHash: (await hashDir(skillSource)) ?? '',
        },
      ],
      commands: [
        {
          slug: 'run-it',
          sourceFile: commandSource,
          contentHash: (await hashFile(commandSource)) ?? '',
        },
      ],
      agents: [],
      mcp: [],
      collisions: [],
      sources: 'ok',
      sourceRoots: [join(tempRoot, 'sources')],
    };
  }

  /** One converged pass from an empty manifest: both copies owned, v1. */
  async function converge(): Promise<ManagedManifest> {
    const manifest = emptyManifest('claude');
    const plan = await target.plan(await desired(), ws, manifest);
    const result = await target.apply(plan, ws);
    expect(result.writeFailed).toEqual([]);
    return {
      ...manifest,
      entries: { ...plan.baseEntries, ...result.written },
    };
  }

  /** History is empty once a restored snapshot is discarded. */
  function historyFiles(): string[] {
    const root = abs(HISTORY);
    if (!existsSync(root)) return [];
    return readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  }

  it('still replaces an unmodified owned copy (the ordinary update)', async () => {
    const manifest = await converge();
    writeSources('v2');

    const plan = await target.plan(await desired(), ws, manifest);
    expect(plan.writes.map((w) => [w.relPath, w.reason])).toEqual([
      [SKILL, 'update'],
      [COMMAND, 'update'],
    ]);
    const result = await target.apply(plan, ws);

    expect(result.writeFailed).toEqual([]);
    expect(Object.keys(result.written).sort()).toEqual([COMMAND, SKILL]);
    expect(readFileSync(abs(COMMAND), 'utf-8')).toBe('command v2\n');
    expect(readFileSync(join(abs(SKILL), 'SKILL.md'), 'utf-8')).toContain(
      'skill v2',
    );
    expect(historyFiles()).toEqual([]);
  });

  it('keeps a COMMAND saved between plan and apply, with its old ownership hash', async () => {
    const manifest = await converge();
    const ownedHash = manifest.entries[COMMAND]?.hash;
    writeSources('v2');
    const plan = await target.plan(await desired(), ws, manifest);

    writeFileSync(abs(COMMAND), 'the user saved this late\n', 'utf-8');
    const result = await target.apply(plan, ws);

    expect(readFileSync(abs(COMMAND), 'utf-8')).toBe(
      'the user saved this late\n',
    );
    expect(result.keptLocalEdit).toContain(COMMAND);
    expect(result.written[COMMAND]).toBeUndefined();
    expect(result.writeFailed).toEqual([]);
    // Nothing lands in `written`, so the manifest keeps the old hash and the
    // next pass reaches the same "kept" answer.
    expect(plan.baseEntries[COMMAND]?.hash).toBe(ownedHash);
    expect(historyFiles()).toEqual([]);
  });

  it('keeps a SKILL directory edited between plan and apply, every file intact', async () => {
    const manifest = await converge();
    writeSources('v2');
    const plan = await target.plan(await desired(), ws, manifest);

    writeFileSync(join(abs(SKILL), 'SKILL.md'), 'edited late\n', 'utf-8');
    writeFileSync(join(abs(SKILL), 'mine.md'), 'a new file\n', 'utf-8');
    const result = await target.apply(plan, ws);

    expect(readFileSync(join(abs(SKILL), 'SKILL.md'), 'utf-8')).toBe(
      'edited late\n',
    );
    expect(readFileSync(join(abs(SKILL), 'mine.md'), 'utf-8')).toBe(
      'a new file\n',
    );
    expect(result.keptLocalEdit).toContain(SKILL);
    expect(result.written[SKILL]).toBeUndefined();
    expect(historyFiles()).toEqual([]);
  });

  it('never replaces a COMMAND the user created at a path the plan saw vacant', async () => {
    const plan = await target.plan(await desired(), ws, emptyManifest('claude'));
    expect(plan.writes.find((w) => w.relPath === COMMAND)?.reason).toBe(
      'create',
    );

    mkdirSync(abs('.claude/commands'), { recursive: true });
    writeFileSync(abs(COMMAND), 'mine, created meanwhile\n', 'utf-8');
    const result = await target.apply(plan, ws);

    expect(readFileSync(abs(COMMAND), 'utf-8')).toBe(
      'mine, created meanwhile\n',
    );
    expect(result.written[COMMAND]).toBeUndefined();
    expect(result.writeFailed).toEqual([
      {
        relPath: COMMAND,
        reason: `a new copy appeared at ${COMMAND} while it was being replaced; kept it`,
      },
    ]);
    // The other write in the same pass is unaffected.
    expect(result.written[SKILL]).toBeDefined();
  });

  it('never deletes or writes into a SKILL directory the user created at a path the plan saw vacant', async () => {
    const plan = await target.plan(await desired(), ws, emptyManifest('claude'));
    expect(plan.writes.find((w) => w.relPath === SKILL)?.reason).toBe(
      'create',
    );

    mkdirSync(abs(SKILL), { recursive: true });
    writeFileSync(join(abs(SKILL), 'notes.md'), 'my notes\n', 'utf-8');
    const result = await target.apply(plan, ws);

    expect(readdirSync(abs(SKILL))).toEqual(['notes.md']);
    expect(result.written[SKILL]).toBeUndefined();
    expect(result.writeFailed.map((f) => f.relPath)).toEqual([SKILL]);
    expect(result.written[COMMAND]).toBeDefined();
  });
});
