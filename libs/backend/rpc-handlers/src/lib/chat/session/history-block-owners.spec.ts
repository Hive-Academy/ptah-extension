import type { FlatStreamEventUnion } from '@ptah-extension/shared';
import {
  selectDeliveredBlockOwners,
  selectDeliveredSyntheticResults,
} from './history-block-owners';

function event(eventType: string): FlatStreamEventUnion {
  return { eventType } as FlatStreamEventUnion;
}

describe('delivered history metadata', () => {
  it('omits every owner entry when a page cuts its first block', () => {
    const first = event('text_delta');
    const second = event('text_delta');
    const other = event('tool_start');
    const full = [first, second, other];
    const owners = new Map([[first, 'X'], [second, 'X'], [other, 'Y']]);

    expect(selectDeliveredBlockOwners(full, full.slice(1), owners)).toEqual({
      '1': 'Y',
    });
    expect(selectDeliveredBlockOwners(full, full, owners)).toEqual({
      '0': 'X',
      '1': 'X',
      '2': 'Y',
    });
  });

  it('returns only synthetic result indices present in the delivered page', () => {
    const cut = event('tool_result');
    const persisted = event('tool_result');
    const synthetic = event('tool_result');
    expect(
      selectDeliveredSyntheticResults(
        [persisted, synthetic],
        new Set([cut, synthetic]),
      ),
    ).toEqual([1]);
  });
});
