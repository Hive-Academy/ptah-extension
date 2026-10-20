import type { IDisposable } from '../types/platform.types';

/** Receives one producer event before any renderer fan-out, including zero-view delivery. */
export interface IHostAttentionIngress {
  observe(type: string, payload: unknown): void;
}

/** Transport-owned observer slot; disposing the registration detaches that observer. */
export interface IHostAttentionObserverHost {
  setAttentionObserver(observer: IHostAttentionIngress): IDisposable;
}
