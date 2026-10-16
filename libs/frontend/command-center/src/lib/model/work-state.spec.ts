import { workStateForStatus } from './work-state';
import { runState } from '../components/command-center-projection.source';

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

  it('rolls up stopped and completed agents as cancelled', () => {
    expect(runState([{ status: 'stopped' }, { status: 'completed' }])).toBe(
      'cancelled',
    );
  });
});
