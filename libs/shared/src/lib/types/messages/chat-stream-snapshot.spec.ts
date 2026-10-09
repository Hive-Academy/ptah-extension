import { ChatStreamSnapshotPayloadSchema } from './schemas';

describe('ChatStreamSnapshotPayloadSchema', () => {
  const base = {
    protocolVersion: 2,
    tabId: 'tab-1',
    fromSequence: 4,
    toSequence: 5,
    events: [{ eventType: 'text_delta' }],
  };

  it('accepts the ordered v2 event snapshot', () => {
    expect(ChatStreamSnapshotPayloadSchema.parse(base)).toEqual(base);
  });

  it('rejects malformed snapshot protocol and recovery shapes', () => {
    for (const payload of [
      { ...base, protocolVersion: 3 },
      { ...base, toSequence: 3 },
      { ...base, resyncRequired: true },
      {
        protocolVersion: 2,
        tabId: 'tab-1',
        fromSequence: 5,
        toSequence: 5,
      },
    ]) {
      expect(ChatStreamSnapshotPayloadSchema.safeParse(payload).success).toBe(
        false,
      );
    }
  });

  it('accepts the explicit resync shape without an event tail', () => {
    expect(
      ChatStreamSnapshotPayloadSchema.parse({
        protocolVersion: 2,
        tabId: 'tab-1',
        fromSequence: 9,
        toSequence: 9,
        resyncRequired: true,
      }),
    ).toMatchObject({ resyncRequired: true });
  });
});
