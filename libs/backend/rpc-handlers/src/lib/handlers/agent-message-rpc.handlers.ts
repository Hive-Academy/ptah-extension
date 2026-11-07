import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import {
  AGENT_MESSAGE_MAX_CHARS,
  AgentId,
  type AgentDeliveryReceipt,
  type AgentGetQueuedMessageBodyResult,
  type AgentListMessageReceiptsResult,
  type AgentListParentDeliveriesResult,
  type AgentMessageOutcome,
  type AgentMessagePreview,
  type AgentMessageSender,
  type ParentDeliveryView,
} from '@ptah-extension/shared';
import {
  CLI_AGENT_RUNTIME_TOKENS,
  LaneCompletionNotifier,
  ParentDeliveryDrainerService,
  type AgentMessageCoordinator,
} from '@ptah-extension/cli-agent-runtime';
import { RpcHandler, RpcUserError, TOKENS } from '@ptah-extension/vscode-core';

const agentId = z.string().refine(AgentId.validate).transform(AgentId.from);
const messageId = z.string().uuid();
const parentSessionId = z.string().min(1).max(200);
/** Both current id formats, matched exactly (`lane-delivery:report:…` and `lane-delivery:<agentId>:<completedAt>`). */
const parentDeliveryId = z.custom<ParentDeliveryView['deliveryId']>(
  (value) => typeof value === 'string' && /^lane-delivery:\S{1,480}$/.test(value),
);
const previewSchema = z.object({ agentId, delivery: z.enum(['queue', 'now']).optional() }).strict();
const sendSchema = z.object({
  agentId,
  message: z.string().min(1).max(AGENT_MESSAGE_MAX_CHARS).refine((value) => value.trim().length > 0),
  delivery: z.enum(['queue', 'now', 'steer']).optional(),
  allowPartialTurnLoss: z.boolean().optional(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/).optional(),
}).strict();
const receiptSchema = z.object({ agentId, messageId }).strict();
const listReceiptsSchema = z.object({ agentId: agentId.optional(), parentSessionId: parentSessionId.optional() }).strict();
const retryMessageSchema = z.object({ agentId, messageId, confirmDuplicateRisk: z.boolean().optional() }).strict();
const listParentSchema = z.object({ parentSessionId: parentSessionId.optional() }).strict();
const retryParentSchema = z.object({ deliveryId: parentDeliveryId, confirmDuplicateRisk: z.boolean().optional() }).strict();
const cancelParentSchema = z.object({ deliveryId: parentDeliveryId }).strict();

/** Settled and cancelled receipts kept in a list; undelivered ones are never cut. */
const MAX_FINISHED_RECEIPTS = 256;
const FINISHED_STATES = new Set<AgentDeliveryReceipt['state']>(['settled', 'cancelled']);
/** The renderer is the user: it may see and act on every envelope. */
const USER: AgentMessageSender = { kind: 'user' };

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) throw new RpcUserError('Invalid agent message parameters.', 'INVALID_PARAMS');
  return result.data;
}

type ParentMutation = Awaited<ReturnType<ParentDeliveryDrainerService['retry']>>;

/**
 * Renderer RPC for lane messages and parent deliveries (Component 12). Every
 * method validates its params with a strict schema; the sender is always the
 * user, never a param.
 */
@injectable()
export class AgentMessageRpcHandlers {
  static readonly METHODS = [
    'agent:previewMessage',
    'agent:sendMessage',
    'agent:getMessageReceipt',
    'agent:listMessageReceipts',
    'agent:getQueuedMessageBody',
    'agent:retryMessage',
    'agent:cancelMessage',
    'agent:listParentDeliveries',
    'agent:retryParentDelivery',
    'agent:cancelParentDelivery',
  ] as const;

  constructor(
    @inject(TOKENS.RPC_HANDLER) private readonly rpc: RpcHandler,
    @inject(CLI_AGENT_RUNTIME_TOKENS.AGENT_MESSAGE_COORDINATOR)
    private readonly coordinator: AgentMessageCoordinator,
    @inject(ParentDeliveryDrainerService)
    private readonly parentDelivery: Pick<ParentDeliveryDrainerService, 'list' | 'toView' | 'retry' | 'cancel'>,
    @inject(LaneCompletionNotifier)
    private readonly laneCompletion: Pick<LaneCompletionNotifier, 'retryUnsaved'>,
  ) {}

  register(): void {
    this.rpc.registerMethod<unknown, AgentMessagePreview>('agent:previewMessage', async (input) =>
      this.coordinator.preview(parse(previewSchema, input)));
    this.rpc.registerMethod<unknown, AgentMessageOutcome>('agent:sendMessage', (input) =>
      this.coordinator.send(parse(sendSchema, input), USER));
    this.rpc.registerMethod<unknown, AgentDeliveryReceipt>('agent:getMessageReceipt', (input) => {
      const params = parse(receiptSchema, input);
      return this.coordinator.getReceipt(params.agentId, params.messageId, USER);
    });
    this.rpc.registerMethod<unknown, AgentListMessageReceiptsResult>('agent:listMessageReceipts', async (input) => {
      const receipts = await this.coordinator.listReceipts(parse(listReceiptsSchema, input));
      return { receipts: newestFirstBounded(receipts) };
    });
    this.rpc.registerMethod<unknown, AgentGetQueuedMessageBodyResult>('agent:getQueuedMessageBody', async (input) => {
      const params = parse(receiptSchema, input);
      return { text: await this.coordinator.getBody(params.agentId, params.messageId, USER) };
    });
    this.rpc.registerMethod<unknown, AgentMessageOutcome>('agent:retryMessage', (input) => {
      const params = parse(retryMessageSchema, input);
      return this.coordinator.retry(params.agentId, params.messageId, USER, {
        confirmDuplicateRisk: params.confirmDuplicateRisk,
      });
    });
    this.rpc.registerMethod<unknown, AgentDeliveryReceipt>('agent:cancelMessage', (input) => {
      const params = parse(receiptSchema, input);
      return this.coordinator.cancel(params.agentId, params.messageId, USER);
    });
    this.rpc.registerMethod<unknown, AgentListParentDeliveriesResult>('agent:listParentDeliveries', async (input) => {
      const params = parse(listParentSchema, input);
      const deliveries = this.parentDelivery.list(params.parentSessionId)
        .map((envelope) => this.parentDelivery.toView(envelope));
      return { deliveries };
    });
    this.rpc.registerMethod<unknown, ParentDeliveryView>('agent:retryParentDelivery', (input) =>
      this.retryParentDelivery(parse(retryParentSchema, input)));
    this.rpc.registerMethod<unknown, ParentDeliveryView>('agent:cancelParentDelivery', async (input) => {
      const { deliveryId } = parse(cancelParentSchema, input);
      if (!this.holds(deliveryId)) throw notFound();
      return this.parentView(deliveryId, await this.parentDelivery.cancel(deliveryId));
    });
  }

  /**
   * A stored delivery is retried in the store. An id with no store record may
   * name a completion that was never saved; the notifier saves it once.
   */
  private async retryParentDelivery(params: z.output<typeof retryParentSchema>): Promise<ParentDeliveryView> {
    if (!this.holds(params.deliveryId)) {
      const unsaved = await this.laneCompletion.retryUnsaved(params.deliveryId);
      if (!unsaved) throw notFound();
      return unsaved;
    }
    const result = await this.parentDelivery.retry(params.deliveryId, {
      confirmDuplicateRisk: params.confirmDuplicateRisk,
    });
    return this.parentView(params.deliveryId, result);
  }

  private holds(deliveryId: string): boolean {
    return this.parentDelivery.list().some((envelope) => envelope.id === deliveryId);
  }

  private parentView(deliveryId: string, result: ParentMutation): ParentDeliveryView {
    if (!('refused' in result)) return this.parentDelivery.toView(result);
    switch (result.refused) {
      case 'confirmation-required':
        throw new RpcUserError(
          'This delivery may already have reached the parent. Retry with confirmDuplicateRisk to send it again.',
          'INVALID_PARAMS',
        );
      case 'parent-session-deleted':
        throw new RpcUserError('The parent session is being deleted.', 'SESSION_NOT_FOUND');
      case 'storage-unavailable':
        // The store answers a missing id with this refusal too; a record removed meanwhile is not found.
        if (!this.holds(deliveryId)) throw notFound();
        throw new RpcUserError('Parent delivery storage is unavailable.', 'PERSISTENCE_UNAVAILABLE');
      case 'parent-inbox-full':
        throw new RpcUserError('The parent inbox is full.', 'PERSISTENCE_UNAVAILABLE');
    }
  }
}

function notFound(): RpcUserError {
  return new RpcUserError('Parent delivery not found.', 'MESSAGE_ID_NOT_FOUND');
}

/** Newest first: every undelivered receipt, plus at most 256 settled or cancelled ones. */
function newestFirstBounded(receipts: readonly AgentDeliveryReceipt[]): AgentDeliveryReceipt[] {
  let finished = 0;
  return [...receipts]
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((receipt) => !FINISHED_STATES.has(receipt.state) || ++finished <= MAX_FINISHED_RECEIPTS);
}
