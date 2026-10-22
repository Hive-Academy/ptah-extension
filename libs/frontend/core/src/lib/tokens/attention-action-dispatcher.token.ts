import { InjectionToken } from '@angular/core';

export type AttentionActionOutcome =
  | { readonly kind: 'completed' }
  | { readonly kind: 'stale' }
  | { readonly kind: 'unavailable'; readonly reason: string };

export interface AttentionActionDispatcher {
  dispatch(key: string, generation: number, actionId: string, reason?: string): Promise<boolean>;
  dispatchOutcome?(key: string, generation: number, actionId: string, reason?: string): Promise<AttentionActionOutcome>;
}

export const ATTENTION_ACTION_DISPATCHER =
  new InjectionToken<AttentionActionDispatcher>('ATTENTION_ACTION_DISPATCHER');
