import { useEffect, useState } from 'react';
import type { EventEmitter } from 'node:events';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type {
  VecStatusChangedPayload,
  EmbedderStatusChangedPayload,
} from '@ptah-extension/shared';

import type {
  ThothActivationSnapshot,
  ThothActivationStatus,
  ThothSubsystem,
} from '../lib/thoth-lifecycle.js';

export type ThothBadgeTone = 'success' | 'warning' | 'info' | 'error';

export interface ThothBadge {
  readonly tone: ThothBadgeTone;
  readonly dot: string;
  readonly text: string;
  readonly reason?: string;
}

export interface ThothStatusSnapshot {
  readonly status: ThothActivationStatus;
  readonly error?: string;
  readonly badges: Readonly<Record<ThothSubsystem, ThothBadge>>;
  readonly vec?: VecStatusChangedPayload;
  readonly embedder?: EmbedderStatusChangedPayload['status'];
}

export type ThothStatusObservable = Pick<
  EventEmitter,
  'on' | 'off' | 'emit'
> & {
  snapshot(): ThothActivationSnapshot;
};

export type ThothPushAdapter = Pick<EventEmitter, 'on' | 'off' | 'emit'>;

const DOT_ON = '●';
const DOT_OFF = '○';

const SUBSYSTEM_LABELS: Record<ThothSubsystem, string> = {
  memory: 'Memory',
  skills: 'Skills',
  cron: 'Schedules',
  gateway: 'Gateway',
  sqlite: 'Database',
  embedder: 'Embedder',
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asVecPayload(payload: unknown): VecStatusChangedPayload | null {
  if (!isObject(payload)) return null;
  if (typeof payload['ok'] !== 'boolean') return null;
  if (!isObject(payload['diagnostic'])) return null;
  return payload as unknown as VecStatusChangedPayload;
}

function asEmbedderPayload(
  payload: unknown,
): EmbedderStatusChangedPayload['status'] | null {
  if (!isObject(payload)) return null;
  const status = payload['status'];
  if (!isObject(status)) return null;
  if (typeof status['ready'] !== 'boolean') return null;
  return status as unknown as EmbedderStatusChangedPayload['status'];
}

function baseBadge(
  subsystem: ThothSubsystem,
  status: ThothActivationStatus,
  ready: boolean,
  reason?: string,
): ThothBadge {
  const label = SUBSYSTEM_LABELS[subsystem];
  if (status === 'activating' || status === 'idle') {
    return { tone: 'info', dot: DOT_OFF, text: `${label} activating`, reason };
  }
  if (ready) {
    return { tone: 'success', dot: DOT_ON, text: `${label} ready` };
  }
  return {
    tone: 'warning',
    dot: DOT_OFF,
    text: `${label} offline`,
    reason: reason ?? 'offline',
  };
}

export function buildThothStatus(
  activation: ThothActivationSnapshot,
  vec: VecStatusChangedPayload | undefined,
  embedder: EmbedderStatusChangedPayload['status'] | undefined,
): ThothStatusSnapshot {
  const badges = {} as Record<ThothSubsystem, ThothBadge>;
  for (const key of Object.keys(activation.subsystems) as ThothSubsystem[]) {
    const state = activation.subsystems[key];
    badges[key] = baseBadge(key, activation.status, state.ready, state.reason);
  }

  if (vec) {
    badges.sqlite = vec.ok
      ? { tone: 'success', dot: DOT_ON, text: 'Database ready' }
      : {
          tone: 'warning',
          dot: DOT_OFF,
          text: 'Database vec offline',
          reason: vec.diagnostic.reason,
        };
  }

  if (embedder) {
    if (embedder.error) {
      badges.embedder = {
        tone: 'error',
        dot: DOT_OFF,
        text: 'Embedder error',
        reason: embedder.error.message,
      };
    } else if (embedder.downloading) {
      badges.embedder = {
        tone: 'info',
        dot: DOT_OFF,
        text: 'Embedder downloading',
        reason:
          embedder.progress !== undefined
            ? `${Math.round(embedder.progress * 100)}%`
            : undefined,
      };
    } else if (embedder.ready) {
      badges.embedder = {
        tone: 'success',
        dot: DOT_ON,
        text: 'Embedder ready',
      };
    } else {
      badges.embedder = {
        tone: 'warning',
        dot: DOT_OFF,
        text: 'Embedder offline',
      };
    }
  }

  return {
    status: activation.status,
    error: activation.error,
    badges,
    vec,
    embedder,
  };
}

export class ThothStatusReducer {
  private activation: ThothActivationSnapshot;
  private vec: VecStatusChangedPayload | undefined;
  private embedder: EmbedderStatusChangedPayload['status'] | undefined;

  private readonly onActivation: (snapshot: ThothActivationSnapshot) => void;
  private readonly onVec: (payload: unknown) => void;
  private readonly onEmbedder: (payload: unknown) => void;

  constructor(
    private readonly lifecycle: ThothStatusObservable,
    private readonly pushAdapter: ThothPushAdapter,
    private readonly onChange: (snapshot: ThothStatusSnapshot) => void,
  ) {
    this.activation = lifecycle.snapshot();

    this.onActivation = (snapshot) => {
      this.activation = snapshot;
      this.emit();
    };
    this.onVec = (payload) => {
      const vec = asVecPayload(payload);
      if (!vec) return;
      this.vec = vec;
      this.emit();
    };
    this.onEmbedder = (payload) => {
      const embedder = asEmbedderPayload(payload);
      if (!embedder) return;
      this.embedder = embedder;
      this.emit();
    };

    this.lifecycle.on('change', this.onActivation);
    this.pushAdapter.on(MESSAGE_TYPES.VEC_STATUS_CHANGED, this.onVec);
    this.pushAdapter.on(MESSAGE_TYPES.EMBEDDER_STATUS_CHANGED, this.onEmbedder);
  }

  snapshot(): ThothStatusSnapshot {
    return buildThothStatus(this.activation, this.vec, this.embedder);
  }

  dispose(): void {
    this.lifecycle.off('change', this.onActivation);
    this.pushAdapter.off(MESSAGE_TYPES.VEC_STATUS_CHANGED, this.onVec);
    this.pushAdapter.off(
      MESSAGE_TYPES.EMBEDDER_STATUS_CHANGED,
      this.onEmbedder,
    );
  }

  private emit(): void {
    this.onChange(this.snapshot());
  }
}

export function useThothStatus(
  lifecycle: ThothStatusObservable,
  pushAdapter: ThothPushAdapter,
): ThothStatusSnapshot {
  const [snapshot, setSnapshot] = useState<ThothStatusSnapshot>(() =>
    buildThothStatus(lifecycle.snapshot(), undefined, undefined),
  );

  useEffect(() => {
    const reducer = new ThothStatusReducer(lifecycle, pushAdapter, setSnapshot);
    setSnapshot(reducer.snapshot());
    return () => reducer.dispose();
  }, [lifecycle, pushAdapter]);

  return snapshot;
}
