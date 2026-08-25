/**
 * `AgentId` smart constructors.
 *
 * The branded-ID rule (CLAUDE.md: "use branded IDs at every boundary") only
 * buys anything if the runtime guard actually rejects what the type forbids.
 * `AgentId.from` is the boundary version — it THROWS — and `safeParse` is the
 * version for data arriving off the wire, where a throw would take the whole
 * envelope down.
 */
import { AgentId } from './agent-process.types';

const VALID_V4 = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('AgentId.create', () => {
  it('produces a value its own validator accepts', () => {
    const id = AgentId.create();
    expect(AgentId.validate(id)).toBe(true);
  });

  it('produces a distinct value on every call', () => {
    const ids = new Set(Array.from({ length: 50 }, () => AgentId.create()));
    expect(ids.size).toBe(50);
  });
});

describe('AgentId.validate', () => {
  it('accepts a canonical v4 uuid in either case', () => {
    expect(AgentId.validate(VALID_V4)).toBe(true);
    expect(AgentId.validate(VALID_V4.toUpperCase())).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['not a uuid', 'agent-1'],
    ['wrong version nibble', '3f2504e0-4f89-11d3-9a0c-0305e82c3301'],
    ['wrong variant nibble', '3f2504e0-4f89-41d3-1a0c-0305e82c3301'],
    ['missing a group', '3f2504e0-4f89-41d3-0305e82c3301'],
    ['too short', '3f2504e0-4f89-41d3-9a0c-0305e82c330'],
    ['non-hex character', '3f2504e0-4f89-41d3-9a0c-0305e82c330g'],
    ['no separators', '3f2504e04f8941d39a0c0305e82c3301'],
    ['surrounding whitespace', ` ${VALID_V4} `],
  ])('rejects %s', (_label, candidate) => {
    expect(AgentId.validate(candidate)).toBe(false);
  });

  it('is anchored, so a valid uuid embedded in junk is rejected', () => {
    expect(AgentId.validate(`prefix${VALID_V4}suffix`)).toBe(false);
  });
});

describe('AgentId.from', () => {
  it('returns the id unchanged when it is valid', () => {
    expect(AgentId.from(VALID_V4)).toBe(VALID_V4);
  });

  it('throws a TypeError naming the offending value', () => {
    // The message has to carry the value — a bare "invalid id" gives the
    // reader nothing to grep the logs for.
    expect(() => AgentId.from('agent-1')).toThrow(TypeError);
    expect(() => AgentId.from('agent-1')).toThrow(/agent-1/);
  });
});

describe('AgentId.safeParse', () => {
  it('returns the id for a valid value', () => {
    expect(AgentId.safeParse(VALID_V4)).toBe(VALID_V4);
  });

  it('returns null rather than throwing for an invalid value', () => {
    // This is the wire-boundary version: one bad id must not take the
    // envelope down.
    expect(AgentId.safeParse('agent-1')).toBeNull();
    expect(AgentId.safeParse('')).toBeNull();
  });
});
