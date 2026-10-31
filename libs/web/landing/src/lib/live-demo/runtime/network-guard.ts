import type { ReplayMiss } from './types';

export function installNetworkGuard(report: (kind: ReplayMiss['kind'], value: string) => void, target: Window = window, baseURI = document.baseURI): void {
  const base = new URL(baseURI);
  const allowed = (raw: string, socket = false): boolean => {
    try {
      const url = new URL(raw, base);
      if (socket) {
        if (url.protocol === 'ws:') url.protocol = 'http:';
        else if (url.protocol === 'wss:') url.protocol = 'https:';
      }
      return url.origin === base.origin && url.pathname.startsWith(base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`);
    } catch { return false; }
  };
  const check = (raw: string, socket = false): boolean => {
    if (allowed(raw, socket)) return true;
    report('blocked-network', raw);
    return false;
  };
  const originalFetch = target.fetch.bind(target);
  target.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof Request !== 'undefined' && input instanceof Request ? input.url : String(input);
    return check(raw) ? originalFetch(input, init) : Promise.reject(new Error('PtahCode replay blocks network access'));
  }) as typeof fetch;

  const host = target as Window & { XMLHttpRequest: typeof XMLHttpRequest; WebSocket?: typeof WebSocket; EventSource?: typeof EventSource };
  const originalOpen = host.XMLHttpRequest.prototype.open;
  host.XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    if (!check(String(url))) throw new Error('PtahCode replay blocks network access');
    return Reflect.apply(originalOpen, this, [method, url, ...rest]);
  } as typeof XMLHttpRequest.prototype.open;

  for (const key of ['WebSocket', 'EventSource'] as const) {
    const Original = host[key];
    if (!Original) continue;
    Object.defineProperty(target, key, { configurable: true, value: new Proxy(Original, {
      construct(constructor, args: unknown[]) {
        if (!check(String(args[0]), key === 'WebSocket')) throw new Error('PtahCode replay blocks network access');
        return Reflect.construct(constructor, args);
      },
    }) });
  }
  const originalBeacon = target.navigator.sendBeacon?.bind(target.navigator);
  if (originalBeacon) {
    Object.defineProperty(target.navigator, 'sendBeacon', { configurable: true, value: (url: string | URL, data?: BodyInit | null) =>
      check(String(url)) && originalBeacon(url, data) });
  }
}
