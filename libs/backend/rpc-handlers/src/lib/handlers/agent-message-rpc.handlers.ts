import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import { AgentId, type AgentMessagePreviewRequest, type AgentMessageRequest } from '@ptah-extension/shared';
import { CLI_AGENT_RUNTIME_TOKENS, type AgentMessageCoordinator } from '@ptah-extension/cli-agent-runtime';
import { RpcHandler, RpcUserError, TOKENS } from '@ptah-extension/vscode-core';

const agentId = z.string().refine(AgentId.validate).transform(AgentId.from);
const previewSchema = z.object({ agentId, delivery: z.enum(['queue', 'now']).optional() }).strict();
const sendSchema = z.object({
  agentId,
  message: z.string().min(1).max(32768).refine((value) => value.trim().length > 0),
  delivery: z.enum(['queue', 'now', 'steer']).optional(),
  allowPartialTurnLoss: z.boolean().optional(),
}).strict();
const receiptSchema = z.object({ agentId, messageId: z.string().uuid() }).strict();
function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw new RpcUserError('Invalid agent message parameters.', 'INVALID_PARAMS');
  return result.data;
}

@injectable()
export class AgentMessageRpcHandlers {
  static readonly METHODS = [
    'agent:previewMessage', 'agent:sendMessage', 'agent:getMessageReceipt', 'agent:cancelMessage',
  ] as const;

  constructor(
    @inject(TOKENS.RPC_HANDLER) private readonly rpc: RpcHandler,
    @inject(CLI_AGENT_RUNTIME_TOKENS.AGENT_MESSAGE_COORDINATOR)
    private readonly coordinator: AgentMessageCoordinator,
  ) {}

  register(): void {
    this.rpc.registerMethod('agent:previewMessage', async (input: AgentMessagePreviewRequest) =>
      this.coordinator.preview(parse(previewSchema, input)));
    this.rpc.registerMethod('agent:sendMessage', (input: AgentMessageRequest) =>
      this.coordinator.send(parse(sendSchema, input), 'user'));
    this.rpc.registerMethod('agent:getMessageReceipt', (input: { agentId: AgentId; messageId: string }) => {
      const { agentId: id, messageId } = parse(receiptSchema, input);
      return this.coordinator.getReceipt(id, messageId);
    });
    this.rpc.registerMethod('agent:cancelMessage', (input: { agentId: AgentId; messageId: string }) => {
      const { agentId: id, messageId } = parse(receiptSchema, input);
      return this.coordinator.cancel(id, messageId);
    });
  }
}
