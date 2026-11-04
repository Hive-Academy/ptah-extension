import type { ControlFrame, EventFrame } from '@ptah-extension/worker-protocol';

export type SessionSubscriber = (frame: EventFrame | ControlFrame) => void;

interface SubscriberState {
  send: SessionSubscriber;
  replayTo: number;
  replaying: boolean;
  buffered: EventFrame[];
}

/** Live frames wait behind an attach's fixed replay boundary. */
export class SessionFanOut {
  private readonly subscribers = new Set<SubscriberState>();

  subscribe(
    send: SessionSubscriber,
    replayTo: number,
  ): { finishReplay: () => void; unsubscribe: () => void } {
    const state: SubscriberState = {
      send,
      replayTo,
      replaying: true,
      buffered: [],
    };
    this.subscribers.add(state);
    return {
      finishReplay: () => {
        if (!this.subscribers.has(state)) return;
        state.replaying = false;
        for (const frame of state.buffered) this.send(state, frame);
        state.buffered.length = 0;
      },
      unsubscribe: () => {
        this.subscribers.delete(state);
      },
    };
  }

  publish(frame: EventFrame): void {
    for (const state of this.subscribers) {
      if (frame.seq <= state.replayTo) continue;
      if (state.replaying) state.buffered.push(frame);
      else this.send(state, frame);
    }
  }

  degraded(sessionId: string): void {
    const frame: ControlFrame = {
      v: 1,
      kind: 'ctl',
      type: 'session-state',
      payload: { sessionId, degraded: 'log-write-failed' },
    };
    for (const state of this.subscribers) this.send(state, frame);
  }

  private send(state: SubscriberState, frame: EventFrame | ControlFrame): void {
    try {
      state.send(frame);
    } catch {
      this.subscribers.delete(state);
    }
  }
}
