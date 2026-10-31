export interface ReplayMessage {
  type: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ReplayScenarioData {
  id: string;
  title: string;
  timeBase: number;
  config: Record<string, unknown>;
  rpc: Record<string, unknown>;
  rpcCases?: Record<string, Array<{ match: Record<string, unknown>; data: unknown }>>;
  rpcErrors?: Record<string, { error: string; errorCode?: string }>;
  timeline: Array<{ at: number; message: ReplayMessage }>;
  /** Messages delivered once the shell is ready. */
  bootMessages?: ReplayMessage[];
  start?: { mode: 'auto' } | { mode: 'on-send'; prompt: string };
}

export interface ReplayState {
  scenario: string;
  ready: boolean;
  waitingForSend: boolean;
  booted: boolean;
  paused: boolean;
  readyAt: number | null;
  playing: boolean;
  complete: boolean;
  elapsed: number;
  duration: number;
  speed: number;
  error?: string;
}

export interface ReplayMiss {
  kind: 'unanswered-rpc' | 'unknown-outbound' | 'blocked-network' | 'scenario-load' | 'ready-timeout' | 'boot-quiet-timeout';
  value: string;
  at: number;
}

export interface ReplayControls {
  readonly state: ReplayState;
  readonly misses: ReplayMiss[];
  play(): void;
  pause(): void;
  setSpeed(value: number): void;
  restart(): void;
}
