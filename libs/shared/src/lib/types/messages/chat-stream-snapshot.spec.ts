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

  it('accepts a resync with a live seed and complete block counts', () => {
    const payload = {
      ...base,
      events: undefined,
      resyncRequired: true,
      liveSeed: [{ eventType: 'message_start' }],
      liveSeedBlocks: { 'message-1': 2 },
    };
    expect(ChatStreamSnapshotPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('accepts block counts without seed events for deferred anchors', () => {
    const payload = {
      ...base,
      events: undefined,
      resyncRequired: true,
      liveSeedBlocks: { 'message-1': 0 },
    };
    expect(ChatStreamSnapshotPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('rejects live seed fields without resyncRequired', () => {
    for (const payload of [
      { ...base, liveSeed: [] },
      { ...base, liveSeedBlocks: { 'message-1': 1 } },
    ]) {
      expect(ChatStreamSnapshotPayloadSchema.safeParse(payload).success).toBe(false);
    }
  });

  it('rejects malformed live seed and block counts', () => {
    for (const payload of [
      { ...base, events: undefined, resyncRequired: true, liveSeed: 'bad' },
      { ...base, events: undefined, resyncRequired: true, liveSeedBlocks: { '': 1 } },
      { ...base, events: undefined, resyncRequired: true, liveSeedBlocks: { 'message-1': -1 } },
      { ...base, events: undefined, resyncRequired: true, liveSeedBlocks: { 'message-1': 1.5 } },
    ]) {
      expect(ChatStreamSnapshotPayloadSchema.safeParse(payload).success).toBe(false);
    }
  });
});
