/**
 * Spec-only harness for the coordinator and reconciler specs: an in-memory
 * persistence with outage injection, a fake manager, and the real envelope
 * store and alias registry over that persistence.
 */
import { EventEmitter } from 'eventemitter3';
import {
  AgentId,
  type AgentMessageOutcome,
  type AgentProcessInfo,
  type CliAdapterManifest,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type { AgentMessageStatus, MessageRoutableAgent } from '../../agent-message-router.service';
import type { SdkHandle } from '../../cli-adapters/cli-adapter.interface';
import type { CliDetectionService } from '../../cli-detection.service';
import { AgentIdAliasRegistry } from '../agent-id-alias.registry';
import { AgentMessageAckService } from '../agent-message-ack.service';
import {
  AgentMessageCoordinator,
  type CoordinatorManager,
  type CoordinatorScheduler,
} from '../agent-message-coordinator.service';
import type { AgentMessageDeliveryTarget } from '../agent-message-delivery.scheduler';
import { AGENT_MESSAGE_ENVELOPE_INDEX_KEY } from '../envelope/agent-message-envelope.schema';
import {
  AgentMessageEnvelopeStore,
  type AgentMessagePersistence,
} from '../envelope/agent-message-envelope.store';
import type { LaneResumeResult } from '../lane-resumers/lane-resumer.port';

const yes = { state: 'supported' } as const;
const no = { state: 'unsupported' } as const;
export const manifest: CliAdapterManifest = {
  messaging: { steer: yes, interrupt: yes, continuation: yes, resume: yes },
  roleChannel: 'task-prompt', permissionModes: {},
  networkModes: { allow: yes, deny: no },
  limitReader: { state: 'no-reliable-source' }, mcp: yes,
};

export class MemoryPersistence implements AgentMessagePersistence {
  readonly values = new Map<string, unknown>();
  /** Return true to reject a write; set by a spec to model a storage outage. */
  failWhen?: (key: string, value: unknown) => boolean;

  get<T>(key: string): T | undefined {
    const value = this.values.get(key);
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  async update(key: string, value: unknown): Promise<void> {
    if (this.failWhen?.(key, value)) throw new Error('disk unavailable');
    if (value === undefined) this.values.delete(key);
    else this.values.set(key, JSON.parse(JSON.stringify(value)));
  }

  keys(): readonly string[] {
    return [...this.values.keys()];
  }

  /** States of the durable index records, by id. */
  states(): Map<string, string> {
    const index = this.values.get(AGENT_MESSAGE_ENVELOPE_INDEX_KEY);
    const records = isIndex(index) ? index.records : [];
    return new Map(records.map((record) => [record.id, record.state]));
  }
}

function isIndex(value: unknown): value is { records: { id: string; state: string }[] } {
  return typeof value === 'object' && value !== null && 'records' in value && Array.isArray(value.records);
}

/** True when the written envelope index holds a record in `state`. */
export function indexHasState(key: string, value: unknown, state: string): boolean {
  return key === AGENT_MESSAGE_ENVELOPE_INDEX_KEY && isIndex(value) &&
    value.records.some((record) => record.state === state);
}

export function createLogger() {
  return Object.assign(Object.create(null) as Logger, {
    error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(),
  });
}

export function createDetection(): CliDetectionService {
  return Object.assign(Object.create(null) as CliDetectionService, { getAdapter: jest.fn() });
}

export function createHandle(): SdkHandle {
  return {
    abort: new AbortController(), done: Promise.resolve(0), onOutput: jest.fn(),
    steer: jest.fn(), interrupt: jest.fn(), supportsInterrupt: () => true,
    continue: jest.fn(), supportsContinuation: () => true,
  };
}

export function laneInfo(agentId: AgentId, patch: Partial<AgentProcessInfo> = {}): AgentProcessInfo {
  return {
    agentId, cli: 'pi', status: 'running', cliSessionId: 'session', task: 'work',
    workingDirectory: '.', startedAt: new Date().toISOString(),
    potentialCapabilities: manifest, turnSeq: 1, parentSessionId: 'parent-1', ...patch,
  };
}

export function harness(storage = new MemoryPersistence()) {
  const agentId = AgentId.create();
  const events = new EventEmitter();
  const lanes = new Map<string, MessageRoutableAgent>();
  const addLane = (id: AgentId, patch: Partial<AgentProcessInfo> = {}): MessageRoutableAgent => {
    const tracked: MessageRoutableAgent = {
      info: laneInfo(id, patch), sdkHandle: createHandle(), subprocessReleased: false, pendingMessages: [],
    };
    lanes.set(id, tracked);
    return tracked;
  };
  const tracked = addLane(agentId);
  /** Default router behaviour for a running lane: park the entry. */
  const sendToAgent = jest.fn(async (id: string, text: string, _delivery?: string, messageId?: string): Promise<AgentMessageOutcome> => {
    const lane = lanes.get(id);
    if (!lane || !messageId) throw new Error('unexpected route');
    lane.pendingMessages.push({ messageId, cliSessionId: lane.info.cliSessionId ?? 'session', text, journaled: true });
    return { mode: 'queue-next-turn', messageId };
  });
  const getAgentMessageStatus = jest.fn((_agentId: string, _messageId: string): AgentMessageStatus => ({ status: 'pending' }));
  const manager: CoordinatorManager = {
    events,
    findAgentInfo: (id: string) => {
      const lane = lanes.get(id);
      return lane ? { ...lane.info } : undefined;
    },
    getMessageRoutableAgent: (id: string) => lanes.get(id),
    sendToAgent,
    getAgentMessageStatus,
  };
  const scheduler: jest.Mocked<CoordinatorScheduler> = {
    start: jest.fn(async (_target: AgentMessageDeliveryTarget): Promise<void> => undefined), enqueueCold: jest.fn(), schedule: jest.fn(), onLaneSettled: jest.fn(),
  };
  const resume = { resume: jest.fn(async (): Promise<LaneResumeResult> => ({ agentId: AgentId.create() })) };
  const logger = createLogger();
  const detection = createDetection();
  const build = (persistence: MemoryPersistence) => {
    const store = new AgentMessageEnvelopeStore(persistence, undefined, Date.now, logger);
    const aliases = new AgentIdAliasRegistry(persistence, logger);
    const ack = new AgentMessageAckService({ store, aliases, logger });
    const coordinator = new AgentMessageCoordinator({
      manager, detection, store, aliases, resume, scheduler, ack, logger,
    });
    return { store, aliases, ack, coordinator };
  };
  const built = build(storage);
  return {
    agentId, events, lanes, tracked, addLane, sendToAgent, getAgentMessageStatus, manager, scheduler,
    resume, logger, detection, storage, ...built,
    /** A new host run over the same persistence (a crash and restart). */
    restart: () => build(storage),
    setInfo: (patch: Partial<AgentProcessInfo>) => { tracked.info = { ...tracked.info, ...patch }; },
  };
}

export const settleEvents = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export function idOf(outcome: AgentMessageOutcome): string {
  if (!outcome.messageId) throw new Error('Expected a message id.');
  return outcome.messageId;
}
