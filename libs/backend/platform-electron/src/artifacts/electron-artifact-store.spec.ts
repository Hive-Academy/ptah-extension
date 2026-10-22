import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import { ArtifactListResponseSchema } from '@ptah-extension/shared/mcp-apps-contracts';
import { ElectronArtifactStore } from './electron-artifact-store';

describe('ElectronArtifactStore', () => {
  let root: string;
  let workspace: string;
  let store: ElectronArtifactStore;
  const scope = () => ({ workspaceRoot: workspace, sessionId: 'session-a' });

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-artifact-'));
    workspace = path.join(root, 'workspace');
    await fs.mkdir(workspace);
    store = new ElectronArtifactStore(path.join(root, 'data'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('publishes HTML to managed storage and lists only the owning session', async () => {
    const published = await store.publish(scope(), { title: 'Test', html: '<h1>Hi</h1>' });
    expect(published.revision).toBe(1);
    expect(published.viewerUrl).toBe(`ptah-artifact://${published.id}/index.html`);
    expect(await fs.readFile(published.savedPath, 'utf8')).toBe('<h1>Hi</h1>');
    expect(await store.readBytes(published.id)).toEqual(Buffer.from('<h1>Hi</h1>'));
    const listed = await store.list(scope());
    expect(ArtifactListResponseSchema.safeParse(listed).success).toBe(true);
    expect(listed.artifacts).toEqual([{
      id: published.id,
      title: published.title,
      revision: published.revision,
      sessionId: published.sessionId,
      viewerUrl: published.viewerUrl,
      createdAt: published.createdAt,
    }]);
    expect((await store.list({ ...scope(), sessionId: 'session-b' })).artifacts).toEqual([]);
    const otherWorkspace = path.join(root, 'other-workspace');
    await fs.mkdir(otherWorkspace);
    expect((await store.list({ workspaceRoot: otherWorkspace, sessionId: 'session-a' })).artifacts).toEqual([]);
  });

  it('copies a workspace HTML file, preserving published bytes after source changes', async () => {
    const source = path.join(workspace, 'page.html');
    await fs.writeFile(source, '<p>First</p>');
    const published = await store.publish(scope(), { title: 'File', path: 'page.html' });
    await fs.writeFile(source, '<p>Changed</p>');
    expect(await fs.readFile(published.savedPath, 'utf8')).toBe('<p>First</p>');
  });

  it('rejects outside, non-HTML, and oversized sources without records', async () => {
    const outside = path.join(root, 'outside.html');
    await fs.writeFile(outside, 'outside');
    await expect(store.publish(scope(), { title: 'Outside', path: outside })).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await fs.writeFile(path.join(workspace, 'plain.txt'), 'plain');
    await expect(store.publish(scope(), { title: 'Plain', path: 'plain.txt' })).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await fs.writeFile(path.join(workspace, 'large.html'), Buffer.alloc(2 * 1024 * 1024 + 1));
    await expect(store.publish(scope(), { title: 'Large', path: 'large.html' })).rejects.toMatchObject({ code: 'TOO_LARGE' });
    await expect(store.publish(scope(), { title: 'Large', html: 'é'.repeat(1024 * 1024 + 1) })).rejects.toMatchObject({ code: 'TOO_LARGE' });
    expect((await store.list(scope())).artifacts).toEqual([]);
  });

  it('rejects a symlink that escapes the workspace', async () => {
    const outside = path.join(root, 'outside.html');
    await fs.writeFile(outside, 'outside');
    try {
      await fs.symlink(outside, path.join(workspace, 'linked.html'));
    } catch (error) {
      // Windows may deny symlink creation without Developer Mode or privilege.
      if (process.platform === 'win32') return;
      throw error;
    }
    await expect(store.publish(scope(), { title: 'Linked', path: 'linked.html' })).rejects.toMatchObject({ code: 'INVALID_PATH' });
    expect((await store.list(scope())).artifacts).toEqual([]);
  });

  it('rejects an in-workspace source symlink', async () => {
    await fs.writeFile(path.join(workspace, 'real.html'), '<p>real</p>');
    try {
      await fs.symlink(path.join(workspace, 'real.html'), path.join(workspace, 'linked.html'));
    } catch (error) {
      if (process.platform === 'win32') return;
      throw error;
    }
    await expect(store.publish(scope(), { title: 'Link', path: 'linked.html' }))
      .rejects.toMatchObject({ code: 'INVALID_PATH' });
  });

  it('skips invalid metadata and sweeps stale temporary directories', async () => {
    const dataRoot = path.join(root, 'data', 'artifacts');
    await fs.mkdir(path.join(dataRoot, 'stale.tmp'), { recursive: true });
    await fs.mkdir(path.join(dataRoot, 'invalid'), { recursive: true });
    await fs.writeFile(path.join(dataRoot, 'invalid', 'metadata.json'), JSON.stringify({ id: 'invalid' }));
    store = new ElectronArtifactStore(path.join(root, 'data'));
    await store.publish(scope(), { title: 'Valid', html: '<p>yes</p>' });
    expect(await fs.stat(path.join(dataRoot, 'stale.tmp')).then(() => true, () => false)).toBe(false);
    expect((await store.list(scope())).artifacts).toHaveLength(1);
  });

  it('reports store IO errors instead of empty lists', async () => {
    const dataRoot = path.join(root, 'data', 'artifacts');
    await fs.mkdir(path.dirname(dataRoot), { recursive: true });
    await fs.writeFile(dataRoot, 'blocking file');
    await expect(store.list(scope())).rejects.toMatchObject({ code: 'IO_ERROR' });
  });

  it('serializes concurrent publishes at the workspace quota', async () => {
    const first = await store.publish(scope(), { title: 'Seed', html: '<p>seed</p>' });
    const dataRoot = path.join(root, 'data', 'artifacts');
    const seed = JSON.parse(await fs.readFile(path.join(dataRoot, first.id, 'metadata.json'), 'utf8')) as Record<string, string | number>;
    await Promise.all(Array.from({ length: 498 }, async () => {
      const id = randomUUID();
      const directory = path.join(dataRoot, id);
      await fs.mkdir(directory);
      await fs.writeFile(path.join(directory, 'metadata.json'), JSON.stringify({
        ...seed,
        id,
        viewerUrl: `ptah-artifact://${id}/index.html`,
        savedPath: path.join(directory, '1', 'index.html'),
      }));
    }));
    const results = await Promise.allSettled([
      store.publish(scope(), { title: 'A', html: '<p>A</p>' }),
      store.publish(scope(), { title: 'B', html: '<p>B</p>' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' ? rejected.reason : null).toMatchObject({ code: 'QUOTA' });
  });

  it('returns null for unknown and invalid ids', async () => {
    expect(await store.readBytes('123e4567-e89b-12d3-a456-426614174000')).toBeNull();
    expect(await store.readBytes('../outside')).toBeNull();
  });

  it('does not expose an incomplete record after a metadata write failure', async () => {
    const data = path.join(root, 'data');
    await fs.mkdir(data);
    await fs.writeFile(path.join(data, 'artifacts'), 'blocking file');
    await expect(store.publish(scope(), { title: 'Failed', html: '<p>x</p>' })).rejects.toMatchObject({ code: 'IO_ERROR' });
  });
});
