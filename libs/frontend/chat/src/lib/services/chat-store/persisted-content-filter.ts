import { isTerminalTurnPhase } from '@ptah-extension/shared';
import type { FlatStreamEventUnion, ToolResultEvent } from '@ptah-extension/shared';

/** One rendered history block, in its API message's block order. */
export type BlockSignature =
  | { readonly kind: 'text' | 'thinking'; readonly value: string }
  | { readonly kind: 'tool'; readonly value: string };

export interface PersistedContentFilterOptions {
  readonly tabId: string;
  readonly sessionId: string;
  readonly history: ReadonlyMap<string, readonly BlockSignature[]>;
  readonly historyToolResults: ReadonlyMap<string, { output: unknown; isError: boolean; synthetic: boolean }>;
  readonly historyToolIds: ReadonlySet<string>;
  readonly prefixMark: number | null;
  readonly seedMessageIds: ReadonlySet<string>;
  readonly seedStartK: ReadonlyMap<string, number>;
  readonly seedBlockKeys: ReadonlySet<string>;
  readonly deliverToTab: (event: FlatStreamEventUnion) => void;
  readonly reconcileHistoryToolResult: (event: ToolResultEvent) => boolean;
}

type Decision = 'keep' | 'drop' | 'hold';
type ContentEvent = Extract<FlatStreamEventUnion, { eventType: 'text_delta' | 'thinking_start' | 'thinking_delta' | 'tool_start' | 'tool_delta' | 'signature_delta' }>;
type AbsorbableEvent = Exclude<ContentEvent, { eventType: 'tool_start' | 'tool_delta' }>;
type TextEvent = Extract<ContentEvent, { eventType: 'text_delta' | 'thinking_delta' }>;
type Kind = 'text' | 'thinking';

interface Absorbed {
  key: string;
  kind: Kind;
  text: string;
  firstDelta?: TextEvent;
  thinkingStart?: FlatStreamEventUnion;
  signature?: FlatStreamEventUnion;
  position?: number;
  order: number;
}
type QueueEntry = { event: FlatStreamEventUnion } | { slot: Absorbed };
interface MessageState {
  phase: 'pre' | 'tracked' | 'pass';
  history: readonly BlockSignature[];
  k: number;
  ks: number;
  queue: QueueEntry[];
  blocks: Map<string, Absorbed>;
  passed: Set<string>;
  batchOpen: boolean;
  batchKept: boolean;
  preBatchOpen: boolean;
  preBatchDropped: boolean;
  keptContent: boolean;
  lastPreBlock?: string;
}

function blockKey(event: ContentEvent): string | undefined {
  if (event.eventType === 'tool_start' || event.eventType === 'tool_delta') {
    return event.toolCallId ? `${event.messageId}|tool|${event.toolCallId}` : undefined;
  }
  if (!Number.isInteger(event.blockIndex) || event.blockIndex < 0) return undefined;
  const kind = event.eventType === 'text_delta' ? 'text' : 'thinking';
  return `${event.messageId}|${kind}|${event.blockIndex}`;
}

function signature(event: ContentEvent): BlockSignature | undefined {
  if (event.eventType === 'text_delta') return { kind: 'text', value: event.delta };
  if (event.eventType === 'thinking_delta') return { kind: 'thinking', value: event.delta };
  if (event.eventType === 'tool_start') return { kind: 'tool', value: event.toolCallId };
  return undefined;
}

function same(a: BlockSignature | undefined, b: BlockSignature | undefined): boolean {
  return !!a && !!b && a.kind === b.kind && a.value === b.value;
}

function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]));
}

/** Per-tab filter for live events after a history reload. Construct one per rebuilt tab. */
export class PersistedContentFilter {
  readonly tabId: string;
  readonly sessionId: string;
  private readonly states = new Map<string, MessageState>();
  private readonly toolResults: Map<string, { output: unknown; isError: boolean; synthetic: boolean }>;
  private nextOrder = 0;
  private nextId = 0;
  private retired = false;
  private retiredDiscarded = false;
  private warned = false;

  constructor(private readonly options: PersistedContentFilterOptions) {
    this.tabId = options.tabId;
    this.sessionId = options.sessionId;
    this.toolResults = new Map(options.historyToolResults);
  }

  /** Return this tab's decision; released earlier events go through deliverToTab. After retirement, history tool results are kept and reconciled when changed. */
  decide(event: FlatStreamEventUnion, arrival?: number): Decision {
    if (this.retired) {
      if (!this.retiredDiscarded && event.eventType === 'tool_result' &&
        this.options.historyToolIds.has(event.toolCallId)) this.reconcileRetiredResult(event);
      return 'keep';
    }
    if (event.eventType === 'tool_result') return this.result(event);
    if (event.eventType === 'compaction_complete' ||
      (event.eventType === 'turn_state' && isTerminalTurnPhase(event.phase))) {
      this.retire();
      return 'keep';
    }
    if (event.eventType === 'turn_state' || event.eventType.startsWith('compaction_') ||
      event.eventType.startsWith('background_') || event.eventType === 'agent_progress' ||
      event.eventType === 'agent_status' || event.eventType === 'agent_completed' ||
      (event.eventType === 'message_start' && event.role === 'user')) return 'keep';
    if (!event.messageId) return 'keep';

    const pre = this.options.prefixMark !== null && arrival !== undefined && arrival < this.options.prefixMark;
    const key = this.isContent(event) ? blockKey(event) : undefined;
    if (pre && event.source === 'stream') {
      if ((key && this.options.seedBlockKeys.has(key)) ||
        (event.eventType === 'message_start' && this.options.seedMessageIds.has(event.messageId))) return 'drop';
    }
    if (pre && this.options.seedStartK.has(event.messageId) && this.options.history.has(event.messageId)) {
      if (event.source === 'complete') return this.preComplete(event);
      if (event.source === 'stream') return this.preStream(event, key);
    }
    // A pre-snapshot event never starts position tracking.
    if (pre) return 'keep';

    let state = this.states.get(event.messageId);
    if (state?.phase === 'pre') {
      const k0 = this.options.seedStartK.get(event.messageId) ?? 0;
      state.phase = k0 < state.history.length ? 'tracked' : 'pass';
      state.k = k0;
      state.ks = k0;
    }
    state ??= this.start(event);
    if (!state) return 'keep';
    if (state.phase === 'pass') return this.pass(state, event, key);
    return this.tracked(state, event, key);
  }

  /** Release unresolved content before a claim/terminal; pass true when the tab was removed, also disabling later tool reconciliation. */
  retire(discard = false): void {
    if (this.retired) return;
    this.retired = true;
    this.retiredDiscarded = discard;
    if (!discard) {
      for (const [id, state] of this.states) this.retireState(id, state);
    }
    this.states.clear();
  }

  private isContent(event: FlatStreamEventUnion): event is ContentEvent {
    return event.eventType === 'text_delta' || event.eventType === 'thinking_start' ||
      event.eventType === 'thinking_delta' || event.eventType === 'tool_start' ||
      event.eventType === 'tool_delta' || event.eventType === 'signature_delta';
  }

  private result(event: ToolResultEvent): Decision {
    const old = this.toolResults.get(event.toolCallId);
    if (this.sameResult(old, event)) return 'drop';
    if (this.options.historyToolIds.has(event.toolCallId)) {
      this.reconcileResult(event);
    }
    return 'keep';
  }

  private sameResult(old: { output: unknown; isError: boolean; synthetic: boolean } | undefined, event: ToolResultEvent): boolean {
    return !!old && !old.synthetic && old.isError === event.isError && jsonEqual(old.output, event.output);
  }

  private reconcileResult(event: ToolResultEvent): void {
    if (this.options.reconcileHistoryToolResult(event)) {
      this.toolResults.set(event.toolCallId, { output: event.output, isError: event.isError, synthetic: false });
    }
  }

  private reconcileRetiredResult(event: ToolResultEvent): void {
    if (!this.sameResult(this.toolResults.get(event.toolCallId), event)) this.reconcileResult(event);
  }

  private newState(id: string, phase: MessageState['phase'], k: number): MessageState {
    const state: MessageState = {
      phase, history: this.options.history.get(id) ?? [], k, ks: k,
      queue: [], blocks: new Map(), passed: new Set(), batchOpen: false,
      batchKept: false, preBatchOpen: false, preBatchDropped: true, keptContent: false,
    };
    this.states.set(id, state);
    return state;
  }

  private start(event: FlatStreamEventUnion): MessageState | undefined {
    const id = event.messageId;
    const old = this.states.get(id);
    if (old) return old;
    const k0 = this.options.seedStartK.get(id);
    if (k0 !== undefined) {
      const h = this.options.history.get(id);
      return this.newState(id, h && k0 < h.length ? 'tracked' : 'pass', k0);
    }
    if (this.options.seedMessageIds.has(id) || event.eventType !== 'message_start' ||
      event.source !== 'stream' || !this.options.history.has(id)) return undefined;
    return this.newState(id, 'tracked', 0);
  }

  private preState(id: string): MessageState {
    return this.states.get(id) ?? this.newState(id, 'pre', this.options.seedStartK.get(id) ?? 0);
  }

  private enqueue(state: MessageState, event: FlatStreamEventUnion): Decision {
    if (state.queue.length >= 4 * state.history.length + 4) {
      this.warn('malformed event queue', event.messageId);
      this.mismatch(state, event.messageId, false);
      return 'keep';
    }
    state.queue.push({ event });
    return 'hold';
  }

  private flush(state: MessageState): void {
    for (let i = 0; i < state.queue.length;) {
      const entry = state.queue[i];
      if ('slot' in entry) { i++; continue; }
      state.queue.splice(i, 1);
      this.options.deliverToTab(entry.event);
    }
  }

  private release(state: MessageState): void {
    while (state.queue.length) {
      const entry = state.queue.shift();
      if (!entry) break;
      if ('event' in entry) this.options.deliverToTab(entry.event);
      else if (state.blocks.get(entry.slot.key) === entry.slot) {
        state.blocks.delete(entry.slot.key);
        this.rebuild(entry.slot);
      }
    }
    state.blocks.clear();
  }

  private rebuild(block: Absorbed): void {
    if (block.thinkingStart) this.options.deliverToTab(block.thinkingStart);
    if (block.firstDelta) {
      this.options.deliverToTab({
        ...block.firstDelta, id: `${block.firstDelta.id}-persisted-rebuild-${++this.nextId}`,
        delta: block.text,
      });
    }
    if (block.signature) this.options.deliverToTab(block.signature);
  }

  private removeBlock(state: MessageState, block: Absorbed): void {
    state.blocks.delete(block.key);
    state.queue = state.queue.filter((entry) => !('slot' in entry && entry.slot === block));
  }

  private absorb(state: MessageState, event: AbsorbableEvent, key: string, position?: number): void {
    let block = state.blocks.get(key);
    if (!block) {
      block = { key, kind: event.eventType === 'text_delta' ? 'text' : 'thinking', text: '', order: ++this.nextOrder, position };
      state.blocks.set(key, block);
      state.queue.push({ slot: block });
    }
    if (position !== undefined) block.position = position;
    if (event.eventType === 'thinking_start') block.thinkingStart = event;
    if (event.eventType === 'signature_delta') block.signature = event;
    if (event.eventType === 'text_delta' || event.eventType === 'thinking_delta') {
      block.firstDelta ??= event;
      block.text += event.delta;
    }
  }

  private discardLoosePrefix(state: MessageState, kind: Kind, text: string): void {
    const block = [...state.blocks.values()].find((entry) => entry.position === undefined && entry.kind === kind && text.startsWith(entry.text));
    if (block) this.removeBlock(state, block);
  }

  private historyTool(state: MessageState, event: FlatStreamEventUnion): boolean {
    return (event.eventType === 'tool_start' || event.eventType === 'tool_delta') &&
      state.history.some((block) => block.kind === 'tool' && block.value === event.toolCallId);
  }

  private preComplete(event: FlatStreamEventUnion): Decision {
    const state = this.preState(event.messageId);
    if (event.eventType === 'message_start') {
      state.preBatchOpen = true;
      state.preBatchDropped = true;
      return this.enqueue(state, event);
    }
    if (event.eventType === 'message_complete') {
      const dropped = state.preBatchOpen && state.preBatchDropped;
      state.preBatchOpen = false;
      if (dropped) {
        state.queue = state.queue.filter((entry) => !('event' in entry && entry.event.source === 'complete' && entry.event.eventType === 'message_start'));
        return 'drop';
      }
      this.flush(state);
      return 'keep';
    }
    if (this.isContent(event)) {
      const sig = signature(event);
      const k0 = this.options.seedStartK.get(event.messageId) ?? 0;
      const match = sig && state.history.slice(0, k0).some((item) => same(item, sig));
      if (event.eventType === 'text_delta' || event.eventType === 'thinking_delta') {
        this.discardLoosePrefix(state, event.eventType === 'text_delta' ? 'text' : 'thinking', event.delta);
      }
      if (match) return 'drop';
    }
    if (state.preBatchOpen && state.preBatchDropped && !this.isContent(event)) return 'drop';
    state.preBatchDropped = false;
    this.flush(state);
    if (this.isContent(event)) state.keptContent = true;
    return 'keep';
  }

  private preStream(event: FlatStreamEventUnion, key?: string): Decision {
    const state = this.preState(event.messageId);
    if (!this.isContent(event)) return this.enqueue(state, event);
    if (!key) { this.flush(state); state.keptContent = true; return 'keep'; }
    if (!state.lastPreBlock || state.lastPreBlock !== key) state.lastPreBlock = key;
    if (state.passed.has(key)) { this.flush(state); state.keptContent = true; return 'keep'; }
    if (event.eventType === 'tool_start' || event.eventType === 'tool_delta') {
      if (this.historyTool(state, event)) return 'drop';
      this.flush(state); state.keptContent = true; return 'keep';
    }
    const kind: Kind = event.eventType === 'text_delta' ? 'text' : 'thinking';
    const joined = (state.blocks.get(key)?.text ?? '') +
      (event.eventType === 'text_delta' || event.eventType === 'thinking_delta' ? event.delta : '');
    if (state.history.some((block) => block.kind === kind && block.value.startsWith(joined))) {
      this.absorb(state, event, key);
      return 'drop';
    }
    this.flush(state);
    const old = state.blocks.get(key);
    if (old) { this.rebuild(old); this.removeBlock(state, old); }
    state.passed.add(key);
    state.keptContent = true;
    return 'keep';
  }

  private pass(state: MessageState, event: FlatStreamEventUnion, key?: string): Decision {
    if (this.historyTool(state, event)) return 'drop';
    if (this.isContent(event)) {
      this.flush(state);
      if (event.source === 'complete' && (event.eventType === 'text_delta' || event.eventType === 'thinking_delta')) {
        this.discardLoosePrefix(state, event.eventType === 'text_delta' ? 'text' : 'thinking', event.delta);
      }
      if (key) {
        const loose = state.blocks.get(key);
        if (loose) { this.rebuild(loose); this.removeBlock(state, loose); }
      }
      state.keptContent = true;
      return 'keep';
    }
    if (state.queue.length || state.blocks.size) return this.enqueue(state, event);
    return 'keep';
  }

  private tracked(state: MessageState, event: FlatStreamEventUnion, key?: string): Decision {
    const id = event.messageId;
    if (this.historyTool(state, event)) {
      if (event.eventType === 'tool_start') {
        if (event.source === 'stream' && same(state.history[state.ks], signature(event))) state.ks++;
        if (event.source === 'complete' && same(state.history[state.k], signature(event))) {
          state.k++;
          state.ks = Math.max(state.ks, state.k);
        }
      }
      this.maybePass(state);
      return 'drop';
    }
    if (event.source === 'stream') {
      if (!this.isContent(event)) return this.enqueue(state, event);
      if (event.parentToolUseId && event.eventType !== 'text_delta' && event.eventType !== 'tool_start' && event.eventType !== 'tool_delta') {
        this.flush(state); state.keptContent = true; return 'keep';
      }
      if (!key) return this.mismatch(state, id);
      if (state.passed.has(key)) { this.flush(state); state.keptContent = true; return 'keep'; }
      const existing = state.blocks.get(key);
      if (existing?.position !== undefined) {
        if (event.eventType === 'tool_start' || event.eventType === 'tool_delta') return this.mismatch(state, id);
        const expected = state.history[existing.position];
        const joined = existing.text + (event.eventType === 'text_delta' || event.eventType === 'thinking_delta' ? event.delta : '');
        if (event.eventType === 'signature_delta' || event.eventType === 'thinking_start' ||
          (expected && expected.kind === existing.kind && expected.value.startsWith(joined))) {
          this.absorb(state, event, key, existing.position); return 'drop';
        }
        return this.mismatch(state, id);
      }
      const pos = state.ks;
      if (pos >= state.history.length) {
        this.flush(state);
        if (existing) { this.rebuild(existing); this.removeBlock(state, existing); }
        state.passed.add(key); state.keptContent = true;
        return 'keep';
      }
      const expected = state.history[pos];
      if (event.eventType === 'tool_start' || event.eventType === 'tool_delta') return this.mismatch(state, id);
      const joined = (existing?.text ?? '') + (event.eventType === 'text_delta' || event.eventType === 'thinking_delta' ? event.delta : '');
      const kind = event.eventType === 'text_delta' ? 'text' : 'thinking';
      if (expected.kind !== kind || !expected.value.startsWith(joined)) return this.mismatch(state, id);
      this.absorb(state, event, key, pos);
      state.ks++;
      return 'drop';
    }
    if (event.source === 'complete') {
      if (event.eventType === 'message_start') {
        state.batchOpen = true; state.batchKept = false;
        return this.enqueue(state, event);
      }
      if (this.isContent(event)) {
        if (event.parentToolUseId && event.eventType === 'thinking_delta') {
          this.flush(state); state.batchKept = true; state.keptContent = true; return 'keep';
        }
        const sig = signature(event);
        if (!sig) return this.enqueue(state, event);
        if (state.k >= state.history.length) {
          this.flush(state); state.batchKept = true; state.keptContent = true;
          if (sig.kind !== 'tool') this.discardLoosePrefix(state, sig.kind, sig.value);
          return 'keep';
        }
        if (same(sig, state.history[state.k])) {
          const pos = state.k++;
          state.ks = Math.max(state.ks, state.k);
          const absorbed = [...state.blocks.values()].find((block) => block.position === pos);
          if (absorbed) this.removeBlock(state, absorbed);
          else if (sig.kind !== 'tool') this.discardLoosePrefix(state, sig.kind, sig.value);
          return 'drop';
        }
        return this.mismatch(state, id);
      }
      if (state.batchOpen) {
        const drop = !state.batchKept;
        if (event.eventType === 'message_complete') {
          state.batchOpen = false;
          if (drop) state.queue = state.queue.filter((entry) => !('event' in entry && entry.event.eventType === 'message_start' && entry.event.source === 'complete'));
          this.maybePass(state);
        }
        if (drop) return 'drop';
        this.flush(state); return 'keep';
      }
      return 'keep';
    }
    return 'keep';
  }

  private maybePass(state: MessageState): void {
    if (state.k === state.history.length && state.ks === state.history.length && !state.batchOpen) state.phase = 'pass';
  }

  private mismatch(state: MessageState, id: string, warn = true): Decision {
    if (warn) this.warn('history block mismatch', id);
    state.phase = 'pass';
    this.release(state);
    state.keptContent = true;
    return 'keep';
  }

  private retireState(id: string, state: MessageState): void {
    const k0 = this.options.seedStartK.get(id) ?? 0;
    let released = false;
    for (const block of state.blocks.values()) {
      if (block.position !== undefined) continue;
      const old = state.history.slice(0, k0).some((sig) => sig.kind === block.kind &&
        (block.key === state.lastPreBlock ? sig.value === block.text : sig.value.startsWith(block.text)));
      if (!old) released = true;
    }
    if (!state.keptContent && !released) return;
    while (state.queue.length) {
      const entry = state.queue.shift();
      if (!entry) break;
      if ('event' in entry) this.options.deliverToTab(entry.event);
      else if (state.blocks.get(entry.slot.key) === entry.slot) {
        const block = entry.slot;
        state.blocks.delete(block.key);
        if (block.position !== undefined) continue;
        const old = state.history.slice(0, k0).some((sig) => sig.kind === block.kind &&
          (block.key === state.lastPreBlock ? sig.value === block.text : sig.value.startsWith(block.text)));
        if (!old) this.rebuild(block);
      }
    }
  }

  private warn(reason: string, messageId: string): void {
    if (this.warned) return;
    this.warned = true;
    console.warn('[PersistedContentFilter]', reason, { tabId: this.tabId, messageId });
  }
}
