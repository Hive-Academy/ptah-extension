import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  HANDOFF_RETENTION_MS,
  INDEX_RESCAN_MS,
  MAX_HEAD_READS,
  SubagentHandoffIndex,
  type HandoffIndexFs,
  type HandoffPointerAudience,
} from './subagent-handoff-index';
import {
  ownerHash,
  recordFileName,
  renderRecord,
} from './subagent-handoff-record';

const DAY = 24 * 60 * 60 * 1_000;
const NOW = Date.UTC(2026, 9, 14, 12, 0, 0, 0);
const OWN = 'session-own';
const OTHER = 'session-other';
const BODY = 'BODY-SECRET handoff text';
const LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir';

function makeLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function audience(
  own: string = OWN,
  hidden: readonly string[] = [],
): HandoffPointerAudience {
  return {
    own: new Set([ownerHash(own)]),
    hidden: new Set(hidden.map(ownerHash)),
    cursorKey: ownerHash(own),
  };
}

/** The real filesystem, with overrides for fault schedules. */
function nodeFs(overrides: Partial<HandoffIndexFs> = {}): HandoffIndexFs {
  return {
    readdir: (dir) => fsp.readdir(dir),
    lstat: (file) => fsp.lstat(file),
    readHead: async (file, bytes) =>
      (await fsp.readFile(file, 'utf8')).slice(0, bytes),
    unlink: (file) => fsp.unlink(file),
    ...overrides,
  };
}

describe('SubagentHandoffIndex', () => {
  let root: string;
  let dir: string;
  let clock: number;
  let seq: number;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-index-'));
    dir = path.join(root, '.ptah', 'subagent-handoffs');
    fs.mkdirSync(dir, { recursive: true });
    clock = NOW;
    seq = 0;
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function makeIndex(files?: HandoffIndexFs) {
    const logger = makeLogger();
    const index = new SubagentHandoffIndex(
      logger as unknown as Logger,
      () => clock,
      files,
    );
    return { index, logger };
  }

  /** Write one record; returns its absolute path. */
  function record(
    opts: {
      owner?: string;
      content?: string;
      ageMs?: number;
      tool?: string;
    } = {},
  ): string {
    seq += 1;
    const name =
      recordFileName(
        NOW - 1_000_000 + seq,
        opts.owner ?? OWN,
        opts.tool ?? `toolu_${seq}`,
        seq.toString(16).padStart(8, '0'),
      ) ?? '';
    const file = path.join(dir, name);
    fs.writeFileSync(file, opts.content ?? renderRecord(BODY));
    if (opts.ageMs !== undefined) {
      const at = new Date(NOW - opts.ageMs);
      fs.utimesSync(file, at, at);
    }
    return file;
  }

  function listed(pointer: string | undefined): string[] {
    return (pointer ?? '')
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).split(' (')[0]);
  }

  it("lists a previous run's pending record with the header, paths only", async () => {
    const file = record();
    const { index } = makeIndex();

    const pointer = await index.pointerFor(root, audience());

    expect(pointer).toContain(
      'Ptah: subagent handoff records are pending. For each: read it',
    );
    expect(pointer).toContain(`- ${file}`);
    expect(pointer).not.toContain('BODY-SECRET');
    expect(pointer).not.toContain('from another or an ended session');
  });

  it('names nothing when the directory is missing or empty', async () => {
    fs.rmSync(path.join(root, '.ptah'), { recursive: true, force: true });
    const { index } = makeIndex();
    await expect(index.pointerFor(root, audience())).resolves.toBeUndefined();
  });

  it('23 pending records are named 10, 10, 3 on successive prompts, then wrap', async () => {
    const files = Array.from({ length: 23 }, () => record());
    const { index } = makeIndex();

    const first = await index.pointerFor(root, audience());
    const second = await index.pointerFor(root, audience());
    const third = await index.pointerFor(root, audience());
    const fourth = await index.pointerFor(root, audience());

    expect(listed(first)).toEqual(files.slice(0, 10));
    expect(first).toContain(`Ptah: 13 more handoff records in \`${dir}\``);
    expect(listed(second)).toEqual(files.slice(10, 20));
    expect(listed(third)).toEqual(files.slice(20));
    expect(third).toContain('Ptah: 20 more handoff records');
    expect(listed(fourth)).toEqual(files.slice(0, 10));
  });

  it('2 050 names: every pending record is named eventually', async () => {
    const names = Array.from(
      { length: 2_050 },
      (_, i) =>
        recordFileName(
          NOW + i,
          OWN,
          `toolu_${i}`,
          i.toString(16).padStart(8, '0'),
        ) ?? '',
    );
    const files = nodeFs({
      readdir: async () => [...names].reverse(),
      lstat: async () => ({ isFile: () => true, mtimeMs: NOW }),
      readHead: async () => renderRecord(BODY),
    });
    const { index } = makeIndex(files);
    const seen = new Set<string>();

    const prompts = Math.ceil(names.length / MAX_HEAD_READS);
    for (let i = 0; i < prompts; i += 1) {
      for (const file of listed(await index.pointerFor(root, audience()))) {
        seen.add(path.basename(file));
      }
    }

    expect(seen.size).toBe(names.length);
  });

  it('drops consumed and dismissed records; deletes only resolved ones older than 7 days', async () => {
    const oldConsumed = record({
      content: '---\nstatus: consumed\n---\n',
      ageMs: 8 * DAY,
    });
    const newConsumed = record({
      content: '---\nstatus: consumed\n---\n',
      ageMs: DAY,
    });
    const dismissed = record({ content: '---\nstatus: dismissed\n---\n' });
    const oldPending = record({ ageMs: 30 * DAY });
    const oldMalformed = record({ content: 'no frontmatter', ageMs: 30 * DAY });
    const { index } = makeIndex();

    const pointer = await index.pointerFor(root, audience());

    expect(listed(pointer)).toEqual([oldPending, oldMalformed]);
    expect(pointer).toContain(`- ${oldMalformed} (frontmatter unreadable)`);
    expect(fs.existsSync(oldConsumed)).toBe(false);
    expect(fs.existsSync(newConsumed)).toBe(true);
    expect(fs.existsSync(dismissed)).toBe(true);
    expect(fs.existsSync(oldPending)).toBe(true);
    expect(fs.existsSync(oldMalformed)).toBe(true);
    expect(HANDOFF_RETENTION_MS).toBe(7 * DAY);

    // Resolved records left the list: the next prompt reads only the two left.
    expect(listed(await index.pointerFor(root, audience()))).toEqual([
      oldPending,
      oldMalformed,
    ]);
  });

  it('skips a link entry without deleting it', async () => {
    const target = path.join(root, 'target');
    fs.mkdirSync(target);
    const name =
      recordFileName(NOW, OWN, 'toolu_link', 'ffffffff') ?? 'missing';
    fs.symlinkSync(target, path.join(dir, name), LINK_TYPE);
    const { index } = makeIndex();

    await expect(index.pointerFor(root, audience())).resolves.toBeUndefined();
    expect(fs.existsSync(path.join(dir, name))).toBe(true);
    expect(fs.existsSync(target)).toBe(true);
  });

  it("hides another live owner's records (not even read) and shows a foreign owner with takeover text", async () => {
    const hiddenRecord = record({ owner: OTHER });
    const hiddenMalformed = record({ owner: OTHER, content: 'x' });
    const foreign = record({ owner: 'ended-session' });
    const readHead = jest.fn(async (file: string, bytes: number) =>
      (await fsp.readFile(file, 'utf8')).slice(0, bytes),
    );
    const { index } = makeIndex(nodeFs({ readHead }));

    const pointer = await index.pointerFor(root, audience(OWN, [OTHER]));

    expect(pointer).not.toContain(hiddenRecord);
    expect(pointer).not.toContain(hiddenMalformed);
    expect(readHead.mock.calls.map(([file]) => file)).toEqual([foreign]);
    expect(pointer).toContain(
      `- ${foreign} (from another or an ended session; continue it only if that session is not running, else leave it)`,
    );
  });

  it('a first readdir slower than the budget gives the timeout line; the next prompt lists', async () => {
    const file = record();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { index } = makeIndex(
      nodeFs({
        readdir: async (d) => {
          await gate;
          return fsp.readdir(d);
        },
      }),
    );

    const pointer = await index.pointerFor(root, audience());
    expect(pointer).toBe(
      `Ptah: handoff records could not be checked in time; look in \`${dir}\` for \`*.handoff.md\` files with \`status: pending\`.`,
    );

    release();
    await gate;
    expect(listed(await index.pointerFor(root, audience()))).toEqual([file]);
  });

  it('a record published during the load is merged into the loaded list', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let names: string[] = [];
    const { index } = makeIndex(
      nodeFs({
        readdir: async () => {
          await gate;
          return names;
        },
      }),
    );
    // Starts the load; it waits on the gate past the budget.
    await index.pointerFor(root, audience());
    const file = record();
    names = [];
    index.publish(root, path.basename(file));
    release();

    expect(listed(await index.pointerFor(root, audience()))).toEqual([file]);
  });

  it("two sessions keep separate cursors and never skip each other's records", async () => {
    const files = Array.from({ length: 12 }, () => record({ owner: 'ended' }));
    const { index } = makeIndex();

    const a1 = listed(await index.pointerFor(root, audience('session-a')));
    const b1 = listed(await index.pointerFor(root, audience('session-b')));
    const a2 = listed(await index.pointerFor(root, audience('session-a')));

    expect(a1).toEqual(files.slice(0, 10));
    expect(b1).toEqual(files.slice(0, 10));
    expect(a2).toEqual(files.slice(10));
  });

  it('a record another host writes after the load is named once the list is a rescan period old', async () => {
    const { index } = makeIndex();
    await expect(index.pointerFor(root, audience())).resolves.toBeUndefined();

    const later = record({ owner: 'other-host-session' });
    await expect(index.pointerFor(root, audience())).resolves.toBeUndefined();

    clock += INDEX_RESCAN_MS;
    // This prompt starts the rescan and still uses the old list.
    await index.pointerFor(root, audience());
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(listed(await index.pointerFor(root, audience()))).toEqual([later]);
  });

  it('a record whose head read fails on every prompt is listed to open directly and never starves the rest', async () => {
    const failing = record();
    const files = Array.from({ length: 12 }, () => record());
    const { index, logger } = makeIndex(
      nodeFs({
        readHead: async (file, bytes) => {
          if (file === failing) {
            throw Object.assign(new Error('denied'), { code: 'EACCES' });
          }
          return (await fsp.readFile(file, 'utf8')).slice(0, bytes);
        },
      }),
    );

    const first = await index.pointerFor(root, audience());
    const second = await index.pointerFor(root, audience());

    expect(first).toContain(
      `- ${failing} (could not be read; open it directly)`,
    );
    expect(listed(first)).toEqual([failing, ...files.slice(0, 9)]);
    expect(listed(second)).toEqual(files.slice(9));
    expect(fs.existsSync(failing)).toBe(true);
    expect(logger.debug).toHaveBeenCalledWith(
      '[SubagentHandoffIndex] Handoff record head not read',
      { errorCode: 'EACCES' },
    );
  });

  it('a failing record and a readable pending one are both listed on every prompt', async () => {
    const failing = record();
    const readable = record();
    const { index } = makeIndex(
      nodeFs({
        lstat: async (file) => {
          if (file === failing) {
            throw Object.assign(new Error('denied'), { code: 'EACCES' });
          }
          return fsp.lstat(file);
        },
      }),
    );

    for (let i = 0; i < 3; i += 1) {
      const pointer = await index.pointerFor(root, audience());
      expect(listed(pointer)).toEqual([failing, readable]);
      expect(pointer).toContain(
        `- ${failing} (could not be read; open it directly)`,
      );
    }
  });

  it("forgetCursor restarts a session's rotation", async () => {
    const files = Array.from({ length: 11 }, () => record());
    const { index } = makeIndex();
    await index.pointerFor(root, audience());

    index.forgetCursor(ownerHash(OWN));

    expect(listed(await index.pointerFor(root, audience()))).toEqual(
      files.slice(0, 10),
    );
  });
});
