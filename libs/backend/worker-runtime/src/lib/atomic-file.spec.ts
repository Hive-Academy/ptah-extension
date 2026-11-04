import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileAtomic, writeJsonAtomic } from './atomic-file';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ptah-worker-atomic-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it('replaces the file with owner-only content and leaves no temp file', async () => {
  const file = join(directory, 'tokens.json');
  await writeJsonAtomic(file, [{ a: 1 }]);
  await Promise.all([
    writeFileAtomic(file, '"one"'),
    writeFileAtomic(file, '"two"'),
  ]);
  expect(['"one"', '"two"']).toContain(await readFile(file, 'utf8'));
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect(await readdir(directory)).toEqual(['tokens.json']);
});

it('removes its temp file when the rename fails', async () => {
  // A directory in the target's place makes the rename fail.
  const file = join(directory, 'endpoint.json');
  await mkdir(join(file, 'occupied'), { recursive: true });
  await expect(writeFileAtomic(file, '{}')).rejects.toMatchObject({
    code: expect.stringMatching(/EISDIR|ENOTEMPTY|EEXIST/),
  });
  expect(await readdir(directory)).toEqual(['endpoint.json']);
});
