import { SessionJsonlWriter } from './session-jsonl-writer';

describe('SessionJsonlWriter', () => {
  it('writes deterministic SDK-shaped JSONL and a matching transcript', () => {
    const write = () => {
      const writer = new SessionJsonlWriter<'synthetic'>(
        'writer-01',
        '2026-01-01T09:00:00.000Z',
        1,
        100,
        2,
      );
      writer.turn('user', 'First synthetic line.');
      writer.turn('assistant', 'Second synthetic line.');
      return writer.build('standard', []);
    };
    const result = write();
    expect(write()).toEqual(result);
    expect(result.jsonl.endsWith('\n')).toBe(true);
    expect(result.transcript).toBe(
      'USER: First synthetic line.\n\nASSISTANT: Second synthetic line.',
    );
    expect(JSON.parse(result.jsonl.split('\n')[0])).toMatchObject({
      type: 'user',
      sessionId: 'writer-01',
      message: { role: 'user' },
    });
  });
});
