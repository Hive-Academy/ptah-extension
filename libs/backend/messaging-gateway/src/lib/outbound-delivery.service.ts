/**
 * OutboundDeliveryService — the assistant reply's journey from token chunks to
 * platform messages, and the guarantee that it never disappears on the way.
 *
 * Extracted from `GatewayService` (TASK_2026_271) under the façade rule:
 * `GatewayService` keeps `appendOutboundChunk` / `drainOutbound` /
 * `discardOutbound` / `completeOutboundTurn` and delegates each one here.
 *
 * Owns the {@link StreamCoalescer} (always `'complete'` mode — one outbound
 * message per agent turn), the per-conversation page handles, pagination
 * against `maxMessageChars`, and per-page delivery recovery. Anything the
 * gateway says on its OWN behalf (pairing prompt, abuse-cap notice, permission
 * notice, typing) deliberately does not come through here: it goes straight to
 * the adapter so it can never flush or pollute a turn's accumulating reply.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';

import { GATEWAY_TOKENS } from './di/tokens';
import { BindingStore } from './binding.store';
import { MessageStore } from './message.store';
import { AdapterLifecycleService } from './adapter-lifecycle.service';
import {
  StreamCoalescer,
  type FlushCallback,
  type FlushPayload,
  type OutboundRoute,
} from './stream-coalescer';
import type { SendResult } from './adapters/adapter.interface';
import type { BindingId, ConversationKey, GatewayPlatform } from './types';

/**
 * Thrown by the outbound flush when a reply page could not be delivered to
 * the platform even after a retry. Carries enough for the caller to tell the
 * user which platform failed and how much of the reply (if any) went out.
 */
export class OutboundDeliveryError extends Error {
  constructor(
    readonly platform: GatewayPlatform,
    readonly failedPage: number,
    readonly totalPages: number,
    override readonly cause: unknown,
  ) {
    super(
      `Outbound delivery to ${platform} failed on page ${failedPage + 1}/${totalPages}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = 'OutboundDeliveryError';
  }
}

/**
 * Split a body into platform-sized pages, preferring a line break so a code
 * fence or a paragraph is not cut mid-word. No limit means one page.
 */
function paginate(body: string, limit?: number): string[] {
  if (!limit || body.length <= limit) return [body];
  const pages: string[] = [];
  let rest = body;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut <= 0) cut = limit;
    pages.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest.length) pages.push(rest);
  return pages;
}

@injectable()
export class OutboundDeliveryService {
  private coalescer: StreamCoalescer | null = null;

  /** Map conversationKey → ordered outbound message ids (one per page). */
  private readonly streamHandles = new Map<
    ConversationKey,
    { pageMsgIds: string[] }
  >();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(GATEWAY_TOKENS.GATEWAY_BINDING_STORE)
    private readonly bindings: BindingStore,
    @inject(GATEWAY_TOKENS.GATEWAY_MESSAGE_STORE)
    private readonly messages: MessageStore,
    @inject(GATEWAY_TOKENS.GATEWAY_ADAPTER_LIFECYCLE)
    private readonly lifecycle: AdapterLifecycleService,
  ) {}

  /** Build the coalescer up front on gateway start; idempotent. */
  ensureCoalescer(): void {
    if (!this.coalescer) this.coalescer = this.createCoalescer();
  }

  /**
   * Test seam: replace the flush path wholesale. Rebuilds the coalescer so a
   * spec that configures a callback after `start()` still gets it.
   */
  useFlushCallback(flushCb: FlushCallback): void {
    this.coalescer = this.createCoalescer(flushCb);
  }

  /** Append assistant text for a conversation — accumulates, never sends. */
  append(route: OutboundRoute, chunk: string): void {
    this.ensureCoalescer();
    this.coalescer?.append(route, chunk);
  }

  /** Flush whatever is pending WITHOUT sealing the turn. */
  async drain(conversationKey: ConversationKey): Promise<void> {
    try {
      await this.coalescer?.drain(conversationKey);
    } finally {
      this.streamHandles.delete(conversationKey);
    }
  }

  /**
   * Drop whatever the current turn has accumulated for a conversation WITHOUT
   * sending it. Used when a resumed stream fails part-way and the bridge
   * retries on a fresh session: the stranded partial text must not be glued
   * in front of the retry's reply (TASK_2026_271 #6).
   */
  discard(conversationKey: ConversationKey): void {
    this.coalescer?.discard(conversationKey);
    this.streamHandles.delete(conversationKey);
  }

  /**
   * Finalize a turn's outbound stream. Flushes whatever text is still pending,
   * then RESETS the per-conversation buffer and the platform message handle so
   * the NEXT turn starts a fresh platform message instead of editing (and
   * cumulatively re-sending) the previous turn's growing message.
   */
  async completeTurn(conversationKey: ConversationKey): Promise<void> {
    try {
      await this.coalescer?.drain(conversationKey); // flush whatever is pending
    } finally {
      // Reset even when delivery failed — otherwise the undelivered body
      // stays in the buffer and the NEXT turn re-sends it prepended to its
      // own reply. The delivery error propagates to the caller.
      this.coalescer?.discard(conversationKey); // reset cumulative body
      this.streamHandles.delete(conversationKey); // next turn -> sendMessage
    }
  }

  /** Graceful shutdown: get partially-assembled replies out before stopping. */
  async drainAll(): Promise<void> {
    await this.coalescer?.drainAll();
  }

  /**
   * Fire a single canned test message at an approved binding. Powers the
   * "Send test" button in the Gateway tab: same send-and-record path as a real
   * reply, minus the coalescer, so a green result proves token + allow-list +
   * permissions all line up. Returns a structured result so the UI can name the
   * precise reason (no-approved-binding, adapter-not-running, the platform's
   * own error text) instead of showing a stack trace.
   */
  async sendTest(args: {
    platform: GatewayPlatform;
    bindingId?: BindingId;
  }): Promise<
    | { ok: true; bindingId: string; externalMsgId: string | null }
    | { ok: false; error: string }
  > {
    const adapter = this.lifecycle.adapterFor(args.platform);
    if (!adapter) return { ok: false, error: 'adapter-not-running' };

    const approved = this.bindings.list({
      platform: args.platform,
      status: 'approved',
    });
    const binding = args.bindingId
      ? approved.find((b) => String(b.id) === String(args.bindingId))
      : approved.at(0);
    if (!binding) {
      return {
        ok: false,
        error: args.bindingId ? 'binding-not-approved' : 'no-approved-binding',
      };
    }

    const body = 'Ptah test message — gateway is wired up correctly.';
    try {
      const res = await adapter.sendMessage(binding.externalChatId, body);
      this.messages.insert({
        bindingId: binding.id,
        direction: 'outbound',
        externalMsgId: res.externalMsgId,
        body,
      });
      this.bindings.touch(binding.id);
      return {
        ok: true,
        bindingId: String(binding.id),
        externalMsgId: res.externalMsgId,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn('[gateway] sendTest failed', {
        platform: args.platform,
        error: message,
      });
      return { ok: false, error: message };
    }
  }

  /**
   * Build a coalescer in `'complete'` (accumulate-until-drain) mode so each
   * agent turn produces exactly ONE outbound send when the turn is sealed —
   * no mid-turn flushes, no live `editMessage` streaming.
   */
  private createCoalescer(flushCb?: FlushCallback): StreamCoalescer {
    const flush: FlushCallback =
      flushCb ?? ((payload) => this.flushOutbound(payload));
    return new StreamCoalescer(flush, { mode: 'complete' });
  }

  /**
   * Per-page delivery with recovery. An edit that fails (message deleted by the
   * user, evicted from the adapter's cache, transient API error) must NOT abort
   * the rest of the reply — the page is re-sent as a fresh message instead. A
   * send that fails after one retry is fatal for this flush and is rethrown so
   * the caller (`completeTurn` → bridge) can tell the user; the old behaviour
   * swallowed it into a warn-log and the turn vanished (TASK_2026_271 #2).
   */
  private async flushOutbound(payload: FlushPayload): Promise<void> {
    const adapter = this.lifecycle.adapterFor(payload.platform);
    if (!adapter) {
      this.logger.warn('[gateway] flushOutbound: no adapter for platform', {
        platform: payload.platform,
      });
      return;
    }
    const handle = this.streamHandles.get(payload.conversationKey) ?? {
      pageMsgIds: [],
    };
    this.streamHandles.set(payload.conversationKey, handle);
    const pages = paginate(payload.body, adapter.maxMessageChars);
    const sendOpts =
      payload.conversationId !== undefined
        ? { conversationId: payload.conversationId }
        : undefined;
    const errorText = (error: unknown): string =>
      error instanceof Error ? error.message : String(error);

    for (
      let i = Math.max(0, handle.pageMsgIds.length - 1);
      i < pages.length;
      i++
    ) {
      if (i < handle.pageMsgIds.length) {
        try {
          await adapter.editMessage(
            payload.externalChatId,
            handle.pageMsgIds[i],
            pages[i],
          );
          continue;
        } catch (error: unknown) {
          this.logger.warn(
            '[gateway] flushOutbound: edit failed, re-sending page as new message',
            { platform: payload.platform, page: i, error: errorText(error) },
          );
          handle.pageMsgIds.length = i; // drop this and later stale ids
        }
      }
      let res: SendResult;
      try {
        res = await adapter.sendMessage(
          payload.externalChatId,
          pages[i],
          sendOpts,
        );
      } catch (firstError: unknown) {
        this.logger.warn(
          '[gateway] flushOutbound: send failed, retrying once',
          {
            platform: payload.platform,
            page: i,
            error: errorText(firstError),
          },
        );
        try {
          res = await adapter.sendMessage(
            payload.externalChatId,
            pages[i],
            sendOpts,
          );
        } catch (error: unknown) {
          this.logger.error(
            '[gateway] flushOutbound: send failed after retry — reply not delivered',
            error instanceof Error ? error : new Error(String(error)),
          );
          throw new OutboundDeliveryError(
            payload.platform,
            i,
            pages.length,
            error,
          );
        }
      }
      handle.pageMsgIds.push(res.externalMsgId);
      if (i === 0) {
        const binding = this.bindings.findByExternal(
          payload.platform,
          payload.externalChatId,
        );
        if (binding) {
          this.messages.insert({
            bindingId: binding.id,
            direction: 'outbound',
            externalMsgId: res.externalMsgId,
            body: pages[i],
          });
        }
      }
    }
  }
}
