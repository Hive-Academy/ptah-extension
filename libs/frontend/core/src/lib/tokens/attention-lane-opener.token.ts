import { InjectionToken } from '@angular/core';

/** Canvas-owned navigation used after an attention item focuses its session. */
export interface AttentionLaneOpener {
  open(tabId: string, agentId: string): boolean;
}

export const ATTENTION_LANE_OPENER = new InjectionToken<AttentionLaneOpener>('ATTENTION_LANE_OPENER');
