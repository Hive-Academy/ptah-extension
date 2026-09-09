import type {
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  SDKMessage,
} from '../types/sdk-types/claude-sdk.types';

/**
 * Query-local root activity accounting. Silence is not evidence of failure while
 * a known tool or compaction is running: report uncertainty, never impose a
 * runtime limit. Only unaccounted root silence invokes the recovery callback.
 * Idle/permission holds remain reference counted; operation ownership is keyed
 * and idempotent instead. Child registration never owns a parent hold.
 */
export class NoActivityWatchdog {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private fired = false;
  private stopped = false;
  private started = false;
  private holds = 0;
  private turnOpen = true;

  beginTurn(): void {
    if (this.stopped || this.fired) return;
    this.turnOpen = true;
    this.kick();
  }
  private readonly tools = new Map<string, string>();
  private compacting = false;
  private readonly tasks = new Map<string, string>();

  constructor(
    private readonly timeoutMs: number,
    private readonly onTimeout: () => void,
    private readonly onOverdue: (operations: readonly string[]) => void = () =>
      undefined,
  ) {}

  start(): void {
    if (this.stopped || this.fired) return;
    this.started = true;
    this.arm();
  }

  kick(): void {
    if (this.stopped || this.fired || !this.started) return;
    this.arm();
  }

  hold(): void {
    if (this.stopped || this.fired) return;
    this.holds += 1;
    this.clear();
  }

  release(): void {
    if (this.holds === 0) return;
    this.holds -= 1;
    this.kick();
  }

  get isHeld(): boolean {
    return this.holds > 0;
  }

  /** Root result/interrupt is authoritative even when a terminal hook is lost. */
  endTurn(): void {
    this.turnOpen = false;
    this.tools.clear();
    this.tasks.clear();
    this.compacting = false;
    this.kick();
  }

  stop(): void {
    this.stopped = true;
    this.holds = 0;
    this.endTurn();
    this.clear();
  }

  /** SDK hooks are scoped to this query, never a mutable session-id lookup. */
  lifecycleHooks(): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    const events: HookEvent[] = [
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'PreCompact',
      'PostCompact',
      'Stop',
      'StopFailure',
      'SessionEnd',
    ];
    const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};
    for (const event of events) {
      hooks[event] = [
        {
          hooks: [
            async (input, _toolId, options) => {
              if (!options.signal.aborted) this.observeHook(input);
              return { continue: true };
            },
          ],
        },
      ];
    }
    return hooks;
  }

  private observeHook(input: HookInput): void {
    // SDK BaseHookInput: agent_id, not agent_type, identifies nested hooks.
    if (this.stopped || this.fired || !this.turnOpen || input.agent_id) return;
    switch (input.hook_event_name) {
      case 'PreToolUse':
        if (input.tool_use_id)
          this.tools.set(input.tool_use_id, input.tool_name);
        break;
      case 'PostToolUse':
      case 'PostToolUseFailure':
        this.tools.delete(input.tool_use_id);
        break;
      case 'PreCompact':
        this.compacting = true;
        break;
      case 'PostCompact':
        this.compacting = false;
        break;
      case 'Stop':
      case 'StopFailure':
        // Do not release the pump or publish idle from a hook: final assistant
        // messages may still be buffered. The result owns the turn boundary.
        this.endTurn();
        break;
      case 'SessionEnd':
        this.stop();
        break;
    }
    this.kick();
  }

  /** Only root activity extends the root deadline. Background chatter cannot. */
  observe(message: SDKMessage): void {
    if (this.stopped || this.fired) return;
    if ('parent_tool_use_id' in message && message.parent_tool_use_id) return;
    if (
      message.type === 'tool_progress' &&
      !this.tools.has(message.tool_use_id)
    )
      return;
    if (message.type === 'system' && this.observeSystem(message)) return;
    this.observeToolResults(message);
    if (message.type === 'result') this.endTurn();
    this.kick();
  }

  /** Task chatter only extends the deadline when it releases a root tool. */
  private observeSystem(
    message: Extract<SDKMessage, { type: 'system' }>,
  ): boolean {
    if (message.subtype === 'task_started') {
      if (message.tool_use_id && this.tools.has(message.tool_use_id)) {
        this.tasks.set(message.task_id, message.tool_use_id);
      }
      return true;
    }
    if (message.subtype === 'task_updated') {
      this.observeTaskUpdate(message);
      return true;
    }
    if (message.subtype === 'task_notification') {
      const toolId = message.tool_use_id ?? this.tasks.get(message.task_id);
      if (toolId && this.tools.delete(toolId)) this.kick();
      this.tasks.delete(message.task_id);
      return true;
    }
    if (message.subtype === 'task_progress') return true;
    this.observeCompaction(message);
    return false;
  }

  private observeCompaction(
    message: Extract<SDKMessage, { type: 'system' }>,
  ): void {
    if (message.subtype === 'status') {
      if (message.status === 'compacting') this.compacting = true;
      // null alone is not proof of completion; compact_result is explicit.
      if (message.compact_result) this.compacting = false;
    }
    if (message.subtype === 'compact_boundary') this.compacting = false;
  }

  private observeTaskUpdate(
    message: Extract<SDKMessage, { subtype: 'task_updated' }>,
  ): void {
    const toolId = this.tasks.get(message.task_id);
    if (
      toolId &&
      (message.patch.is_backgrounded ||
        ['completed', 'failed', 'killed'].includes(message.patch.status ?? ''))
    ) {
      const wasWaiting = this.tools.delete(toolId);
      this.tasks.delete(message.task_id);
      if (wasWaiting) this.kick();
    }
  }

  private observeToolResults(message: SDKMessage): void {
    if (message.type === 'user' && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (block.type === 'tool_result') this.tools.delete(block.tool_use_id);
      }
    }
  }

  private arm(): void {
    this.clear();
    if (this.holds > 0 || this.stopped || this.fired || !this.started) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.stopped || this.fired) return;
      const operations = [...this.tools.values()];
      if (this.compacting) operations.push('compaction');
      if (operations.length > 0) {
        // One timer, no polling I/O and no invented failure verdict. A missing
        // terminal hook is reconciled by result/interrupt/cancel/stream failure.
        // Re-arm even if a diagnostic sink throws.
        try {
          this.onOverdue(operations);
        } finally {
          this.arm();
        }
        return;
      }
      this.fired = true;
      this.onTimeout();
    }, this.timeoutMs);
    this.timer.unref?.();
  }

  private clear(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/** Unaccounted silence recovery window, NOT a tool or compaction runtime cap. */
export const NO_ACTIVITY_TIMEOUT_MS = 180_000;

export interface ActivityHold {
  hold(): void;
  release(): void;
  /** Implemented by the query watchdog; plain permission holds need neither. */
  lifecycleHooks?(): Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  endTurn?(): void;
  beginTurn?(): void;
}
