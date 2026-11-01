/** A second RPC quiet period after boot messages have opened the session. */
export function waitForBootQuiet(durationMs = 300, capMs = 5000): { noteActivity(): void; done: Promise<boolean> } {
  let timer: ReturnType<typeof setTimeout>;
  let settled = false;
  let resolveDone!: (timedOut: boolean) => void;
  const done = new Promise<boolean>((resolve) => { resolveDone = resolve; });
  const finish = (timedOut: boolean) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    clearTimeout(capTimer);
    resolveDone(timedOut);
  };
  const noteActivity = () => {
    if (settled) return;
    clearTimeout(timer);
    timer = setTimeout(() => finish(false), durationMs);
  };
  const capTimer = setTimeout(() => finish(true), capMs);
  noteActivity();
  return { noteActivity, done };
}
