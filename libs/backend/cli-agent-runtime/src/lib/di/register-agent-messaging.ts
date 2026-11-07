/**
 * Lane messaging registrations (Components 2, 3, 6, 8, 10), split out of
 * `register.ts`. `registerAgentMessageJournal` runs BEFORE the router and the
 * manager are registered, so the router's optional journal injection finds
 * it; `registerAgentMessagingServices` runs after the manager.
 *
 * Every collaborator that another phase registers (the receipt push sink, the
 * session metadata store, the Ptah CLI registry) is resolved lazily at call
 * time, so resolving the router early never caches a store without its sink.
 */
import { type DependencyContainer, instanceCachingFactory } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SDK_TOKENS, type SessionMetadataStore } from '@ptah-extension/agent-sdk';
import { PLATFORM_TOKENS, type IStateStorage } from '@ptah-extension/platform-core';
import type { AgentDeliveryReceipt } from '@ptah-extension/shared';
import { CLI_AGENT_RUNTIME_TOKENS } from './tokens';
import type { AgentProcessManager } from '../cli-agents/agent-process-manager.service';
import type { CliDetectionService } from '../cli-agents/cli-detection.service';
import { ParentEnvelopeStoreService } from '../cli-agents/parent-delivery/parent-envelope-store.service';
import type { AgentDeliveryReceiptEventSink } from '../cli-agents/messaging/agent-delivery-receipt-event-sink';
import { AgentIdAliasRegistry } from '../cli-agents/messaging/agent-id-alias.registry';
import { AgentLaneResumeService } from '../cli-agents/messaging/agent-lane-resume.service';
import { AgentMessageAckService } from '../cli-agents/messaging/agent-message-ack.service';
import { AgentMessageCoordinator } from '../cli-agents/messaging/agent-message-coordinator.service';
import { AgentMessageDeliveryScheduler } from '../cli-agents/messaging/agent-message-delivery.scheduler';
import type { AgentMessageDispatchJournal } from '../cli-agents/messaging/agent-message-dispatch-journal.port';
import { AgentMessageEnvelopeStore } from '../cli-agents/messaging/envelope/agent-message-envelope.store';
import { PtahCliLaneResumer } from '../cli-agents/messaging/lane-resumers/ptah-cli-lane-resumer';
import {
  ParentSessionPurgeService,
  type ParentSessionExistence,
} from '../cli-agents/messaging/parent-session-purge.service';
import type { PtahCliRegistry } from '../ptah-cli';

const envelopeStore = (c: DependencyContainer): AgentMessageEnvelopeStore =>
  c.resolve<AgentMessageEnvelopeStore>(CLI_AGENT_RUNTIME_TOKENS.AGENT_MESSAGE_ENVELOPE_STORE);
const isParentFrozen = (c: DependencyContainer) => (parentSessionId: string): boolean =>
  c.resolve(ParentEnvelopeStoreService).isParentFrozen(parentSessionId);

/** Envelope store and the router's dispatch journal over it. */
export function registerAgentMessageJournal(container: DependencyContainer): void {
  container.register(CLI_AGENT_RUNTIME_TOKENS.AGENT_MESSAGE_ENVELOPE_STORE, {
    useFactory: instanceCachingFactory((c) => AgentMessageEnvelopeStore.fromStateStorage(
      c.resolve<IStateStorage>(PLATFORM_TOKENS.STATE_STORAGE),
      lazyReceiptSink(c),
      c.resolve<Logger>(TOKENS.LOGGER),
    )),
  });
  container.register(CLI_AGENT_RUNTIME_TOKENS.AGENT_MESSAGE_DISPATCH_JOURNAL, {
    useFactory: instanceCachingFactory((c): AgentMessageDispatchJournal => ({
      async markDispatching(messageId: string): Promise<void> {
        await envelopeStore(c).markDispatching(messageId);
      },
    })),
  });
}

/** Alias registry, scheduler, purge, resume, ack and the coordinator. */
export function registerAgentMessagingServices(container: DependencyContainer): void {
  container.register(CLI_AGENT_RUNTIME_TOKENS.AGENT_ID_ALIAS_REGISTRY, {
    useFactory: instanceCachingFactory((c) => new AgentIdAliasRegistry(
      c.resolve<IStateStorage>(PLATFORM_TOKENS.STATE_STORAGE),
      c.resolve<Logger>(TOKENS.LOGGER),
    )),
  });
  container.register(CLI_AGENT_RUNTIME_TOKENS.AGENT_MESSAGE_SCHEDULER, {
    useFactory: instanceCachingFactory((c) => new AgentMessageDeliveryScheduler(
      envelopeStore(c), c.resolve<Logger>(TOKENS.LOGGER), { isParentFrozen: isParentFrozen(c) },
    )),
  });
  container.register(CLI_AGENT_RUNTIME_TOKENS.PARENT_SESSION_PURGE, {
    useFactory: instanceCachingFactory((c) => new ParentSessionPurgeService(
      c.resolve(ParentEnvelopeStoreService),
      envelopeStore(c),
      createParentSessionExistence(c),
      c.resolve<Logger>(TOKENS.LOGGER),
    )),
  });
  container.register(CLI_AGENT_RUNTIME_TOKENS.AGENT_LANE_RESUME, {
    useFactory: instanceCachingFactory((c) => {
      const manager = c.resolve<AgentProcessManager>(TOKENS.AGENT_PROCESS_MANAGER);
      const registry = (): PtahCliRegistry =>
        c.resolve<PtahCliRegistry>(CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_REGISTRY);
      const metadata = (): SessionMetadataStore =>
        c.resolve<SessionMetadataStore>(SDK_TOKENS.SDK_SESSION_METADATA_STORE);
      return new AgentLaneResumeService(manager, new PtahCliLaneResumer(
        manager,
        {
          spawnAgent: (...args: Parameters<PtahCliRegistry['spawnAgent']>) => registry().spawnAgent(...args),
          getMcpPort: () => registry().getMcpPort(),
        },
        {
          createChild: (...args: Parameters<SessionMetadataStore['createChild']>) =>
            metadata().createChild(...args),
        },
        c.resolve<Logger>(TOKENS.LOGGER),
      ));
    }),
  });
  container.register(CLI_AGENT_RUNTIME_TOKENS.AGENT_MESSAGE_ACK, {
    useFactory: instanceCachingFactory((c) => new AgentMessageAckService({
      store: envelopeStore(c),
      aliases: c.resolve<AgentIdAliasRegistry>(CLI_AGENT_RUNTIME_TOKENS.AGENT_ID_ALIAS_REGISTRY),
      logger: c.resolve<Logger>(TOKENS.LOGGER),
    })),
  });
  container.register(CLI_AGENT_RUNTIME_TOKENS.AGENT_MESSAGE_COORDINATOR, {
    useFactory: instanceCachingFactory((c) => {
      const logger = c.resolve<Logger>(TOKENS.LOGGER);
      const coordinator = new AgentMessageCoordinator({
        manager: c.resolve<AgentProcessManager>(TOKENS.AGENT_PROCESS_MANAGER),
        detection: c.resolve<CliDetectionService>(TOKENS.CLI_DETECTION_SERVICE),
        store: envelopeStore(c),
        aliases: c.resolve<AgentIdAliasRegistry>(CLI_AGENT_RUNTIME_TOKENS.AGENT_ID_ALIAS_REGISTRY),
        resume: c.resolve<AgentLaneResumeService>(CLI_AGENT_RUNTIME_TOKENS.AGENT_LANE_RESUME),
        scheduler: c.resolve<AgentMessageDeliveryScheduler>(CLI_AGENT_RUNTIME_TOKENS.AGENT_MESSAGE_SCHEDULER),
        ack: c.resolve<AgentMessageAckService>(CLI_AGENT_RUNTIME_TOKENS.AGENT_MESSAGE_ACK),
        purge: c.resolve<ParentSessionPurgeService>(CLI_AGENT_RUNTIME_TOKENS.PARENT_SESSION_PURGE),
        isParentFrozen: isParentFrozen(c),
        logger,
      });
      // Purge recovery decides before the scheduler delivers anything (Component 10).
      void coordinator.start().catch((error: unknown) => {
        logger.error('[CliAgentRuntime] Agent message startup failed',
          error instanceof Error ? error : new Error('Agent message startup failed'));
      });
      return coordinator;
    }),
  });
}

/** Parent session metadata existence (A7). Unknown → throws, which keeps the parent frozen. */
export function createParentSessionExistence(c: DependencyContainer): ParentSessionExistence {
  return {
    async exists(sessionId: string): Promise<boolean> {
      if (!c.isRegistered(SDK_TOKENS.SDK_SESSION_METADATA_STORE, true))
        throw new Error('Session metadata store is not registered in this host.');
      const metadata = await c.resolve<SessionMetadataStore>(SDK_TOKENS.SDK_SESSION_METADATA_STORE).get(sessionId);
      return metadata !== null && metadata !== undefined;
    },
  };
}

/** The push sink is registered by the host wiring, possibly after the store exists. */
function lazyReceiptSink(c: DependencyContainer): AgentDeliveryReceiptEventSink {
  return {
    changed(receipt: AgentDeliveryReceipt): void {
      if (!c.isRegistered(CLI_AGENT_RUNTIME_TOKENS.AGENT_DELIVERY_RECEIPT_EVENT_SINK, true)) return;
      c.resolve<AgentDeliveryReceiptEventSink>(CLI_AGENT_RUNTIME_TOKENS.AGENT_DELIVERY_RECEIPT_EVENT_SINK)
        .changed(receipt);
    },
  };
}
