import type { ExecutionNode } from '@ptah-extension/shared';
import {
  compareTranscriptItems,
  type AppsTranscriptItem,
} from './apps-transcript-order';

const user = (key: string, at: number): AppsTranscriptItem => ({
  kind: 'user',
  key,
  at,
  text: key,
});

const node = (key: string, at: number): AppsTranscriptItem => ({
  kind: 'node',
  key,
  at,
  node: { id: key } as ExecutionNode,
});

const order = (items: AppsTranscriptItem[]) =>
  [...items].sort(compareTranscriptItems).map((item) => item.key);

describe('compareTranscriptItems (codex S1)', () => {
  it('orders by time', () => {
    expect(order([node('reply', 20), user('prompt', 10)])).toEqual([
      'prompt',
      'reply',
    ]);
  });

  it('puts a bubble before the node sharing its millisecond, whatever the input order', () => {
    expect(order([node('reply', 10), user('submitted', 10)])).toEqual([
      'submitted',
      'reply',
    ]);
    expect(order([user('submitted', 10), node('reply', 10)])).toEqual([
      'submitted',
      'reply',
    ]);
  });

  it('keeps the input order of items of the same kind and time', () => {
    expect(
      order([user('typed', 10), user('submitted', 10), node('a', 5)]),
    ).toEqual(['a', 'typed', 'submitted']);
  });

  it('puts an unstamped node (Infinity) last without breaking the order', () => {
    expect(
      order([
        node('building', Number.POSITIVE_INFINITY),
        user('prompt', 10),
        node('done', 20),
        node('also-building', Number.POSITIVE_INFINITY),
      ]),
    ).toEqual(['prompt', 'done', 'building', 'also-building']);
  });
});
