import { ArtifactStoreError, type IArtifactStore } from '@ptah-extension/platform-core';
import { ArtifactPublishInputSchema } from '@ptah-extension/shared/mcp-apps-contracts';
import { buildArtifactPublishTool } from './artifact-tools';
import { handleArtifactPublish } from './artifact-tool-handlers';

const scope = { workspaceRoot: '/trusted/workspace', sessionId: 'trusted-session' };
const record = {
  id: 'abcdefghijklmnop', revision: 1, title: 'Report',
  sessionId: scope.sessionId,
  viewerUrl: 'ptah-artifact://abcdefghijklmnop/index.html',
  createdAt: '2026-10-20T12:00:00.000Z',
  savedPath: '/trusted/workspace/artifacts/index.html',
};

function fixture() {
  const store: IArtifactStore = {
    publish: jest.fn().mockResolvedValue(record),
    list: jest.fn(),
    readBytes: jest.fn(),
  };
  const logger = { warn: jest.fn(), error: jest.fn() };
  const notify = jest.fn().mockResolvedValue(undefined);
  return { store, logger, notify };
}

describe('ptah_artifact_publish', () => {
  it('serves the contract schema and rejects extra scope fields', () => {
    const tool = buildArtifactPublishTool();
    expect(tool.name).toBe('ptah_artifact_publish');
    expect(ArtifactPublishInputSchema.safeParse({ title: 'x', html: '<h1>x</h1>', sessionId: 'spoof' }).success).toBe(false);
    expect(tool.inputSchema).toMatchObject({ anyOf: expect.any(Array) });
    expect(tool.inputSchema).toMatchObject({ type: 'object' });
    const branches = ('anyOf' in tool.inputSchema ? tool.inputSchema.anyOf : []) as
      Array<{ properties?: Record<string, unknown>; required?: string[] }>;
    expect(branches.some((branch) => branch.properties?.['title'] && branch.properties?.['html']
      && branch.required?.includes('title') && branch.required?.includes('html'))).toBe(true);
    expect(ArtifactPublishInputSchema.safeParse({ title: 'Report', html: '<h1>ok</h1>' }).success).toBe(true);
  });

  it('publishes using trusted scope and sends only validated metadata', async () => {
    const { store, logger, notify } = fixture();
    const reply = await handleArtifactPublish({ title: 'Report', html: '<h1>secret</h1>' }, scope, store, notify, logger);
    expect(reply.isError).toBe(false);
    expect(store.publish).toHaveBeenCalledWith(scope, { title: 'Report', html: '<h1>secret</h1>' });
    expect(notify).toHaveBeenCalledWith('artifact:published', expect.not.objectContaining({ savedPath: expect.anything() }));
    expect(reply.text).toContain(record.viewerUrl);
    expect(reply.text).not.toContain('secret');
    expect(reply.text).not.toContain(record.savedPath);
  });

  it('refuses missing scope and unsupported hosts without saving', async () => {
    const { store, logger, notify } = fixture();
    const missing = await handleArtifactPublish({ title: 'Report', html: 'x' }, { sessionId: 's' }, store, notify, logger);
    expect(missing.isError).toBe(true);
    expect(store.publish).not.toHaveBeenCalled();
    const unsupported = await handleArtifactPublish({ title: 'Report', html: 'x' }, scope, undefined, notify, logger);
    expect(unsupported.text).toContain('nothing was saved');
  });

  it('keeps a committed publish successful when notification fails', async () => {
    const { store, logger } = fixture();
    const reply = await handleArtifactPublish({ title: 'Report', path: 'index.html' }, scope, store, jest.fn().mockRejectedValue(new Error('secret')), logger);
    expect(reply.isError).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith('Artifact notification failed after publish');
  });

  it('maps store errors without leaking source content', async () => {
    const { store, logger, notify } = fixture();
    for (const code of ['INVALID_INPUT', 'INVALID_PATH', 'TOO_LARGE', 'NOT_FOUND', 'UNSUPPORTED', 'QUOTA', 'IO_ERROR'] as const) {
      jest.mocked(store.publish).mockRejectedValueOnce(new ArtifactStoreError(code));
      const reply = await handleArtifactPublish({ title: 'Report', html: '<p>secret</p>' }, scope, store, notify, logger);
      expect(reply.isError).toBe(true);
      expect(reply.text).not.toContain('secret');
      expect(reply.text).not.toContain('/trusted/workspace');
    }
    expect(notify).not.toHaveBeenCalled();
  });

});
