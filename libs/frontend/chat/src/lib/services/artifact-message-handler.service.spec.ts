import { TestBed } from '@angular/core/testing';
import { type ArtifactRecord } from '@ptah-extension/shared';
import { ArtifactMessageHandler } from './artifact-message-handler.service';
import { ArtifactStore } from './artifact.store';

describe('ArtifactMessageHandler', () => {
  const upsert = jest.fn();
  let handler: ArtifactMessageHandler;

  beforeEach(() => {
    upsert.mockReset();
    TestBed.configureTestingModule({ providers: [{ provide: ArtifactStore, useValue: { upsert } }] });
    handler = TestBed.inject(ArtifactMessageHandler);
  });

  it('accepts valid metadata notifications', () => {
    const payload: ArtifactRecord = {
      id: 'abcdefghijklmnop', title: 'Preview', revision: 1, sessionId: 'session-a',
      viewerUrl: 'ptah-artifact://abcdefghijklmnop/index.html',
      createdAt: '2026-10-20T12:00:00.000Z',
    };
    handler.handleMessage({ type: 'artifact:published', payload });
    expect(upsert).toHaveBeenCalledWith(payload);
  });

  it('drops malformed and unexpected messages', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    handler.handleMessage({ type: 'artifact:published', payload: { html: '<script>bad</script>' } });
    handler.handleMessage({ type: 'unrelated', payload: {} });
    expect(upsert).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
