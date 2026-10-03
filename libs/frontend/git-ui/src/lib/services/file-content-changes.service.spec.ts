import { TestBed } from '@angular/core/testing';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { FileContentChangesService } from './file-content-changes.service';

describe('FileContentChangesService', () => {
  let service: FileContentChangesService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(FileContentChangesService);
  });

  function push(
    payload: unknown,
    type: string = MESSAGE_TYPES.FILE_CONTENT_CHANGED,
  ) {
    service.handleMessage({ type, payload });
  }

  it('declares file:content-changed as its only message type', () => {
    expect(service.handledMessageTypes).toEqual([
      MESSAGE_TYPES.FILE_CONTENT_CHANGED,
    ]);
  });

  it('delivers every batch to every listener, in order', () => {
    const first = jest.fn();
    const second = jest.fn();
    service.listen(first);
    service.listen(second);

    push({ filePaths: ['/ws/a.ts'], truncated: false });
    push({ filePaths: [], truncated: true });

    expect(first.mock.calls).toEqual([
      [{ filePaths: ['/ws/a.ts'], truncated: false }],
      [{ filePaths: [], truncated: true }],
    ]);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('stops delivering after release', () => {
    const listener = jest.fn();
    const release = service.listen(listener);
    release();

    push({ filePaths: ['/ws/a.ts'], truncated: false });

    expect(listener).not.toHaveBeenCalled();
  });

  it('drops malformed payloads, other types and empty untruncated batches', () => {
    const listener = jest.fn();
    service.listen(listener);

    push(null);
    push({ filePath: '/ws/a.ts' });
    push({ filePaths: [], truncated: false });
    push({ filePaths: ['/ws/a.ts'] }, 'git:status-update');

    expect(listener).not.toHaveBeenCalled();
  });

  it('drops non-string and empty entries but keeps the rest of the batch', () => {
    const listener = jest.fn();
    service.listen(listener);

    push({ filePaths: ['/ws/a.ts', 3, '', '/ws/b.ts'], truncated: 'yes' });

    expect(listener).toHaveBeenCalledWith({
      filePaths: ['/ws/a.ts', '/ws/b.ts'],
      truncated: false,
    });
  });

  it('a listener releasing itself does not skip the next listener', () => {
    const second = jest.fn();
    const release = service.listen(() => release());
    service.listen(second);

    push({ filePaths: ['/ws/a.ts'], truncated: false });

    expect(second).toHaveBeenCalledTimes(1);
  });
});
