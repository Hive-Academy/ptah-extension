import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileSessionBlobStore } from './file-session-blob-store';

describe('FileSessionBlobStore', () => {
  let root: string;
  let blobs: FileSessionBlobStore;
  const id = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-session-blobs-'));
    blobs = new FileSessionBlobStore(root);
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes JSON under <root>/<sessionId>/<name>.json and reads it back', async () => {
    await blobs.write(id, 'turn-change-sets', { changeSets: [1, 2] });
    expect(
      JSON.parse(
        fs.readFileSync(path.join(root, id, 'turn-change-sets.json'), 'utf8'),
      ),
    ).toEqual({ changeSets: [1, 2] });
    expect(await blobs.read(id, 'turn-change-sets')).toEqual({
      changeSets: [1, 2],
    });
  });

  it('returns undefined for a missing blob', async () => {
    expect(await blobs.read(id, 'nothing')).toBeUndefined();
  });

  it('replaces atomically and leaves no temp files', async () => {
    await blobs.write(id, 'agent-output.a1', { n: 1 });
    await blobs.write(id, 'agent-output.a1', { n: 2 });
    expect(await blobs.read(id, 'agent-output.a1')).toEqual({ n: 2 });
    expect(fs.readdirSync(path.join(root, id))).toEqual([
      'agent-output.a1.json',
    ]);
  });

  it('removes one blob, then all of a session', async () => {
    await blobs.write(id, 'a', 1);
    await blobs.write(id, 'b', 2);
    await blobs.remove(id, 'a');
    expect(await blobs.read(id, 'a')).toBeUndefined();
    expect(await blobs.read(id, 'b')).toBe(2);
    await blobs.removeAll(id);
    expect(fs.existsSync(path.join(root, id))).toBe(false);
    await expect(blobs.remove(id, 'gone')).resolves.toBeUndefined();
  });

  it.each([
    ['../escape', 'x'],
    ['a/b', 'x'],
    [id, '../../etc/passwd'],
    [id, 'sub/name'],
    ['', 'x'],
    [id, ''],
  ])('refuses unsafe session id %p or name %p', async (sessionId, name) => {
    await expect(blobs.write(sessionId, name, 1)).rejects.toThrow(/unsafe/i);
  });
});
