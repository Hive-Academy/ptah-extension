import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import { AgentId, type AgentMessagePreviewRequest, type AgentMessageRequest } from '@ptah-extension/shared';
import { CLI_AGENT_RUNTIME_TOKENS, type AgentMessageCoordinator } from '@ptah-extension/cli-agent-runtime';
import { RpcHandler, TOKENS } from '@ptah-extension/vscode-core';

const agentId = z.string().refine(AgentId.validate).transform(AgentId.from);
const previewSchema = z.object({ agentId, delivery: z.enum(['queue', 'now']).optional() }).strict();
const sendSchema = z.object({
  agentId,
  message: z.string().trim().min(1),
  delivery: z.enum(['queue', 'now', 'steer']).optional(),
  allowPartialTurnLoss: z.boolean().optional(),
}).strict();
const receiptSchema = z.object({ agentId, messageId: z.string().uuid() }).strict();

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
      this.coordinator.preview(previewSchema.parse(input)));
    this.rpc.registerMethod('agent:sendMessage', (input: AgentMessageRequest) =>
      this.coordinator.send(sendSchema.parse(input), 'user'));
    this.rpc.registerMethod('agent:getMessageReceipt', (input: { agentId: AgentId; messageId: string }) => {
      const { agentId: id, messageId } = receiptSchema.parse(input);
      return this.coordinator.getReceipt(id, messageId);
    });
    this.rpc.registerMethod('agent:cancelMessage', (input: { agentId: AgentId; messageId: string }) => {
      const { agentId: id, messageId } = receiptSchema.parse(input);
      return this.coordinator.cancel(id, messageId);
    });
  }
}
