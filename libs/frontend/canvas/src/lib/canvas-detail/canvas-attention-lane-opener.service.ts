import { Injectable } from '@angular/core';
import type { AttentionLaneOpener } from '@ptah-extension/core';
import { laneKey } from '@ptah-extension/chat';

interface LaneDetail {
  open(tabId: string, key: string): boolean;
}

/** Root bridge to the detail services owned by mounted canvas instances. */
@Injectable({ providedIn: 'root' })
export class CanvasAttentionLaneOpener implements AttentionLaneOpener {
  private readonly details = new Set<LaneDetail>();

  register(detail: LaneDetail): () => void {
    this.details.add(detail);
    return () => this.details.delete(detail);
  }

  open(tabId: string, agentId: string): boolean {
    for (const detail of this.details) {
      if (detail.open(tabId, laneKey('cli', agentId))) return true;
    }
    return false;
  }
}
