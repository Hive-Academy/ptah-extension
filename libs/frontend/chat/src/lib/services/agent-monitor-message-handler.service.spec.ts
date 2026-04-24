/**
 * AgentMonitorMessageHandler specs — routes AGENT_MONITOR_* messages to
 * AgentMonitorStore. This is a pure routing layer; tests assert each supported
 * message type dispatches to the correct store method and unknown types are
 * silently ignored.
 */

import { TestBed } from '@angular/core/testing';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { AgentMonitorMessageHandler } from './agent-monitor-message-handler.service';
import { AgentMonitorStore } from './agent-monitor.store';

type StoreSlice = Pick<
  AgentMonitorStore,
  'onAgentSpawned' | 'onAgentOutput' | 'onAgentExited' | 'onPermissionRequest'
>;

describe('AgentMonitorMessageHandler', () => {
  let handler: AgentMonitorMessageHandler;
  let store: jest.Mocked<StoreSlice>;

  beforeEach(() => {
    store = {
      onAgentSpawned: jest.fn(),
      onAgentOutput: jest.fn(),
      onAgentExited: jest.fn(),
      onPermissionRequest: jest.fn(),
    } as jest.Mocked<StoreSlice>;

    TestBed.configureTestingModule({
      providers: [
        AgentMonitorMessageHandler,
        { provide: AgentMonitorStore, useValue: store },
      ],
    });
    handler = TestBed.inject(AgentMonitorMessageHandler);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('declares the four AGENT_MONITOR_* message types', () => {
    expect(handler.handledMessageTypes).toEqual([
      MESSAGE_TYPES.AGENT_MONITOR_SPAWNED,
      MESSAGE_TYPES.AGENT_MONITOR_OUTPUT,
      MESSAGE_TYPES.AGENT_MONITOR_EXITED,
      MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_REQUEST,
    ]);
  });

  it('routes AGENT_MONITOR_SPAWNED → store.onAgentSpawned', () => {
    const payload = { agentId: 'a1' };
    handler.handleMessage({
      type: MESSAGE_TYPES.AGENT_MONITOR_SPAWNED,
      payload,
    });
    expect(store.onAgentSpawned).toHaveBeenCalledWith(payload);
    expect(store.onAgentOutput).not.toHaveBeenCalled();
    expect(store.onAgentExited).not.toHaveBeenCalled();
    expect(store.onPermissionRequest).not.toHaveBeenCalled();
  });

  it('routes AGENT_MONITOR_OUTPUT → store.onAgentOutput', () => {
    const payload = { agentId: 'a1', chunk: 'hello' };
    handler.handleMessage({
      type: MESSAGE_TYPES.AGENT_MONITOR_OUTPUT,
      payload,
    });
    expect(store.onAgentOutput).toHaveBeenCalledWith(payload);
  });

  it('routes AGENT_MONITOR_EXITED → store.onAgentExited', () => {
    const payload = { agentId: 'a1', exitCode: 0 };
    handler.handleMessage({
      type: MESSAGE_TYPES.AGENT_MONITOR_EXITED,
      payload,
    });
    expect(store.onAgentExited).toHaveBeenCalledWith(payload);
  });

  it('routes AGENT_MONITOR_PERMISSION_REQUEST → store.onPermissionRequest', () => {
    const payload = { agentId: 'a1', requestId: 'r1' };
    handler.handleMessage({
      type: MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_REQUEST,
      payload,
    });
    expect(store.onPermissionRequest).toHaveBeenCalledWith(payload);
  });

  it('silently ignores unknown message types', () => {
    handler.handleMessage({ type: 'SOMETHING_ELSE', payload: { a: 1 } });
    expect(store.onAgentSpawned).not.toHaveBeenCalled();
    expect(store.onAgentOutput).not.toHaveBeenCalled();
    expect(store.onAgentExited).not.toHaveBeenCalled();
    expect(store.onPermissionRequest).not.toHaveBeenCalled();
  });

  it('tolerates missing payload (passes undefined through)', () => {
    handler.handleMessage({ type: MESSAGE_TYPES.AGENT_MONITOR_SPAWNED });
    expect(store.onAgentSpawned).toHaveBeenCalledWith(undefined);
  });
});
