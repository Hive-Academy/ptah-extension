import { injectable, inject } from 'tsyringe';
import type { FlatStreamEventUnion, SessionId } from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type {
  InternalQueryConfig,
  InternalQueryHandle,
} from '@ptah-extension/agent-sdk';
import type { SDKMessage } from '@ptah-extension/agent-sdk';
import { DEEP_AGENT_TOKENS } from '../di/tokens';
import { DeepAgentAdapter } from '../deep-agent-adapter/deep-agent-adapter';

const SERVICE_TAG = '[DeepAgentInternalQuery]';

function buildFullPrompt(config: InternalQueryConfig): string {
  if (!config.outputFormat) {
    return config.prompt;
  }

  const schema = config.outputFormat.schema;
  const schemaInstructions = schema
    ? `\n\nYour response MUST be valid JSON matching this schema:\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\`\n\nRespond with ONLY the JSON object, no additional text.`
    : '\n\nYour response MUST be valid JSON.';

  return config.prompt + schemaInstructions;
}

function extractJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    // try ```json block
    const codeBlockMatch = /```json\s*([\s\S]*?)```/.exec(text);
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1].trim());
      } catch {
        // fall through
      }
    }
    // try brace extraction
    const braceMatch = /(\{[\s\S]*\})/.exec(text);
    if (braceMatch) {
      try {
        return JSON.parse(braceMatch[1]);
      } catch {
        // fall through
      }
    }
    return null;
  }
}

@injectable()
export class DeepAgentInternalQueryAdapter {
  constructor(
    @inject(DEEP_AGENT_TOKENS.DEEP_AGENT_ADAPTER)
    private readonly deepAgent: DeepAgentAdapter,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
  ) {}

  async execute(config: InternalQueryConfig): Promise<InternalQueryHandle> {
    const tabId = 'internal-query-' + Date.now();
    const abortController = config.abortController ?? new AbortController();

    this.logger.info(`${SERVICE_TAG} Starting internal query via deep-agent`, {
      tabId,
      model: config.model,
      isPremium: config.isPremium,
      cwd: config.cwd,
    });

    const rawStream = await this.deepAgent.startChatSession({
      tabId,
      prompt: buildFullPrompt(config),
      systemPrompt: config.systemPromptAppend,
      model: config.model,
      isPremium: config.isPremium,
      mcpServerRunning: config.mcpServerRunning,
      pluginPaths: config.pluginPaths,
      projectPath: config.cwd,
      workspaceId: config.cwd,
      name: 'Internal Query',
    });

    const stream = this.adaptStream(rawStream, tabId, config, abortController);

    return {
      stream,
      abort: () => abortController.abort(),
      close: () => {
        /* cleanup handled in adaptStream finally block */
      },
    };
  }

  private async *adaptStream(
    rawStream: AsyncIterable<FlatStreamEventUnion>,
    tabId: string,
    config: InternalQueryConfig,
    abortController: AbortController,
  ): AsyncIterable<SDKMessage> {
    let fullText = '';
    let gotComplete = false;

    try {
      for await (const event of rawStream) {
        if (abortController.signal.aborted) {
          break;
        }

        if (event.eventType === 'text_delta') {
          const delta = (event as { eventType: 'text_delta'; delta: string })
            .delta;
          fullText += delta;

          yield {
            type: 'stream_event',
            event: {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: delta },
            },
          } as unknown as SDKMessage;
        } else if (event.eventType === 'message_complete') {
          gotComplete = true;

          yield {
            type: 'result',
            subtype: 'success',
            result: fullText,
            structured_output: config.outputFormat
              ? extractJson(fullText)
              : null,
            num_turns: 1,
            total_cost_usd: 0,
            is_error: false,
            duration_ms: 0,
            usage: { input_tokens: 0, output_tokens: 0 },
          } as unknown as SDKMessage;

          return;
        }
      }

      if (!gotComplete) {
        yield {
          type: 'result',
          subtype: 'success',
          result: fullText,
          structured_output: config.outputFormat ? extractJson(fullText) : null,
          num_turns: 1,
          total_cost_usd: 0,
          is_error: false,
          duration_ms: 0,
          usage: { input_tokens: 0, output_tokens: 0 },
        } as unknown as SDKMessage;
      }
    } finally {
      this.logger.info(`${SERVICE_TAG} Internal query finished`, {
        tabId,
        textLength: fullText.length,
      });
      this.deepAgent.endSession(tabId as SessionId);
    }
  }
}
