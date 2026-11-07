import { WorkerEventCapture } from './event-capture';

it('routes only captured events synchronously without assigning sequence numbers', () => {
  const queued: unknown[] = [];
  const capture = new WorkerEventCapture(
    (payload) =>
      typeof payload === 'object' && payload !== null && 'sessionId' in payload
        ? String(payload.sessionId)
        : null,
    (sessionId, event) => queued.push({ sessionId, event }),
  );
  capture.capture('chat:chunk', { sessionId: 's', text: 'hi' });
  capture.capture('worker:turn.begin', { sessionId: 's' });
  capture.capture('chat:chunk', {});
  expect(queued).toEqual([
    {
      sessionId: 's',
      event: { type: 'chat:chunk', payload: { sessionId: 's', text: 'hi' } },
    },
  ]);
  expect(capture.dropped).toBe(1);
});
