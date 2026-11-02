import type { ReplayControls, ReplayState } from './types';

export function installControlChannel(controls: ReplayControls, target: Window = window): (state: ReplayState) => void {
  const embedded = target.parent !== target;
  const onMessage = (event: MessageEvent) => {
    if (!embedded || event.origin !== target.location.origin || event.source !== target.parent) return;
    const data = event.data as { source?: unknown; cmd?: unknown; value?: unknown } | null;
    if (data?.source !== 'ptah-replay-control') return;
    switch (data.cmd) {
      case 'play': controls.play(); break;
      case 'pause': controls.pause(); break;
      case 'speed': controls.setSpeed(Number(data.value)); break;
      case 'restart': controls.restart(); break;
    }
  };
  target.addEventListener('message', onMessage);
  let lastPost = -Infinity;
  let lastSignature = '';
  return (state) => {
    if (!embedded) return;
    const now = performance.now();
    const signature = JSON.stringify({ ...state, elapsed: undefined });
    if (signature === lastSignature && now - lastPost < 250) return;
    target.parent.postMessage({ source: 'ptah-replay-state', state: { ...state } }, target.location.origin);
    lastPost = now;
    lastSignature = signature;
  };
}
