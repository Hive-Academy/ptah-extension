import { MESSAGE_TYPES, type AttentionOpenTargetPayload } from '@ptah-extension/shared';
import type { IHostAttentionNotifications, SafeHostAttentionNotice } from '@ptah-extension/platform-core';

export interface ElectronNotificationHandle {
  show(): void;
  close(): void;
  on(event: 'click', listener: () => void): void;
}

export interface ElectronAttentionCapabilities {
  createNotification?: (options: { title: string; body: string }) => ElectronNotificationHandle;
  notificationsSupported?: () => boolean;
  isWindowFocused?: () => boolean;
  revealWindow?: () => void;
  sendToRenderer?: (message: { type: string; payload: AttentionOpenTargetPayload }) => void;
  isRendererReady?: () => boolean;
  onRendererReady?: (listener: () => void) => boolean;
  hasLiveWindow?: () => boolean;
  warn?: (message: string) => void;
}

interface ActiveNotice {
  notice: SafeHostAttentionNotice;
  handle: ElectronNotificationHandle | null;
}

/** Keeps native handles and click routes tied to an unresolved generation. */
export class ElectronHostAttentionNotifications implements IHostAttentionNotifications {
  private readonly active = new Map<string, ActiveNotice>();
  private disposed = false;
  private warned = false;
  private burstUntil = 0;
  private burstHandle: ElectronNotificationHandle | null = null;
  private pendingRoute: AttentionOpenTargetPayload | null = null;
  private waitingForRenderer = false;

  constructor(private readonly capabilities: ElectronAttentionCapabilities) {}

  isEligible(): boolean {
    try {
      return !this.disposed && !!this.capabilities.createNotification &&
        !!this.capabilities.notificationsSupported?.() &&
        this.capabilities.isWindowFocused?.() === false;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - OS notifications are an
      // optional extra over the in-app bell; the error is warned once and
      // false means "do not show an OS notification".
      this.warnOnce(error);
      return false;
    }
  }

  present(notice: SafeHostAttentionNotice): void {
    if (!this.isEligible()) return;
    const current = this.active.get(notice.key);
    if (current && current.notice.generation >= notice.generation) return;
    if (current) this.close(current);
    const entry: ActiveNotice = { notice, handle: null };
    this.active.set(notice.key, entry);
    // Burst members share one native handle and remain individually resolvable.
    const burstMembers = Date.now() < this.burstUntil && this.burstHandle
      ? [...this.active.values()].filter((value) => value.handle === this.burstHandle && value !== entry)
      : [];
    if (burstMembers.length && this.burstHandle) {
      const oldHandle = this.burstHandle;
      for (const member of burstMembers) member.handle = null;
      this.burstHandle = null;
      try { oldHandle.close(); } catch (error: unknown) { this.warnOnce(error); }
    }
    this.showHandle(entry, burstMembers.length + 1);
    for (const member of burstMembers) member.handle = entry.handle;
  }

  private showHandle(entry: ActiveNotice, count: number): void {
    const notice = entry.notice;
    try {
      const handle = this.capabilities.createNotification?.({
        title: 'Ptah',
        body: count > 1
          ? `${count} requests need you — ${notice.sessionTitle}`
          : `${notice.label} — ${notice.sessionTitle}`,
      });
      if (!handle) return;
      entry.handle = handle;
      handle.on('click', () => {
        const selected = [...this.active.values()].reverse().find((value) => value.handle === handle);
        if (selected) this.open({ key: selected.notice.key, generation: selected.notice.generation, target: selected.notice.target });
      });
      handle.show();
      this.burstHandle = handle;
      this.burstUntil = Date.now() + 350;
    } catch (error: unknown) {
      entry.handle = null;
      this.warnOnce(error);
    }
  }

  resolve(key: string, generation: number): void {
    const entry = this.active.get(key);
    if (!entry || entry.notice.generation !== generation) return;
    this.active.delete(key);
    if (this.pendingRoute?.key === key) this.pendingRoute = null;
    const oldHandle = entry.handle;
    const shared = oldHandle ? [...this.active.values()].filter((value) => value.handle === oldHandle) : [];
    if (oldHandle && shared.length) {
      for (const member of shared) member.handle = null;
      if (this.burstHandle === oldHandle) this.burstHandle = null;
      try { oldHandle.close(); } catch (error: unknown) { this.warnOnce(error); }
      const newest = shared[shared.length - 1];
      this.showHandle(newest, shared.length);
      for (const member of shared) member.handle = newest.handle;
    } else {
      this.close(entry);
    }
  }

  open(target: AttentionOpenTargetPayload): void {
    const entry = this.active.get(target.key);
    if (!entry || entry.notice.generation !== target.generation) return;
    const route: AttentionOpenTargetPayload = {
      key: entry.notice.key,
      generation: entry.notice.generation,
      target: entry.notice.target,
    };
    try {
      this.capabilities.revealWindow?.();
      if (this.capabilities.hasLiveWindow?.() === false) {
        this.capabilities.warn?.('Electron attention route dropped: no live window');
        return;
      }
      const send = () => {
        if (this.active.get(route.key)?.notice.generation !== route.generation) return;
        this.capabilities.sendToRenderer?.({ type: MESSAGE_TYPES.ATTENTION_OPEN_TARGET, payload: route });
      };
      if (this.capabilities.isRendererReady?.() === false) {
        this.pendingRoute = route;
        if (!this.waitingForRenderer && this.capabilities.onRendererReady) {
          this.waitingForRenderer = true;
          const listening = this.capabilities.onRendererReady(() => {
            this.waitingForRenderer = false;
            if (this.capabilities.hasLiveWindow?.() === false) return;
            const pending = this.pendingRoute;
            this.pendingRoute = null;
            if (pending && this.active.get(pending.key)?.notice.generation === pending.generation) {
              try {
                this.capabilities.sendToRenderer?.({ type: MESSAGE_TYPES.ATTENTION_OPEN_TARGET, payload: pending });
              } catch (error: unknown) {
                this.warnOnce(error);
              }
            }
          });
          if (!listening) this.waitingForRenderer = false;
        }
      } else {
        send();
      }
    } catch (error: unknown) {
      this.warnOnce(error);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const handles = new Set([...this.active.values()].map((entry) => entry.handle));
    this.active.clear();
    this.pendingRoute = null;
    for (const handle of handles) {
      try { handle?.close(); } catch (error: unknown) { this.warnOnce(error); }
    }
    this.burstHandle = null;
  }

  private close(entry: ActiveNotice): void {
    if (!entry.handle || [...this.active.values()].some((value) => value !== entry && value.handle === entry.handle)) return;
    if (this.burstHandle === entry.handle) this.burstHandle = null;
    try { entry.handle.close(); } catch (error: unknown) { this.warnOnce(error); }
  }

  private warnOnce(error: unknown): void {
    if (this.warned) return;
    this.warned = true;
    this.capabilities.warn?.(`Electron attention unavailable: ${error instanceof Error ? error.name : 'Error'}`);
  }
}
