import { TestBed } from '@angular/core/testing';
import type {
  FileViewContentResult,
  FileViewFailureReason,
} from '@ptah-extension/shared';
import type { FileViewTabState } from '../types/diff-tab.types';
import { FileViewReaderService } from './file-view-reader.service';

const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => ({
  rpcCall: (...args: unknown[]) => mockRpcCall(...args),
  VSCodeService: class VSCodeService {},
}));
const { VSCodeService } = jest.requireMock('@ptah-extension/core');

function previousState(): FileViewTabState {
  return {
    absolutePath: '/ws/old.ts',
    workspaceRoot: '/ws',
    relativePath: 'old.ts',
    content: 'kept content',
    sizeBytes: 12,
    isMarkdown: false,
    reveal: null,
    status: 'fresh',
    request: { path: '/ws/old.ts', workspaceRoot: '/ws' },
    requestId: 1,
  };
}

describe('FileViewReaderService', () => {
  let service: FileViewReaderService;

  beforeEach(() => {
    mockRpcCall.mockReset();
    TestBed.configureTestingModule({
      providers: [{ provide: VSCodeService, useValue: {} }],
    });
    service = TestBed.inject(FileViewReaderService);
  });

  it('maps successful content and forwards only the authorized read hints', async () => {
    mockRpcCall.mockResolvedValue({
      success: true,
      data: {
        success: true,
        absolutePath: '/ws/docs/a.md',
        workspaceRoot: '/ws',
        relativePath: 'docs/a.md',
        content: '# A',
        sizeBytes: 3,
        encoding: 'utf-8',
      } satisfies FileViewContentResult,
    });

    const result = await service.read(
      {
        path: 'a.md',
        line: 4,
        column: 2,
        workspaceRoot: '/ws',
        documentPath: '/ws/docs/readme.md',
      },
      7,
    );

    expect(mockRpcCall).toHaveBeenCalledWith({}, 'file:viewContent', {
      path: 'a.md',
      workspaceRoot: '/ws',
      documentPath: '/ws/docs/readme.md',
    });
    expect(result).toMatchObject({
      status: 'fresh',
      absolutePath: '/ws/docs/a.md',
      content: '# A',
      isMarkdown: true,
      reveal: { line: 4, column: 2 },
      requestId: 7,
    });
  });

  it.each([
    'unsupported-path',
    'no-base-root',
    'root-not-open',
    'outside-roots',
  ] satisfies FileViewFailureReason[])(
    'maps authorization reason %s to blocked and clears stale bytes',
    async (reason) => {
      mockRpcCall.mockResolvedValue({
        success: true,
        data: {
          success: false,
          reason,
          error: `fixed ${reason}`,
          externalOpenAllowed: reason === 'outside-roots',
          absolutePath: '/outside/a.ts',
        } satisfies FileViewContentResult,
      });
      const result = await service.read(
        { path: '/outside/a.ts' },
        2,
        previousState(),
      );
      expect(result.status).toBe('blocked');
      expect(result.content).toBe('');
      expect(result.failure).toEqual({
        reason,
        message: `fixed ${reason}`,
        externalOpenAllowed: reason === 'outside-roots',
      });
    },
  );

  it.each([
    'invalid-request',
    'not-found',
    'not-a-file',
    'too-large',
    'binary',
    'unsupported-encoding',
    'unreadable',
  ] satisfies FileViewFailureReason[])(
    'maps readable failure reason %s to an error using fixed backend copy',
    async (reason) => {
      mockRpcCall.mockResolvedValue({
        success: true,
        data: {
          success: false,
          reason,
          error: `fixed ${reason}`,
          externalOpenAllowed: false,
        } satisfies FileViewContentResult,
      });
      const result = await service.read({ path: 'a.ts' }, 1);
      expect(result.status).toBe('error');
      expect(result.failure?.message).toBe(`fixed ${reason}`);
    },
  );

  it('keeps old content when a refresh transport call fails', async () => {
    mockRpcCall.mockRejectedValue(new Error('/secret/raw transport detail'));
    const result = await service.read(
      { path: '/ws/old.ts' },
      2,
      previousState(),
    );
    expect(result.content).toBe('kept content');
    expect(result.failure?.message).toBe(
      'This file could not be opened in the viewer.',
    );
    expect(result.failure?.message).not.toContain('/secret');
  });

  it('uses generic copy for malformed transport data', async () => {
    mockRpcCall.mockResolvedValue({
      success: true,
      data: {
        success: false,
        reason: 'future-reason',
        error: '/secret/backend detail',
        externalOpenAllowed: true,
      },
    });
    const result = await service.read({ path: 'a.ts' }, 1);
    expect(result.failure).toEqual({
      reason: 'unreadable',
      message: 'This file could not be opened in the viewer.',
      externalOpenAllowed: true,
    });
  });
});
