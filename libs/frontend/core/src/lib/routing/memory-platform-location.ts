import { PlatformLocation, type LocationChangeListener } from '@angular/common';
import { Injectable } from '@angular/core';

/**
 * Synthetic origin for {@link MemoryPlatformLocation.href}.
 *
 * The logical URL is never shown, navigated to or handed to the host — it only
 * has to parse. A dedicated scheme keeps it obvious in a debugger that the
 * value came from here and not from `window.location`.
 */
const MEMORY_ORIGIN = 'ptah://webview';

/** One entry of the in-memory history stack. */
interface MemoryHistoryEntry {
  /** Path + search + hash, always starting with `/`. */
  readonly url: string;
  readonly state: unknown;
}

/** Split an internal URL into the three parts the accessors expose. */
function splitUrl(url: string): {
  pathname: string;
  search: string;
  hash: string;
} {
  const absolute = url.startsWith('/') ? url : `/${url}`;
  const hashAt = absolute.indexOf('#');
  const hash = hashAt === -1 ? '' : absolute.slice(hashAt);
  const withoutHash = hashAt === -1 ? absolute : absolute.slice(0, hashAt);
  const searchAt = withoutHash.indexOf('?');
  const search = searchAt === -1 ? '' : withoutHash.slice(searchAt);
  const pathname =
    searchAt === -1 ? withoutHash : withoutHash.slice(0, searchAt);
  return { pathname: pathname === '' ? '/' : pathname, search, hash };
}

/**
 * A `PlatformLocation` that keeps the whole browsing history in memory and
 * never touches `window.history` or `window.location`.
 *
 * **Why this exists.** `BrowserPlatformLocation.pushState` forwards straight to
 * `history.pushState` with no guard
 * (`@angular/common/fesm2022/_platform_location-chunk.mjs`), and
 * `withHashLocation()` is not an escape from it —
 * `HashLocationStrategy.pushState` calls `platformLocation.pushState` too and
 * never assigns `location.hash`. The Electron renderer loads through
 * `mainWindow.loadFile(...)`, and the HTML specification rejects a changed
 * `file:` pathname, so any code path that reaches the History API can raise a
 * `SecurityError` there. `Location` forwards every state change to the injected
 * platform location, so replacing that one seam makes the Router host-agnostic
 * by construction rather than by hoping a strategy stays away from the API.
 *
 * Bound at the application injector in `app.config.ts`, which shadows the
 * platform-level `PlatformLocation` provider for the whole app.
 *
 * `back`, `forward` and `historyGo` move an index over the stack and notify the
 * `popstate` listeners, which is what `Location` — and through it the Router —
 * subscribes to, so in-session history works without a real session history.
 *
 * Do **not** replace this with `MockPlatformLocation` from
 * `@angular/common/testing`: that is a test double and must not enter product
 * code.
 */
@Injectable()
export class MemoryPlatformLocation extends PlatformLocation {
  /** Visited entries, oldest first. Never empty. */
  private readonly entries: MemoryHistoryEntry[] = [{ url: '/', state: null }];
  /** Index into {@link entries} of the entry currently being displayed. */
  private cursor = 0;
  private readonly popStateListeners = new Set<LocationChangeListener>();
  private readonly hashChangeListeners = new Set<LocationChangeListener>();

  /**
   * `/` rather than the document's `<base href="./">`.
   *
   * The logical URL is synthetic, so a relative base read off a `file:` or
   * `vscode-webview:` document would make every route path resolve against a
   * directory that has nothing to do with it.
   */
  getBaseHrefFromDOM(): string {
    return '/';
  }

  getState(): unknown {
    return this.current.state;
  }

  get href(): string {
    return `${MEMORY_ORIGIN}${this.current.url}`;
  }

  get protocol(): string {
    return 'ptah:';
  }

  get hostname(): string {
    return 'webview';
  }

  get port(): string {
    return '';
  }

  get pathname(): string {
    return splitUrl(this.current.url).pathname;
  }

  get search(): string {
    return splitUrl(this.current.url).search;
  }

  get hash(): string {
    return splitUrl(this.current.url).hash;
  }

  /**
   * Push a new entry, discarding any forward entries — the same truncation
   * `history.pushState` performs.
   */
  pushState(state: unknown, _title: string, url: string): void {
    this.entries.splice(this.cursor + 1);
    this.entries.push({ url: normalize(url), state });
    this.cursor = this.entries.length - 1;
  }

  replaceState(state: unknown, _title: string, url: string): void {
    this.entries[this.cursor] = { url: normalize(url), state };
  }

  forward(): void {
    this.go(this.cursor + 1);
  }

  back(): void {
    this.go(this.cursor - 1);
  }

  /**
   * Move `relativePosition` entries through the stack. Out-of-range targets are
   * ignored rather than clamped, which is what `history.go` does.
   *
   * A non-integer offset is rejected without touching the cursor. `history.go`
   * coerces its argument, but this class indexes an array with the result: a
   * fractional or `NaN` cursor addresses no entry, and then EVERY later read of
   * `href`, `pathname` or `getState` throws, permanently — the history is
   * unrecoverable rather than merely wrong (revision 1, F6). No caller in the
   * app supplies such an offset today; the guard is here because the failure is
   * unrecoverable, not because it is reachable.
   */
  // `override`, unlike the members above: `historyGo` is the one non-abstract
  // member on `PlatformLocation` (it throws "Not implemented" by default).
  override historyGo(relativePosition = 0): void {
    if (!Number.isInteger(relativePosition)) {
      console.warn(
        `[MemoryPlatformLocation] historyGo(${String(
          relativePosition,
        )}) ignored — the offset must be a finite integer.`,
      );
      return;
    }
    this.go(this.cursor + relativePosition);
  }

  onPopState(fn: LocationChangeListener): VoidFunction {
    this.popStateListeners.add(fn);
    return () => this.popStateListeners.delete(fn);
  }

  onHashChange(fn: LocationChangeListener): VoidFunction {
    this.hashChangeListeners.add(fn);
    return () => this.hashChangeListeners.delete(fn);
  }

  private get current(): MemoryHistoryEntry {
    // `entries` is seeded with one entry and `go` only accepts in-range
    // targets, so the cursor always addresses a real entry.
    return this.entries[this.cursor];
  }

  /**
   * Point the cursor at `target` and notify. The hash listeners fire too when
   * only the fragment changed, mirroring the browser's `hashchange`.
   */
  private go(target: number): void {
    // `Number.isInteger` is the load-bearing half, and it is repeated here
    // rather than left to `historyGo` because this is the only place the
    // cursor is assigned: `back`/`forward` reach it too, and a cursor that
    // does not index an entry breaks every subsequent read.
    if (
      !Number.isInteger(target) ||
      target === this.cursor ||
      target < 0 ||
      target >= this.entries.length
    ) {
      return;
    }
    const from = this.current;
    this.cursor = target;
    const to = this.current;

    const event = { type: 'popstate', state: to.state };
    for (const listener of [...this.popStateListeners]) {
      listener(event);
    }

    const sameDocument =
      splitUrl(from.url).pathname === splitUrl(to.url).pathname &&
      splitUrl(from.url).search === splitUrl(to.url).search;
    if (sameDocument && splitUrl(from.url).hash !== splitUrl(to.url).hash) {
      const hashEvent = { type: 'hashchange', state: to.state };
      for (const listener of [...this.hashChangeListeners]) {
        listener(hashEvent);
      }
    }
  }
}

/** Make an incoming URL absolute so the accessors have a stable shape. */
function normalize(url: string): string {
  if (url === '') return '/';
  return url.startsWith('/') ? url : `/${url}`;
}
