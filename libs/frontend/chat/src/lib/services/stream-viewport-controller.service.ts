import { DestroyRef, Injectable, effect, inject } from '@angular/core';
import {
  ClaudeRpcService,
  SurfaceRouterService,
} from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';

export type StreamTier = 'focused' | 'visible' | 'hidden';

interface StreamViewport {
  readonly focusedTabId?: string;
  readonly visibleTabIds: readonly string[];
}

/**
 * Declares the local tab layout to the v2 stream coordinator.
 *
 * Until the host accepts v2, callers deliberately receive the focused tier.
 * That preserves the Phase 2 rollback path for older hosts and failed
 * declarations without dropping a received stream event.
 */
@Injectable({ providedIn: 'root' })
export class StreamViewportController {
  private static readonly DECLARATION_DEBOUNCE_MS = 50;

  private readonly tabs = inject(TabManagerService);
  private readonly surfaceRouter = inject(SurfaceRouterService);
  private readonly rpc = inject(ClaudeRpcService);
  private readonly destroyRef = inject(DestroyRef);

  private currentViewport: StreamViewport | null = null;
  private declaredViewport: StreamViewport | null = null;
  private declarationTimer: ReturnType<typeof setTimeout> | null = null;
  private declarationGeneration = 0;
  private v2Accepted = false;

  constructor() {
    effect(() => this.queueDeclaration(this.deriveViewport()));
    this.destroyRef.onDestroy(() => {
      if (this.declarationTimer !== null) {
        clearTimeout(this.declarationTimer);
      }
    });
  }

  tierFor(tabId: string | undefined): StreamTier {
    if (!tabId || !this.v2Accepted || !this.currentViewport) {
      return 'focused';
    }
    if (this.currentViewport.focusedTabId === tabId) return 'focused';
    return this.currentViewport.visibleTabIds.includes(tabId)
      ? 'visible'
      : 'hidden';
  }

  private deriveViewport(): StreamViewport {
    const visible = new Set(this.tabs.visibleTabIds());
    const activeTabId = this.tabs.activeTabId();
    const isChatSurface = this.surfaceRouter.currentSurface() === 'chat';

    if (isChatSurface && activeTabId) {
      visible.add(activeTabId);
    }

    return {
      ...(isChatSurface && activeTabId ? { focusedTabId: activeTabId } : {}),
      visibleTabIds: [...visible].sort((left, right) => left.localeCompare(right)),
    };
  }

  private queueDeclaration(viewport: StreamViewport): void {
    this.currentViewport = viewport;
    if (this.sameViewport(viewport, this.declaredViewport)) return;

    if (this.declarationTimer !== null) {
      clearTimeout(this.declarationTimer);
    }
    const generation = ++this.declarationGeneration;
    this.declarationTimer = setTimeout(() => {
      this.declarationTimer = null;
      if (generation !== this.declarationGeneration) return;
      if (this.sameViewport(viewport, this.declaredViewport)) return;
      this.declaredViewport = viewport;
      void this.declare(viewport, generation);
    }, StreamViewportController.DECLARATION_DEBOUNCE_MS);
  }

  private async declare(
    viewport: StreamViewport,
    generation: number,
  ): Promise<void> {
    const result = await this.rpc.call('chat:setStreamViewport', {
      protocolVersion: 2,
      ...viewport,
    });
    if (generation !== this.declarationGeneration) return;
    this.v2Accepted = result.success && result.data?.acceptedProtocolVersion === 2;
  }

  private sameViewport(
    left: StreamViewport | null,
    right: StreamViewport | null,
  ): boolean {
    if (!left || !right) return left === right;
    return (
      left.focusedTabId === right.focusedTabId &&
      left.visibleTabIds.length === right.visibleTabIds.length &&
      left.visibleTabIds.every((id, index) => id === right.visibleTabIds[index])
    );
  }
}
