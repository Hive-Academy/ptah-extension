import { workStateForStatus } from './work-state';

describe('workStateForStatus', () => {
  it.each([
    ['streaming', 'running'],
    ['resuming', 'running'],
    ['running', 'running'],
    ['background', 'running'],
    ['pending', 'queued'],
    ['draft', 'queued'],
    ['fresh', 'starting'],
    ['switching', 'starting'],
    ['paused', 'awaiting input'],
    ['awaiting-background', 'awaiting input'],
    ['completed', 'completed'],
    ['failed', 'failed'],
    ['timeout', 'failed'],
    ['killed', 'cancelled'],
    ['stopped', 'cancelled'],
    ['other', 'unknown'],
  ] as const)('maps %s to %s', (status, expected) => {
    expect(workStateForStatus(status)).toBe(expected);
  });

});
