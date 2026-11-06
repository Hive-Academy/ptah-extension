import type { EventFrame } from '@ptah-extension/worker-protocol';
import { SessionFanOut } from './fan-out';

it('buffers live frames until replay finishes and omits frames inside the replay boundary', () => {
  const fanOut = new SessionFanOut();
  const seen: number[] = [];
  const subscription = fanOut.subscribe((frame) => {
    if (frame.kind === 'evt') seen.push(frame.seq);
  }, 2);
  const frame = (seq: number): EventFrame => ({
    v: 1,
    kind: 'evt',
    sessionId: 's',
    epoch: 'e',
    seq,
    type: 'chat:chunk',
    ts: 1,
    payload: {},
  });
  fanOut.publish(frame(2));
  fanOut.publish(frame(3));
  expect(seen).toEqual([]);
  subscription.finishReplay();
  expect(seen).toEqual([3]);
  fanOut.publish(frame(4));
  expect(seen).toEqual([3, 4]);
  subscription.unsubscribe();
});
