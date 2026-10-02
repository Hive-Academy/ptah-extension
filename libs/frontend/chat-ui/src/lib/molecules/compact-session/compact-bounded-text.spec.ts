import { boundedText } from './compact-bounded-text';

describe(boundedText.name, () => {
  it.each([
    [{ a: 1, b: 'x', c: [true, null, undefined], d: undefined }],
    [[1, 'two', { three: [3] }]],
    [{ when: new Date(0), n: Number.NaN }],
  ])('writes plain JSON data as JSON.stringify does: %j', (value) => {
    expect(boundedText(value, 10_000)).toBe(JSON.stringify(value));
  });

  it('passes strings through, cut to the limit, and empties nullish values', () => {
    expect(boundedText('e'.repeat(50), 10)).toBe('e'.repeat(10));
    expect(boundedText(null, 10)).toBe('');
    expect(boundedText(undefined, 10)).toBe('');
  });

  it('stops walking a large value once the limit is reached', () => {
    const visited = jest.fn(() => 1);
    const rows = Array.from({ length: 10_000 }, () => ({
      get value() {
        return visited();
      },
    }));

    const text = boundedText({ rows }, 50);

    expect(text).toHaveLength(50);
    expect(visited.mock.calls.length).toBeLessThan(20);
  });

  it('writes a circular reference as null instead of throwing', () => {
    const value: Record<string, unknown> = { a: 1 };
    value['self'] = value;

    expect(boundedText(value, 100)).toBe('{"a":1,"self":null}');
  });
});
