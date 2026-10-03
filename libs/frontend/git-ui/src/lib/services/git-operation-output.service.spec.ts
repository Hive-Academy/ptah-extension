import { TestBed } from '@angular/core/testing';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { GitOperationOutputService } from './git-operation-output.service';

describe('GitOperationOutputService', () => {
  let service: GitOperationOutputService;

  beforeEach(() => {
    service = TestBed.inject(GitOperationOutputService);
  });

  function push(
    payload: unknown,
    type: string = MESSAGE_TYPES.GIT_OPERATION_OUTPUT,
  ): void {
    service.handleMessage({ type, payload });
  }

  it('handles git:operationOutput only', () => {
    expect(service.handledMessageTypes).toEqual([
      MESSAGE_TYPES.GIT_OPERATION_OUTPUT,
    ]);
  });

  it('routes each chunk to the listener of its operationId, in order', () => {
    const a = jest.fn();
    const b = jest.fn();
    service.listen('op-a', a);
    service.listen('op-b', b);

    push({ operationId: 'op-a', stream: 'stdout', chunk: '1' });
    push({ operationId: 'op-b', stream: 'stderr', chunk: 'x' });
    push({ operationId: 'op-a', stream: 'stderr', chunk: '2' });
    push({ operationId: 'op-c', stream: 'stdout', chunk: 'nobody' });

    expect(a.mock.calls.map(([output]) => output.chunk)).toEqual(['1', '2']);
    expect(b).toHaveBeenCalledWith({
      operationId: 'op-b',
      stream: 'stderr',
      chunk: 'x',
    });
  });

  it('drops malformed payloads and other message types', () => {
    const listener = jest.fn();
    service.listen('op', listener);

    push(null);
    push({ operationId: 'op', stream: 'stdin', chunk: 'x' });
    push({ operationId: 'op', stream: 'stdout', chunk: 1 });
    push({ operationId: '', stream: 'stdout', chunk: 'x' });
    push({ operationId: 'op', stream: 'stdout', chunk: 'x' }, 'git:other');

    expect(listener).not.toHaveBeenCalled();
  });

  it('stops delivering after release; a stale release keeps the replacement', () => {
    const first = jest.fn();
    const second = jest.fn();
    const releaseFirst = service.listen('op', first);
    const releaseSecond = service.listen('op', second);

    releaseFirst();
    push({ operationId: 'op', stream: 'stdout', chunk: 'a' });
    releaseSecond();
    push({ operationId: 'op', stream: 'stdout', chunk: 'b' });

    expect(first).not.toHaveBeenCalled();
    expect(second.mock.calls.map(([output]) => output.chunk)).toEqual(['a']);
  });
});
