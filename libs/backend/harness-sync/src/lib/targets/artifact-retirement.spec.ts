/**
 * `retireOwnedArtifact` — detach first, decide on the detached object
 * (TASK_2026_609, code-logic-review findings 1 and 2).
 *
 * Real filesystem in a temp workspace. The two interleavings a disk cannot be
 * made to produce on demand (a save racing the detach, a rename that fails)
 * go through the module's own `RetirementHooks` seam, never a mock of `fs`.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { rename } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { hashDir, hashFile, MAX_DEPTH } from '../hash/content-hash';
import {
  retireOwnedArtifact,
  type RetireOwnedArtifactRequest,
} from './artifact-retirement';

const AGENT = '.codex/agents/agent-one.toml';
const SKILL = '.agents/skills/tuned';
const HISTORY = '.ptah/harness/.history';

describe('retireOwnedArtifact (TASK_2026_609)', () => {
  let ws: string;
  let outside: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'retire-ws-'));
    outside = mkdtempSync(join(tmpdir(), 'retire-outside-'));
    // The manifest store's own directory always exists beside the history.
    mkdirSync(join(ws, '.ptah', 'harness'), { recursive: true });
  });

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------- fixtures

  function abs(relPath: string): string {
    return join(ws, ...relPath.split('/'));
  }

  function writeAt(relPath: string, content: string): void {
    mkdirSync(join(abs(relPath), '..'), { recursive: true });
    writeFileSync(abs(relPath), content, 'utf-8');
  }

  async function ownedAgent(content = 'ptah wrote this'): Promise<string> {
    writeAt(AGENT, content);
    return (await hashFile(abs(AGENT))) as string;
  }

  async function ownedSkill(): Promise<string> {
    writeAt(`${SKILL}/SKILL.md`, '---\nname: tuned\n---\nbody\n');
    writeAt(`${SKILL}/refs/guide.md`, 'guide');
    return (await hashDir(abs(SKILL))) as string;
  }

  function request(
    relPath: string,
    isDirectory: boolean,
    ownedHash: string | undefined,
  ): RetireOwnedArtifactRequest {
    return { workspaceRoot: ws, relPath, isDirectory, ownedHash };
  }

  function snapshotOf(slug: string, relPath: string): string {
    const stamps = readdirSync(abs(`${HISTORY}/${slug}`));
    expect(stamps).toHaveLength(1);
    return abs(`${HISTORY}/${slug}/${stamps[0]}/${relPath}`);
  }

  function errnoError(code: string): NodeJS.ErrnoException {
    return Object.assign(new Error(`${code}: injected`), { code });
  }

  // ------------------------------------------------------- unchanged copies

  it('removes an unchanged file and leaves no history behind', async () => {
    const owned = await ownedAgent();

    const outcome = await retireOwnedArtifact(request(AGENT, false, owned));

    expect(outcome).toEqual({ kind: 'removed' });
    expect(existsSync(abs(AGENT))).toBe(false);
    expect(existsSync(abs(HISTORY))).toBe(false);
  });

  it('removes an unchanged skill directory and leaves no history behind', async () => {
    const owned = await ownedSkill();

    const outcome = await retireOwnedArtifact(request(SKILL, true, owned));

    expect(outcome).toEqual({ kind: 'removed' });
    expect(existsSync(abs(SKILL))).toBe(false);
    expect(existsSync(abs(HISTORY))).toBe(false);
  });

  it('an unchanged retirement never prunes an earlier snapshot of the same slug', async () => {
    const owned = await ownedAgent();
    writeAt(`${HISTORY}/agent-one/earlier/${AGENT}`, 'an older edit');

    const outcome = await retireOwnedArtifact(request(AGENT, false, owned));

    expect(outcome).toEqual({ kind: 'removed' });
    expect(readdirSync(abs(`${HISTORY}/agent-one`))).toEqual(['earlier']);
    expect(
      readFileSync(abs(`${HISTORY}/agent-one/earlier/${AGENT}`), 'utf-8'),
    ).toBe('an older edit');
  });

  // --------------------------------------------------------- edited copies

  it('keeps a hand-edited file as the snapshot', async () => {
    const owned = await ownedAgent();
    writeFileSync(abs(AGENT), 'HAND EDITED', 'utf-8');

    const outcome = await retireOwnedArtifact(request(AGENT, false, owned));

    const snapshot = snapshotOf('agent-one', AGENT);
    expect(outcome).toEqual({
      kind: 'removed-local-edit',
      snapshotPath: snapshot,
    });
    expect(existsSync(abs(AGENT))).toBe(false);
    expect(readFileSync(snapshot, 'utf-8')).toBe('HAND EDITED');
  });

  it("keeps a copy when no hash was recorded: nothing proves it is Ptah's", async () => {
    await ownedAgent();

    const outcome = await retireOwnedArtifact(request(AGENT, false, undefined));

    expect(outcome.kind).toBe('removed-local-edit');
    expect(readFileSync(snapshotOf('agent-one', AGENT), 'utf-8')).toBe(
      'ptah wrote this',
    );
  });

  // ------------------------------------------- F1: bytes the hash cannot see

  it.each([
    ['.history/notes.md', 'only copy of my notes'],
    ['_candidates/draft/SKILL.md', 'a synthesis draft'],
    ['.ptah-origin.json', '{"mine":true}'],
  ])(
    'F1: an otherwise unchanged skill holding %s is kept whole, those bytes included',
    async (inner, content) => {
      const owned = await ownedSkill();
      writeAt(`${SKILL}/${inner}`, content);
      // The filtered hash is still equal: this is the trap the old rule fell in.
      expect(await hashDir(abs(SKILL))).toBe(owned);

      const outcome = await retireOwnedArtifact(request(SKILL, true, owned));

      expect(outcome.kind).toBe('removed-local-edit');
      expect(existsSync(abs(SKILL))).toBe(false);
      const snapshot = snapshotOf('tuned', SKILL);
      expect(readFileSync(join(snapshot, ...inner.split('/')), 'utf-8')).toBe(
        content,
      );
    },
  );

  it('F1: a symlink inside the skill is kept as a link, never followed, and its target is untouched', async () => {
    const owned = await ownedSkill();
    writeFileSync(join(outside, 'precious.md'), 'outside bytes', 'utf-8');
    symlinkSync(outside, join(abs(SKILL), 'linked'), 'junction');
    expect(await hashDir(abs(SKILL))).toBe(owned);

    const outcome = await retireOwnedArtifact(request(SKILL, true, owned));

    expect(outcome.kind).toBe('removed-local-edit');
    const link = join(snapshotOf('tuned', SKILL), 'linked');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(outside, 'precious.md'), 'utf-8')).toBe(
      'outside bytes',
    );
  });

  it('F1: content nested deeper than the hash walks is kept', async () => {
    const owned = await ownedSkill();
    const deep = Array.from({ length: MAX_DEPTH + 1 }, () => 'd').join('/');
    writeAt(`${SKILL}/${deep}/buried.md`, 'deep bytes');
    expect(await hashDir(abs(SKILL))).toBe(owned);

    const outcome = await retireOwnedArtifact(request(SKILL, true, owned));

    expect(outcome.kind).toBe('removed-local-edit');
    const snapshot = snapshotOf('tuned', SKILL);
    expect(
      readFileSync(join(snapshot, ...deep.split('/'), 'buried.md'), 'utf-8'),
    ).toBe('deep bytes');
  });

  // ------------------------------------------------ F2: a save racing retirement

  it('F2: a save landing after the detach stays at the original path; the detached unchanged copy is discarded', async () => {
    const owned = await ownedAgent();

    const outcome = await retireOwnedArtifact(request(AGENT, false, owned), {
      afterDetach: async () => {
        writeFileSync(abs(AGENT), 'SAVED DURING RETIREMENT', 'utf-8');
      },
    });

    expect(outcome).toEqual({ kind: 'removed' });
    expect(readFileSync(abs(AGENT), 'utf-8')).toBe('SAVED DURING RETIREMENT');
    expect(existsSync(abs(HISTORY))).toBe(false);
  });

  it('F2: a save landing after the detach stays, and a detached edit is still kept', async () => {
    const owned = await ownedAgent();
    writeFileSync(abs(AGENT), 'EDIT A', 'utf-8');

    const outcome = await retireOwnedArtifact(request(AGENT, false, owned), {
      afterDetach: async () => {
        writeFileSync(abs(AGENT), 'EDIT B', 'utf-8');
      },
    });

    expect(outcome.kind).toBe('removed-local-edit');
    expect(readFileSync(abs(AGENT), 'utf-8')).toBe('EDIT B');
    expect(readFileSync(snapshotOf('agent-one', AGENT), 'utf-8')).toBe(
      'EDIT A',
    );
  });

  it('F2: a save landing before the detach is the object detached, and is kept because it differs', async () => {
    const owned = await ownedAgent();

    const outcome = await retireOwnedArtifact(request(AGENT, false, owned), {
      rename: async (from, to) => {
        writeFileSync(from, 'SAVED JUST BEFORE', 'utf-8');
        await rename(from, to);
      },
    });

    expect(outcome.kind).toBe('removed-local-edit');
    expect(existsSync(abs(AGENT))).toBe(false);
    expect(readFileSync(snapshotOf('agent-one', AGENT), 'utf-8')).toBe(
      'SAVED JUST BEFORE',
    );
  });

  // ------------------------------------------------------ detach failures

  it.each(['EXDEV', 'EBUSY'])(
    'a rename failing with %s removes nothing, leaves no history, and the next attempt retires it',
    async (code) => {
      const owned = await ownedAgent();
      const failing = jest.fn(async () => {
        throw errnoError(code);
      });

      const outcome = await retireOwnedArtifact(request(AGENT, false, owned), {
        rename: failing,
      });

      expect(outcome.kind).toBe('failed');
      expect(outcome.kind === 'failed' && outcome.reason).toMatch(
        new RegExp(`could not detach for removal: ${code}`),
      );
      expect(readFileSync(abs(AGENT), 'utf-8')).toBe('ptah wrote this');
      expect(existsSync(abs(HISTORY))).toBe(false);

      const retried = await retireOwnedArtifact(request(AGENT, false, owned));
      expect(retried).toEqual({ kind: 'removed' });
      expect(existsSync(abs(AGENT))).toBe(false);
    },
  );

  it('a copy that vanished before the rename is reported removed, with no history left', async () => {
    const owned = await ownedAgent();

    const outcome = await retireOwnedArtifact(request(AGENT, false, owned), {
      rename: async (from) => {
        rmSync(from);
        throw errnoError('ENOENT');
      },
    });

    expect(outcome).toEqual({ kind: 'removed' });
    expect(existsSync(abs(HISTORY))).toBe(false);
  });

  it('an unwritable history store removes nothing, unchanged copies included', async () => {
    const owned = await ownedAgent();
    writeFileSync(abs(HISTORY), 'not a directory', 'utf-8');

    const outcome = await retireOwnedArtifact(request(AGENT, false, owned));

    expect(outcome.kind).toBe('failed');
    expect(outcome.kind === 'failed' && outcome.reason).toMatch(
      /could not save local edit before removal/,
    );
    expect(readFileSync(abs(AGENT), 'utf-8')).toBe('ptah wrote this');
  });

  // ------------------------------------------------------- odd path states

  it('a directory where a file was recorded is not removed', async () => {
    writeAt(`${AGENT}/inner.txt`, 'something');

    const outcome = await retireOwnedArtifact(request(AGENT, false, 'any'));

    expect(outcome).toEqual({
      kind: 'failed',
      reason: `cannot read to check for local edits: ${AGENT} is not a readable file`,
    });
    expect(existsSync(abs(`${AGENT}/inner.txt`))).toBe(true);
    expect(existsSync(abs(HISTORY))).toBe(false);
  });

  it('an absent path is reported removed', async () => {
    const outcome = await retireOwnedArtifact(request(SKILL, true, 'any'));

    expect(outcome).toEqual({ kind: 'removed' });
  });

  it('a symlink at the owned path is unlinked, never followed or snapshotted', async () => {
    writeFileSync(join(outside, 'precious.md'), 'outside bytes', 'utf-8');
    mkdirSync(join(abs(SKILL), '..'), { recursive: true });
    symlinkSync(outside, abs(SKILL), 'junction');

    const outcome = await retireOwnedArtifact(request(SKILL, true, 'any'));

    expect(outcome).toEqual({ kind: 'removed' });
    expect(existsSync(abs(SKILL))).toBe(false);
    expect(readFileSync(join(outside, 'precious.md'), 'utf-8')).toBe(
      'outside bytes',
    );
    expect(existsSync(abs(HISTORY))).toBe(false);
  });
});
