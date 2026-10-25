import type { CliOutputSegment } from '@ptah-extension/shared';
import { appendMergingProse } from './agent-output-frame';

describe('appendMergingProse', () => {
  it('merges prose of the same message into the last segment', () => {
    const target: CliOutputSegment[] = [
      { type: 'text', content: 'Now ', messageId: 'a' },
    ];
    appendMergingProse(target, [
      { type: 'text', content: 'delegating.', messageId: 'a' },
    ]);
    expect(target).toEqual([
      { type: 'text', content: 'Now delegating.', messageId: 'a' },
    ]);
  });

  // TASK_2026_717: two provider messages must stay two text blocks.
  it('keeps text of another message as its own segment', () => {
    const target: CliOutputSegment[] = [
      { type: 'text', content: 'Delegating.', messageId: 'a' },
    ];
    appendMergingProse(target, [
      { type: 'text', content: 'Done.', messageId: 'b' },
    ]);
    expect(target.map((segment) => segment.content)).toEqual([
      'Delegating.',
      'Done.',
    ]);
  });
});
