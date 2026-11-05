/**
 * AgentMonitorMessageHandler specs — routes AGENT_MONITOR_* messages to
 * AgentMonitorStore. This is a pure routing layer; tests assert each supported
 * message type dispatches to the correct store method and unknown types are
 * silently ignored.
 */

import { TestBed } from '@angular/core/testing';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import {
  AgentMonitorMessageHandler,
  parseAgentMonitorReparented,
} from './agent-monitor-message-handler.service';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';

type StoreSlice = Pick<
  AgentMonitorStore,
  | 'onAgentSpawned'
  | 'onAgentOutput'
  | 'onAgentOutputBatch'
  | 'onAgentExited'
  | 'onAgentExpired'
  | 'onPermissionRequest'
  | 'reparentAgents'
>;

describe('AgentMonitorMessageHandler', () => {
  let handler: AgentMonitorMessageHandler;
  let store: jest.Mocked<StoreSlice>;

  beforeEach(() => {
    store = {
      onAgentSpawned: jest.fn(),
      onAgentOutput: jest.fn(),
      onAgentOutputBatch: jest.fn(),
      onAgentExited: jest.fn(),
      onAgentExpired: jest.fn(),
      onPermissionRequest: jest.fn(),
      reparentAgents: jest.fn(),
    } as jest.Mocked<StoreSlice>;

    TestBed.configureTestingModule({
      providers: [
        AgentMonitorMessageHandler,
        { provide: AgentMonitorStore, useValue: store },
      ],
    });
    handler = TestBed.inject(AgentMonitorMessageHandler);
  });

  afterEach(() => {
    jest.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('declares the six AGENT_MONITOR_* message types', () => {
    expect(handler.handledMessageTypes).toEqual([
      MESSAGE_TYPES.AGENT_MONITOR_SPAWNED,
      MESSAGE_TYPES.AGENT_MONITOR_OUTPUT,
      MESSAGE_TYPES.AGENT_MONITOR_EXITED,
      MESSAGE_TYPES.AGENT_MONITOR_EXPIRED,
      MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_REQUEST,
      MESSAGE_TYPES.AGENT_MONITOR_REPARENTED,
    ]);
  });

  describe('agent-monitor:reparented (TASK_2026_876)', () => {
    it('applies a valid payload to the store', () => {
      handler.handleMessage({
        type: MESSAGE_TYPES.AGENT_MONITOR_REPARENTED,
        payload: { agentIds: ['lane-1', 'lane-2'], parentSessionId: 'tab-b' },
      });
      expect(store.reparentAgents).toHaveBeenCalledWith(
        ['lane-1', 'lane-2'],
        'tab-b',
      );
    });

    it.each([
      ['undefined', undefined],
      ['an array', []],
      ['a missing parent', { agentIds: ['lane-1'] }],
      ['an empty parent', { agentIds: ['lane-1'], parentSessionId: '' }],
      ['non-array agentIds', { agentIds: 'lane-1', parentSessionId: 'tab-b' }],
      ['an empty agent id', { agentIds: ['lane-1', ''], parentSessionId: 'tab-b' }],
      ['a numeric agent id', { agentIds: [1], parentSessionId: 'tab-b' }],
    ])('drops %s with a shape-only warning', (_label, payload) => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        expect(parseAgentMonitorReparented(payload)).toBeNull();
        handler.handleMessage({
          type: MESSAGE_TYPES.AGENT_MONITOR_REPARENTED,
          payload,
        });
        expect(store.reparentAgents).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('agent-monitor:reparented payload rejected'),
          expect.any(String),
        );
        expect(JSON.stringify(warn.mock.calls)).not.toContain('tab-b');
      } finally {
        warn.mockRestore();
      }
    });
  });

  it('routes AGENT_MONITOR_EXPIRED → store.onAgentExpired with the id', () => {
    handler.handleMessage({
      type: MESSAGE_TYPES.AGENT_MONITOR_EXPIRED,
      payload: { agentId: 'a1' },
    });
    expect(store.onAgentExpired).toHaveBeenCalledWith('a1');
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

  it('coalesces AGENT_MONITOR_OUTPUT deltas into one batch per flush', () => {
    jest.useFakeTimers();
    const first = { agentId: 'a1', stdoutDelta: 'hel' };
    const second = { agentId: 'a1', stdoutDelta: 'lo' };
    handler.handleMessage({
      type: MESSAGE_TYPES.AGENT_MONITOR_OUTPUT,
      payload: first,
    });
    handler.handleMessage({
      type: MESSAGE_TYPES.AGENT_MONITOR_OUTPUT,
      payload: second,
    });
    expect(store.onAgentOutputBatch).not.toHaveBeenCalled();

    jest.advanceTimersByTime(100);

    expect(store.onAgentOutputBatch).toHaveBeenCalledTimes(1);
    expect(store.onAgentOutputBatch).toHaveBeenCalledWith([first, second]);
    expect(store.onAgentOutput).not.toHaveBeenCalled();
  });

  it('applies pending output before any other agent event', () => {
    jest.useFakeTimers();
    const output = { agentId: 'a1', stdoutDelta: 'last words' };
    const exited = { agentId: 'a1' };
    handler.handleMessage({
      type: MESSAGE_TYPES.AGENT_MONITOR_OUTPUT,
      payload: output,
    });
    handler.handleMessage({
      type: MESSAGE_TYPES.AGENT_MONITOR_EXITED,
      payload: exited,
    });

    expect(store.onAgentOutputBatch).toHaveBeenCalledWith([output]);
    expect(store.onAgentOutputBatch.mock.invocationCallOrder[0]).toBeLessThan(
      store.onAgentExited.mock.invocationCallOrder[0],
    );
    jest.advanceTimersByTime(100);
    expect(store.onAgentOutputBatch).toHaveBeenCalledTimes(1);
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
