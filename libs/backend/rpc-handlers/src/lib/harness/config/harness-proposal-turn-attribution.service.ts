import { inject, injectable } from 'tsyringe';
import {
  SDK_TOKENS,
  SdkAdapterEvents,
  UserPromptSubmitCallbackRegistry,
  type UserPromptSubmitPayload,
} from '@ptah-extension/agent-sdk';
import { sameWorkspaceRoot } from '../../utils/workspace-authorization';

interface CapturedTurn {
  readonly workspaceRoot: string;
  readonly startedAt: string;
  references: number;
}

interface SessionTurns {
  history: CapturedTurn[];
  active?: CapturedTurn;
  ambiguous: boolean;
}

const MAX_IDLE_HISTORY = 16;
const MAX_SESSIONS = 128;

/** Retains SDK callback starts while proposing calls are in flight. */
@injectable()
export class HarnessProposalTurnAttributionService {
  private readonly sessions = new Map<string, SessionTurns>();
  private readonly subscriptions: Array<() => void>;

  constructor(
    @inject(SDK_TOKENS.SDK_USER_PROMPT_SUBMIT_CALLBACK_REGISTRY)
    promptSubmits: UserPromptSubmitCallbackRegistry,
    @inject(SDK_TOKENS.SDK_ADAPTER_EVENTS)
    events: SdkAdapterEvents,
  ) {
    this.subscriptions = [
      promptSubmits.register((payload) => this.onPromptSubmit(payload)),
      events.onTurnEnded((event) => this.onTurnEnd(event.sessionId)),
      events.onTurnFailed((event) => this.onTurnEnd(event.sessionId)),
    ];
  }

  capture(
    sessionId: string,
    workspaceRoot: string,
  ): {
    readonly turnStartedAt?: string;
    release(): void;
  } {
    const state = this.sessions.get(sessionId);
    const turn =
      state &&
      !state.ambiguous &&
      state.active &&
      sameWorkspaceRoot(state.active.workspaceRoot, workspaceRoot)
        ? state.active
        : undefined;
    if (turn) turn.references += 1;
    let released = false;
    return {
      turnStartedAt: turn?.startedAt,
      release: () => {
        if (released) return;
        released = true;
        if (turn && state) {
          turn.references -= 1;
          this.prune(sessionId, state);
        }
      },
    };
  }

  dispose(): void {
    for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe();
    this.sessions.clear();
  }

  private onPromptSubmit(payload: UserPromptSubmitPayload): void {
    if (
      typeof payload.sessionId !== 'string' ||
      !payload.sessionId ||
      typeof payload.workspaceRoot !== 'string' ||
      !payload.workspaceRoot ||
      typeof payload.timestamp !== 'number' ||
      !Number.isFinite(payload.timestamp)
    ) {
      return;
    }

    const started = new Date(payload.timestamp);
    if (Number.isNaN(started.getTime())) return;
    const startedAt = started.toISOString();
    const state = this.sessions.get(payload.sessionId) ?? {
      history: [],
      ambiguous: false,
    };
    if (state.active) state.ambiguous = true;
    const turn: CapturedTurn = {
      workspaceRoot: payload.workspaceRoot,
      startedAt,
      references: 0,
    };
    state.history.push(turn);
    state.active = state.ambiguous ? undefined : turn;
    this.sessions.set(payload.sessionId, state);
    this.prune(payload.sessionId, state);
    this.trimSessions();
  }

  onTurnAborted(sessionId: string): void {
    this.onTurnEnd(sessionId);
  }

  private onTurnEnd(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    state.active = undefined;
    state.ambiguous = false;
    this.prune(sessionId, state);
  }

  private prune(sessionId: string, state: SessionTurns): void {
    const idle = state.history.filter(
      (turn) => turn !== state.active && turn.references === 0,
    );
    const excess = idle.length - MAX_IDLE_HISTORY;
    if (excess > 0) {
      const removed = new Set(idle.slice(0, excess));
      state.history = state.history.filter((turn) => !removed.has(turn));
    }
    if (
      !state.active &&
      !state.ambiguous &&
      state.history.every((turn) => turn.references === 0)
    ) {
      this.sessions.delete(sessionId);
    }
  }

  private trimSessions(): void {
    if (this.sessions.size <= MAX_SESSIONS) return;
    for (const [sessionId, state] of this.sessions) {
      if (this.sessions.size <= MAX_SESSIONS) break;
      if (state.history.every((turn) => turn.references === 0)) {
        this.sessions.delete(sessionId);
      }
    }
  }
}
