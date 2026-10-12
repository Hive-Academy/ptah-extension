import { TestBed } from '@angular/core/testing';
import {
  AgentMonitorStore,
  PermissionHandlerService,
} from '@ptah-extension/chat-streaming';
import { VSCodeService } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { PermissionRequest } from '@ptah-extension/shared';
import { AgentPermissionResponder } from './agent-permission-responder';

describe('AgentPermissionResponder', () => {
  const queue = [{ requestId: 'first' }, { requestId: 'second' }];
  const postMessage = jest.fn<void, [unknown]>();
  const clearPermission = jest.fn<void, [string, string]>((_, requestId) => {
    const index = queue.findIndex((entry) => entry.requestId === requestId);
    if (index >= 0) queue.splice(index, 1);
  });
  const handlePermissionResponse = jest.fn<void, [unknown, string]>();
  let responder: AgentPermissionResponder;

  beforeEach(() => {
    queue.splice(
      0,
      queue.length,
      { requestId: 'first' },
      { requestId: 'second' },
    );
    jest.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        { provide: VSCodeService, useValue: { postMessage } },
        { provide: AgentMonitorStore, useValue: { clearPermission } },
        {
          provide: PermissionHandlerService,
          useValue: { handlePermissionResponse },
        },
      ],
    });
    responder = TestBed.inject(AgentPermissionResponder);
  });

  it('posts the existing protocol and clears only the chosen request', () => {
    expect(responder.respondLane('agent', 'first', 'deny')).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_RESPONSE,
      payload: { requestId: 'first', decision: 'deny', reason: 'User denied' },
    });
    expect(clearPermission).toHaveBeenCalledWith('agent', 'first');
    expect(queue).toEqual([{ requestId: 'second' }]);
  });

  it('does not clear a request when posting throws', () => {
    postMessage.mockImplementationOnce(() => {
      throw new Error('post failed');
    });
    expect(() => responder.respondLane('agent', 'first', 'allow')).toThrow(
      'post failed',
    );
    expect(clearPermission).not.toHaveBeenCalled();
    expect(queue).toHaveLength(2);
  });

  it('posts and clears a lane request only once across repeated answers', () => {
    expect(responder.respondLane('agent', 'first', 'allow')).toBe(true);
    expect(responder.respondLane('agent', 'first', 'deny', 'User denied')).toBe(
      false,
    );
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(clearPermission).toHaveBeenCalledTimes(1);
  });

  it('forwards the deciding tab for session permissions', () => {
    const request = { id: 'session-perm' } as PermissionRequest;
    responder.respondSession(request, 'allow', 'tab-2');
    expect(handlePermissionResponse).toHaveBeenCalledWith(
      { id: 'session-perm', decision: 'allow' },
      'tab-2',
    );
  });
});
