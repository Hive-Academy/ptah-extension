import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMockFileSystemProvider } from '@ptah-extension/platform-core/testing';
import { LaneInstructionFileStore } from './lane-instruction-file-store';

describe('LaneInstructionFileStore', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'ptah-lane-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  function store(): LaneInstructionFileStore {
    const files = createMockFileSystemProvider();
    files.exists.mockImplementation(async (path) => access(path).then(() => true, () => false));
    files.createDirectory.mockImplementation(async (path) => { await mkdir(path, { recursive: true }); });
    files.createDirectoryExclusive.mockImplementation(async (path) => { await mkdir(path); });
    files.writeFile.mockImplementation(async (path, content) => {
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, content);
    });
    files.delete.mockImplementation(async (path) => { await rm(path, { recursive: true }); });
    return new LaneInstructionFileStore(files);
  }

  it('writes under a claimed per-run directory and removes only that directory', async () => {
    const owner = store();
    const path = await owner.write(root, 'agent-1', 'instructions/AGENTS.md', 'policy');
    expect(await readFile(path, 'utf8')).toBe('policy');
    await owner.remove('agent-1');
    await expect(access(path)).rejects.toThrow();
  });

  it('retains its claim after delete fails so a terminal retry removes the directory', async () => {
    const owner = store();
    const path = await owner.write(root, 'agent-1', 'instructions/AGENTS.md', 'policy');
    const files = Reflect.get(owner, 'files') as ReturnType<typeof createMockFileSystemProvider>;
    const remove = files.delete.getMockImplementation();
    files.delete.mockRejectedValueOnce(new Error('locked'));
    await expect(owner.remove('agent-1')).rejects.toThrow('locked');
    expect(await readFile(path, 'utf8')).toBe('policy');
    files.delete.mockImplementation(remove!);
    await owner.remove('agent-1');
    await expect(access(path)).rejects.toThrow();
  });

  it('rejects a symlinked lane parent', async () => {
    await mkdir(join(root, '.ptah'));
    const outside = await mkdtemp(join(tmpdir(), 'ptah-outside-'));
    try {
      await symlink(outside, join(root, '.ptah', 'lanes'), process.platform === 'win32' ? 'junction' : 'dir');
      await expect(store().write(root, 'agent-1', 'AGENTS.md', 'policy')).rejects.toThrow();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('rejects traversal in an instruction name', async () => {
    await expect(store().write(root, 'agent-1', '../outside', 'policy')).rejects.toThrow();
  });
});
