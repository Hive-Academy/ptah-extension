import { EpisodeTracker } from './episode-tracker';

describe('EpisodeTracker', () => {
  it('reports an empty snapshot for an unknown session', () => {
    const t = new EpisodeTracker();
    const snap = t.snapshot('s1');
    expect(snap.isEmpty).toBe(true);
    expect(snap.turnCount).toBe(0);
    expect(t.buildTranscript('s1')).toBe('');
  });

  it('counts turns and buffers assistant messages', () => {
    const t = new EpisodeTracker();
    expect(t.recordTurn('s1', 'first turn')).toBe(1);
    expect(t.recordTurn('s1', 'second turn')).toBe(2);
    const snap = t.snapshot('s1');
    expect(snap.turnCount).toBe(2);
    expect(snap.assistantMessages).toEqual(['first turn', 'second turn']);
    expect(t.buildTranscript('s1')).toContain('first turn');
  });

  it('caps buffered assistant messages', () => {
    const t = new EpisodeTracker();
    for (let i = 0; i < 40; i++) t.recordTurn('s1', `m${i}`);
    const snap = t.snapshot('s1');
    expect(snap.turnCount).toBe(40);
    expect(snap.assistantMessages.length).toBeLessThanOrEqual(15);
    expect(snap.assistantMessages.at(-1)).toBe('m39');
  });

  it('detects error→recovery as critical learning with salience boost', () => {
    const t = new EpisodeTracker();
    t.recordFailure('s1', 'Bash', 'tests failed');
    expect(t.recordToolSuccess('s1', 'Edit')).toBe(false);
    expect(t.recordToolSuccess('s1', 'Bash')).toBe(true);
    const snap = t.snapshot('s1');
    expect(snap.hasCriticalLearning).toBe(true);
    expect(snap.recoveredTools).toContain('Bash');
    expect(t.salienceBoost('s1')).toBeCloseTo(0.2);
    expect(t.buildTranscript('s1')).toContain('Recovered after failure');
  });

  it('boosts committed work and combines with critical learning', () => {
    const t = new EpisodeTracker();
    t.recordCommit('s1');
    expect(t.salienceBoost('s1')).toBeCloseTo(0.1);
    t.recordFailure('s1', 'Bash', 'x');
    t.recordToolSuccess('s1', 'Bash');
    expect(t.salienceBoost('s1')).toBeCloseTo(0.3);
  });

  it('reset clears a single session; clear wipes all', () => {
    const t = new EpisodeTracker();
    t.recordTurn('s1', 'a');
    t.recordTurn('s2', 'b');
    t.reset('s1');
    expect(t.snapshot('s1').isEmpty).toBe(true);
    expect(t.snapshot('s2').isEmpty).toBe(false);
    t.clear();
    expect(t.snapshot('s2').isEmpty).toBe(true);
  });

  it('caps buffered failures at MAX_FAILURES, dropping the oldest', () => {
    const t = new EpisodeTracker();
    for (let i = 0; i < 40; i++) t.recordFailure('s1', `Tool${i}`, `err${i}`);
    const snap = t.snapshot('s1');
    expect(snap.failures.length).toBe(30);
    expect(snap.failures.at(-1)).toEqual(
      expect.objectContaining({ tool: 'Tool39', error: 'err39' }),
    );
    expect(snap.failures[0]).toEqual(
      expect.objectContaining({ tool: 'Tool10' }),
    );
  });

  it('truncates a long assistant message to MAX_MESSAGE_CHARS', () => {
    const t = new EpisodeTracker();
    t.recordTurn('s1', 'x'.repeat(5000));
    const snap = t.snapshot('s1');
    expect(snap.assistantMessages[0].length).toBe(2000);
  });

  it('truncates a long failure error to MAX_MESSAGE_CHARS', () => {
    const t = new EpisodeTracker();
    t.recordFailure('s1', 'Bash', 'e'.repeat(5000));
    const snap = t.snapshot('s1');
    expect(snap.failures[0].error.length).toBe(2000);
  });

  it('ignores blank assistant messages but still advances the turn count', () => {
    const t = new EpisodeTracker();
    expect(t.recordTurn('s1', '   ')).toBe(1);
    expect(t.recordTurn('s1', null)).toBe(2);
    const snap = t.snapshot('s1');
    expect(snap.turnCount).toBe(2);
    expect(snap.assistantMessages).toEqual([]);
  });

  it('recovery only fires for a tool that previously failed', () => {
    const t = new EpisodeTracker();
    expect(t.recordToolSuccess('s1', 'Bash')).toBe(false);
    t.recordFailure('s1', 'Bash', 'boom');
    expect(t.recordToolSuccess('s1', 'Bash')).toBe(true);
    expect(t.recordToolSuccess('s1', 'Bash')).toBe(false);
    expect(t.snapshot('s1').recoveredTools).toEqual(['Bash']);
  });

  it('hasCriticalLearning requires both a failure and a recovery', () => {
    const t = new EpisodeTracker();
    t.recordFailure('s1', 'Bash', 'boom');
    expect(t.snapshot('s1').hasCriticalLearning).toBe(false);
    t.recordToolSuccess('s1', 'Bash');
    expect(t.snapshot('s1').hasCriticalLearning).toBe(true);
  });

  it('buildTranscript renders each populated section', () => {
    const t = new EpisodeTracker();
    t.recordTurn('s1', 'summarised the work');
    t.recordFailure('s1', 'Bash', 'npm test failed');
    t.recordToolSuccess('s1', 'Bash');
    t.recordCommit('s1');
    const transcript = t.buildTranscript('s1');
    expect(transcript).toContain('# Session episode — 1 assistant turn(s)');
    expect(transcript).toContain('## Assistant turn summaries');
    expect(transcript).toContain('- summarised the work');
    expect(transcript).toContain('## Tool failures encountered');
    expect(transcript).toContain('- Bash: npm test failed');
    expect(transcript).toContain('## Recovered after failure: Bash');
    expect(transcript).toContain('## Commits in this episode: 1');
  });

  it('buildTranscript omits sections with no content', () => {
    const t = new EpisodeTracker();
    t.recordCommit('s1');
    const transcript = t.buildTranscript('s1');
    expect(transcript).toContain('Commits in this episode: 1');
    expect(transcript).not.toContain('## Assistant turn summaries');
    expect(transcript).not.toContain('## Tool failures encountered');
    expect(transcript).not.toContain('## Recovered after failure');
  });

  it('isEmpty transitions: empty → false on any signal → empty after reset', () => {
    const t = new EpisodeTracker();
    expect(t.snapshot('s1').isEmpty).toBe(true);
    t.recordCommit('s1');
    expect(t.snapshot('s1').isEmpty).toBe(false);
    t.reset('s1');
    expect(t.snapshot('s1').isEmpty).toBe(true);
  });

  it('a lone tool failure makes the episode non-empty', () => {
    const t = new EpisodeTracker();
    t.recordFailure('s1', 'Bash', 'boom');
    expect(t.snapshot('s1').isEmpty).toBe(false);
  });

  it('a bare recovery with no prior failure leaves the episode empty', () => {
    const t = new EpisodeTracker();
    expect(t.recordToolSuccess('s1', 'Bash')).toBe(false);
    expect(t.snapshot('s1').isEmpty).toBe(true);
  });
});
