import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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

  it('drops ownership when the owned directory was deleted, so remove settles and a later write works', async () => {
    const owner = store();
    const file = await owner.write(root, 'agent-1', 'lane/policy.md', 'content');
    await rm(join(root, '.ptah', 'lanes', 'agent-1'), { recursive: true, force: true });
    // ENOENT on the owned directory means it was removed: ownership is
    // dropped, not held forever (4332578889).
    await expect(owner.remove('agent-1')).resolves.toBeUndefined();
    // Not stuck: the next write starts a fresh directory for the same id.
    await expect(owner.write(root, 'agent-1', 'lane/policy.md', 'again')).resolves.toBe(file);
  });

  it('drops ownership when the workspace root itself is gone', async () => {
    const owner = store();
    await owner.write(root, 'agent-2', 'lane/policy.md', 'content');
    await rm(root, { recursive: true, force: true });
    await expect(owner.remove('agent-2')).resolves.toBeUndefined();
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

  it('still refuses a directory swapped for a link to outside the root', async () => {
    const owner = store();
    const outside = await mkdtemp(join(tmpdir(), 'ptah-outside-'));
    try {
      await owner.write(root, 'agent-3', 'lane/policy.md', 'content');
      const owned = join(root, '.ptah', 'lanes', 'agent-3');
      await rm(owned, { recursive: true, force: true });
      await symlink(outside, owned, process.platform === 'win32' ? 'junction' : 'dir');
      // A containment change is still refused: only ENOENT means "removed"
      // (4332578889).
      await expect(owner.remove('agent-3')).rejects.toThrow(
        /Lane instruction (path escapes its root|directory changed)/,
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('refuses a lane directory swapped for a dangling link instead of forgetting it', async () => {
    const owner = store();
    await owner.write(root, 'agent-4', 'lane/policy.md', 'content');
    const owned = join(root, '.ptah', 'lanes', 'agent-4');
    await rm(owned, { recursive: true, force: true });
    await symlink(
      join(root, '.ptah', 'lanes', 'vanished'),
      owned,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    // realpath fails ENOENT through the dangling link, but lstat still sees
    // the entry: the claim is kept and the removal is refused as a
    // containment change, so nothing is deleted through a link the store did
    // not create (Grok code-logic review, moderate 1).
    await expect(owner.remove('agent-4')).rejects.toThrow(
      'Lane instruction directory changed',
    );
    // The refusal kept the claim: a second remove sees the same entry again,
    // where a dropped claim would settle as a no-op.
    await expect(owner.remove('agent-4')).rejects.toThrow(
      'Lane instruction directory changed',
    );
  });

  it('rejects traversal in an instruction name', async () => {
    await expect(store().write(root, 'agent-1', '../outside', 'policy')).rejects.toThrow();
  });
});