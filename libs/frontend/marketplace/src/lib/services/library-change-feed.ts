import { Injectable, inject, signal } from '@angular/core';
import { VSCodeService, type MessageHandler } from '@ptah-extension/core';
import {
  MESSAGE_TYPES,
  type LibraryChangedPayload,
} from '@ptah-extension/shared';

/** The last `library:changed` push, stamped with when this webview received it. */
export interface LibraryChange {
  /** Harness root whose Library the pass refreshed. */
  readonly workspaceRoot: string;
  readonly status: LibraryChangedPayload['status'];
  /** Why the pass ran, e.g. `setup-wizard` or a plugin id. */
  readonly reasons: readonly string[];
  /** `Date.now()` when the push arrived; distinguishes two identical pushes. */
  readonly at: number;
}

/**
 * LibraryChangeFeed — the `library:changed` push as a signal.
 *
 * The host broadcasts `library:changed` after a Library pass (a setup-wizard
 * run, a plugin install or a config-home choice) refreshed one harness root's
 * Library. The installed view and the inventory store react to {@link latest};
 * they compare its `workspaceRoot` with their own and ignore a push for another
 * root.
 *
 * Registered in `MESSAGE_HANDLERS` at bootstrap (`app.config.ts`) and exported
 * from the services-only barrel, so a push that lands before the lazy
 * Marketplace surface is first opened is not lost and registering it adds no
 * Marketplace UI to the initial bundle.
 *
 * Inert outside Electron (D3: the Library is desktop-only). The VS Code host
 * never sends this push; if one arrives anyway it is ignored, so no VS Code
 * surface can start reacting to it.
 *
 * The payload crosses `postMessage` from a host whose version is not pinned to
 * this bundle's, so it is narrowed rather than trusted: a malformed push leaves
 * the previous value standing.
 */
@Injectable({ providedIn: 'root' })
export class LibraryChangeFeed implements MessageHandler {
  private readonly vscode = inject(VSCodeService);
  private readonly _latest = signal<LibraryChange | null>(null);

  /** Message types this feed handles via `MessageRouterService`. */
  public readonly handledMessageTypes = [MESSAGE_TYPES.LIBRARY_CHANGED] as const;

  /** The last valid push, or `null` when none arrived this session. */
  public readonly latest = this._latest.asReadonly();

  public handleMessage(message: { type: string; payload?: unknown }): void {
    if (message.type !== MESSAGE_TYPES.LIBRARY_CHANGED) return;
    // Read per message, not at construction: the host config that carries
    // `isElectron` can be applied after this root service is created.
    if (!this.vscode.isElectron) return;
    const payload = parseLibraryChanged(message.payload);
    if (payload === null) return;
    this._latest.set({ ...payload, at: Date.now() });
  }
}

/** Narrow an untrusted push payload, or `null` when it is malformed. */
function parseLibraryChanged(
  payload: unknown,
): Omit<LibraryChange, 'at'> | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { workspaceRoot, status, reasons } = payload as Record<
    keyof LibraryChangedPayload,
    unknown
  >;
  if (typeof workspaceRoot !== 'string' || workspaceRoot.length === 0) {
    return null;
  }
  if (status !== 'updated' && status !== 'failed') return null;
  if (
    !Array.isArray(reasons) ||
    !reasons.every((reason): reason is string => typeof reason === 'string')
  ) {
    return null;
  }
  return { workspaceRoot, status, reasons: [...reasons] };
}
