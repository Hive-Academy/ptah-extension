import type {
  IdleSessionState,
  IdleSignal,
  IdleTimerSpec,
} from './idle-compaction.types';
import type { CompactionConfigProvider } from '../../compaction-config-provider';

export function readIdleSettings(config: CompactionConfigProvider): {
  enabled: boolean;
  autoCompactEnabled: boolean;
  minTokens: number;
} {
  const idle = config.getIdleCompactionConfig();
  return {
    enabled: idle.enabled,
    autoCompactEnabled: config.getConfig().enabled,
    minTokens: idle.minTokens,
  };
}

export interface KeyedSignal {
  readonly key: string;
  readonly signal: IdleSignal;
}

export function resolveIdleSignal(
  signal: IdleSignal,
  aliases: Map<string, string>,
  keys: Map<string, Set<string>>,
  currentIds: Map<string, string>,
): KeyedSignal | null {
  let key = aliases.get(signal.sessionId);
  if (signal.type === 'session-bound' && key === undefined) {
    key = signal.sessionId;
    aliases.set(key, key);
    keys.set(key, new Set([key]));
    currentIds.set(key, key);
  }
  if (key === undefined) return null;
  const currentId = currentIds.get(key);
  if (currentId === undefined) return null;
  if (signal.type === 'rekey') {
    const existing = aliases.get(signal.toId);
    if (existing !== undefined && existing !== key) return null;
    aliases.set(signal.toId, key);
    keys.get(key)?.add(signal.toId);
    currentIds.set(key, signal.toId);
  }
  return { key, signal: { ...signal, sessionId: currentId } };
}

export class IdleSendVetoedError extends Error {
  constructor(readonly reason: 'manual-reserved' | 'compaction-state') {
    super(reason);
    this.name = 'IdleSendVetoedError';
  }
}

export function sameTimer(a: IdleTimerSpec, b: IdleTimerSpec): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.kind === b.kind &&
      a.attemptId === b.attemptId &&
      a.phase === b.phase &&
      a.at === b.at)
  );
}

export function initialState(sessionId: string): IdleSessionState {
  return {
    sessionId,
    runToken: '',
    codexProxy: false,
    lastTurn: null,
    reading: null,
    activitySinceTurnEnd: false,
    prefixChangedSinceTurnEnd: false,
    rateLimit: null,
    compactionOpen: false,
    idlePeriodClosed: false,
    attempt: null,
    timer: null,
  };
}
