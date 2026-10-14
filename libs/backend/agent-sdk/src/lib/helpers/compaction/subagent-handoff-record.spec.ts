import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  SubagentHandoffRecords,
  ownerHash,
  parseRecordHead,
  parseRecordName,
  recordFileName,
  renderRecord,
  taskFolderOf,
} from './subagent-handoff-record';

const SESSION = 'session-a';
const TOOL = 'toolu_01-abc_DEF';
const NOW = Date.UTC(2026, 9, 14, 21, 19, 0, 123);
const LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir';

function makeLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

describe('record names and heads', () => {
  it('round-trips a rendered record and its name', () => {
    const name = recordFileName(NOW, SESSION, TOOL, '0a1b2c3d');
    expect(name).toBe(
      `20261014T211900123Z-${ownerHash(SESSION)}-${TOOL}-0a1b2c3d.handoff.md`,
    );
    expect(parseRecordName(name ?? '')).toEqual({
      time: '20261014T211900123Z',
      owner: ownerHash(SESSION),
      tool: TOOL,
      nonce: '0a1b2c3d',
    });
    expect(parseRecordHead(renderRecord('the handoff'))).toBe('pending');
    expect(renderRecord('the handoff')).toContain('set `status: dismissed`');
  });

  it('reduces a hostile tool id to the name alphabet and refuses one with nothing usable', () => {
    const name = recordFileName(NOW, SESSION, '../x/y', '0a1b2c3d') ?? '';
    expect(parseRecordName(name)?.tool).toBe('___x_y');
    expect(recordFileName(NOW, SESSION, '../..', '0a1b2c3d')).toBeUndefined();
    expect(
      parseRecordName(
        recordFileName(NOW, SESSION, 'a'.repeat(90), '0a1b2c3d') ?? '',
      )?.tool,
    ).toHaveLength(64);
  });

  it.each([
    [
      'uppercase owner hex',
      `20261014T211900123Z-ABCDEF0123456789-tool-0a1b2c3d.handoff.md`,
    ],
    [
      'short nonce',
      `20261014T211900123Z-abcdef0123456789-tool-0a1b2c.handoff.md`,
    ],
    ['no time', `abcdef0123456789-tool-0a1b2c3d.handoff.md`],
    ['other suffix', `20261014T211900123Z-abcdef0123456789-tool-0a1b2c3d.md`],
  ])('rejects a name with %s', (_label, name) => {
    expect(parseRecordName(name)).toBeUndefined();
  });

  it('owner hashes separate ids the file-name sanitiser would merge', () => {
    expect(ownerHash('a.b')).not.toBe(ownerHash('a_b'));
    expect(ownerHash('a.b')).toMatch(/^[0-9a-f]{16}$/);
  });

  it.each([
    [
      'other keys before status',
      '---\nagent: x\nstatus: consumed\n---\nbody',
      'consumed',
    ],
    ['CRLF line ends', '---\r\nstatus: dismissed\r\n---\r\nbody', 'dismissed'],
    [
      'a duplicate status',
      '---\nstatus: pending\nstatus: consumed\n---\n',
      'malformed',
    ],
    ['an unknown value', '---\nstatus: done\n---\n', 'malformed'],
    [
      'no closing fence',
      `---\nstatus: consumed\n${'x'.repeat(10)}`,
      'malformed',
    ],
    ['a leading blank line', '\n---\nstatus: consumed\n---\n', 'malformed'],
    [
      'a line that is not key: value',
      '---\nstatus: consumed\nfree text\n---\n',
      'malformed',
    ],
  ])('parses a head with %s', (_label, head, expected) => {
    expect(parseRecordHead(head)).toBe(expected);
  });

  it('reads the task folder line of a spawning prompt', () => {
    expect(
      taskFolderOf('**Task Folder**: D:\\w\\.ptah\\specs\\TASK_1\nmore'),
    ).toBe('D:\\w\\.ptah\\specs\\TASK_1');
    expect(taskFolderOf('- **Task Folder:** `/w/.ptah/specs/T`')).toBe(
      '/w/.ptah/specs/T',
    );
    expect(taskFolderOf('no folder here')).toBeUndefined();
  });
});

describe('SubagentHandoffRecords', () => {
  let root: string;
  let workspace: string;
  let nonce: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-record-'));
    workspace = path.join(root, 'ws');
    fs.mkdirSync(workspace);
    nonce = '0a1b2c3d';
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function makeStore(ws: string | undefined = workspace) {
    const logger = makeLogger();
    const store = new SubagentHandoffRecords(
      logger as unknown as Logger,
      () => ws,
      () => NOW,
      () => nonce,
    );
    return { store, logger };
  }

  function handoffDir(): string {
    return path.join(workspace, '.ptah', 'subagent-handoffs');
  }

  it('writes one pending record named by time, owner, tool and nonce', async () => {
    const { store, logger } = makeStore();

    const result = await store.writeOnce(SESSION, TOOL, 'SECRET handoff');

    expect(result).toMatchObject({ ok: true, workspace });
    if (!result.ok) throw new Error('expected a record');
    expect(path.dirname(result.path)).toBe(handoffDir());
    expect(parseRecordName(result.name)?.owner).toBe(ownerHash(SESSION));
    const content = fs.readFileSync(result.path, 'utf8');
    expect(parseRecordHead(content)).toBe('pending');
    expect(content).toContain('SECRET handoff');
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('SECRET');
  });

  it('fails without a workspace, writing nothing', async () => {
    const store = new SubagentHandoffRecords(
      makeLogger() as unknown as Logger,
      () => undefined,
    );
    await expect(store.writeOnce(SESSION, TOOL, 't')).resolves.toEqual({
      ok: false,
      errorType: 'NoWorkspace',
    });
  });

  it('two concurrent writes for one tool id share one file', async () => {
    const { store } = makeStore();
    nonce = '11111111';
    const first = store.writeOnce(SESSION, TOOL, 'a');
    nonce = '22222222';
    const second = store.writeOnce('session-b', TOOL, 'b');

    const [a, b] = await Promise.all([first, second]);

    expect(a).toEqual(b);
    expect(fs.readdirSync(handoffDir())).toHaveLength(1);
  });

  it('an equal name (EEXIST) is a failed write and leaves the first record intact', async () => {
    const { store } = makeStore();
    const first = await store.writeOnce(SESSION, TOOL, 'first');
    if (!first.ok) throw new Error('expected a record');
    store.markInvoked(TOOL);
    store.forget(new Set([SESSION]));

    const second = await store.writeOnce(SESSION, TOOL, 'second');

    expect(second).toMatchObject({ ok: false, errorCode: 'EEXIST' });
    expect(fs.readFileSync(first.path, 'utf8')).toContain('first');
  });

  it('withdraw deletes a record whose stop was never invoked, and keeps an invoked one', async () => {
    const { store } = makeStore();
    const withdrawn = await store.writeOnce(SESSION, TOOL, 'a');
    if (!withdrawn.ok) throw new Error('expected a record');
    await store.withdraw(TOOL, withdrawn.path);
    expect(fs.existsSync(withdrawn.path)).toBe(false);

    nonce = '33333333';
    const kept = await store.writeOnce(SESSION, TOOL, 'b');
    if (!kept.ok) throw new Error('expected a record');
    store.markInvoked(TOOL);
    await store.withdraw(TOOL, kept.path);
    store.forget(new Set([SESSION]));
    await store.withdraw(TOOL, kept.path);

    expect(fs.existsSync(kept.path)).toBe(true);
  });

  it('a failed write frees the slot for a retry', async () => {
    const ws: { current?: string } = {};
    const logger = makeLogger();
    const store = new SubagentHandoffRecords(
      logger as unknown as Logger,
      () => ws.current,
      () => NOW,
      () => nonce,
    );
    await expect(store.writeOnce(SESSION, TOOL, 'a')).resolves.toMatchObject({
      ok: false,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      '[SubagentHandoffRecords] Handoff record not saved',
      expect.objectContaining({ toolCallId: TOOL, errorType: 'NoWorkspace' }),
    );
    ws.current = workspace;
    await expect(store.writeOnce(SESSION, TOOL, 'a')).resolves.toMatchObject({
      ok: true,
    });
  });

  it.each(['.ptah', 'handoff dir'])(
    'refuses to write when %s is a link or junction',
    async (which) => {
      const elsewhere = path.join(root, 'elsewhere');
      fs.mkdirSync(elsewhere);
      if (which === '.ptah') {
        fs.symlinkSync(elsewhere, path.join(workspace, '.ptah'), LINK_TYPE);
      } else {
        fs.mkdirSync(path.join(workspace, '.ptah'));
        fs.symlinkSync(elsewhere, handoffDir(), LINK_TYPE);
      }
      const { store } = makeStore();

      await expect(store.writeOnce(SESSION, TOOL, 't')).resolves.toMatchObject({
        ok: false,
        errorType: 'GuardRefused',
      });
      expect(fs.readdirSync(elsewhere)).toEqual([]);
    },
  );

  describe('task-folder stub', () => {
    let specs: string;
    let recordPath: string;
    let store: SubagentHandoffRecords;

    beforeEach(async () => {
      specs = path.join(workspace, '.ptah', 'specs');
      fs.mkdirSync(path.join(specs, 'TASK_1'), { recursive: true });
      store = makeStore().store;
      const written = await store.writeOnce(SESSION, TOOL, 't');
      if (!written.ok) throw new Error('expected a record');
      recordPath = written.path;
    });

    function stubs(folder: string): string[] {
      return fs.existsSync(folder)
        ? fs
            .readdirSync(folder)
            .filter((n) => n.startsWith('subagent-handoff-'))
        : [];
    }

    it('writes an immutable stub naming the record into a direct child of specs', async () => {
      await store.writeStub(
        `**Task Folder**: ${path.join(specs, 'TASK_1')}`,
        'backend-developer',
        recordPath,
      );
      const [stub] = stubs(path.join(specs, 'TASK_1'));
      expect(stub).toBe(`subagent-handoff-backend-developer-${nonce}.md`);
      expect(
        fs.readFileSync(path.join(specs, 'TASK_1', stub), 'utf8'),
      ).toContain(recordPath);
    });

    it.each([
      ['a `..` escape', () => path.join(specs, 'TASK_1', '..', '..', 'x')],
      ['an absolute folder elsewhere', () => root],
      ['a nested folder', () => path.join(specs, 'TASK_1', 'sub')],
    ])('writes no stub for %s, never throwing', async (_label, folder) => {
      const target = folder();
      fs.mkdirSync(target, { recursive: true });
      await expect(
        store.writeStub(`**Task Folder**: ${target}`, 'x', recordPath),
      ).resolves.toBeUndefined();
      expect(stubs(target)).toEqual([]);
    });

    it('writes no stub into a junctioned task folder or through a linked specs', async () => {
      const outside = path.join(root, 'outside');
      fs.mkdirSync(outside);
      fs.symlinkSync(outside, path.join(specs, 'TASK_J'), LINK_TYPE);
      await store.writeStub(
        `**Task Folder**: ${path.join(specs, 'TASK_J')}`,
        'x',
        recordPath,
      );
      expect(stubs(outside)).toEqual([]);

      fs.rmSync(specs, { recursive: true, force: true });
      const realSpecs = path.join(root, 'real-specs');
      fs.mkdirSync(path.join(realSpecs, 'TASK_2'), { recursive: true });
      fs.symlinkSync(realSpecs, specs, LINK_TYPE);
      await store.writeStub(
        `**Task Folder**: ${path.join(specs, 'TASK_2')}`,
        'x',
        recordPath,
      );
      expect(stubs(path.join(realSpecs, 'TASK_2'))).toEqual([]);
    });
  });
});
