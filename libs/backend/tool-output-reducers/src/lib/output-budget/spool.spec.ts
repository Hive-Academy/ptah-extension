import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  relativeSpoolLocator,
  spoolFileName,
  spoolLocation,
  spoolToolText,
  writeSpoolFile,
} from './spool';

const SPOOL_NAME = /^[A-Za-z0-9_-]{1,64}-\d{1,16}-[0-9a-f]{4}\.txt$/;

let root: string;

beforeEach(() => {
  root = fsSync.mkdtempSync(path.join(os.tmpdir(), 'output-spool-'));
});

afterEach(() => {
  jest.restoreAllMocks();
  fsSync.rmSync(root, { recursive: true, force: true });
});

function spoolDir(base = root): string {
  return path.join(base, '.ptah', 'tmp', 'mcp-out');
}

describe('spoolToolText', () => {
  it('writes the text under <root>/.ptah/tmp/mcp-out with a safe name', async () => {
    const outcome = await spoolToolText('full text', root, 'a/b:c');
    if (!('path' in outcome)) throw new Error(outcome.failure);
    expect(path.dirname(outcome.path)).toBe(spoolDir());
    expect(path.basename(outcome.path)).toMatch(SPOOL_NAME);
    expect(path.basename(outcome.path).startsWith('a_b_c-')).toBe(true);
    expect(fsSync.readFileSync(outcome.path, 'utf8')).toBe('full text');
  });

  it('falls back to the system temp directory for a relative or empty root', () => {
    const tmp = path.resolve(os.tmpdir());
    expect(spoolLocation('')).toEqual({
      dir: spoolDir(tmp),
      rootLabel: 'system temp directory',
    });
    expect(spoolLocation('relative/dir').dir).toBe(spoolDir(tmp));
    expect(spoolLocation(root)).toEqual({
      dir: spoolDir(path.resolve(root)),
      rootLabel: 'workspace root',
    });
  });

  it('reports an errno code, never the error message, when the write fails', async () => {
    jest
      .spyOn(fsSync.promises, 'writeFile')
      .mockRejectedValue(
        Object.assign(new Error('EACCES /private/path'), { code: 'EACCES' }),
      );
    await expect(spoolToolText('x', root, 1)).resolves.toEqual({
      failure: 'EACCES',
    });
  });

  it('reports only a built-in error name when there is no errno code', async () => {
    jest
      .spyOn(fsSync.promises, 'writeFile')
      .mockRejectedValue(
        Object.assign(new Error('x'), { name: '/private/SECRET' }),
      );
    await expect(spoolToolText('x', root, 1)).resolves.toEqual({
      failure: 'Error',
    });
  });

  it('never overwrites an existing file: another name is tried', async () => {
    const exists = Object.assign(new Error('exists'), { code: 'EEXIST' });
    const write = jest
      .spyOn(fsSync.promises, 'writeFile')
      .mockRejectedValueOnce(exists) // the .gitignore write
      .mockRejectedValueOnce(exists); // the first spool file name
    const outcome = await spoolToolText('second', root, 7);
    expect(write).toHaveBeenCalledTimes(3);
    expect('path' in outcome).toBe(true);
  });
});

describe('spool .gitignore', () => {
  it('writes a catch-all .gitignore once and never overwrites one', async () => {
    const dir = spoolDir();
    await writeSpoolFile('a', dir, 1);
    const ignore = path.join(dir, '.gitignore');
    expect(fsSync.readFileSync(ignore, 'utf8')).toBe('*\n');
    fsSync.writeFileSync(ignore, 'custom\n');
    await writeSpoolFile('b', dir, 2);
    expect(fsSync.readFileSync(ignore, 'utf8')).toBe('custom\n');
  });

  it('still spools when the .gitignore cannot be written', async () => {
    const dir = spoolDir();
    fsSync.mkdirSync(path.join(dir, '.gitignore'), { recursive: true });
    const outcome = await writeSpoolFile('c', dir, 3);
    expect('path' in outcome).toBe(true);
  });
});

describe('writeSpoolFile pruning', () => {
  it('deletes only its own files older than a day', async () => {
    const dir = spoolDir();
    fsSync.mkdirSync(dir, { recursive: true });
    const stale = path.join(dir, 'old-1700000000000-abcd.txt');
    const foreign = path.join(dir, 'notes.txt');
    fsSync.writeFileSync(stale, 'old');
    fsSync.writeFileSync(foreign, 'keep');
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    fsSync.utimesSync(stale, old, old);
    fsSync.utimesSync(foreign, old, old);
    const outcome = await writeSpoolFile('new', dir, 'prune');
    expect(fsSync.existsSync(stale)).toBe(false);
    expect(fsSync.existsSync(foreign)).toBe(true);
    expect('path' in outcome && fsSync.existsSync(outcome.path)).toBe(true);
  });
});

describe('spool names and locators', () => {
  it('uses "call" for an empty id and caps the id at 64 chars', () => {
    expect(spoolFileName(undefined, 'beef')).toMatch(/^call-\d+-beef\.txt$/);
    const long = spoolFileName('x'.repeat(200), 'beef');
    expect(long).toMatch(SPOOL_NAME);
    expect(long.split('-')[0]).toHaveLength(64);
  });

  it('names a spool file relative to its root', () => {
    const file = path.join(spoolDir(), 'id-1-abcd.txt');
    expect(relativeSpoolLocator(file, root)).toBe(
      `${path.join('.ptah', 'tmp', 'mcp-out', 'id-1-abcd.txt')} under the workspace root`,
    );
    expect(relativeSpoolLocator(file, '')).toMatch(
      / under the system temp directory$/,
    );
  });
});
