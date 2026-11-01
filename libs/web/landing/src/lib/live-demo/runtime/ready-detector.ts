export function detectReady(onReady: (at: number, timedOut: boolean) => void, target: Document = document): { rpcCall(): void; stop(): void } {
  let finished = false;
  let lastRpc = performance.now();
  let quietTimer: ReturnType<typeof setTimeout> | undefined;
  let capTimer: ReturnType<typeof setTimeout> | undefined;
  let observer: MutationObserver | undefined;
  const rendered = () => !!target.querySelector('ptah-root')?.children.length;
  const complete = (timedOut = false) => {
    if (finished) return;
    finished = true;
    clearTimeout(quietTimer);
    clearTimeout(capTimer);
    observer?.disconnect();
    onReady(performance.now(), timedOut && !rendered());
  };
  const check = () => {
    if (finished || !rendered()) return;
    const remaining = 300 - (performance.now() - lastRpc);
    if (remaining <= 0) complete();
    else { clearTimeout(quietTimer); quietTimer = setTimeout(check, remaining); }
  };
  const start = () => {
    if (finished || capTimer) return;
    lastRpc = performance.now();
    capTimer = setTimeout(() => complete(true), 8000);
    observer = new MutationObserver(check);
    observer.observe(target.documentElement, { childList: true, subtree: true });
    check();
  };
  if (target.readyState === 'loading') target.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  return {
    rpcCall: () => { lastRpc = performance.now(); clearTimeout(quietTimer); check(); },
    stop: () => { finished = true; clearTimeout(quietTimer); clearTimeout(capTimer); observer?.disconnect(); },
  };
}
