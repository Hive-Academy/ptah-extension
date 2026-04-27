import { TabId, ConversationId, BackgroundAgentId, SurfaceId } from './ids';

describe('TASK_2026_106 Phase 1 — branded identity types', () => {
  const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
  const INVALID = 'not-a-uuid';

  describe.each([
    ['TabId', TabId],
    ['ConversationId', ConversationId],
    ['BackgroundAgentId', BackgroundAgentId],
    ['SurfaceId', SurfaceId],
  ] as const)('%s', (_name, Brand) => {
    it('create() mints a UUID v4 that validates', () => {
      const id = Brand.create();
      expect(typeof id).toBe('string');
      expect(Brand.validate(id)).toBe(true);
    });

    it('create() returns distinct ids on each call', () => {
      const a = Brand.create();
      const b = Brand.create();
      expect(a).not.toBe(b);
    });

    it('validate() rejects malformed strings', () => {
      expect(Brand.validate(INVALID)).toBe(false);
      expect(Brand.validate('')).toBe(false);
      expect(Brand.validate(VALID_UUID.slice(0, -1))).toBe(false);
    });

    it('validate() accepts a valid v4 UUID literal', () => {
      expect(Brand.validate(VALID_UUID)).toBe(true);
    });

    it('from() casts a valid string to the brand', () => {
      const id = Brand.from(VALID_UUID);
      expect(id).toBe(VALID_UUID);
    });

    it('from() throws on invalid input', () => {
      expect(() => Brand.from(INVALID)).toThrow(TypeError);
    });

    it('safeParse() returns the brand on valid input', () => {
      expect(Brand.safeParse(VALID_UUID)).toBe(VALID_UUID);
    });

    it('safeParse() returns null on invalid input', () => {
      expect(Brand.safeParse(INVALID)).toBeNull();
    });
  });

  it('the four brands are nominally distinct (compile-time guard)', () => {
    // This test exists to anchor the brand at compile time. If a future
    // refactor accidentally collapses the brands into a single nominal type,
    // the type assertions below will start compiling without the cast,
    // and the explicit unknown-cast hops here become redundant — surfacing
    // the regression in code review even if the test still passes at runtime.
    const tab = TabId.create();
    const conv = ConversationId.create();
    const bg = BackgroundAgentId.create();
    const surface = SurfaceId.create();

    // Crossing brands requires going through unknown — this is the contract.
    const tabAsConv = tab as unknown as ConversationId;
    const convAsBg = conv as unknown as BackgroundAgentId;
    const surfaceAsTab = surface as unknown as TabId;
    expect(tabAsConv).toBe(tab);
    expect(convAsBg).toBe(conv);
    expect(surfaceAsTab).toBe(surface);
    expect(bg).not.toBe(tab);
    expect(surface).not.toBe(tab);
    expect(surface).not.toBe(conv);
    expect(surface).not.toBe(bg);
  });
});
