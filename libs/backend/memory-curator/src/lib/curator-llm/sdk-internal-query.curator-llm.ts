/**
 * SdkInternalQueryCuratorLlm — implements ICuratorLLM by routing extract /
 * resolve prompts through `SdkInternalQueryService` (one-shot, bypass-perm,
 * no chat-session pollution). Parses the model's JSON output defensively.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { InternalQueryService } from '@ptah-extension/agent-sdk';
import type { SDKMessage } from '@ptah-extension/agent-sdk';
import type {
  ExtractedMemoryDraft,
  ICuratorLLM,
  ResolvedMemoryDraft,
} from './curator-llm.interface';
import {
  EXTRACT_SYSTEM_PROMPT,
  buildExtractUserPrompt,
} from './extract-prompt';
import {
  RESOLVE_SYSTEM_PROMPT,
  buildResolveUserPrompt,
} from './resolve-prompt';
import type { MemoryKind } from '../memory.types';

const KIND_VALUES = new Set<MemoryKind>([
  'fact',
  'preference',
  'event',
  'entity',
]);

@injectable()
export class SdkInternalQueryCuratorLlm implements ICuratorLLM {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE)
    private readonly internalQuery: InternalQueryService,
  ) {}

  async extract(
    transcript: string,
    signal?: AbortSignal,
  ): Promise<readonly ExtractedMemoryDraft[]> {
    const text = await this.runQuery(
      EXTRACT_SYSTEM_PROMPT,
      buildExtractUserPrompt(transcript),
      signal,
    );
    return this.parseDrafts(text);
  }

  async resolve(
    drafts: readonly ExtractedMemoryDraft[],
    related: readonly { id: string; subject: string | null; content: string }[],
    signal?: AbortSignal,
  ): Promise<readonly ResolvedMemoryDraft[]> {
    if (drafts.length === 0) return [];
    if (related.length === 0) {
      return drafts.map((d) => ({ ...d, mergeTargetId: null }));
    }
    const text = await this.runQuery(
      RESOLVE_SYSTEM_PROMPT,
      buildResolveUserPrompt(drafts, related),
      signal,
    );
    return this.parseResolved(text, drafts);
  }

  private async runQuery(
    systemPromptAppend: string,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const abortController = new AbortController();
    if (signal) {
      if (signal.aborted) abortController.abort();
      else
        signal.addEventListener('abort', () => abortController.abort(), {
          once: true,
        });
    }
    try {
      const handle = await this.internalQuery.execute({
        cwd: process.cwd(),
        model: 'claude-haiku-4-20251022',
        prompt,
        systemPromptAppend,
        isPremium: false,
        mcpServerRunning: false,
        maxTurns: 1,
        abortController,
      });
      let collected = '';
      for await (const msg of handle.stream as AsyncIterable<SDKMessage>) {
        if (msg.type === 'assistant') {
          // SDKAssistantMessage.message.content is an array of blocks
          const message = (
            msg as unknown as {
              message?: { content?: Array<{ type: string; text?: string }> };
            }
          ).message;
          for (const block of message?.content ?? []) {
            if (block.type === 'text' && typeof block.text === 'string') {
              collected += block.text;
            }
          }
        }
        if (msg.type === 'result') break;
      }
      return collected;
    } catch (err) {
      this.logger.warn('[memory-curator] curator LLM query failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return '';
    }
  }

  private parseDrafts(text: string): readonly ExtractedMemoryDraft[] {
    const json = this.extractJsonObject(text);
    if (!json) return [];
    const list = (json as { memories?: unknown }).memories;
    if (!Array.isArray(list)) return [];
    const out: ExtractedMemoryDraft[] = [];
    for (const item of list) {
      const draft = this.coerceDraft(item);
      if (draft) out.push(draft);
    }
    return out;
  }

  private parseResolved(
    text: string,
    fallback: readonly ExtractedMemoryDraft[],
  ): readonly ResolvedMemoryDraft[] {
    const json = this.extractJsonObject(text);
    if (!json) return fallback.map((d) => ({ ...d, mergeTargetId: null }));
    const list = (json as { memories?: unknown }).memories;
    if (!Array.isArray(list))
      return fallback.map((d) => ({ ...d, mergeTargetId: null }));
    const out: ResolvedMemoryDraft[] = [];
    for (const item of list) {
      const draft = this.coerceDraft(item);
      if (!draft) continue;
      const mergeTargetId =
        typeof (item as { mergeTargetId?: unknown }).mergeTargetId === 'string'
          ? (item as { mergeTargetId: string }).mergeTargetId
          : null;
      out.push({ ...draft, mergeTargetId });
    }
    return out.length > 0
      ? out
      : fallback.map((d) => ({ ...d, mergeTargetId: null }));
  }

  private coerceDraft(item: unknown): ExtractedMemoryDraft | null {
    if (!item || typeof item !== 'object') return null;
    const o = item as Record<string, unknown>;
    const kindRaw = o['kind'];
    if (typeof kindRaw !== 'string') return null;
    const kind = kindRaw as MemoryKind;
    if (!KIND_VALUES.has(kind)) return null;
    const content =
      typeof o['content'] === 'string' ? (o['content'] as string).trim() : '';
    if (!content) return null;
    const subject =
      typeof o['subject'] === 'string' && (o['subject'] as string).trim()
        ? (o['subject'] as string).trim().toLowerCase()
        : null;
    const sh =
      typeof o['salienceHint'] === 'number'
        ? (o['salienceHint'] as number)
        : 0.3;
    const salienceHint = Math.max(0, Math.min(1, sh));
    return { kind, subject, content, salienceHint };
  }

  /** Extract the first balanced { … } JSON object from `text`. */
  private extractJsonObject(text: string): unknown | null {
    if (!text) return null;
    const start = text.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const slice = text.slice(start, i + 1);
          try {
            return JSON.parse(slice);
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }
}
