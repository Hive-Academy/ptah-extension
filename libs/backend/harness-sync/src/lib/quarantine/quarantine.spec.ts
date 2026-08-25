/**
 * The quarantine convention (TASK_2026_306, Batch 8 / Task 8.1).
 *
 * Source-under-test: `lib/quarantine/quarantine.ts`.
 *
 * Everything here is about the property the repair's whole safety argument
 * rests on: the occupant is somewhere else, provably, before anything is
 * written where it used to be. A move that silently half-happened would satisfy
 * a happy-path test and lose a user's directory, so the move is asserted from
 * BOTH ends every time — destination present, source gone, bytes intact.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * A `rename` that can be told to COPY INSTEAD OF MOVING, and report success.
 *
 * This is the only way to reach `assertMoved`'s SOURCE-side check. Against a
 * real temp directory a `rename` that resolves always removes the source, so
 * no fixture built on real filesystem semantics can produce "resolved, the
 * destination is there, and the source is still there too" — which is
 * precisely the failure the assertion names: a silently-failing overlay
 * filesystem or a stale handle where the write half lands and the unlink half
 * does not. The assertion is unfalsifiable BY THE FIXTURE, not unfalsifiable
 * inherently, and those are different claims. This stub closes the gap.
 *
 * It must COPY rather than do nothing: a no-op would fail the destination-side
 * check first and never reach the one under test.
 *
 * Default is off, delegating to the real `rename`, so every other case in this
 * file and every module in its graph behaves exactly as it did before.
 */
let renameLiesFor: ((from: string, to: string) => boolean) | null = null;

/**
 * The other lie: the source is removed and the destination never appears, and
 * `rename` still reports success. This is what reaches the DESTINATION-side
 * half of `assertMoved`, which the copy-flavoured lie above cannot — with the
 * source still present, the source-side check fires first and the destination
 * check is never the one that throws.
 */
let renameVanishesFor: ((from: string, to: string) => boolean) | null = null;

jest.mock('fs/promises', () => {
  const actual = jest.requireActual('fs/promises');
  return {
    ...actual,
    rename: async (from: string, to: string): Promise<void> => {
      if (renameVanishesFor?.(from, to) === true) {
        await actual.rm(from, { recursive: true, force: true });
        return; // reports success; nothing arrives
      }
      if (renameLiesFor?.(from, to) === true) {
        await actual.cp(from, to, { recursive: true });
        return; // reports success; the source survives
      }
      return actual.rename(from, to);
    },
  };
});

import {
  formatQuarantineTimestamp,
  isQuarantineEntry,
  moveToQuarantine,
  quarantineDirFor,
  restoreFromQuarantine,
  QUARANTINE_DIR_NAME,
} from './quarantine';

const FIXED = new Date('2026-08-23T14:15:30.123Z');
const STAMP = '20260823T141530123';

describe('the quarantine convention', () => {
  let root: string;
  let skillsDir: string;
  let occupant: string;

  /** A directory of the user's, with content we can prove survived. */
  function writeOccupant(name = 'alpha'): string {
    const dir = join(skillsDir, name);
    mkdirSync(join(dir, 'reference'), { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), 'hand-written by the user\n', 'utf-8');
    writeFileSync(join(dir, 'reference', 'notes.md'), 'nested\n', 'utf-8');
    return dir;
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'harness-quarantine-'));
    skillsDir = join(root, '.claude', 'skills');
    mkdirSync(skillsDir, { recursive: true });
    occupant = writeOccupant();
    renameLiesFor = null;
    renameVanishesFor = null;
  });

  afterEach(() => {
    renameLiesFor = null;
    renameVanishesFor = null;
    rmSync(root, { recursive: true, force: true });
  });

  describe('naming and the ignore rule', () => {
    it('recognises only the exact directory name, not anything dot-prefixed', () => {
      // A prefix rule would be a DIFFERENT rule that happens to agree today:
      // `.ptah-managed.json` and `.mcp.json` are both dot-prefixed and both
      // very much scanned.
      expect(isQuarantineEntry(QUARANTINE_DIR_NAME)).toBe(true);
      expect(isQuarantineEntry('.ptah-managed.json')).toBe(false);
      expect(isQuarantineEntry('.mcp.json')).toBe(false);
      expect(isQuarantineEntry('.ptah-quarantine-old')).toBe(false);
      expect(isQuarantineEntry('ptah-quarantine')).toBe(false);
    });

    it('places the quarantine ALONGSIDE the occupant, which is what makes the move same-volume', () => {
      // U2: not `~/.ptah/` (a workspace on D: and a home on C: is the common
      // Windows case, and that move is a cross-volume copy).
      expect(quarantineDirFor(occupant)).toBe(
        join(skillsDir, QUARANTINE_DIR_NAME),
      );
    });

    it('stamps to the millisecond so two repairs of one slug in the same SECOND cannot collide', () => {
      expect(formatQuarantineTimestamp(FIXED)).toBe(STAMP);
      const sameSecond = new Date('2026-08-23T14:15:30.987Z');
      expect(formatQuarantineTimestamp(sameSecond)).not.toBe(STAMP);
      expect(formatQuarantineTimestamp(sameSecond)).toBe('20260823T141530987');
    });
  });

  describe('moveToQuarantine', () => {
    it('moves the occupant to `<dir>/.ptah-quarantine/<name>-<timestamp>` with its content intact', async () => {
      const { quarantinePath } = await moveToQuarantine(occupant, FIXED);

      expect(quarantinePath).toBe(
        join(skillsDir, QUARANTINE_DIR_NAME, `alpha-${STAMP}`),
      );
      expect(readFileSync(join(quarantinePath, 'SKILL.md'), 'utf-8')).toBe(
        'hand-written by the user\n',
      );
      // Nested content too: this is a MOVE of a tree, not a copy of one file.
      expect(
        readFileSync(join(quarantinePath, 'reference', 'notes.md'), 'utf-8'),
      ).toBe('nested\n');
    });

    it('leaves the original path VACANT, which is the precondition for any write', async () => {
      await moveToQuarantine(occupant, FIXED);
      expect(existsSync(occupant)).toBe(false);
    });

    it('resolves a same-millisecond collision by suffixing, keeping BOTH originals', async () => {
      const first = await moveToQuarantine(occupant, FIXED);
      writeOccupant('alpha');
      writeFileSync(join(occupant, 'SKILL.md'), 'the second one\n', 'utf-8');

      const second = await moveToQuarantine(occupant, FIXED);

      expect(second.quarantinePath).toBe(`${first.quarantinePath}-2`);
      // The timestamp is what a human reads to find their directory again, so
      // it stays the moment of the repair rather than being re-rolled.
      expect(second.quarantinePath).toContain(STAMP);
      expect(
        readFileSync(join(first.quarantinePath, 'SKILL.md'), 'utf-8'),
      ).toBe('hand-written by the user\n');
      expect(
        readFileSync(join(second.quarantinePath, 'SKILL.md'), 'utf-8'),
      ).toBe('the second one\n');
    });

    it('throws and leaves the occupant EXACTLY where it was when the quarantine cannot be created', async () => {
      // A file sitting where the quarantine directory must go. The caller turns
      // this into `move-failed` and must not proceed to the write.
      writeFileSync(join(skillsDir, QUARANTINE_DIR_NAME), 'not a dir', 'utf-8');

      await expect(moveToQuarantine(occupant, FIXED)).rejects.toThrow();

      expect(readFileSync(join(occupant, 'SKILL.md'), 'utf-8')).toBe(
        'hand-written by the user\n',
      );
      expect(statSync(occupant).isDirectory()).toBe(true);
    });

    it('REJECTS when rename resolves but the occupant is still in place — a lying filesystem', async () => {
      // The runtime enforcement of this batch's entire safety argument: the
      // occupant must be provably elsewhere before anything is written where it
      // used to be. A `rename` that reports success and does nothing would
      // otherwise leave the caller believing the path is vacant.
      renameLiesFor = (from) => from === occupant;

      await expect(moveToQuarantine(occupant, FIXED)).rejects.toThrow(
        /is still in place/,
      );

      // Untouched, and — because the move threw — the caller writes nothing.
      expect(readFileSync(join(occupant, 'SKILL.md'), 'utf-8')).toBe(
        'hand-written by the user\n',
      );
    });

    it('REJECTS when rename resolves but nothing arrives at the destination', async () => {
      // The other half of the same assertion. Both halves matter: this one is
      // the signature of a copy-then-delete fallback whose copy silently did
      // nothing, and reporting the move as a success there would tell the
      // caller the original is safely aside when it is simply gone.
      renameVanishesFor = (from) => from === occupant;

      await expect(moveToQuarantine(occupant, FIXED)).rejects.toThrow(
        /does not exist/,
      );
    });

    it('moves a single FILE occupant too — a blocked command is not a directory', async () => {
      const commandsDir = join(root, '.claude', 'commands');
      mkdirSync(commandsDir, { recursive: true });
      const command = join(commandsDir, 'run-it.md');
      writeFileSync(command, 'the user wrote this command\n', 'utf-8');

      const { quarantinePath } = await moveToQuarantine(command, FIXED);

      expect(quarantinePath).toBe(
        join(commandsDir, QUARANTINE_DIR_NAME, `run-it.md-${STAMP}`),
      );
      expect(readFileSync(quarantinePath, 'utf-8')).toBe(
        'the user wrote this command\n',
      );
      expect(existsSync(command)).toBe(false);
    });
  });

  describe('restoreFromQuarantine', () => {
    it('puts the occupant back byte-identical', async () => {
      const { quarantinePath } = await moveToQuarantine(occupant, FIXED);

      const { supersededPath } = await restoreFromQuarantine(
        quarantinePath,
        occupant,
        FIXED,
      );

      expect(readFileSync(join(occupant, 'SKILL.md'), 'utf-8')).toBe(
        'hand-written by the user\n',
      );
      expect(
        readFileSync(join(occupant, 'reference', 'notes.md'), 'utf-8'),
      ).toBe('nested\n');
      expect(existsSync(quarantinePath)).toBe(false);
      // Nothing was on the path, so nothing was displaced.
      expect(supersededPath).toBeUndefined();
    });

    it('MOVES a half-finished managed copy aside rather than deleting it', async () => {
      const { quarantinePath } = await moveToQuarantine(occupant, FIXED);
      // What a `copyDirectory` that threw part-way leaves behind. There is no
      // `rm` on this path: the repair releases the workspace lock before the
      // write pass, so the restore window is NOT exclusive and an argument
      // about who else could have written here would be unsound.
      mkdirSync(occupant, { recursive: true });
      writeFileSync(join(occupant, 'SKILL.md'), 'half a managed copy', 'utf-8');

      const { supersededPath } = await restoreFromQuarantine(
        quarantinePath,
        occupant,
        FIXED,
      );

      expect(readFileSync(join(occupant, 'SKILL.md'), 'utf-8')).toBe(
        'hand-written by the user\n',
      );
      expect(existsSync(join(occupant, 'reference', 'notes.md'))).toBe(true);
      // And the obstruction survives, named, in the quarantine beside it.
      expect(supersededPath).toBe(
        join(skillsDir, QUARANTINE_DIR_NAME, `alpha.superseded-${STAMP}`),
      );
      expect(
        readFileSync(join(supersededPath as string, 'SKILL.md'), 'utf-8'),
      ).toBe('half a managed copy');
    });

    it('throws when the quarantined original is gone, so the caller can name the path it looked for', async () => {
      const { quarantinePath } = await moveToQuarantine(occupant, FIXED);
      rmSync(quarantinePath, { recursive: true, force: true });

      await expect(
        restoreFromQuarantine(quarantinePath, occupant, FIXED),
      ).rejects.toThrow();
    });

    it('leaves the (now empty) quarantine directory behind — there is deliberately no cleanup', async () => {
      const { quarantinePath } = await moveToQuarantine(occupant, FIXED);
      await restoreFromQuarantine(quarantinePath, occupant, FIXED);

      // U4: no TTL, no sweep, no purge-on-boot. An expiry policy silently
      // converts a reversible operation into a destructive one on a timer, so
      // even the trivially-safe empty-directory case is left alone rather than
      // establishing a cleanup path somebody later generalises.
      const quarantineDir = quarantineDirFor(occupant);
      expect(existsSync(quarantineDir)).toBe(true);
      expect(readdirSync(quarantineDir)).toEqual([]);
    });
  });
});
