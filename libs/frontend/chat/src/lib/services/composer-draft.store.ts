import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { ChatFile } from './file-picker.service';

export interface ComposerDraftImage {
  id: string;
  data: string;
  mediaType: string;
  dataUrl: string;
  name: string;
}

export interface ComposerDraft {
  text: string;
  files: ChatFile[];
  images: ComposerDraftImage[];
}

@Injectable({ providedIn: 'root' })
export class ComposerDraftStore {
  private readonly tabManager = inject(TabManagerService);
  private readonly drafts = signal<ReadonlyMap<string, ComposerDraft>>(
    new Map(),
  );

  constructor() {
    const unsubscribe = this.tabManager.onTabClosed(({ tabId }) => {
      this.clear(tabId);
    });
    inject(DestroyRef).onDestroy(unsubscribe);
  }

  get(tabId: string): ComposerDraft | undefined {
    return this.drafts().get(tabId);
  }

  save(tabId: string, draft: ComposerDraft): void {
    this.drafts.update((current) => {
      const next = new Map(current);
      next.set(tabId, draft);
      return next;
    });
  }

  clear(tabId: string): void {
    this.drafts.update((current) => {
      const next = new Map(current);
      next.delete(tabId);
      return next;
    });
  }
}
