import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  CommandCenterRecordsService,
  TabManagerService,
  type TerminalTurnPulse,
} from '@ptah-extension/chat-state';
import { ClaudeRpcService } from '@ptah-extension/core';
import { TribunalDiscoveryService } from '@ptah-extension/tribunal-panel/discovery';
import { CommandCenterStore } from '../model/command-center.store';
import { CommandCenterSessionCoordinator } from '../model/session-coordinator';
import { CommandCenterTribunalTransport } from './command-center-tribunal.transport';

jest.mock('@ptah-extension/tribunal-panel/discovery', () => ({
  TribunalDiscoveryService: class {},
}));

describe('CommandCenterTribunalTransport', () => {
  const vendors = signal([
    {
      lane: { laneId: 'codex#1', family: 'codex', cli: 'codex' },
      available: true,
    },
    {
      lane: { laneId: 'cursor#1', family: 'cursor', cli: 'cursor' },
      available: false,
    },
  ]);
  const discovered = signal(true);
  const pulses = signal<readonly TerminalTurnPulse[]>([]);
  const lastTerminalPulseByTab = signal<ReadonlyMap<string, TerminalTurnPulse>>(
    new Map(),
  );
  const coordinator = {
    answerQuestion: jest.fn(),
    sendLaunchTurn: jest.fn(async () => true),
  };
  const records = {
    writeRunManifest: jest.fn(() => true),
    removeRunManifest: jest.fn(() => true),
  };
  const rpc = {
    call: jest.fn(async () => ({
      isSuccess: () => true,
      data: { disabledClis: ['codex'] },
    })),
  };
  let transport: CommandCenterTribunalTransport;
  let store: CommandCenterStore;

  beforeEach(() => {
    jest.clearAllMocks();
    pulses.set([]);
    lastTerminalPulseByTab.set(new Map());
    TestBed.configureTestingModule({
      providers: [
        CommandCenterStore,
        CommandCenterTribunalTransport,
        { provide: CommandCenterSessionCoordinator, useValue: coordinator },
        {
          provide: TabManagerService,
          useValue: { terminalTurnPulses: pulses, lastTerminalPulseByTab },
        },
        { provide: CommandCenterRecordsService, useValue: records },
        {
          provide: TribunalDiscoveryService,
          useValue: {
            vendors,
            discovered,
            ensureDiscovered: jest.fn(async () => vendors()),
          },
        },
        { provide: ClaudeRpcService, useValue: rpc },
      ],
    });
    transport = TestBed.inject(CommandCenterTribunalTransport);
    store = TestBed.inject(CommandCenterStore);
    store.setSession('root-tab', 'session', '/workspace');
  });

  it('maps unavailable vendors to non-launchable lanes and applies disabledClis', async () => {
    await transport.open();
    expect(transport.availability()).toEqual({
      lanes: [
        {
          laneId: 'codex#1',
          state: 'AVAILABLE',
          family: 'codex',
          cli: 'codex',
        },
        {
          laneId: 'cursor#1',
          state: 'AT LIMIT',
          family: 'cursor',
          cli: 'cursor',
        },
      ],
      disabledClis: ['codex'],
    });
  });

  it('forwards the D1 answer verbatim and declines text containing Confirm', () => {
    const d1 = 'Discovery turn ended. Await further instructions.';
    expect(transport.answer('q1', 'roster', d1)).toBe(true);
    expect(coordinator.answerQuestion).toHaveBeenCalledWith({
      id: 'q1',
      answers: { roster: d1 },
    });
    transport.answer('q2', 'roster', 'Recorded. cOnFiRm this');
    expect(coordinator.answerQuestion).toHaveBeenLastCalledWith({
      id: 'q2',
      answers: { roster: 'Decline' },
    });
  });

  const pulse = (seq: number): TerminalTurnPulse => ({
    seq,
    tabId: 'root-tab',
    sessionId: 'session',
    workspacePath: '/workspace',
    revision: seq,
    phase: 'idle',
    terminalReason: 'completed',
    lastAssistantMessage: 'Done',
    classification: 'success',
    title: 'Command Center',
    occurredAt: Date.now(),
  });

  it('resolves discovery after the ledger consumes the queue', async () => {
    transport.answer('q1', 'roster', 'Discovery turn ended.');
    const complete = transport.discoveryComplete();
    lastTerminalPulseByTab.set(new Map([['root-tab', pulse(1)]]));
    pulses.set([]);
    TestBed.tick();
    await expect(complete).resolves.toBeUndefined();
  });

  it('resolves discovery when the marked pulse arrives before the waiter is armed', async () => {
    transport.answer('q1', 'roster', 'Discovery turn ended.');
    lastTerminalPulseByTab.set(new Map([['root-tab', pulse(1)]]));
    await expect(transport.discoveryComplete()).resolves.toBeUndefined();
  });

  it('rejects a pending discovery waiter on page exit', async () => {
    transport.answer('q1', 'roster', 'Discovery turn ended.');
    const complete = transport.discoveryComplete();
    transport.pageExit();
    await expect(complete).rejects.toThrow('Page exited');
  });

  it('rejects a pending discovery waiter when Decline cancels confirmation', async () => {
    transport.answer('q1', 'roster', 'Discovery turn ended.');
    const complete = transport.discoveryComplete();
    transport.cancelDiscovery();
    await expect(complete).rejects.toThrow('Discovery cancelled');
  });
});
