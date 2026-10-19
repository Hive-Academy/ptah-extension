import type { SubagentRecord } from '@ptah-extension/chat-streaming';
import { subagentProgressText } from './subagent-progress.utils';

describe('subagentProgressText', () => {
  const record: SubagentRecord = { parentToolUseId: 'tool', status: 'running' };

  it('prefers the latest summary', () => {
    expect(subagentProgressText({ ...record, latestSummary: 'Checking files', lastToolName: 'Read', description: 'Explore' })).toBe('Checking files');
  });

  it('uses the last tool when there is no summary', () => {
    expect(subagentProgressText({ ...record, lastToolName: 'Read', description: 'Explore' })).toBe('last: Read');
  });

  it('uses the description when no activity is known', () => {
    expect(subagentProgressText({ ...record, description: 'Explore' })).toBe('Explore');
  });

  it('returns null when there is no progress text', () => {
    expect(subagentProgressText(record)).toBeNull();
  });
});
